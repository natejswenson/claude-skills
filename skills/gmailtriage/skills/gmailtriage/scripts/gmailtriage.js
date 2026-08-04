#!/usr/bin/env node
/**
 * gmailtriage — the deterministic half of the skill.
 *
 * The Gmail MCP is agent-side, so this binary never touches a mailbox. The
 * agent fetches threads and the agent trashes them; everything that must not
 * depend on a model behaving well lives here — which threads a rule takes,
 * whether a thread was authorised, and what was actually moved.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

import { validateRuleSet, validateRule, toGmailQuery, RuleProblem } from './lib/rules.mjs';
import { propose, candidateToRule, plan, authorise, buildReceipt, NotAuthorised } from './lib/plan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const VERSION = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8')).version;

function argv(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a.startsWith('--')) {
      const [k, inline] = a.slice(2).split('=');
      const key = k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (inline !== undefined) out[key] = inline;
      else if (args[i + 1] && !args[i + 1].startsWith('--')) { out[key] = args[i + 1]; i += 1; }
      else out[key] = true;
    } else out._.push(a);
  }
  return out;
}

export const table = (headers, rows) => {
  if (rows.length === 0) return '';
  const w = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i] ?? '').length)));
  const line = (c) => `| ${c.map((x, i) => String(x ?? '').padEnd(w[i])).join(' | ')} |`;
  return [line(headers), `|${w.map((x) => '-'.repeat(x + 2)).join('|')}|`, ...rows.map(line)].join('\n');
};

const readJson = (p, what) => {
  const f = resolve(p);
  if (!existsSync(f)) throw new Error(`${what}: no such file — ${f}`);
  return JSON.parse(readFileSync(f, 'utf8'));
};

const writeJson = (p, v) => {
  const f = resolve(p);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, JSON.stringify(v, null, 2) + '\n');
  return f;
};

const defaultRules = () => join(homedir(), '.gmailtriage', 'rules.json');
const trim = (s, n) => (String(s ?? '').length > n ? String(s).slice(0, n - 1) + '…' : String(s ?? ''));

// ── propose ─────────────────────────────────────────────────────────────────

async function cmdPropose(args) {
  const threads = readJson(args.threads ?? '', 'propose: --threads <file.json> of fetched threads');
  const { candidates, withheld, sampled } = propose(threads, { minCount: Number(args.minCount ?? 3) });

  console.log(table(['Rule id', 'Sender', 'In sample', 'Bulk', 'Example subject'],
    candidates.map((c) => [c.id, c.from, c.count, c.bulkCount, trim(c.sample, 46)])));

  if (withheld.length) {
    console.log('');
    console.log(table(['Withheld sender', 'In sample', 'Why not proposed'],
      withheld.slice(0, Number(args.showWithheld ?? 8)).map((w) => [w.from, w.count, w.why])));
  }

  console.log('');
  console.log(table(['Sampled', 'Proposed', 'Withheld'], [[sampled, candidates.length, withheld.length]]));
  console.log('\nnothing has been trashed — these are candidates. Accept the ones you want with `rules --add`.');

  if (args.out) console.error(`wrote ${writeJson(args.out, { candidates: candidates.map(candidateToRule), withheld })}`);
}

// ── rules ───────────────────────────────────────────────────────────────────

async function cmdRules(args) {
  const file = resolve(args.file ?? defaultRules());
  let doc = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { version: 1, rules: [] };

  if (args.add) {
    const incoming = readJson(args.add, 'rules --add <file.json>');
    const list = Array.isArray(incoming) ? incoming : incoming.candidates ?? incoming.rules ?? [incoming];
    for (const r of list) validateRule(r);
    const byId = new Map(doc.rules.map((r) => [r.id, r]));
    for (const r of list) byId.set(r.id, r);
    doc = { ...doc, rules: [...byId.values()] };
  }

  const rows = validateRuleSet(doc);   // throws before anything is written
  if (args.add) writeJson(file, doc);

  console.log(table(['Rule id', 'Action', 'Matches on', 'Gmail query'],
    rows.map((r) => [r.id, r.action, r.fields.join(', '), trim(r.query, 52)])));
  console.log('');
  console.log(table(['Rules', 'Trash', 'Keep', 'File'], [[
    rows.length,
    rows.filter((r) => r.action === 'trash').length,
    rows.filter((r) => r.action === 'keep').length,
    file.replace(homedir(), '~'),
  ]]));
}

// ── plan ────────────────────────────────────────────────────────────────────

async function cmdPlan(args) {
  const threads = readJson(args.threads ?? '', 'plan: --threads <file.json>');
  const doc = readJson(args.rules ?? defaultRules(), 'plan: rule file');
  validateRuleSet(doc);
  const p = plan(threads, doc);

  const byRule = new Map();
  for (const t of p.taken) byRule.set(t.ruleId, (byRule.get(t.ruleId) ?? 0) + 1);

  console.log(table(['Rule id', 'Action', 'Threads'],
    [...byRule].map(([id, n]) => [id, doc.rules.find((r) => r.id === id)?.action ?? '?', n])));

  const preview = p.taken.slice(0, Number(args.preview ?? 12));
  if (preview.length) {
    console.log('');
    console.log(table(['Rule id', 'From', 'Subject'],
      preview.map((t) => [t.ruleId, trim(t.from, 30), trim(t.subject, 46)])));
    if (p.taken.length > preview.length) console.log(`\n${p.taken.length - preview.length} more not shown — \`--preview N\` to widen.`);
  }

  if (p.overlaps.length) {
    console.log('');
    console.log(table(['Claimed by more than one rule', 'Rules'],
      p.overlaps.slice(0, 6).map((o) => [trim(o.subject, 44), o.ruleIds.join(', ')])));
    console.log('the first matching rule owns a thread, so attribution stays unambiguous.');
  }

  console.log('');
  console.log(table(['Scanned', 'Would trash', 'Kept by a keep rule', 'Overlaps'],
    [[p.scanned, p.taken.filter((t) => t.action === 'trash').length, p.spared.length, p.overlaps.length]]));
  console.log('\nnothing has been trashed — this is what the rules would take.');

  if (args.out) console.error(`wrote ${writeJson(args.out, p)}`);
}

// ── apply ───────────────────────────────────────────────────────────────────

async function cmdApply(args) {
  const p = readJson(args.plan ?? '', 'apply: --plan <plan.json>');
  const requested = args.trash ? readJson(args.trash, 'apply: --trash <ids.json>') : null;

  // Throws when a requested thread is not in the plan. No receipt is written,
  // and the agent is told exactly which ids had no rule behind them.
  const entries = authorise(p, requested);
  const receipt = buildReceipt(entries, { at: args.at ?? new Date().toISOString() });

  const byRule = new Map();
  for (const e of entries) byRule.set(e.ruleId, (byRule.get(e.ruleId) ?? 0) + 1);

  console.log(table(['Rule id', 'Authorised threads'], [...byRule].map(([id, n]) => [id, n])));
  console.log('');
  console.log(table(['Authorised', 'Refused'], [[entries.length, 0]]));

  const out = args.receipt ?? join(homedir(), '.gmailtriage', `receipt-${receipt.at.replace(/[:.]/g, '-')}.json`);
  console.error(`wrote ${writeJson(out, receipt)}`);
  console.log('\ntrash exactly these thread ids and nothing else:');
  console.log(entries.map((e) => e.threadId).join('\n'));
}

// ── undo ────────────────────────────────────────────────────────────────────

async function cmdUndo(args) {
  const r = readJson(args.receipt ?? '', 'undo: --receipt <receipt.json>');
  const entries = r.entries ?? [];
  if (entries.length === 0) throw new Error('undo: that receipt records no threads');

  console.log(table(['Thread id', 'Taken by', 'From', 'Subject'],
    entries.slice(0, Number(args.preview ?? 15)).map((e) => [e.threadId, e.ruleId, trim(e.from, 26), trim(e.subject, 40)])));
  console.log('');
  console.log(table(['To restore', 'Trashed at'], [[entries.length, r.at]]));
  console.log('\nremove the TRASH label from exactly these thread ids:');
  console.log(entries.map((e) => e.threadId).join('\n'));
}

const USAGE = `gmailtriage v${VERSION} — triage a Gmail inbox against rules you wrote.

  gmailtriage propose --threads <f.json> [--min-count N] [--out <f.json>]
  gmailtriage rules   [--file <rules.json>] [--add <f.json>]
  gmailtriage plan    --threads <f.json> [--rules <f.json>] [--preview N] [--out <plan.json>]
  gmailtriage apply   --plan <plan.json> [--trash <ids.json>] [--receipt <f.json>]
  gmailtriage undo    --receipt <f.json>

This binary never touches Gmail. The agent fetches and trashes; this decides
what a rule may take, and refuses anything a rule did not name.
`;

async function main() {
  const args = argv(process.argv.slice(2));
  const cmd = args._[0];
  if (args.version) return console.log(VERSION);
  try {
    switch (cmd) {
      case 'propose': return await cmdPropose(args);
      case 'rules': return await cmdRules(args);
      case 'plan': return await cmdPlan(args);
      case 'apply': return await cmdApply(args);
      case 'undo': return await cmdUndo(args);
      default:
        console.log(USAGE);
        process.exitCode = cmd ? 2 : 0;
    }
  } catch (err) {
    const tag = err instanceof NotAuthorised ? 'REFUSED' : err instanceof RuleProblem ? 'rule' : 'gmailtriage';
    console.error(`${tag}: ${err.message}`);
    process.exitCode = 1;
  }
}

main();

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

import { validateRuleSet, validateRule, toGmailQuery, reconcileDestinations, SYSTEM_LABELS, RuleProblem } from './lib/rules.mjs';
import { propose, candidateToRule, candidateToSortRule, plan, authorise, buildReceipt, undoPlan, NotAuthorised } from './lib/plan.mjs';

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

// ── setup ───────────────────────────────────────────────────────────────────

/**
 * Where this mailbox stands, and the single next thing to do.
 *
 * A first run should never open with an empty table. This says, in one look,
 * whether any rules exist, and it is the only command safe to run before
 * anything has been configured.
 */
async function cmdSetup(args) {
  const file = resolve(args.file ?? defaultRules());
  const exists = existsSync(file);
  let rows = [];
  let broken = null;
  if (exists) {
    try { rows = validateRuleSet(JSON.parse(readFileSync(file, 'utf8'))); }
    catch (e) { broken = e.message; }
  }

  const first = !exists || rows.length === 0;
  console.log(table(['State', 'Rules', 'Rule file'], [[
    broken ? 'rule file will not load' : first ? 'first run — no rules yet' : 'ready',
    broken ? '—' : rows.length,
    file.replace(homedir(), '~'),
  ]]));

  if (broken) {
    console.log(`\nthe rule file exists but does not validate: ${broken}`);
    console.log('fix it, or move it aside and start again — nothing will run against a rule set that does not load.');
    process.exitCode = 1;
    return;
  }

  if (first) {
    console.log(`
Nothing is configured yet, and nothing moves until you say so.

  1. I read a slice of your inbox, plus the labels you already have, and
     cluster your mail by sender.
  2. You get candidate rules drawn from YOUR mail — with counts and an example
     subject. Two kinds:
       • trash — bulk mail you do not read
       • sort  — mail worth keeping, filed into one of your folders and taken
                 out of the inbox
     Plus the senders I refused to suggest trashing, and why. Most of those are
     the best things to sort.
  3. You accept the ones you want. Those become your rules.
  4. Every later run plans first, and only ever moves what a rule you accepted
     named. Nothing is deleted: trash is recoverable for 30 days, a filed thread
     is one label away from where it was, and \`undo\` reverses a whole run.

Next: fetch a sample and your label list, then \`propose\`.`);
    return;
  }

  console.log(table(['Rule id', 'Action', 'Destination', 'Matches on'],
    rows.map((r) => [r.id, r.action, r.label ?? '—', r.fields.join(', ')])));
  console.log('\nNext: fetch a sample, then `plan`.');
}

// ── propose ─────────────────────────────────────────────────────────────────

/**
 * `list_labels` returns objects; a hand-written file may be a bare array of
 * names.
 *
 * System labels are filtered **by name**, not by a `type` field. The live API
 * returns `{labelId, name, messagesTotal, …}` with no type at all, so trusting
 * a type would let INBOX, TRASH, SENT and SPAM through as if they were the
 * user's own folders — which is how "your labels: 24" becomes a number that is
 * wrong by every system label the mailbox has, and how TRASH becomes a
 * destination `propose` is willing to match a sender to.
 */
const readLabels = (p) => {
  if (!p) return [];
  const raw = readJson(p, '--labels <file.json> from list_labels');
  const list = Array.isArray(raw) ? raw : raw.labels ?? raw.result ?? [];
  return list
    .map((l) => (typeof l === 'string'
      ? { name: l, id: null }
      : { name: l?.name ?? l?.label, id: l?.labelId ?? l?.id ?? null }))
    .filter((l) => l.name)
    .filter((l) => {
      if (String(l.type ?? '').toLowerCase() === 'system') return false;
      const upper = l.name.toUpperCase();
      return !SYSTEM_LABELS.includes(upper) && !upper.startsWith('CATEGORY_');
    });
};

async function cmdPropose(args) {
  const threads = readJson(args.threads ?? '', 'propose: --threads <file.json> of fetched threads');
  const labels = readLabels(args.labels);
  const r = propose(threads, { minCount: Number(args.minCount ?? 3), labels });
  const { candidates, sortable, withheld, below, reason, sortReason, unhoused, sampled } = r;

  console.log('TRASH — bulk mail a rule would move to the trash\n');
  if (candidates.length) {
    console.log(table(['Rule id', 'Sender', 'In sample', 'Bulk', 'Example subject'],
      candidates.map((c) => [c.id, c.from, c.count, c.bulkCount, trim(c.sample, 46)])));
  } else {
    console.log(`No trash candidates — ${reason.text}`);
    if (below.length) {
      console.log('');
      console.log(table(['Closest sender', 'In sample', 'Why not proposed'],
        below.slice(0, 5).map((b) => [b.from, b.count, b.why])));
    }
  }

  console.log('\nSORT — mail worth keeping, filed out of the inbox\n');
  if (sortable.length) {
    console.log(table(['Rule id', 'Sender', 'In sample', 'Destination', 'Folder', 'Leaves inbox'],
      sortable.map((s) => [
        s.id, trim(s.from, 34), s.count,
        s.destination ?? '— needs a name —',
        s.destination ? 'exists' : 'NEW',
        s.keepInInbox ? 'no — tagged in place' : 'yes',
      ])));
    if (unhoused) {
      console.log(`\n${unhoused} sender(s) have no folder that fits. Naming one is your call, not mine —`);
      console.log('a folder name is a decision about how you think, and nothing in the mail says it.');
    }
  } else {
    console.log(`No sort candidates — ${sortReason.text}`);
  }

  if (withheld.length) {
    console.log('');
    console.log(table(['Withheld from trash', 'In sample', 'Why not proposed'],
      withheld.slice(0, Number(args.showWithheld ?? 8)).map((w) => [w.from, w.count, w.why])));
    // State the real count. "most of these can still be sorted" is a claim,
    // and when it is 2 of 16 it is a wrong one.
    console.log(`withheld from TRASHING, not from sorting — ${sortable.length} of these ${withheld.length} appear in the sort table above.`);
  }

  console.log('');
  console.log(table(['Sampled', 'Your labels', 'Trash', 'Sort', 'Need a new folder', 'Withheld', 'Below threshold'],
    [[sampled, labels.length, candidates.length, sortable.length, unhoused, withheld.length, below.length]]));
  console.log('\nnothing has moved — these are candidates. Accept the ones you want with `rules --add`.');

  if (args.out) {
    console.error(`wrote ${writeJson(args.out, {
      candidates: candidates.map(candidateToRule),
      // Only the housed ones become rules here. An unhoused candidate has no
      // destination, and inventing one is the judgment this script does not
      // have — it is carried through unchanged for the agent to name.
      sortCandidates: sortable.filter((s) => !s.unhoused).map((s) => candidateToSortRule(s)),
      unhoused: sortable.filter((s) => s.unhoused),
      withheld,
    })}`);
  }
}

// ── rules ───────────────────────────────────────────────────────────────────

async function cmdRules(args) {
  const file = resolve(args.file ?? defaultRules());
  let doc = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { version: 1, rules: [] };

  if (args.add) {
    const incoming = readJson(args.add, 'rules --add <file.json>');
    const list = Array.isArray(incoming)
      ? incoming
      : incoming.candidates || incoming.sortCandidates
        // A propose output carries both halves. Taking only one silently drops
        // every sort rule the user just accepted, and the summary table below
        // would still look right.
        ? [...(incoming.candidates ?? []), ...(incoming.sortCandidates ?? [])]
        : incoming.rules ?? [incoming];
    if (list.length === 0) throw new Error('rules --add: that file contains no rules to add');
    for (const r of list) validateRule(r);
    const byId = new Map(doc.rules.map((r) => [r.id, r]));
    for (const r of list) byId.set(r.id, r);
    doc = { ...doc, rules: [...byId.values()] };
  }

  const rows = validateRuleSet(doc);   // throws before anything is written
  if (args.add) writeJson(file, doc);

  console.log(table(['Rule id', 'Action', 'Destination', 'Leaves inbox', 'Matches on', 'Gmail query'],
    rows.map((r) => [
      r.id, r.action, r.label ?? '—',
      r.action === 'label' ? (r.archives ? 'yes' : 'no') : '—',
      r.fields.join(', '), trim(r.query, 46),
    ])));
  console.log('');
  console.log(table(['Rules', 'Trash', 'Sort', 'Keep', 'Folders', 'File'], [[
    rows.length,
    rows.filter((r) => r.action === 'trash').length,
    rows.filter((r) => r.action === 'label').length,
    rows.filter((r) => r.action === 'keep').length,
    new Set(rows.filter((r) => r.action === 'label').map((r) => r.label)).size,
    file.replace(homedir(), '~'),
  ]]));

  if (rows.some((r) => r.action === 'label')) {
    console.log('\nrun `labels --labels <list_labels.json>` before applying — a folder Gmail does not');
    console.log('have is a failed call halfway through a run, with some mail moved and some not.');
  }
}

// ── labels ──────────────────────────────────────────────────────────────────

/**
 * Reconcile every destination the rules need against the labels the mailbox
 * actually has, and refuse to pass until each one exists.
 *
 * This is the gate that keeps `apply` all-or-nothing in practice as well as in
 * principle. Without it, a run against a folder that was never created fails on
 * thread 27 of 50 — half the mail moved, and a receipt describing a mailbox
 * state that no longer exists.
 */
async function cmdLabels(args) {
  const doc = readJson(args.rules ?? defaultRules(), 'labels: rule file');
  validateRuleSet(doc);
  const existing = readLabels(args.labels);
  const dests = reconcileDestinations(doc, existing);

  if (dests.length === 0) {
    console.log(table(['Destinations', 'Your labels', 'To create'], [[0, existing.length, 0]]));
    console.log('\nno rule files anything yet — nothing to reconcile.');
    return;
  }

  // The label id is the point of this table, not decoration: `label_thread`
  // takes ids, never names, so a run that has only the name is a run that has
  // to guess the mapping.
  console.log(table(['Destination', 'Status', 'Label id', 'Used by'],
    dests.map((d) => [d.name, d.exists ? 'exists' : 'NEEDS CREATE', d.labelId ?? '—', d.ruleIds.join(', ')])));

  const variants = dests.filter((d) => d.variants.length);
  if (variants.length) {
    console.log('');
    console.log(table(['One folder, spelled two ways', 'Would be created as'],
      variants.map((d) => [[d.name, ...d.variants].join(' / '), d.name])));
    console.log('these are one folder, not two. Fix the spelling if that is not what you meant.');
  }

  const missing = dests.filter((d) => !d.exists);
  console.log('');
  console.log(table(['Destinations', 'Your labels', 'To create'], [[dests.length, existing.length, missing.length]]));

  if (missing.length) {
    console.log('\ncreate exactly these labels, then re-run this command:');
    console.log(missing.map((d) => d.name).join('\n'));
    process.exitCode = 1;
    return;
  }
  console.log('\nevery folder these rules need already exists. Safe to plan and apply.');
}

// ── plan ────────────────────────────────────────────────────────────────────

async function cmdPlan(args) {
  const threads = readJson(args.threads ?? '', 'plan: --threads <file.json>');
  const doc = readJson(args.rules ?? defaultRules(), 'plan: rule file');
  validateRuleSet(doc);
  const p = plan(threads, doc);

  const byRule = new Map();
  for (const t of p.taken) byRule.set(t.ruleId, (byRule.get(t.ruleId) ?? 0) + 1);

  console.log(table(['Rule id', 'Action', 'Destination', 'Leaves inbox', 'Threads'],
    [...byRule].map(([id, n]) => {
      const r = doc.rules.find((x) => x.id === id);
      const isSort = r?.action === 'label';
      return [id, r?.action ?? '?', isSort ? r.label : '—', isSort ? (r.keepInInbox === true ? 'no' : 'yes') : '—', n];
    })));

  const preview = p.taken.slice(0, Number(args.preview ?? 12));
  if (preview.length) {
    console.log('');
    console.log(table(['Rule id', 'Goes to', 'From', 'Subject'],
      preview.map((t) => [t.ruleId, t.action === 'label' ? trim(t.label, 20) : 'trash', trim(t.from, 30), trim(t.subject, 40)])));
    if (p.taken.length > preview.length) console.log(`\n${p.taken.length - preview.length} more not shown — \`--preview N\` to widen.`);
  }

  if (p.overlaps.length) {
    console.log('');
    console.log(table(['Claimed by more than one rule', 'Rules'],
      p.overlaps.slice(0, 6).map((o) => [trim(o.subject, 44), o.ruleIds.join(', ')])));
    console.log('the first matching rule owns a thread, so attribution stays unambiguous.');
  }

  if (p.destinations.length) {
    console.log('');
    console.log(table(['Folder', 'Threads'],
      p.destinations.map((d) => [d, p.taken.filter((t) => t.label === d).length])));
    console.log('reconcile these against your real labels with `labels` before applying.');
  }

  console.log('');
  console.log(table(['Scanned', 'Would trash', 'Would file', 'Would leave the inbox', 'Kept by a keep rule', 'Overlaps'],
    [[
      p.scanned,
      p.taken.filter((t) => t.action === 'trash').length,
      p.taken.filter((t) => t.action === 'label').length,
      p.taken.filter((t) => t.action === 'label' && t.archive).length,
      p.spared.length,
      p.overlaps.length,
    ]]));
  console.log('\nnothing has moved — this is what the rules would do.');

  if (args.out) console.error(`wrote ${writeJson(args.out, p)}`);
}

// ── apply ───────────────────────────────────────────────────────────────────

async function cmdApply(args) {
  const p = readJson(args.plan ?? '', 'apply: --plan <plan.json>');
  const wantTrash = args.trash ? readJson(args.trash, 'apply: --trash <ids.json>') : null;
  const wantSort = args.sort ? readJson(args.sort, 'apply: --sort <ids.json>') : null;

  // Throws when a requested thread is not in the plan UNDER THAT ACTION. No
  // receipt is written, and the agent is told exactly which ids had no rule
  // behind them. Authorising both before writing anything keeps a run
  // all-or-nothing: a rogue id in either list stops the whole thing.
  const trashed = authorise(p, wantTrash, 'trash');
  const filed = authorise(p, wantSort, 'label');
  const entries = [...trashed, ...filed];
  if (entries.length === 0) throw new Error('apply: this plan authorises nothing — there is nothing to do');

  const receipt = buildReceipt(entries, { at: args.at ?? new Date().toISOString() });

  // Keyed on the rule id alone: a rule has exactly one action and one
  // destination, so a composite key would buy nothing and would split wrongly
  // the moment a folder name contains a space.
  const byRule = new Map();
  for (const e of entries) {
    if (!byRule.has(e.ruleId)) byRule.set(e.ruleId, { action: e.action, label: e.label, n: 0 });
    byRule.get(e.ruleId).n += 1;
  }

  console.log(table(['Rule id', 'Action', 'Destination', 'Authorised threads'],
    [...byRule].map(([id, r]) => [id, r.action === 'label' ? 'file' : r.action, r.label ?? '—', r.n])));
  console.log('');
  console.log(table(['Authorised', 'To trash', 'To file', 'To archive', 'Refused'], [[
    entries.length,
    trashed.length,
    filed.length,
    filed.filter((e) => e.archive).length,
    0,
  ]]));

  const out = args.receipt ?? join(homedir(), '.gmailtriage', `receipt-${receipt.at.replace(/[:.]/g, '-')}.json`);
  console.error(`wrote ${writeJson(out, receipt)}`);

  // Three separate instruction blocks, because they are three different calls.
  // Merging them would hand the agent a list of ids and leave it to infer what
  // to do with each — which is exactly the inference this skill exists to
  // remove from the model.
  if (trashed.length) {
    console.log('\nTRASH exactly these thread ids and nothing else:');
    console.log(trashed.map((e) => e.threadId).join('\n'));
  }
  const byLabel = new Map();
  for (const e of filed) {
    if (!byLabel.has(e.label)) byLabel.set(e.label, []);
    byLabel.get(e.label).push(e);
  }
  for (const [label, es] of byLabel) {
    console.log(`\nLABEL "${label}" onto exactly these thread ids and nothing else:`);
    console.log(es.map((e) => e.threadId).join('\n'));
  }
  const toArchive = filed.filter((e) => e.archive);
  if (toArchive.length) {
    console.log('\nthen REMOVE the INBOX label from exactly these thread ids — this is the "move":');
    console.log(toArchive.map((e) => e.threadId).join('\n'));
  }
  const stays = filed.filter((e) => !e.archive);
  if (stays.length) {
    console.log(`\n${stays.length} filed thread(s) stay in the inbox by rule. Do NOT remove INBOX from those.`);
  }
}

// ── undo ────────────────────────────────────────────────────────────────────

async function cmdUndo(args) {
  const r = readJson(args.receipt ?? '', 'undo: --receipt <receipt.json>');
  const entries = r.entries ?? [];
  if (entries.length === 0) throw new Error('undo: that receipt records no threads');

  // An entry with no `action` was written by 0.1.0, which could only trash.
  const u = undoPlan(r);

  console.log(table(['Thread id', 'Taken by', 'What happened', 'From', 'Subject'],
    entries.slice(0, Number(args.preview ?? 15)).map((e) => [
      e.threadId, e.ruleId,
      (e.action ?? 'trash') === 'trash' ? 'trashed' : `filed → ${e.label}${e.archived ? ' (left inbox)' : ''}`,
      trim(e.from, 24), trim(e.subject, 34),
    ])));
  console.log('');
  console.log(table(['To restore', 'Trashed', 'Filed', 'Left the inbox', 'Run at'],
    [[u.total, u.untrash.length, u.total - u.untrash.length, u.reinbox.length, r.at]]));

  // Three operations, listed separately, because reversing a trash and
  // reversing a move are not the same call. Removing TRASH from a thread that
  // was filed restores nothing and hides that it is still out of the inbox.
  if (u.untrash.length) {
    console.log('\nremove the TRASH label from exactly these thread ids:');
    console.log(u.untrash.map((e) => e.threadId).join('\n'));
  }
  for (const { label, entries: es } of u.unlabel) {
    console.log(`\nremove the "${label}" label from exactly these thread ids:`);
    console.log(es.map((e) => e.threadId).join('\n'));
  }
  if (u.reinbox.length) {
    console.log('\nthen ADD the INBOX label back to exactly these thread ids — they were archived:');
    console.log(u.reinbox.map((e) => e.threadId).join('\n'));
  }
}

const USAGE = `gmailtriage v${VERSION} — triage and sort a Gmail inbox against rules you wrote.

  gmailtriage setup   [--file <rules.json>]
  gmailtriage propose --threads <f.json> [--labels <f.json>] [--min-count N] [--out <f.json>]
  gmailtriage rules   [--file <rules.json>] [--add <f.json>]
  gmailtriage labels  --labels <f.json> [--rules <f.json>]
  gmailtriage plan    --threads <f.json> [--rules <f.json>] [--preview N] [--out <plan.json>]
  gmailtriage apply   --plan <plan.json> [--trash <ids.json>] [--sort <ids.json>] [--receipt <f.json>]
  gmailtriage undo    --receipt <f.json>

This binary never touches Gmail. The agent fetches, trashes, labels and
archives; this decides what a rule may take, and refuses anything a rule did
not name — for every action, not only for trashing.
`;

async function main() {
  const args = argv(process.argv.slice(2));
  const cmd = args._[0];
  if (args.version) return console.log(VERSION);
  try {
    switch (cmd) {
      case 'setup': return await cmdSetup(args);
      case 'propose': return await cmdPropose(args);
      case 'rules': return await cmdRules(args);
      case 'labels': return await cmdLabels(args);
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

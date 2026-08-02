#!/usr/bin/env node
/**
 * forge — the CLI half of the skill.
 *
 * Everything deterministic lives here so the agent never reshapes output with
 * sed/grep/jq in the transcript: one command returns everything a step needs,
 * already as a table. The agent's job is the conversation and the YAML; this
 * binary's job is facts.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { detect } from '../lib/detect.mjs';
import { verify, collectUses } from '../lib/verify.mjs';
import { inspectUses } from '../lib/resolve.mjs';
import { applyHeader, checkHeader } from '../lib/header.mjs';

const VERSION = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version;

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

const table = (headers, rows) => {
  if (rows.length === 0) return '';
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i] ?? '').length)));
  const line = (cells) => `| ${cells.map((c, i) => String(c ?? '').padEnd(widths[i])).join(' | ')} |`;
  return [line(headers), `|${widths.map((w) => '-'.repeat(w + 2)).join('|')}|`, ...rows.map(line)].join('\n');
};

const yes = (b) => (b ? 'yes' : 'no');

async function cmdDetect(args) {
  const repo = resolve(args.repo ?? '.');
  const d = await detect(repo);
  if (args.json) return console.log(JSON.stringify(d, null, 2));

  console.log(table(['Signal', 'Detected', 'From'], [
    ['ecosystem', d.ecosystem, d.ecosystem === 'node' ? 'package.json' : d.ecosystem === 'python' ? 'pyproject.toml' : 'manifest'],
    ['package manager', d.packageManager ?? '—', d.lockfile ?? 'no lockfile'],
    ['runtime version', d.runtime ?? 'unpinned', d.runtime ? 'version file' : 'nothing declares one'],
    ['test command', d.test ?? '—', d.test ? 'manifest' : 'none found'],
    ['lint command', d.lint ?? '—', d.lint ? 'manifest' : 'none found'],
    ['monorepo', yes(d.workspaces), 'workspaces'],
    ['default branch', d.defaultBranch ?? '—', 'gh'],
    ['visibility', d.visibility ?? '—', 'gh'],
    ['auto-merge', d.autoMerge === null ? '—' : yes(d.autoMerge), 'gh'],
  ]));

  if (d.workflows.length) {
    console.log(`\n${table(['Workflow', 'File', 'Jobs', 'forge header'], d.workflows.map((w) => [
      w.name, w.file, w.jobs.join(', ') || '—', yes(w.hasHeader),
    ]))}`);
  } else console.log('\nNo workflows yet.');

  if (d.requiredChecks.length) {
    console.log(`\nRequired checks on ${d.defaultBranch}: ${d.requiredChecks.join(', ')}`);
  } else console.log(`\nRequired checks on ${d.defaultBranch ?? 'the default branch'}: none (or no admin access).`);

  if (d.secrets.length) console.log(`Secrets present (names only): ${d.secrets.join(', ')}`);
  return undefined;
}

async function cmdResolve(args) {
  const rows = [];
  for (const uses of args._) {
    const r = await inspectUses(uses, null);
    rows.push([uses, r.status, r.sha ? `${r.sha.slice(0, 12)}…` : '—', r.via ?? '—', r.detail ?? '']);
  }
  console.log(table(['uses', 'Status', 'SHA', 'Via', 'Detail'], rows));
  return rows.some((r) => r[1] !== 'ok' && r[1] !== 'skipped') ? 1 : 0;
}

async function cmdVerify(args) {
  const files = args._.map((f) => resolve(f));
  for (const f of files) if (!existsSync(f)) { console.error(`no such file: ${f}`); return 2; }
  const texts = files.map((f) => readFileSync(f, 'utf8'));
  const v = await verify(files, texts);

  const stale = v.refs.filter((r) => r.behind > 0);
  console.log(table(['Rung', 'Check', 'Result'], [
    ['0', 'action refs resolve', v.badRefs.length
      ? `${v.badRefs.length} bad of ${v.refs.length}`
      : `${v.refs.length}/${v.refs.length} resolved`],
    ['0', 'action refs current', stale.length ? `${stale.length} behind` : 'all current'],
    ['1', 'actionlint', v.lint.ran ? (v.lint.findings.length ? `${v.lint.findings.length} findings` : 'clean') : `skipped — ${v.lint.reason}`],
    ['2', 'zizmor', v.audit.ran ? (v.blocking.length ? `${v.blocking.length} blocking of ${v.audit.findings.length}` : `clean (${v.audit.findings.length} advisory)`) : v.audit.reason.startsWith('skipped') ? v.audit.reason : `skipped — ${v.audit.reason}`],
  ]));

  if (v.badRefs.length) {
    console.log(`\n${table(['uses', 'Problem', 'Detail'], v.badRefs.map((r) => [
      r.uses, r.status,
      r.detail ?? [r.unknown?.length ? `unknown input: ${r.unknown.join(', ')}` : '',
        r.missing?.length ? `missing required: ${r.missing.join(', ')}` : ''].filter(Boolean).join('; '),
    ]))}`);
  }
  if (stale.length) {
    console.log(`\n${table(['Action', 'Declared', 'Latest', 'Behind'], stale.map((r) => [
      `${r.owner}/${r.repo}${r.subdir ? `/${r.subdir}` : ''}`,
      r.comment ?? r.ref,
      r.latest,
      `${r.behind} major${r.behind > 1 ? 's' : ''}`,
    ]))}`);
  }
  if (v.lint.findings?.length) {
    console.log(`\n${table(['Line', 'Rule', 'Message'], v.lint.findings.map((f) => [
      f.line, f.rule, f.message.length > 90 ? `${f.message.slice(0, 90)}…` : f.message,
    ]))}`);
  }
  if (v.blocking.length) {
    // The file column matters the moment more than one file is checked — without
    // it a repo-wide run prints a wall of line numbers with no way to act on them.
    console.log(`\n${table(['File', 'Line', 'Severity', 'Rule', 'Message'], v.blocking.map((f) => [
      (f.file || '').split('/').pop() || '—', f.line ?? '—', f.severity, f.rule, f.message.slice(0, 52),
    ]))}`);
  }

  console.log(`\nVerified to: ${v.rung}.`);
  if (v.ok) console.log('Not verified: no CI run yet — that is the only thing that proves it works.');
  return v.ok ? 0 : 1;
}

async function cmdHeader(args) {
  const file = resolve(args._[0] ?? '');
  if (!existsSync(file)) { console.error(`no such file: ${file}`); return 2; }
  const text = readFileSync(file, 'utf8');
  const opts = {
    title: args.title ?? /^name:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? 'workflow',
    purpose: args.purpose ?? '',
    generatorVersion: VERSION,
  };
  if (!opts.purpose) { console.error('--purpose is required: a masthead with no purpose is decoration'); return 2; }
  const next = await applyHeader(text, opts);
  if (args.dryRun) { console.log(next.split('\n').slice(0, 10).join('\n')); return 0; }
  writeFileSync(file, next);
  console.log(table(['File', 'Region', 'Result'], [[args._[0], 'press:gha-header', text === next ? 'unchanged' : 'written']]));
  return 0;
}

async function cmdCheck(args) {
  const rows = [];
  let bad = 0;
  for (const f of args._) {
    const text = readFileSync(resolve(f), 'utf8');
    const title = /^name:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? 'workflow';
    const purpose = args.purpose ?? headerPurpose(text);
    const r = await checkHeader(text, { title, purpose, generatorVersion: VERSION });
    if (r.status !== 'ok') bad += 1;
    rows.push([f, r.status, r.was ? `${r.was} → ${r.now}` : '']);
  }
  if (rows.length === 0) { console.error('check resolved zero files — that is a failure, not a pass'); return 2; }
  console.log(table(['File', 'Status', 'Detail'], rows));
  return bad ? 1 : 0;
}

/** The purpose line back out of an existing masthead, so `check` is self-contained. */
function headerPurpose(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.includes('>>> press:gha-header'));
  if (start === -1) return '';
  const body = [];
  for (let i = start + 4; i < lines.length; i += 1) {
    if (!lines[i].startsWith('# ')) break;
    const inner = lines[i].slice(2);
    if (/^[═─]+$/.test(inner.trim()) || /^ generated by /.test(inner)) break;
    body.push(inner.trim());
  }
  return body.join(' ');
}

const USAGE = `forge ${VERSION} — generate GitHub Actions workflows that are verified, not hoped for

  forge detect  [--repo .] [--json]        what this repo already tells us
  forge resolve <uses…>                    resolve action refs to pinned SHAs
  forge verify  <file…>                    the ladder: refs, actionlint, zizmor
  forge header  <file> --purpose "…"       splice the press masthead
  forge check   <file…>                    is each masthead still what press emits
`;

const COMMANDS = { detect: cmdDetect, resolve: cmdResolve, verify: cmdVerify, header: cmdHeader, check: cmdCheck };

const [cmd, ...rest] = process.argv.slice(2);
if (!cmd || cmd === '--help' || cmd === '-h') { console.log(USAGE); process.exit(0); }
if (cmd === '--version') { console.log(VERSION); process.exit(0); }
if (!COMMANDS[cmd]) { console.error(`unknown command "${cmd}"\n\n${USAGE}`); process.exit(2); }

try {
  process.exit((await COMMANDS[cmd](argv(rest))) ?? 0);
} catch (err) {
  console.error(`forge: ${err.message}`);
  process.exit(2);
}

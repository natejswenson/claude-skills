#!/usr/bin/env node
/**
 * press — the brand CLI.
 *
 * The agent decides; this does. Every command is deterministic, offline, and
 * costs nothing, so it is safe to run in CI on every pull request.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

import { loadTokens } from '../lib/tokens.mjs';
import { emitBody } from '../lib/emit.mjs';
import { initRegion, spliceRegion, findRegion } from '../lib/region.mjs';
import { loadTargets, repoRoot, selectTargets, targetPath } from '../lib/targets.mjs';
import { checkAll, EXPLAIN } from '../lib/check.mjs';
import { lintText } from '../lib/lint.mjs';
import { propagate } from '../lib/propagate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const VERSION = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8')).version;

const USAGE = `press v${VERSION} — one brand, generated into every consumer.

  press emit  [--target <id>…] [--repo <path>] [--init] [--dry-run]
  press check [--target <id>…] [--repo <path>] [--json]
  press lint  <file…> [--accent-cap <n>] [--raster] [--waive <rule>…]
  press propagate [--repo <path>] [--dry-run] [--json]
  press doctor [--repo <path>]
  press tokens [--format json|css|md]

Docs: brand/laws.md (why), brand/components.md (what), targets.json (where).`;

const OPTIONS = {
  target: { type: 'string', multiple: true, default: [] },
  repo: { type: 'string' },
  init: { type: 'boolean', default: false },
  'dry-run': { type: 'boolean', default: false },
  json: { type: 'boolean', default: false },
  format: { type: 'string', default: 'json' },
  'accent-cap': { type: 'string' },
  raster: { type: 'boolean', default: false },
  waive: { type: 'string', multiple: true, default: [] },
  help: { type: 'boolean', default: false },
};

function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    options: OPTIONS,
    allowPositionals: true,
  });
  const command = positionals[0];
  if (values.help || !command) {
    process.stdout.write(`${USAGE}\n`);
    return command ? 0 : 1;
  }

  const tokens = loadTokens();
  const root = repoRoot(values.repo ?? process.cwd());

  switch (command) {
    case 'emit':
      return cmdEmit({ tokens, root, values });
    case 'check':
      return cmdCheck({ tokens, root, values });
    case 'lint':
      return cmdLint({ tokens, files: positionals.slice(1), values });
    case 'propagate':
      return cmdPropagate({ tokens, root, values });
    case 'doctor':
      return cmdDoctor({ root, values });
    case 'tokens':
      return cmdTokens({ tokens, values });
    default:
      process.stderr.write(`press: unknown command "${command}"\n\n${USAGE}\n`);
      return 1;
  }
}

function cmdEmit({ tokens, root, values }) {
  const targets = selectTargets(loadTargets(), { root, ids: values.target });
  if (targets.length === 0) return fail('no targets resolved under this repo — nothing to emit');

  const rows = [];
  for (const target of targets) {
    const path = targetPath(target, root);
    const body = emitBody(tokens, target.emitter, target.params ?? {});
    const before = readFileSync(path, 'utf8');
    const has = findRegion(before, target.region, target.syntax);

    let after;
    if (has) {
      if (values.init) return fail(`${target.id} already has a press:${target.region} region — drop --init`);
      after = spliceRegion(before, target.region, target.syntax, body, VERSION);
    } else {
      if (!values.init) {
        return fail(`${target.id} has no press:${target.region} region — re-run with --init to create one`);
      }
      after = initRegion(before, target.region, target.syntax, body, VERSION, target.init ?? {});
    }

    const changed = after !== before;
    if (changed && !values['dry-run']) writeFileSync(path, after, 'utf8');
    rows.push([
      target.id,
      target.emitter,
      relative(root, path),
      changed ? (values['dry-run'] ? 'would write' : has ? 'updated' : 'created') : 'unchanged',
    ]);
  }

  table(['Target', 'Emitter', 'File', 'Result'], rows);
  return 0;
}

function cmdCheck({ tokens, root, values }) {
  const report = checkAll({
    tokens,
    targets: loadTargets(),
    root,
    ids: values.target,
    version: VERSION,
  });

  if (values.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.ok ? 0 : 1;
  }

  // A run that checked nothing is a failure, never a pass.
  if (report.empty) {
    return fail('no targets resolved under this repo — check verified nothing');
  }

  table(
    ['Target', 'File', 'Status'],
    report.results.map((r) => [r.target.id, relative(root, r.path), r.status]),
  );

  if (report.failures.length === 0) return 0;

  for (const f of report.failures) {
    process.stderr.write(`\n${f.target.id} — ${EXPLAIN[f.status]}\n`);
    if (f.detail) process.stderr.write(`${f.detail}\n`);
    if (f.diff) process.stderr.write(`${f.diff}\n`);
  }
  const ids = report.failures.map((f) => f.target.id);
  process.stderr.write(
    `\nFix: press emit ${ids.map((id) => `--target ${id}`).join(' ')}` +
      `${report.failures.some((f) => f.status === 'missing') ? ' --init' : ''}\n`,
  );
  return 1;
}

function cmdLint({ tokens, files, values }) {
  if (files.length === 0) return fail('lint needs at least one file');
  const accentCap = values['accent-cap'] === undefined ? null : Number(values['accent-cap']);
  let findings = 0;
  const rows = [];

  for (const file of files) {
    const result = lintText(readFileSync(file, 'utf8'), tokens, {
      file,
      accentCap,
      waivers: values.waive,
      // A card is pixels by the time anyone reads it, so the tracking ceiling
      // (which protects PDF text extraction) does not bind.
      textExtractable: !values.raster,
    });
    findings += result.findings.length;
    rows.push([file, String(result.findings.length), result.ok ? 'clean' : 'violations']);
    for (const f of result.findings) {
      process.stderr.write(`${f.file}:${f.line || '-'}  ${f.rule}  ${f.message}\n`);
    }
  }

  table(['File', 'Findings', 'Status'], rows);
  return findings === 0 ? 0 : 1;
}

function cmdPropagate({ tokens, root, values }) {
  const report = propagate({
    tokens,
    targets: loadTargets(),
    root,
    version: VERSION,
    dryRun: values['dry-run'],
  });

  if (values.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  }

  if (report.regions.length === 0) {
    return fail('no targets resolved under this repo — nothing to propagate');
  }
  table(['Target', 'File', 'Wrote by', 'Result'],
    report.regions.map((r) => [r.id, r.path, r.wroteBy ?? '—', r.status]));
  if (report.pins.length) {
    table(['Workflow', 'Pinned', 'Now', 'Result'],
      report.pins.map((p) => [p.file, p.from, p.to, p.status]));
  }
  process.stdout.write(report.changed
    ? `\nThis repo is BEHIND — ${report.stale.join(', ')} changed. Commit and open a PR.\n`
    : `\nAlready on press v${VERSION}; nothing to do.\n`);
  return 0;
}

function cmdDoctor({ root, values }) {
  const all = loadTargets();
  const here = new Set(selectTargets(all, { root, ids: [] }).map((t) => t.id));
  table(
    ['Target', 'Repo', 'File', 'Present'],
    all.map((t) => [t.id, t.repo, t.path, here.has(t.id) ? 'yes' : 'no']),
  );
  return 0;
}

function cmdTokens({ tokens, values }) {
  if (values.format === 'json') {
    process.stdout.write(`${emitBody(tokens, 'json', {})}\n`);
  } else if (values.format === 'css') {
    const vars = [...Object.keys(tokens.colors), 'hair'];
    process.stdout.write(`${emitBody(tokens, 'css-vars', { vars, align: true, comments: false })}\n`);
  } else if (values.format === 'md') {
    process.stdout.write(`${emitBody(tokens, 'md-palette', {})}\n`);
  } else {
    return fail(`unknown --format "${values.format}" (json, css, md)`);
  }
  return 0;
}

// --- output ---------------------------------------------------------------

function table(headers, rows) {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => String(r[i] ?? '').length)),
  );
  const line = (cells) => `| ${cells.map((c, i) => String(c ?? '').padEnd(widths[i])).join(' | ')} |`;
  process.stdout.write(`${line(headers)}\n`);
  process.stdout.write(`|${widths.map((w) => '-'.repeat(w + 2)).join('|')}|\n`);
  for (const row of rows) process.stdout.write(`${line(row)}\n`);
}

function fail(message) {
  process.stderr.write(`press: ${message}\n`);
  return 1;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (err) {
  process.stderr.write(`press: ${err.message}\n`);
  process.exitCode = 1;
}

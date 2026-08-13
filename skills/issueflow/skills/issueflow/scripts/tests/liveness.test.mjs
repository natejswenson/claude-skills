/**
 * Liveness: making a run's state legible to a user who is looking at it right
 * now, rather than only after a stage finishes.
 *
 * unreadable-run-row (#223) is the first piece: `runs` used to discard a
 * `RunError` that `loadRun` already wrote to be actionable, rendering the row
 * as a bare `(unreadable run)` with no reason and no remedy.
 *
 * live-stage-clock (#223) is the second: `Took` used to answer only after a
 * human typed `accept` — `briefed` / `—` was the entire liveness signal a
 * reader had for a stage that was, in fact, still running. `observe()` fills
 * `at.delivered` in memory the moment an artifact lands on disk, and
 * `board(run, { now })` renders a live elapsed time for a stage that has
 * neither.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  accept, artifactPath, board, createRun, durationOf, findStep, markBriefed, observe, saveRun,
} from '../lib/run.mjs';
import { STAGES } from '../lib/stages.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = join(HERE, '..', '..');
const CLI = join(SKILL, 'scripts', 'issueflow.js');

const cli = (args) => {
  try {
    const out = execFileSync(process.execPath, [CLI, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_TEST_CONTEXT: undefined },
    });
    return { code: 0, out, err: '' };
  } catch (e) {
    return { code: e.status ?? 1, out: String(e.stdout ?? ''), err: String(e.stderr ?? '') };
  }
};

const policy = { base: 'dev', featurePrefix: 'feature/', mergeMethod: 'squash', source: 'test', shipflow: false };

/** A well-formed run root: one readable schema-2 run, one schema-1 run `loadRun` refuses. */
function mixedRunRoot() {
  const root = mkdtempSync(join(tmpdir(), 'issueflow-runs-'));

  const readableDir = join(root, 'x__y', 'issue-1');
  mkdirSync(readableDir, { recursive: true });
  const readable = createRun({
    repo: { owner: 'x', name: 'y', path: '/tmp/x' },
    issue: { number: 1, title: 'a readable run', url: 'https://github.com/x/y/issues/1' },
    policy,
  });
  writeFileSync(join(readableDir, 'run.json'), `${JSON.stringify(readable, null, 2)}\n`);

  const staleDir = join(root, 'x__y', 'issue-2');
  mkdirSync(staleDir, { recursive: true });
  const stale = createRun({
    repo: { owner: 'x', name: 'y', path: '/tmp/x' },
    issue: { number: 2, title: 'a schema-1 run', url: 'https://github.com/x/y/issues/2' },
    policy,
  });
  writeFileSync(join(staleDir, 'run.json'), `${JSON.stringify({ ...stale, schema: 1 }, null, 2)}\n`);

  return { root, staleDir };
}

function freshRun(issue = { number: 9, title: 'a live run', url: 'https://example.invalid/9' }) {
  const dir = mkdtempSync(join(tmpdir(), 'issueflow-clock-'));
  const run = createRun({ repo: { owner: 'x', name: 'y', path: '/tmp/x' }, issue, policy });
  saveRun(dir, run);
  return { dir, run, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Write an artifact that satisfies `investigate`'s required sections. */
function writeInvestigate(dir, run) {
  const step = findStep(run, 'investigate');
  const declared = STAGES.find((s) => s.id === 'investigate');
  const path = artifactPath(dir, step);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, declared.requires.map((r) => `## ${r}\n\nsomething real.\n`).join('\n'));
  return step;
}

/** An ISO timestamp `secondsAgo` in the past, so a briefed stage reads as still running. */
const ago = (secondsAgo) => new Date(Date.now() - secondsAgo * 1000).toISOString();

// ---------------------------------------------------------------------------
// live-stage-clock — a stage's clock runs while the stage does. Proof items
// 4-8 of the design: `briefed` / `—` used to be the entire liveness signal.
// ---------------------------------------------------------------------------
test('live-stage-clock: briefed with no artifact shows a live elapsed Took, marked with a +', () => {
  const { dir, run, cleanup } = freshRun();
  const step = findStep(run, 'investigate');
  markBriefed(dir, run, step, () => ago(252)); // 4m12s ago
  const r = cli(['status', '--run-dir', dir, '--offline']);
  assert.equal(r.code, 0, `status exited ${r.code}: ${r.err}`);
  const row = r.out.split('\n').find((l) => l.includes('investigate'));
  assert.match(row, /\bbriefed\b/, `expected the persisted state to still read briefed: ${row}`);
  const cell = row.split('|').map((c) => c.trim())[4];
  assert.match(cell, /^\d+m\d\ds\+$/, `Took cell is not a live elapsed reading: "${cell}"`);
  cleanup();
});

test('live-stage-clock: an artifact on disk but never accepted shows delivered, with a real duration and no +', () => {
  const { dir, run, cleanup } = freshRun();
  const step = findStep(run, 'investigate');
  markBriefed(dir, run, step, () => ago(300));
  writeInvestigate(dir, run);
  const r = cli(['status', '--run-dir', dir, '--offline']);
  const row = r.out.split('\n').find((l) => l.includes('investigate'));
  assert.match(row, /\bdelivered\b/, `expected the display state to read delivered: ${row}`);
  const cell = row.split('|').map((c) => c.trim())[4];
  assert.doesNotMatch(cell, /\+/, `an already-delivered stage should show a finished duration, not a lower bound: "${cell}"`);
  assert.match(cell, /^\d+m?\d*s$/, `Took cell is not a real duration: "${cell}"`);
  cleanup();
});

test('live-stage-clock: a pending step shows — in both State-adjacent columns, the clock does not start early', () => {
  const { dir, run, cleanup } = freshRun();
  void run;
  const r = cli(['status', '--run-dir', dir, '--offline']);
  const row = r.out.split('\n').find((l) => l.includes('investigate'));
  assert.match(row, /\bpending\b/, `expected investigate to still be pending: ${row}`);
  const cell = row.split('|').map((c) => c.trim())[4];
  assert.equal(cell, '—', `a never-dispatched stage must not show a duration: "${cell}"`);
  cleanup();
});

test('live-stage-clock: observe() is pure and predicts what accept() later persists', () => {
  const { dir, run, cleanup } = freshRun();
  const step = findStep(run, 'investigate');
  markBriefed(dir, run, step);
  writeInvestigate(dir, run);
  const before = readFileSync(join(dir, 'run.json'), 'utf8');

  const observed = observe(dir, run);
  const after = readFileSync(join(dir, 'run.json'), 'utf8');
  assert.equal(after, before, 'observe() wrote to run.json — it must be read-only');
  assert.equal(findStep(run, 'investigate').stage.at.delivered, undefined,
    'observe() must not mutate the run object it was handed, either');

  const predicted = findStep(observed, 'investigate').stage.at.delivered;
  assert.ok(predicted, 'observe() found no delivered timestamp for a step with an artifact on disk');

  const accepted = accept(dir, run, findStep(run, 'investigate'));
  const persisted = findStep(accepted, 'investigate').stage.at.delivered;
  assert.equal(persisted, predicted, 'accept() persisted a different delivered value than observe() predicted');
  cleanup();
});

test('live-stage-clock: purity guard — board(run) with no `now` renders no + and matches the pre-#223 shape', () => {
  const { dir, run, cleanup } = freshRun();
  const step = findStep(run, 'investigate');
  markBriefed(dir, run, step, () => ago(120));
  const rows = board(run);
  assert.ok(!rows.some((r) => String(r.took).includes('+')), 'a `+` leaked into board() with no `now` passed');
  const investigateRow = rows.find((r) => r.stage === 'investigate');
  assert.equal(investigateRow.state, 'briefed', 'display state drifted from the persisted state with no `now`');
  assert.equal(investigateRow.took, durationOf(step.stage) ?? '—', 'Took must equal the old durationOf-only rendering');
  cleanup();
});

// ---------------------------------------------------------------------------
// unreadable-run-row (trap) — the known-bad side. Without this, `runs`
// swallowing the reason regresses silently the day someone touches its catch.
// ---------------------------------------------------------------------------
test('unreadable-run-row: a schema-1 run names the reason and the remedy', () => {
  const { root, staleDir } = mixedRunRoot();
  const r = cli(['runs', '--run-root', root]);
  assert.equal(r.code, 0, `runs exited ${r.code}: ${r.err}`);
  assert.doesNotMatch(r.out, /\(unreadable run\)/, 'the row still says nothing — the catch was not bound');
  assert.match(r.out, /schema 1/, 'the reason lost which schema the run is');
  assert.match(r.out, /start the issue again/, 'the remedy loadRun already wrote got discarded');
  rmSync(root, { recursive: true, force: true });
});

test('unreadable-run-row: the unreadable row keeps its directory name in Title, not a placeholder', () => {
  const { root } = mixedRunRoot();
  const r = cli(['runs', '--run-root', root]);
  assert.match(r.out, /\bissue-2\b/, 'the row lost the one thing that still identifies which run it is');
  rmSync(root, { recursive: true, force: true });
});

test('unreadable-run-row: two-sided — a readable run in the same table still renders its title and position', () => {
  const { root } = mixedRunRoot();
  const r = cli(['runs', '--run-root', root]);
  assert.match(r.out, /x\/y#1/, 'the readable row went missing — the bound catch must not have swallowed it too');
  assert.match(r.out, /a readable run/, 'the readable row lost its title');
  assert.match(r.out, /0\/\d+/, 'the readable row lost its approved count');
  rmSync(root, { recursive: true, force: true });
});

test('unreadable-run-row: no padded table cell carries an absolute path', () => {
  const { root } = mixedRunRoot();
  const r = cli(['runs', '--run-root', root]);
  for (const line of r.out.split('\n')) {
    if (!line.startsWith('|')) continue;
    assert.doesNotMatch(line, /\/(tmp|var|home|Users)\//, `a padded cell carries a machine-dependent path: ${line}`);
  }
  // The full reason, path included, is allowed — just not inside the table.
  assert.match(r.out, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'the full reason lost the path entirely — nothing tells the user which directory to look at');
  rmSync(root, { recursive: true, force: true });
});

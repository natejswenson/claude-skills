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
 *
 * dispatch-expectation (#223) is the third: `brief` used to print a table and
 * the prompt and nothing about where the run stands or how long the stage it
 * is about to dispatch usually takes here — the exact moment a multi-minute
 * wait begins was the moment the user was told least. `positionLine()` prints
 * `n of m`; `timings.mjs`'s `readTimings()` reads this repo's own past stage
 * durations from the run's sibling directories.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  accept, artifactPath, board, createRun, durationOf, findStep, gateSteps, markBriefed, observe, progressPath,
  saveRun,
} from '../lib/run.mjs';
import { renderBrief } from '../lib/brief.mjs';
import { PER_ITEM_STAGES, STAGES, stage } from '../lib/stages.mjs';
import { readTimings } from '../lib/timings.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = join(HERE, '..', '..');
const CLI = join(SKILL, 'scripts', 'issueflow.js');
const TIMINGS_FIXTURES = join(SKILL, 'evals', 'inputs', 'timings');

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

// ---------------------------------------------------------------------------
// dispatch-expectation — `brief` says where the run stands and how long this
// stage usually takes here. Proof items 9-13 of the design.
// ---------------------------------------------------------------------------

/** One lane, hand-built with the same shape `split()` produces — no gate to satisfy this way. */
function fixtureLane(slug, base) {
  return {
    id: slug,
    slug,
    title: `${slug} lane`,
    branch: `feature/issue-999-${slug}`,
    base,
    stages: PER_ITEM_STAGES.map((id) => {
      const s = stage(id);
      return { id: s.id, model: s.model, agent: s.agent, artifact: s.artifact, state: 'pending', at: {} };
    }),
  };
}

/**
 * A run root holding this repo's 3 frozen prior runs (#212, #215, #219) as
 * siblings, plus one fresh split run — 2 lanes, 6 gate steps total — with its
 * own `investigate` already approved, so `design` is briefable.
 */
function seededTimingsRoot() {
  const root = mkdtempSync(join(tmpdir(), 'issueflow-timings-'));
  const owner = join(root, 'x__y');
  mkdirSync(owner, { recursive: true });
  for (const name of readdirSync(TIMINGS_FIXTURES)) {
    cpSync(join(TIMINGS_FIXTURES, name), join(owner, name), { recursive: true });
  }

  const dir = join(owner, 'issue-999');
  mkdirSync(dir, { recursive: true });
  const issue = { number: 999, title: 'a fresh split run', url: 'https://example.invalid/999' };
  let run = createRun({ repo: { owner: 'x', name: 'y', path: '/tmp/x' }, issue, policy });
  run.split = true;
  run.lanes = [fixtureLane('a', 'dev'), fixtureLane('b', 'feature/issue-999-a')];
  saveRun(dir, run);
  // `briefOne` reads the frozen issue back off disk (`loadIssue`) — `start` writes
  // it normally, and this fixture skips `start`, so it must write it directly.
  mkdirSync(join(dir, 'inputs'), { recursive: true });
  writeFileSync(join(dir, 'inputs', 'issue.json'), `${JSON.stringify(issue, null, 2)}\n`);

  markBriefed(dir, run, findStep(run, 'investigate'));
  writeInvestigate(dir, run);
  run = accept(dir, run, findStep(run, 'investigate'));

  return { root, dir, run, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('dispatch-expectation: readTimings summarizes investigate\'s spread exactly as measured (#223 investigation)', () => {
  const root = mkdtempSync(join(tmpdir(), 'issueflow-timings-exact-'));
  const owner = join(root, 'x__y');
  mkdirSync(owner, { recursive: true });
  for (const name of readdirSync(TIMINGS_FIXTURES)) cpSync(join(TIMINGS_FIXTURES, name), join(owner, name), { recursive: true });

  const found = readTimings(join(owner, 'issue-000'));
  const investigate = found.find((t) => t.stage === 'investigate');
  assert.ok(investigate, 'investigate has no entry at all — the scan found nothing');
  assert.equal(investigate.n, 3);
  assert.equal(investigate.min, '3m21s');
  assert.equal(investigate.median, '5m32s');
  assert.equal(investigate.max, '9m03s');
  rmSync(root, { recursive: true, force: true });
});

test('dispatch-expectation: brief prints a position line and a duration range+median above its table', () => {
  const { dir, cleanup } = seededTimingsRoot();
  const r = cli(['brief', '--stage', 'design', '--run-dir', dir, '--offline']);
  assert.equal(r.code, 0, `brief exited ${r.code}: ${r.err}`);
  assert.match(r.out, /Step 2 of 6/, `no position line, or wrong position: ${r.out}`);
  assert.match(r.out, /\[design\]/, 'the step being dispatched is not bracketed in the chain');
  assert.match(r.out, /1 approved/, 'investigate was accepted before this brief — the approved count should say so');
  // design's own frozen spread across the 3 fixtures, matching the design doc's own worked example verbatim.
  assert.match(r.out, /design on this repo: 3 past runs, 3m45s–6m45s \(median 5m12s\)\./, `no duration range+median line, or the numbers drifted: ${r.out}`);
  cleanup();
});

test('dispatch-expectation: anti-vacuity floor — the timings fixtures yield at least 10 samples across the 3 frozen runs', () => {
  const fixtures = readdirSync(TIMINGS_FIXTURES);
  assert.ok(fixtures.length >= 3, `only ${fixtures.length} timings fixtures on disk — the corpus floor requires 3`);
  const root = mkdtempSync(join(tmpdir(), 'issueflow-timings-floor-'));
  const owner = join(root, 'x__y');
  mkdirSync(owner, { recursive: true });
  for (const name of fixtures) cpSync(join(TIMINGS_FIXTURES, name), join(owner, name), { recursive: true });
  const total = readTimings(join(owner, 'issue-000')).reduce((sum, t) => sum + t.n, 0);
  assert.ok(total >= 10, `the timings scan found only ${total} samples — a scanner matching nothing would pass every other assertion here`);
  rmSync(root, { recursive: true, force: true });
});

test('dispatch-expectation: two-sided — a run with no sibling history gets "no past timings", never an invented number', () => {
  const root = mkdtempSync(join(tmpdir(), 'issueflow-timings-none-'));
  const owner = join(root, 'x__y');
  mkdirSync(owner, { recursive: true });
  const dir = join(owner, 'issue-1');
  mkdirSync(dir, { recursive: true });
  const issue = { number: 1, title: 'no history yet', url: 'https://example.invalid/1' };
  const run = createRun({ repo: { owner: 'x', name: 'y', path: '/tmp/x' }, issue, policy });
  saveRun(dir, run);
  mkdirSync(join(dir, 'inputs'), { recursive: true });
  writeFileSync(join(dir, 'inputs', 'issue.json'), `${JSON.stringify(issue, null, 2)}\n`);

  const r = cli(['brief', '--stage', 'investigate', '--run-dir', dir, '--offline']);
  assert.equal(r.code, 0, `brief exited ${r.code}: ${r.err}`);
  assert.match(r.out, /investigate has no past timings on this repo — nothing to compare against\./, `the no-history line is missing or worded differently: ${r.out}`);
  assert.doesNotMatch(r.out, /past runs?,/, 'a range was printed despite there being no sibling history — an invented number');
  rmSync(root, { recursive: true, force: true });
});

test('dispatch-expectation: a schema-1 sibling is skipped and the scan still returns the other run\'s samples', () => {
  const root = mkdtempSync(join(tmpdir(), 'issueflow-timings-schema1-'));
  const owner = join(root, 'x__y');
  mkdirSync(owner, { recursive: true });
  cpSync(join(TIMINGS_FIXTURES, 'issue-212'), join(owner, 'issue-212'), { recursive: true });

  const staleDir = join(owner, 'issue-998');
  mkdirSync(staleDir, { recursive: true });
  const stale = createRun({
    repo: { owner: 'x', name: 'y', path: '/tmp/x' },
    issue: { number: 998, title: 'a schema-1 run', url: 'https://example.invalid/998' },
    policy,
  });
  writeFileSync(join(staleDir, 'run.json'), `${JSON.stringify({ ...stale, schema: 1 }, null, 2)}\n`);

  const found = readTimings(join(owner, 'issue-000'));
  const investigate = found.find((t) => t.stage === 'investigate');
  assert.ok(investigate, 'the readable sibling\'s samples went missing entirely — a schema-1 neighbour must not poison the whole scan');
  assert.equal(investigate.n, 1, `expected exactly issue-212's one investigate sample, got ${investigate.n}`);
  rmSync(root, { recursive: true, force: true });
});

test('dispatch-expectation: hermeticity — timings.mjs scans only the run directory it is handed, never resolves its own root', () => {
  const source = readFileSync(join(SKILL, 'scripts', 'lib', 'timings.mjs'), 'utf8');
  assert.doesNotMatch(source, /homedir|runRoot/, 'timings.mjs must never resolve $HOME itself — that would make a brief under --run-dir non-hermetic');
});

// ---------------------------------------------------------------------------
// stage-heartbeat — the progress channel: every brief asks for it, `status`
// surfaces it enriched over the filesystem clock, and it degrades cleanly
// when the subagent never writes to it. Proof items 14-17 of the design.
// ---------------------------------------------------------------------------
test('stage-heartbeat: every stage brief asks for progress and names its own progress log (#223)', () => {
  const issue = { number: 1, title: 'a synthetic issue', url: 'https://github.com/x/y/issues/1', body: 'body text', comments: [] };
  const run = createRun({ repo: { owner: 'x', name: 'y', path: '/tmp/x' }, issue, policy });
  const dir = '/tmp/run';
  const steps = gateSteps(run);
  assert.ok(steps.length >= STAGES.length, `only ${steps.length} steps rendered — fewer than the ${STAGES.length} shipped stages`);
  for (const step of steps) {
    const text = renderBrief(dir, run, step, issue);
    assert.match(text, /## While you work/, `${step.key} brief lost the progress section`);
    assert.ok(text.includes(progressPath(dir, step)), `${step.key} brief does not name its own progress log`);
  }
});

test('stage-heartbeat: a progress log with two lines shows the LAST line and its age in the liveness block', () => {
  const { dir, run, cleanup } = freshRun();
  const step = findStep(run, 'investigate');
  markBriefed(dir, run, step, () => ago(252)); // 4m12s ago
  const log = progressPath(dir, step);
  mkdirSync(join(log, '..'), { recursive: true });
  writeFileSync(log, 'read run.mjs and brief.mjs\nroot cause found, writing it up\n');
  const r = cli(['status', '--run-dir', dir, '--offline']);
  assert.equal(r.code, 0, `status exited ${r.code}: ${r.err}`);
  const row = r.out.split('\n').find((l) => l.startsWith('| investigate') && l.split('|').length === 5);
  assert.ok(row, `no liveness row for investigate: ${r.out}`);
  const cells = row.split('|').map((c) => c.trim());
  assert.match(cells[2], /^\d+m\d\ds$/, `Since is not a real elapsed duration: "${cells[2]}"`);
  assert.match(cells[3], /ago — root cause found, writing it up$/, `Last progress did not surface the LAST line: "${cells[3]}"`);
  assert.doesNotMatch(cells[3], /read run\.mjs/, 'the liveness block surfaced the first line instead of the last');
  cleanup();
});

test('stage-heartbeat: with no progress log, the liveness block still shows a real Since and — for Last progress', () => {
  const { dir, run, cleanup } = freshRun();
  const step = findStep(run, 'investigate');
  markBriefed(dir, run, step, () => ago(90));
  const r = cli(['status', '--run-dir', dir, '--offline']);
  assert.equal(r.code, 0, `status exited ${r.code}: ${r.err}`);
  const row = r.out.split('\n').find((l) => l.startsWith('| investigate') && l.split('|').length === 5);
  assert.ok(row, `no liveness row for investigate: ${r.out}`);
  const cells = row.split('|').map((c) => c.trim());
  assert.match(cells[2], /^\d+m?\d*s$/, `Since is missing or not a real duration: "${cells[2]}"`);
  assert.equal(cells[3], '—', 'a stage that never wrote a progress line must degrade to —, not disappear');
  cleanup();
});

test('stage-heartbeat: leak guard — the frozen checkpoint comment carries no progress-log text or path', () => {
  const text = readFileSync(join(SKILL, 'evals', 'baseline', 'checkpoint-comment.md'), 'utf8');
  assert.doesNotMatch(text, /While you work/, 'the progress instruction leaked into the public checkpoint comment');
  assert.doesNotMatch(text, /progress\//, 'a progress/ path leaked into the public checkpoint comment');
});

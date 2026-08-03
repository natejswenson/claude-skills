/**
 * The baseline: a real issueflow run, frozen and re-run.
 *
 * Pinned against `natejswenson/local-fitness#133` — its real open issue list, its
 * real issue payload, and the investigation and design a real opus subagent
 * produced from the briefs this skill rendered. `update.mjs` re-runs the whole
 * state machine over those frozen inputs and the assertions byte-compare, so
 * the eval fails when behaviour changes rather than merely when someone edits a
 * fixture.
 *
 * Offline and $0 by construction: the frozen `gh` payloads are fed in through
 * `--repo-json` / `--issues-json` / `--issue-json`, so nothing here can reach
 * the network, spend, or flake.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from '../../evals/baseline/update.mjs';
import { STAGES } from '../lib/stages.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = join(HERE, '..', '..');
const BASELINE = join(SKILL, 'evals', 'baseline');
const INPUTS = join(SKILL, 'evals', 'inputs');
const CLI = join(SKILL, 'scripts', 'issueflow.js');
const REFRESH = 'node evals/baseline/update.mjs';

const frozen = (name) => readFileSync(join(BASELINE, name), 'utf8');

test('a real run has been frozen as the baseline', () => {
  assert.ok(existsSync(join(BASELINE, 'MANIFEST.json')), `no baseline frozen — run \`${REFRESH}\``);
  const manifest = JSON.parse(frozen('MANIFEST.json'));
  assert.equal(manifest.source, 'natejswenson/local-fitness#133');
});

// ---------------------------------------------------------------------------
// the-real-run — the golden. Re-runs the state machine and byte-compares.
// ---------------------------------------------------------------------------
test('the-real-run: re-running the frozen inputs reproduces every artifact byte for byte', () => {
  const produced = generate();
  const manifest = JSON.parse(frozen('MANIFEST.json'));
  const names = Object.keys(manifest.artifacts);

  assert.ok(names.length >= 9, `the golden set collapsed to ${names.length} artifacts — run \`${REFRESH}\``);
  assert.deepEqual(
    Object.keys(produced).sort(),
    names.sort(),
    `the run produces a different artifact set than is frozen — run \`${REFRESH}\``,
  );
  for (const name of names) {
    assert.equal(produced[name], frozen(name), `${name} drifted from the frozen run — if deliberate, run \`${REFRESH}\``);
  }
});

test('the-real-run: the frozen board is a real board, not an empty one', () => {
  const board = frozen('board.txt');
  const rows = board.split('\n').filter((l) => /^\| \d+ /.test(l));
  // local-fitness had 3 open issues when this was frozen. A refresh that
  // collapsed every input to "nothing to report" would otherwise pass this
  // golden over nothing at all.
  assert.ok(rows.length >= 3, `the frozen board has ${rows.length} issue rows — a board over nothing proves nothing`);
  assert.match(board, /natejswenson\/local-fitness/);
  // and the Detail column must still discriminate: a signal that collapsed to
  // one value for every issue is a column that has stopped meaning anything.
  const details = new Set(rows.map((l) => l.split('|').at(-2).trim()));
  assert.ok(details.size >= 2, `every issue reported Detail "${[...details]}" — the signal has stopped discriminating`);
});

test('the-real-run: no padded table cell carries a path, so the golden survives another machine', () => {
  // `table()` pads cells to the widest value. A cell holding an absolute path is
  // therefore as wide as the machine's tmpdir — /var/folders/… on macOS,
  // /tmp/… on Linux — and normalising the path afterwards shrinks the text but
  // not the padding, so the golden disagreed with CI on the separator row alone.
  // Paths belong on their own line.
  for (const name of ['board.txt', 'start.txt']) {
    for (const line of frozen(name).split('\n')) {
      if (!line.startsWith('|')) continue;
      assert.doesNotMatch(line, /\/(tmp|var|home|Users)\//, `${name} puts a machine-dependent path in a padded cell: ${line}`);
    }
  }
});

test('the-real-run: each frozen brief carries the issue and the artifacts it inherits', () => {
  const investigate = frozen('brief-investigate.md');
  assert.match(investigate, /tool descriptions promise behavior/, 'the investigate brief lost the issue body');
  assert.doesNotMatch(investigate, /Read these first/, 'the first stage inherits nothing and must claim nothing');

  const design = frozen('brief-design.md');
  assert.match(design, /Read these first/, 'the design brief lost its inherited artifacts');
  assert.match(design, /shared\/investigate\.md/, 'the design brief lost the investigation');

  const implement = frozen('brief-implement.md');
  assert.match(implement, /shared\/investigate\.md/);
  assert.match(implement, /shared\/design\.md/, 'the implement brief lost the design — the subagent would start blind');
  assert.match(implement, /feature\/issue-133/, 'the implement brief lost the branch it must commit to');
});

// ---------------------------------------------------------------------------
// stage-contract-corpus — every shipped stage, with an anti-vacuity floor.
// ---------------------------------------------------------------------------
test('stage-contract-corpus: every shipped stage is frozen with its full contract', () => {
  const files = readdirSync(BASELINE).filter((f) => /^stage-.*\.json$/.test(f));
  assert.ok(files.length >= 4, `the stage corpus matched ${files.length} files, floor is 4 — a resolver that matches nothing must go red`);
  assert.equal(files.length, STAGES.length, `${STAGES.length} stages ship but ${files.length} are frozen — run \`${REFRESH}\``);

  for (const s of STAGES) {
    const snapshot = JSON.parse(frozen(`stage-${s.id}.json`));
    assert.equal(snapshot.model, s.model, `${s.id} changed model — that changes what every run of it costs and how good it is`);
    assert.equal(snapshot.agent, s.agent);
    assert.equal(snapshot.artifact, s.artifact);
    assert.deepEqual(snapshot.requires, s.requires, `${s.id} changed what the gate reads for`);
    assert.deepEqual(snapshot.asks, s.asks, `${s.id} changed what it asks the subagent`);
    assert.equal(snapshot.forbids, s.forbids);
  }
});

test('stage-contract-corpus: the models are the ones the skill promises', () => {
  const byId = Object.fromEntries(STAGES.map((s) => [s.id, s.model]));
  assert.deepEqual(byId, { investigate: 'opus', design: 'opus', implement: 'sonnet', test: 'sonnet' });
});

// ---------------------------------------------------------------------------
// unapproved-stage-trap — the known-bad side. Without this the golden above
// goes green the day the gate stops refusing anything.
// ---------------------------------------------------------------------------
const cli = (args) => {
  try {
    execFileSync(process.execPath, [CLI, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_TEST_CONTEXT: undefined },
    });
    return { code: 0, err: '' };
  } catch (e) {
    return { code: e.status ?? 1, err: String(e.stderr ?? '') };
  }
};

/** A run where design has a real artifact on disk but was never approved. */
function trapRun() {
  const dir = mkdtempSync(join(tmpdir(), 'issueflow-trap-'));
  const repo = join(INPUTS, 'repo');
  cli(['start', '--repo', repo, '--repo-json', join(INPUTS, 'repo.json'), '--run-dir', dir, '--issue', '133', '--issue-json', join(INPUTS, 'issue-133.json')]);
  mkdirSync(join(dir, 'shared'), { recursive: true });
  writeFileSync(join(dir, 'shared', 'investigate.md'), readFileSync(join(INPUTS, 'artifacts', 'investigate.md')));
  cli(['accept', '--stage', 'investigate', '--run-dir', dir]);
  // the artifact exists and is good — the ONLY thing missing is the approval
  writeFileSync(join(dir, 'shared', 'design.md'), readFileSync(join(INPUTS, 'artifacts', 'design.md')));
  return dir;
}

test('unapproved-stage-trap: a later stage cannot be briefed over an unapproved design', () => {
  const dir = trapRun();
  const r = cli(['brief', '--stage', 'implement', '--run-dir', dir]);
  assert.notEqual(r.code, 0, 'brief accepted a stage gated behind an unapproved design');
  assert.match(r.err, /design \(briefed\)|design \(pending\)/);
  rmSync(dir, { recursive: true, force: true });
});

test('unapproved-stage-trap: a later stage cannot be accepted over an unapproved design', () => {
  const dir = trapRun();
  mkdirSync(join(dir, 'root'), { recursive: true });
  writeFileSync(join(dir, 'root', 'implement.md'), '## Changed\n\nstuff\n\n## Deviations\n\nnone\n');
  const r = cli(['accept', '--stage', 'implement', '--run-dir', dir]);
  assert.notEqual(r.code, 0, 'accept advanced a stage whose predecessor was never approved');
  assert.match(r.err, /no stage runs on anything but its predecessor/);
  rmSync(dir, { recursive: true, force: true });
});

test('unapproved-stage-trap: ship refuses an unapproved run and names every hole', () => {
  const dir = trapRun();
  const r = cli(['ship', '--run-dir', dir]);
  assert.notEqual(r.code, 0, 'ship opened a pull request over an unapproved run');
  assert.match(r.err, /every stage above must be approved first/);
  rmSync(dir, { recursive: true, force: true });
});

test('unapproved-stage-trap: a skipped stage is not a pass — ship still refuses', () => {
  const dir = trapRun();
  cli(['accept', '--stage', 'design', '--run-dir', dir]);
  cli(['accept', '--stage', 'implement', '--run-dir', dir, '--skip', 'nothing to build']);
  const r = cli(['ship', '--run-dir', dir]);
  assert.notEqual(r.code, 0, 'a skipped stage was treated as done');
  rmSync(dir, { recursive: true, force: true });
});

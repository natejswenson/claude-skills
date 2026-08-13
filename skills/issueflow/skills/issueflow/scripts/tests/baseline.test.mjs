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
import { createRun, gateSteps } from '../lib/run.mjs';
import { renderBrief } from '../lib/brief.mjs';

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

  assert.ok(names.length >= 10, `the golden set collapsed to ${names.length} artifacts — run \`${REFRESH}\``);
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
// checkpoint-comment — the durable record, pinned like the briefs are.
//
// This is the artifact that leaves the machine. Everything else in this run
// lives under `$HOME`; if the comment is wrong, the run is unrecoverable and
// nothing else notices.
// ---------------------------------------------------------------------------
test('the-real-run: the frozen checkpoint comment carries the run, its board and its approved artifacts', () => {
  const comment = frozen('checkpoint-comment.md');

  assert.ok(
    comment.startsWith('<!-- issueflow:run natejswenson/local-fitness#133 -->'),
    'the marker is how a run is adopted on another machine — it must lead the comment',
  );
  assert.match(comment, /\| investigate \| opus \| ✅ approved \|/, 'the board lost its approved stages');
  assert.match(comment, /\| root \| `feature\/issue-133` \| `main` \|/, 'the lane table lost its branch');
  // Both approved artifacts, in full — this is what makes the issue the record.
  assert.match(comment, /<details><summary><b>investigate<\/b>/);
  assert.match(comment, /<details><summary><b>design<\/b>/);
  assert.match(comment, /tools\.py:296-304/, 'the investigation body is not actually in the comment');
  assert.ok(comment.length > 5000, `the comment is ${comment.length} bytes — an empty record would pass every check above`);
});

test('the-real-run: the checkpoint comment publishes no local path and no wall-clock timing', () => {
  const comment = frozen('checkpoint-comment.md');
  // Only the part this module writes. An artifact's own body is reproduced
  // verbatim on purpose — a subagent that quoted its repo path is quoting
  // itself, and rewriting a decision record is worse than publishing one.
  const rendered = comment.split('<details>')[0];
  assert.ok(rendered.includes('| Lane |'), 'the split found no rendered section to check');
  // The pull request body leaked `/Users/<someone>/.claude/issueflow/…` for
  // exactly this reason: this text is posted to a public issue.
  for (const line of rendered.split('\n')) {
    assert.doesNotMatch(line, /\/(Users|home)\/[a-z]/i, `the comment publishes a local path: ${line.slice(0, 120)}`);
  }
  // The Took column must be frozen empty: a duration here would pin the speed
  // of whichever machine last ran the refresh.
  const board = comment.split('\n').filter((l) => /^\| (investigate|design|root\/)/.test(l));
  assert.ok(board.length >= 4, `the frozen board has ${board.length} rows — a board over nothing proves nothing`);
  for (const row of board) {
    assert.match(row, /\| — \|$|\| — \|\s*$/, `a wall-clock duration was frozen into the golden: ${row}`);
  }
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

test('stage-contract-corpus: the test brief says which evidence formats the gate can read (#215)', () => {
  const snapshot = JSON.parse(frozen('stage-test.json'));
  const asks = snapshot.asks.join(' ');
  assert.match(asks, /pass\/fail summary/, `the frozen test-stage asks say nothing about the evidence contract — run \`${REFRESH}\``);
  assert.match(asks, /exit code/, `the frozen test-stage asks say nothing about the evidence contract — run \`${REFRESH}\``);
});

test('stage-contract-corpus: the models are the ones the skill promises', () => {
  const byId = Object.fromEntries(STAGES.map((s) => [s.id, s.model]));
  assert.deepEqual(byId, { investigate: 'opus', design: 'opus', implement: 'sonnet', test: 'sonnet' });
});

test('stage-contract-corpus: the frozen test-stage contract states a load error is not a red run (#219)', () => {
  const snapshot = JSON.parse(frozen('stage-test.json'));
  const asks = snapshot.asks.join(' ');
  assert.match(
    asks,
    /load or import error is NOT a red run/i,
    `the frozen test-stage asks say nothing about a load error not counting as red — run \`${REFRESH}\``,
  );
  assert.match(
    asks,
    /watch each new assertion fail on its own claim/i,
    `the frozen test-stage asks do not require each assertion be seen failing individually — run \`${REFRESH}\``,
  );
});

// ---------------------------------------------------------------------------
// completion-contract — every rendered brief, not just the three frozen ones.
// The measured failure was VARIANCE: two dispatches of the identical stage
// contract behaved differently, so this checks every stage rather than
// trusting the byte-compare of three briefs to stand in for the fourth.
// ---------------------------------------------------------------------------
test('completion-contract: every stage brief asks the subagent to SendMessage main on completion (#219)', () => {
  const policy = { base: 'dev', featurePrefix: 'feature/', mergeMethod: 'squash', source: 'test', shipflow: false };
  const issue = { number: 1, title: 'a synthetic issue', url: 'https://github.com/x/y/issues/1', body: 'body text', comments: [] };
  const run = createRun({ repo: { owner: 'x', name: 'y', path: '/tmp/x' }, issue, policy });

  const steps = gateSteps(run);
  assert.ok(steps.length >= STAGES.length, `only ${steps.length} steps rendered — fewer than the ${STAGES.length} shipped stages`);
  for (const step of steps) {
    const text = renderBrief('/tmp/run', run, step, issue);
    assert.match(text, /## When you are done/, `${step.key} brief lost the completion section`);
    assert.match(text, /SendMessage/, `${step.key} brief does not ask for a SendMessage`);
    assert.match(text, /addressed to `main`/, `${step.key} brief does not name the addressee`);
  }
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

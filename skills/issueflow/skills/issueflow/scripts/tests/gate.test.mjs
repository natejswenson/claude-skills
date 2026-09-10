/**
 * The gate, driven against a real run directory rather than a mock.
 *
 * Every assertion here is a way a stage can look done without being done. They
 * are unit tests only in the sense that they are fast; each one drives the same
 * `createRun` → `accept` → `split` path the CLI does, because a mocked state
 * machine proves the mock.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STAGES, SHARED_STAGES, PER_ITEM_STAGES, PLAN_STAGE } from '../lib/stages.mjs';
import { detailOf, issueRows, ISSUE_COLUMNS } from '../lib/board.mjs';
import { branchFor, resolvePolicy, slugify } from '../lib/policy.mjs';
import {
  accept, artifactPath, blockers, board, createRun, evidencePath, findStep, loadRun,
  nextStep, readySteps, runState, saveRun, skip, split, workItemsFromPlan,
} from '../lib/run.mjs';
import { parseEvidence, parseAllEvidence, summarize, twoSided, RUNNER_IDS } from '../lib/evidence.mjs';
import { shipBlockers } from '../lib/ship.mjs';
import { GOOD_EVIDENCE, approveImplement, approvePlan, redTeamPass, writeGood } from './helpers.mjs';

const ISSUE = { number: 3, title: 'Rotate leaked credentials', url: 'https://example.invalid/3', body: 'x' };
const POLICY = { base: 'dev', featurePrefix: 'feature/', mergeMethod: 'squash', source: 'test', shipflow: true };
const REPO = { owner: 'acme', name: 'widgets', path: '/nowhere', defaultBranch: 'main' };

function freshRun() {
  const dir = mkdtempSync(join(tmpdir(), 'issueflow-test-'));
  const run = createRun({ repo: REPO, issue: ISSUE, policy: POLICY });
  saveRun(dir, run);
  return { dir, run, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('the gate refuses a stage whose predecessor is not approved', () => {
  const { dir, run, cleanup } = freshRun();
  writeGood(dir, run, 'implement');
  assert.throws(() => accept(dir, run, findStep(run, 'implement')), /investigate is pending/);
  cleanup();
});

test('the gate refuses a stage that produced no artifact', () => {
  const { dir, run, cleanup } = freshRun();
  assert.throws(() => accept(dir, run, findStep(run, 'investigate')), /no artifact at/);
  cleanup();
});

test('the gate refuses an artifact that never names its required sections', () => {
  const { dir, run, cleanup } = freshRun();
  const step = findStep(run, 'investigate');
  writeFileSync(artifactPath(dir, step), 'I looked at it and it seems fine.\n');
  assert.throws(() => accept(dir, run, step), /has no Root cause section/);
  cleanup();
});

test('the gate refuses an artifact that mentions its sections in prose but heads none of them', () => {
  // The old check was `text.includes(section)`, which this artifact passes: it
  // contains "root cause", "evidence" and "unknowns" as words. A stage owes the
  // next one a section a reader can find, and prose is not findable.
  const { dir, run, cleanup } = freshRun();
  const step = findStep(run, 'investigate');
  writeFileSync(
    artifactPath(dir, step),
    'I could not determine the root cause. There is some evidence in the logs, but plenty of unknowns.\n',
  );
  assert.throws(() => accept(dir, run, step), /has no Root cause section/);
  cleanup();
});

test('the gate accepts required sections written as bold lines, not only as headings', () => {
  const { dir, run, cleanup } = freshRun();
  const step = findStep(run, 'investigate');
  const declared = STAGES.find((s) => s.id === 'investigate');
  writeFileSync(artifactPath(dir, step), declared.requires.map((r) => `**${r}**\n\nx\n`).join('\n'));
  redTeamPass(dir, run, step);
  accept(dir, run, step);
  assert.equal(step.stage.state, 'approved');
  cleanup();
});

test('the plan cannot be approved before the red team has read it — the review is not optional', () => {
  const { dir, run, cleanup } = freshRun();
  const step = writeGood(dir, run, 'investigate');
  assert.throws(() => accept(dir, run, step), /no red-team review is registered/);
  assert.notEqual(step.stage.state, 'approved');
  cleanup();
});

test('a plan folds the design in: the gate reads for the approach, the rejected alternative, the files and the proof', () => {
  const { dir, run, cleanup } = freshRun();
  const step = findStep(run, 'investigate');
  writeFileSync(artifactPath(dir, step), '## Root cause\n\nx\n\n## Evidence\n\ny\n\n## Unknowns\n\nz\n');
  redTeamPass(dir, run, step);
  assert.throws(() => accept(dir, run, step), /no Approach section, no Rejected section, no Files section, no Proof section/);
  cleanup();
});

test('the gate refuses an implement stage with no recorded output', () => {
  const { dir, run, cleanup } = freshRun();
  approvePlan(dir, run);
  const step = writeGood(dir, run, 'implement');
  assert.throws(() => accept(dir, run, step), /no test output at/);
  cleanup();
});

test('an accepted implement stage records the evidence it was proved by', () => {
  const { dir, run, cleanup } = freshRun();
  approvePlan(dir, run);
  const step = approveImplement(dir, run);
  assert.equal(step.stage.state, 'approved');
  assert.match(step.stage.evidence, /test-output\.txt$/);
  assert.equal(step.stage.result, 'node --test, 24 passed, 0 failed');
  cleanup();
});

test('the gate refuses a blocked implementation artifact even with passing baseline evidence', () => {
  const { dir, run, cleanup } = freshRun();
  approvePlan(dir, run);
  const step = writeGood(dir, run, 'implement');
  const path = artifactPath(dir, step);
  const text = readFileSync(path, 'utf8').replace(/## Result[\s\S]*$/, '## Result\n\nBLOCKED — prerequisite missing.\n');
  writeFileSync(path, text);
  writeFileSync(evidencePath(dir, step), GOOD_EVIDENCE);
  assert.throws(() => accept(dir, run, step), /reports blocked, incomplete, or not performed work/);
  cleanup();
});

test('a skipped stage is never approved, and ship keeps refusing it', () => {
  const { dir, run, cleanup } = freshRun();
  const step = findStep(run, 'investigate');
  skip(dir, run, step, 'already investigated in #12');
  assert.equal(step.stage.state, 'skipped');
  assert.ok(shipBlockers(run).some((b) => b.step === 'investigate' && b.state === 'skipped'));
  // and it still blocks everything downstream — skipped is a hole, not a pass
  assert.ok(blockers(run, findStep(run, 'implement')).length > 0);
  cleanup();
});

test('a skip without a reason is refused', () => {
  const { dir, run, cleanup } = freshRun();
  assert.throws(() => skip(dir, run, findStep(run, 'investigate'), null), /needs a reason/);
  cleanup();
});

test('the gate refuses evidence that holds no runner result at all', () => {
  // A non-empty file is not a test run. `ok` used to clear this gate, which
  // made the evidence check a check on the existence of a file.
  const { dir, run, cleanup } = freshRun();
  approvePlan(dir, run);
  const step = writeGood(dir, run, 'implement');
  writeFileSync(evidencePath(dir, step), 'ok\n');
  assert.throws(() => accept(dir, run, step), /format I can parse/);
  cleanup();
});

test('the refusal names every runner id it can read, not a hand-written list', () => {
  const { dir, run, cleanup } = freshRun();
  approvePlan(dir, run);
  const step = writeGood(dir, run, 'implement');
  writeFileSync(evidencePath(dir, step), 'ok\n');
  assert.throws(() => accept(dir, run, step), (err) => {
    for (const id of RUNNER_IDS) assert.ok(err.message.includes(id), `refusal is missing "${id}"`);
    return true;
  });
  cleanup();
});

// ---------------------------------------------------------------------------
// The two-sided rule, as code. The separate test stage used to be the pair of
// eyes that checked the red run; `accept` now reads the whole evidence file
// and refuses the shapes that stage used to catch.
// ---------------------------------------------------------------------------

test('red-before-green: a green-only evidence file is refused — a test never seen red proves nothing', () => {
  const { dir, run, cleanup } = freshRun();
  approvePlan(dir, run);
  const step = writeGood(dir, run, 'implement');
  writeFileSync(evidencePath(dir, step), '# pass 24\n# fail 0\n');
  assert.throws(() => accept(dir, run, step), /no failing run before the passing one/);
  assert.notEqual(step.stage.state, 'approved');
  cleanup();
});

test('red-before-green: red then green passes, and the LAST result is what the stage reports', () => {
  const { dir, run, cleanup } = freshRun();
  approvePlan(dir, run);
  const step = writeGood(dir, run, 'implement');
  writeFileSync(evidencePath(dir, step), '# pass 0\n# fail 1\n\n--- after the fix ---\n\n# pass 24\n# fail 0\n');
  accept(dir, run, step);
  assert.equal(step.stage.result, 'node --test, 24 passed, 0 failed');
  cleanup();
});

test('red-before-green: green then red is refused — the order is the proof', () => {
  const { dir, run, cleanup } = freshRun();
  approvePlan(dir, run);
  const step = writeGood(dir, run, 'implement');
  writeFileSync(evidencePath(dir, step), '# pass 24\n# fail 0\n\n# pass 0\n# fail 1\n');
  assert.throws(() => accept(dir, run, step), /the last run in it failed/);
  cleanup();
});

test('red-before-green: a red run that is only a load or import error is not a red run', () => {
  const { dir, run, cleanup } = freshRun();
  approvePlan(dir, run);
  const step = writeGood(dir, run, 'implement');
  writeFileSync(
    evidencePath(dir, step),
    "Error: Cannot find module './widget.mjs'\n# pass 0\n# fail 1\n\n# pass 24\n# fail 0\n",
  );
  assert.throws(() => accept(dir, run, step), /only red run is a load or import error/);
  // the same file with a real assertion failure as the red half passes
  writeFileSync(
    evidencePath(dir, step),
    'not ok 1 - returns the cached value\n  AssertionError: expected 2 to equal 1\n# pass 0\n# fail 1\n\n# pass 24\n# fail 0\n',
  );
  accept(dir, run, step);
  assert.equal(step.stage.state, 'approved');
  cleanup();
});

test('twoSided reads every result in the file, not just the last', () => {
  const all = parseAllEvidence(GOOD_EVIDENCE);
  assert.equal(all.length, 2, 'two node --test summaries, two results');
  assert.equal(all[0].green, false);
  assert.equal(all[1].green, true);
  assert.equal(twoSided(all).ok, true);
  assert.equal(twoSided([]).ok, false);
  assert.match(twoSided(parseAllEvidence('=== 118 passed in 1.20s ===\n')).reason, /no failing run/);
  assert.equal(twoSided(parseAllEvidence('=== 2 failed, 116 passed in 1.1s ===\n=== 118 passed in 1.20s ===\n')).ok, true);
});

test('a fully approved run has no ship blockers', () => {
  const { dir, run, cleanup } = freshRun();
  approvePlan(dir, run);
  approveImplement(dir, run);
  assert.deepEqual(shipBlockers(run), []);
  assert.equal(nextStep(run), null);
  cleanup();
});

// ---------------------------------------------------------------------------
// split
// ---------------------------------------------------------------------------

test('split refuses before the plan is approved', () => {
  const { dir, run, cleanup } = freshRun();
  writeGood(dir, run, 'investigate');
  assert.throws(() => split(dir, run, [{ title: 'a' }, { title: 'b' }]), /before the plan is approved/);
  cleanup();
});

test('split refuses fewer than two work items', () => {
  const { dir, run, cleanup } = freshRun();
  approvePlan(dir, run);
  assert.throws(() => split(dir, run, [{ title: 'only one' }]), /at least 2 work items/);
  cleanup();
});

test('split refuses two work items whose slugs collide', () => {
  const { dir, run, cleanup } = freshRun();
  approvePlan(dir, run);
  assert.throws(() => split(dir, run, [{ title: 'Rotate keys' }, { title: 'rotate  keys' }]), /slug to "rotate-keys"/);
  cleanup();
});

test('split stacks each lane on the one below it, bottom on the base branch', () => {
  const { dir, run, cleanup } = freshRun();
  approvePlan(dir, run);
  split(dir, run, [{ title: 'Rotate secrets' }, { title: 'Decommission host' }, { title: 'Verify DNS' }]);
  assert.deepEqual(run.lanes.map((l) => l.branch), [
    'feature/issue-3-rotate-secrets',
    'feature/issue-3-decommission-host',
    'feature/issue-3-verify-dns',
  ]);
  assert.deepEqual(run.lanes.map((l) => l.base), [
    'dev',
    'feature/issue-3-rotate-secrets',
    'feature/issue-3-decommission-host',
  ]);
  for (const lane of run.lanes) assert.deepEqual(lane.review, { rounds: [], converged: false, draft: null, maxRounds: 2 });
  cleanup();
});

test('parallel split puts genuinely independent lanes on the shared base', () => {
  const { dir, run, cleanup } = freshRun();
  approvePlan(dir, run);
  split(dir, run, [{ title: 'first' }, { title: 'second' }], { parallel: true });
  assert.deepEqual(run.lanes.map((l) => l.base), ['dev', 'dev']);
  cleanup();
});

test('split gives every lane its own implement stage, and does not duplicate the plan', () => {
  const { dir, run, cleanup } = freshRun();
  approvePlan(dir, run);
  split(dir, run, [{ title: 'a' }, { title: 'b' }]);
  const rows = board(run);
  assert.equal(rows.filter((r) => r.stage === PLAN_STAGE).length, 1);
  for (const id of PER_ITEM_STAGES) assert.equal(rows.filter((r) => r.stage === id).length, 2);
  cleanup();
});

test('split refuses a second split', () => {
  const { dir, run, cleanup } = freshRun();
  approvePlan(dir, run);
  split(dir, run, [{ title: 'a' }, { title: 'b' }]);
  assert.throws(() => split(dir, run, [{ title: 'c' }, { title: 'd' }]), /already split/);
  cleanup();
});

test('split refuses once an implementation has been delivered', () => {
  const { dir, run, cleanup } = freshRun();
  approvePlan(dir, run);
  writeGood(dir, run, 'implement'); // delivered, not even approved
  assert.throws(() => split(dir, run, [{ title: 'a' }, { title: 'b' }]), /implementation has delivered/);
  cleanup();
});

test('split is still allowed after a lane was merely briefed — a brief produces nothing to strand', () => {
  // `brief --ready` straight after the plan used to foreclose `split` forever:
  // the stage was marked briefed and split refused anything past pending.
  const { dir, run, cleanup } = freshRun();
  approvePlan(dir, run);
  findStep(run, 'implement').stage.state = 'briefed';
  split(dir, run, [{ title: 'a' }, { title: 'b' }]);
  assert.equal(run.lanes.length, 2);
  cleanup();
});

test('a per-item stage on a split run refuses an unnamed lane', () => {
  const { dir, run, cleanup } = freshRun();
  approvePlan(dir, run);
  split(dir, run, [{ title: 'a' }, { title: 'b' }]);
  assert.throws(() => findStep(run, 'implement'), /name one with --lane/);
  assert.equal(findStep(run, 'implement', 'a').laneSlug, 'a');
  cleanup();
});

// ---------------------------------------------------------------------------
// The dependency graph. These two are a pair on purpose: the first proves the
// gate still refuses what it must, the second proves the concurrency it now
// allows is real rather than decorative. Either one alone can pass over a
// graph that is wrong in the other direction.
// ---------------------------------------------------------------------------

test('a stacked lane cannot be implemented before the lane it branches off is', () => {
  const { dir, run, cleanup } = freshRun();
  approvePlan(dir, run);
  split(dir, run, [{ title: 'first' }, { title: 'second' }]);
  // lane 2 branches off lane 1's branch — its commits cannot exist until lane 1's do
  const second = findStep(run, 'implement', 'second');
  writeGood(dir, run, 'implement', 'second');
  writeFileSync(evidencePath(dir, second), GOOD_EVIDENCE);
  assert.throws(() => accept(dir, run, second), /first\/implement is pending/);
  cleanup();
});

test('a lane may be implemented while the lane below it is still under review — the gate needs its commits, not its pull request', () => {
  const { dir, run, cleanup } = freshRun();
  approvePlan(dir, run);
  split(dir, run, [{ title: 'first' }, { title: 'second' }]);
  approveImplement(dir, run, 'first');
  run.lanes[0].pr = { number: 1, url: 'https://example.invalid/pull/1' }; // shipped, loop still open
  assert.equal(run.lanes[0].review.converged, false);
  assert.deepEqual(blockers(run, findStep(run, 'implement', 'second')), []);
  approveImplement(dir, run, 'second');
  assert.equal(findStep(run, 'implement', 'second').stage.state, 'approved');
  cleanup();
});

test('readySteps opens exactly the next lane up the stack — a lane two above cannot start on commits that do not exist', () => {
  const { dir, run, cleanup } = freshRun();
  approvePlan(dir, run);
  split(dir, run, [{ title: 'first' }, { title: 'second' }, { title: 'third' }]);
  assert.deepEqual(readySteps(run).map((s) => s.key), ['first/implement']);
  approveImplement(dir, run, 'first');
  // second stacks on first (approved); third stacks on second (still pending)
  assert.deepEqual(readySteps(run).map((s) => s.key), ['second/implement']);
  cleanup();
});

test('a hole two levels down is still named, not hidden behind the step above it', () => {
  const { dir, run, cleanup } = freshRun();
  skip(dir, run, findStep(run, 'investigate'), 'someone else looked at it');
  const blocked = blockers(run, findStep(run, 'implement')).map((b) => b.key);
  assert.ok(blocked.includes('investigate'), 'the skipped plan behind the lane must be named');
  cleanup();
});

test('the run round-trips through disk', () => {
  const { dir, run, cleanup } = freshRun();
  approvePlan(dir, run);
  assert.equal(findStep(loadRun(dir), 'investigate').stage.state, 'approved');
  cleanup();
});

test('every stage declares a model, an agent, an artifact and what the gate reads for', () => {
  assert.equal(STAGES.length, 2);
  assert.deepEqual(SHARED_STAGES, ['investigate']);
  assert.deepEqual(PER_ITEM_STAGES, ['implement']);
  for (const s of STAGES) {
    assert.ok(['opus', 'sonnet'].includes(s.model), `${s.id} has no model`);
    assert.ok(s.agent && s.artifact && s.forbids, `${s.id} is missing a field`);
    assert.ok(s.asks.length > 0 && s.requires.length > 0, `${s.id} asks or requires nothing`);
  }
});

test('policy falls back to the repo default branch when there is no shipflow config and no dev on origin', () => {
  const dir = mkdtempSync(join(tmpdir(), 'issueflow-policy-'));
  const policy = resolvePolicy(dir, 'trunk', { remoteBranches: ['trunk', 'feature/x'] });
  assert.equal(policy.base, 'trunk');
  assert.equal(policy.shipflow, false);
  rmSync(dir, { recursive: true, force: true });
});

test('policy targets dev when origin has one beside the default branch, shipflow config or not', () => {
  // The first real 0.7.0 run opened four pull requests into `main` on a repo
  // whose CLAUDE.md says feature/* → dev → main but which has no shipflow.json.
  const dir = mkdtempSync(join(tmpdir(), 'issueflow-policy-'));
  const policy = resolvePolicy(dir, 'main', { remoteBranches: ['main', 'dev'] });
  assert.equal(policy.base, 'dev');
  assert.match(policy.source, /origin has a dev branch/);
  // and a repo whose DEFAULT is dev does not point at itself twice
  assert.equal(resolvePolicy(dir, 'dev', { remoteBranches: ['dev'] }).base, 'dev');
  rmSync(dir, { recursive: true, force: true });
});

test('policy prefers the shipflow dev branch when one is declared', () => {
  const dir = mkdtempSync(join(tmpdir(), 'issueflow-policy-'));
  mkdirSync(join(dir, '.github'), { recursive: true });
  writeFileSync(
    join(dir, '.github', 'shipflow.json'),
    JSON.stringify({ branches: { main: 'main', dev: 'dev' }, featureBranchPrefix: 'feat/' }),
  );
  const policy = resolvePolicy(dir, 'main');
  assert.equal(policy.base, 'dev');
  assert.equal(branchFor(policy, 7, 'root'), 'feat/issue-7');
  rmSync(dir, { recursive: true, force: true });
});

test('a shipflow config with no dev branch does not invent one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'issueflow-policy-'));
  mkdirSync(join(dir, '.github'), { recursive: true });
  writeFileSync(join(dir, '.github', 'shipflow.json'), JSON.stringify({ branches: { main: 'trunk' } }));
  assert.equal(resolvePolicy(dir, 'trunk').base, 'trunk');
  rmSync(dir, { recursive: true, force: true });
});

test('slugify never yields an empty branch segment', () => {
  assert.equal(slugify('!!!'), 'issue');
  assert.equal(slugify('Rotate  the  keys!'), 'rotate-the-keys');
});

test('slugify truncates on a word boundary, never mid-word', () => {
  // A real run produced `shipflow-refuses-the-ambiguous-f`, which reads as a
  // typo everywhere a branch name is shown.
  assert.equal(slugify('shipflow refuses the ambiguous fast path'), 'shipflow-refuses-the-ambiguous');
  // A single word longer than the limit has no boundary to back off to.
  assert.equal(slugify('a'.repeat(50)), 'a'.repeat(32));
});

// ---------------------------------------------------------------------------
// Work items, read out of the approved plan rather than retyped.
// ---------------------------------------------------------------------------

test('work items are read from the approved plan`s own Work items section', () => {
  const items = workItemsFromPlan(
    '## Approach\n\nsomething\n\n## Work items\n\nWhy split: ~900 changed lines, and the descriptions layer is one the other two build on.\n\nThree of them.\n\n' +
      '- `descriptions`: the eight description-string rewrites. Nothing else.\n' +
      '- `query-workouts-honesty`: `source` added to the SELECT\n' +
      '- dead-notes-param: the unread parameter removed\n\n## Proof\n\n- not: an item\n',
  );
  assert.deepEqual(items.map((i) => i.slug), ['descriptions', 'query-workouts-honesty', 'dead-notes-param']);
  assert.equal(items[0].title, 'the eight description-string rewrites');
  assert.ok(!items.some((i) => i.slug === 'not'), 'the parser must stop at the next heading');
});

test('a plan that decided the issue is ONE change yields no work items, and says so', () => {
  assert.throws(() => workItemsFromPlan('## Approach\n\nOne change. No split.\n'), /declares no `## Work items`/);
});

test('a Work items heading with nothing parseable under it is refused, not read as zero items', () => {
  assert.throws(() => workItemsFromPlan('## Work items\n\nWhy split: two layers\n\nI decided not to split after all.\n'), /nothing there names a lane/);
});

test('a Work items heading with no `Why split:` line is refused — one pull request per issue is the default', () => {
  const items = '- first: the first layer\n- second: the second layer\n';
  assert.throws(() => workItemsFromPlan(`## Work items\n\n${items}`), /no `Why split:/);
  assert.throws(() => workItemsFromPlan(`## Work items\n\nWhy split:\n\n${items}`), /no `Why split:/, 'an empty reason is no reason');
  assert.equal(workItemsFromPlan(`## Work items\n\n**Why split:** ~1,200 lines across a schema and two consumers\n\n${items}`).length, 2, 'bold or bulleted, the line still counts');
  assert.equal(workItemsFromPlan(`## Work items\n\n- Why split: 700 changed lines\n${items}`).length, 2, 'the reason line is never read as a lane');
});

// ---------------------------------------------------------------------------
// Evidence: what counts as a test having run.
// ---------------------------------------------------------------------------

test('every supported runner`s own summary is recognised', () => {
  assert.equal(summarize(parseEvidence('# tests 5\n# pass 5\n# fail 0\n')), 'node --test, 5 passed, 0 failed');
  assert.equal(summarize(parseEvidence('=== 2 failed, 118 passed in 1.20s ===\n')), 'pytest, 118 passed, 2 failed');
  assert.equal(summarize(parseEvidence('  4 passing (12ms)\n')), 'mocha, 4 passed, 0 failed');
  assert.equal(summarize(parseEvidence('Tests:       1 failed, 40 passed, 41 total\n')), 'jest/vitest, 40 passed, 1 failed');
  assert.equal(parseEvidence('ok  \texample.com/pkg\t0.42s\n').runner, 'go test');
  assert.equal(parseEvidence('the command finished with exit code 0\n').exitCode, 0);
});

test('prose that merely talks about tests is not a runner result', () => {
  assert.equal(parseEvidence('I ran the suite and it all passed, honestly.\n'), null);
  assert.equal(parseEvidence('ok\n'), null);
  assert.equal(parseEvidence(''), null);
});

test('a failing result is never reported as green', () => {
  assert.equal(parseEvidence('# pass 3\n# fail 2\n').green, false);
  assert.equal(parseEvidence('# pass 3\n# fail 0\n').green, true);
});

// ---------------------------------------------------------------------------
// The spec reporter: node --test's default on Node ≥25, even piped (#215).
// ---------------------------------------------------------------------------

test('the spec reporter — the issue`s own failure — now parses', () => {
  const spec =
    'ℹ tests 31\nℹ suites 0\nℹ pass 31\nℹ fail 0\nℹ cancelled 0\nℹ skipped 0\nℹ todo 0\nℹ duration_ms 812\n';
  const result = parseEvidence(spec);
  assert.equal(result.runner, 'node --test');
  assert.equal(result.passed, 31);
  assert.equal(result.failed, 0);
  assert.equal(result.green, true);
});

test('a coloured spec summary parses identically — a pty capture wraps it in SGR', () => {
  const coloured = '\x1b[34mℹ pass 31\x1b[39m\n\x1b[34mℹ fail 0\x1b[39m\n';
  assert.equal(summarize(parseEvidence(coloured)), 'node --test, 31 passed, 0 failed');
});

test('a coloured mocha summary also parses now that the strip is global', () => {
  assert.equal(summarize(parseEvidence('\x1b[32m4 passing (12ms)\x1b[0m\n')), 'mocha, 4 passed, 0 failed');
});

test('order follows the file, not the reporter — spec red then TAP green reports green', () => {
  const text = 'ℹ pass 0\nℹ fail 1\n# pass 24\n# fail 0\n';
  assert.equal(summarize(parseEvidence(text)), 'node --test, 24 passed, 0 failed');
  assert.equal(twoSided(parseAllEvidence(text)).ok, true);
});

test('order follows the file, not the reporter — the mirror: TAP red then spec green reports green', () => {
  const text = '# pass 0\n# fail 1\nℹ pass 24\nℹ fail 0\n';
  assert.equal(summarize(parseEvidence(text)), 'node --test, 24 passed, 0 failed');
});

test('detail counts characters, not soft-wrapped lines', () => {
  // Both bodies are ONE physical line. Scoring on newlines would rank them
  // identically, which is how a real 461-character issue read as three lines.
  const short = { body: 'fix it' };
  const long = { body: 'word '.repeat(400) };
  assert.equal(long.body.trim().split('\n').length, 1, 'the fixture must be one physical line');
  assert.ok(detailOf(long).score > detailOf(short).score, 'length must move the score');
  assert.equal(detailOf(long).detail, 'some');
  assert.equal(detailOf(short).detail, 'thin');
});

test('a broad label over a thin body is flagged, not silently called small', () => {
  const rows = issueRows([{ number: 1, title: 'Phase 4: port the CMS', labels: [{ name: 'epic' }], comments: [], body: 'do it' }]);
  assert.equal(rows[0][ISSUE_COLUMNS.indexOf('Detail')], 'thin !');
});

// ---------------------------------------------------------------------------
// runState — one predicate, one place (#219), plus the review loop's state.
// ---------------------------------------------------------------------------

test('runState is "in progress" while any gate step is neither approved nor skipped', () => {
  const { run } = freshRun();
  assert.equal(runState(run), 'in progress');
});

test('runState is "ready to ship" once every gate step is approved, before any lane has a pull request', () => {
  const { dir, run, cleanup } = freshRun();
  approvePlan(dir, run);
  approveImplement(dir, run);
  assert.equal(runState(run), 'ready to ship');
  cleanup();
});

test('runState is "in review" once a lane has a pull request whose review loop has not converged, and "shipped" once it has', () => {
  const { dir, run, cleanup } = freshRun();
  approvePlan(dir, run);
  approveImplement(dir, run);
  run.lanes[0].pr = { number: 9, url: 'https://example.invalid/pull/9' };
  assert.equal(runState(run), 'in review');
  run.lanes[0].review.converged = true;
  assert.equal(runState(run), 'shipped');
  cleanup();
});

test('runState is "done" once run.finished is set — the finding verbatim: both fully-shipped runs it was measured against reported "ready to ship" forever', () => {
  const { run } = freshRun();
  run.finished = { at: '2026-08-12T00:00:00Z', issueClosed: true };
  assert.equal(runState(run), 'done');
});

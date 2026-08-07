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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STAGES, SHARED_STAGES, PER_ITEM_STAGES } from '../lib/stages.mjs';
import { detailOf, issueRows, ISSUE_COLUMNS } from '../lib/board.mjs';
import { branchFor, resolvePolicy, slugify } from '../lib/policy.mjs';
import {
  accept, artifactPath, blockers, board, createRun, evidencePath, findStep, loadRun,
  nextStep, readySteps, saveRun, skip, split, workItemsFromDesign,
} from '../lib/run.mjs';
import { parseEvidence, summarize } from '../lib/evidence.mjs';
import { shipBlockers } from '../lib/ship.mjs';

const ISSUE = { number: 3, title: 'Rotate leaked credentials', url: 'https://example.invalid/3', body: 'x' };
const POLICY = { base: 'dev', featurePrefix: 'feature/', mergeMethod: 'squash', source: 'test', shipflow: true };
const REPO = { owner: 'acme', name: 'widgets', path: '/nowhere', defaultBranch: 'main' };

function freshRun() {
  const dir = mkdtempSync(join(tmpdir(), 'issueflow-test-'));
  const run = createRun({ repo: REPO, issue: ISSUE, policy: POLICY });
  saveRun(dir, run);
  return { dir, run, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Write an artifact that satisfies the stage's required sections. */
function writeGood(dir, run, stageId, lane = null) {
  const step = findStep(run, stageId, lane);
  const declared = STAGES.find((s) => s.id === stageId);
  const path = artifactPath(dir, step);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, declared.requires.map((r) => `## ${r}\n\nsomething real.\n`).join('\n'));
  return step;
}

test('the gate refuses a stage whose predecessor is not approved', () => {
  const { dir, run, cleanup } = freshRun();
  writeGood(dir, run, 'design');
  assert.throws(() => accept(dir, run, findStep(run, 'design')), /investigate is pending/);
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
  writeFileSync(artifactPath(dir, step), '**Root cause**\n\nx\n\n**Evidence**\n\ny\n\n**Unknowns**\n\nz\n');
  accept(dir, run, step);
  assert.equal(step.stage.state, 'approved');
  cleanup();
});

test('the gate refuses a test stage with no recorded output', () => {
  const { dir, run, cleanup } = freshRun();
  for (const id of SHARED_STAGES) accept(dir, run, writeGood(dir, run, id));
  accept(dir, run, writeGood(dir, run, 'implement'));
  const step = writeGood(dir, run, 'test');
  assert.throws(() => accept(dir, run, step), /no test output at/);
  cleanup();
});

test('an accepted test stage records the evidence it was proved by', () => {
  const { dir, run, cleanup } = freshRun();
  for (const id of SHARED_STAGES) accept(dir, run, writeGood(dir, run, id));
  accept(dir, run, writeGood(dir, run, 'implement'));
  const step = writeGood(dir, run, 'test');
  writeFileSync(evidencePath(dir, step), '4 passing\n');
  accept(dir, run, step);
  assert.equal(findStep(run, 'test').stage.state, 'approved');
  assert.match(findStep(run, 'test').stage.evidence, /test-output\.txt$/);
  cleanup();
});

test('a skipped stage is never approved, and ship keeps refusing it', () => {
  const { dir, run, cleanup } = freshRun();
  const step = findStep(run, 'investigate');
  skip(dir, run, step, 'already investigated in #12');
  assert.equal(step.stage.state, 'skipped');
  assert.ok(shipBlockers(run).some((b) => b.step === 'investigate' && b.state === 'skipped'));
  // and it still blocks everything downstream — skipped is a hole, not a pass
  assert.ok(blockers(run, findStep(run, 'design')).length > 0);
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
  for (const id of SHARED_STAGES) accept(dir, run, writeGood(dir, run, id));
  accept(dir, run, writeGood(dir, run, 'implement'));
  const step = writeGood(dir, run, 'test');
  writeFileSync(evidencePath(dir, step), 'ok\n');
  assert.throws(() => accept(dir, run, step), /holds no runner result/);
  cleanup();
});

test('the gate reads the LAST result in the evidence, so a two-sided proof is not read as a failure', () => {
  const { dir, run, cleanup } = freshRun();
  for (const id of SHARED_STAGES) accept(dir, run, writeGood(dir, run, id));
  accept(dir, run, writeGood(dir, run, 'implement'));
  const step = writeGood(dir, run, 'test');
  // The red half, then the green half — exactly what the stage is asked for.
  writeFileSync(evidencePath(dir, step), '# pass 0\n# fail 1\n\n--- after the fix ---\n\n# pass 24\n# fail 0\n');
  accept(dir, run, step);
  assert.equal(step.stage.result, 'node --test, 24 passed, 0 failed');
  cleanup();
});

test('a fully approved run has no ship blockers', () => {
  const { dir, run, cleanup } = freshRun();
  for (const id of SHARED_STAGES) accept(dir, run, writeGood(dir, run, id));
  accept(dir, run, writeGood(dir, run, 'implement'));
  const test4 = writeGood(dir, run, 'test');
  writeFileSync(evidencePath(dir, test4), '# pass 12\n# fail 0\n');
  accept(dir, run, test4);
  assert.deepEqual(shipBlockers(run), []);
  assert.equal(nextStep(run), null);
  cleanup();
});

test('split refuses before the design is approved', () => {
  const { dir, run, cleanup } = freshRun();
  accept(dir, run, writeGood(dir, run, 'investigate'));
  assert.throws(() => split(dir, run, [{ title: 'a' }, { title: 'b' }]), /before the design is approved/);
  cleanup();
});

test('split refuses fewer than two work items', () => {
  const { dir, run, cleanup } = freshRun();
  for (const id of SHARED_STAGES) accept(dir, run, writeGood(dir, run, id));
  assert.throws(() => split(dir, run, [{ title: 'only one' }]), /at least 2 work items/);
  cleanup();
});

test('split refuses two work items whose slugs collide', () => {
  const { dir, run, cleanup } = freshRun();
  for (const id of SHARED_STAGES) accept(dir, run, writeGood(dir, run, id));
  assert.throws(() => split(dir, run, [{ title: 'Rotate keys' }, { title: 'rotate  keys' }]), /slug to "rotate-keys"/);
  cleanup();
});

test('split stacks each lane on the one below it, bottom on the base branch', () => {
  const { dir, run, cleanup } = freshRun();
  for (const id of SHARED_STAGES) accept(dir, run, writeGood(dir, run, id));
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
  cleanup();
});

test('split gives every lane its own implement and test stages, and duplicates neither shared stage', () => {
  const { dir, run, cleanup } = freshRun();
  for (const id of SHARED_STAGES) accept(dir, run, writeGood(dir, run, id));
  split(dir, run, [{ title: 'a' }, { title: 'b' }]);
  const rows = board(run);
  assert.equal(rows.filter((r) => r.stage === 'investigate').length, 1);
  assert.equal(rows.filter((r) => r.stage === 'design').length, 1);
  for (const id of PER_ITEM_STAGES) assert.equal(rows.filter((r) => r.stage === id).length, 2);
  cleanup();
});

test('split refuses a second split', () => {
  const { dir, run, cleanup } = freshRun();
  for (const id of SHARED_STAGES) accept(dir, run, writeGood(dir, run, id));
  split(dir, run, [{ title: 'a' }, { title: 'b' }]);
  assert.throws(() => split(dir, run, [{ title: 'c' }, { title: 'd' }]), /already split/);
  cleanup();
});

test('split refuses once implementation has started', () => {
  const { dir, run, cleanup } = freshRun();
  for (const id of SHARED_STAGES) accept(dir, run, writeGood(dir, run, id));
  accept(dir, run, writeGood(dir, run, 'implement'));
  assert.throws(() => split(dir, run, [{ title: 'a' }, { title: 'b' }]), /implementation has started/);
  cleanup();
});

test('a per-item stage on a split run refuses an unnamed lane', () => {
  const { dir, run, cleanup } = freshRun();
  for (const id of SHARED_STAGES) accept(dir, run, writeGood(dir, run, id));
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
  for (const id of SHARED_STAGES) accept(dir, run, writeGood(dir, run, id));
  split(dir, run, [{ title: 'first' }, { title: 'second' }]);
  // lane 2 branches off lane 1's branch — its commits cannot exist until lane 1's do
  const second = findStep(run, 'implement', 'second');
  writeGood(dir, run, 'implement', 'second');
  assert.throws(() => accept(dir, run, second), /first\/implement is pending/);
  cleanup();
});

test('a lane may be implemented while the lane below it is still being tested', () => {
  // The edge the old flat gate invented. Lane 2's implementation needs lane 1's
  // COMMITS, not lane 1's tests — and on the run this was measured against,
  // that false edge is why lane 2 never started.
  const { dir, run, cleanup } = freshRun();
  for (const id of SHARED_STAGES) accept(dir, run, writeGood(dir, run, id));
  split(dir, run, [{ title: 'first' }, { title: 'second' }]);
  accept(dir, run, writeGood(dir, run, 'implement', 'first'));

  assert.equal(findStep(run, 'test', 'first').stage.state, 'pending');
  assert.deepEqual(blockers(run, findStep(run, 'implement', 'second')), []);
  accept(dir, run, writeGood(dir, run, 'implement', 'second'));
  assert.equal(findStep(run, 'implement', 'second').stage.state, 'approved');
  cleanup();
});

test('readySteps reports every independent stage, not just the first', () => {
  const { dir, run, cleanup } = freshRun();
  for (const id of SHARED_STAGES) accept(dir, run, writeGood(dir, run, id));
  split(dir, run, [{ title: 'first' }, { title: 'second' }]);
  // one lane implemented: its test and the next lane's implement are both open
  accept(dir, run, writeGood(dir, run, 'implement', 'first'));
  assert.deepEqual(readySteps(run).map((s) => s.key).sort(), ['first/test', 'second/implement']);
  cleanup();
});

test('a hole two levels down is still named, not hidden behind the step above it', () => {
  const { dir, run, cleanup } = freshRun();
  skip(dir, run, findStep(run, 'investigate'), 'someone else looked at it');
  const blocked = blockers(run, findStep(run, 'implement')).map((b) => b.key);
  assert.ok(blocked.includes('design'), 'the direct dependency must be reported');
  assert.ok(blocked.includes('investigate'), 'and so must the skipped stage behind it');
  cleanup();
});

test('the run round-trips through disk', () => {
  const { dir, run, cleanup } = freshRun();
  accept(dir, run, writeGood(dir, run, 'investigate'));
  assert.equal(findStep(loadRun(dir), 'investigate').stage.state, 'approved');
  cleanup();
});

test('every stage declares a model, an agent, an artifact and what the gate reads for', () => {
  assert.equal(STAGES.length, 4);
  for (const s of STAGES) {
    assert.ok(['opus', 'sonnet'].includes(s.model), `${s.id} has no model`);
    assert.ok(s.agent && s.artifact && s.forbids, `${s.id} is missing a field`);
    assert.ok(s.asks.length > 0 && s.requires.length > 0, `${s.id} asks or requires nothing`);
  }
});

test('policy falls back to the repo default branch when there is no shipflow config', () => {
  const dir = mkdtempSync(join(tmpdir(), 'issueflow-policy-'));
  const policy = resolvePolicy(dir, 'trunk');
  assert.equal(policy.base, 'trunk');
  assert.equal(policy.shipflow, false);
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
// Work items, read out of the approved design rather than retyped.
// ---------------------------------------------------------------------------

test('work items are read from the approved design`s own Work items section', () => {
  const items = workItemsFromDesign(
    '## Approach\n\nsomething\n\n## Work items\n\nThree of them.\n\n' +
      '- `descriptions`: the eight description-string rewrites. Nothing else.\n' +
      '- `query-workouts-honesty`: `source` added to the SELECT\n' +
      '- dead-notes-param: the unread parameter removed\n\n## Proof\n\n- not: an item\n',
  );
  assert.deepEqual(items.map((i) => i.slug), ['descriptions', 'query-workouts-honesty', 'dead-notes-param']);
  assert.equal(items[0].title, 'the eight description-string rewrites');
  assert.ok(!items.some((i) => i.slug === 'not'), 'the parser must stop at the next heading');
});

test('a design that decided the issue is ONE change yields no work items, and says so', () => {
  assert.throws(() => workItemsFromDesign('## Approach\n\nOne change. No split.\n'), /declares no `## Work items`/);
});

test('a Work items heading with nothing parseable under it is refused, not read as zero items', () => {
  assert.throws(() => workItemsFromDesign('## Work items\n\nI decided not to split after all.\n'), /nothing there names a lane/);
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

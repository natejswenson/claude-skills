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
  nextStep, saveRun, skip, split,
} from '../lib/run.mjs';
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
  assert.throws(() => accept(dir, run, step), /never mentions Root cause/);
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

test('a fully approved run has no ship blockers', () => {
  const { dir, run, cleanup } = freshRun();
  for (const id of SHARED_STAGES) accept(dir, run, writeGood(dir, run, id));
  accept(dir, run, writeGood(dir, run, 'implement'));
  const test4 = writeGood(dir, run, 'test');
  writeFileSync(evidencePath(dir, test4), 'ok\n');
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

test('detail counts characters, not soft-wrapped lines', () => {
  // Both bodies are ONE physical line. Scoring on newlines would rank them
  // identically, which is how dinnerdeck#7 read as three lines and 461 chars.
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

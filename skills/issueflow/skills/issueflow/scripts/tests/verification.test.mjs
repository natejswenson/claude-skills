import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { accept, artifactPath, createRun, findStep, laneTree, loadRun, markBriefed, saveRun } from '../lib/run.mjs';
import { contractFromPlan, observedRisk, validateContract } from '../lib/contracts.mjs';
import { assertVerified, verificationCurrent, verifyLane } from '../lib/verification.mjs';
import { recordDispatch } from '../lib/execution.mjs';
import { completeAttempt } from '../lib/attempts.mjs';
import { decide } from '../lib/next.mjs';
import { redTeamPass, writeGood } from './helpers.mjs';
import { parseAllEvidence, twoSided } from '../lib/evidence.mjs';
import { cancelReview, openRound, currentRound, laneDiff, registerRound } from '../lib/prreview.mjs';

const cli = resolve(dirname(fileURLToPath(import.meta.url)), '../issueflow.js');
const contract = () => ({ schema: 1, risk: 'standard', criteria: [{ id: 'C1', description: 'answer returns 42' }], nonGoals: ['unrelated edits'], allowedPaths: ['answer.cjs', 'answer.test.cjs'], checks: [
  { id: 'regression', type: 'regression', argv: [process.execPath, '--test', '--test-reporter=tap', 'answer.test.cjs'], criteria: ['C1'], testFiles: ['answer.test.cjs'] },
  { id: 'suite', type: 'test', argv: [process.execPath, '--test', '--test-reporter=tap', 'answer.test.cjs'], criteria: ['C1'] },
] });
const testSource = "const test = require('node:test'); const assert = require('node:assert/strict'); test('requested answer', () => assert.equal(require('./answer.cjs'), 42));\n";
function fixture(t, transform = (c) => c) {
  const root = mkdtempSync(join(tmpdir(), 'issueflow-verification-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, 'repo'); const dir = join(root, 'run'); mkdirSync(repo);
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: 'pipe' }).trim();
  git('init', '-qb', 'main'); git('config', 'user.name', 'test'); git('config', 'user.email', 'test@example.invalid');
  writeFileSync(join(repo, '.gitignore'), '.offset\nnode_modules/\n');
  writeFileSync(join(repo, 'answer.cjs'), 'module.exports = 41;\n'); git('add', '.'); git('commit', '-qm', 'bug');
  const run = createRun({ strict: true, repo: { path: repo, owner: 'test', name: 'fixture' }, issue: { number: 1, title: 'correct answer' }, policy: { base: 'main', branchPrefix: 'fix' }, offline: true, auto: true });
  saveRun(dir, run);
  const plan = writeGood(dir, run, 'investigate');
  writeFileSync(artifactPath(dir, plan), readFileSync(artifactPath(dir, plan), 'utf8').replace(/```issueflow-contract\n[\s\S]*?\n```/, '```issueflow-contract\n' + JSON.stringify(transform(contract())) + '\n```'));
  redTeamPass(dir, run, plan); accept(dir, run, plan, { auto: true });
  const step = writeGood(dir, run, 'implement'); markBriefed(dir, run, step);
  const tree = laneTree(dir, run, step.lane);
  writeFileSync(join(tree, 'answer.cjs'), 'module.exports = 42;\n');
  writeFileSync(join(tree, 'answer.test.cjs'), testSource);
  execFileSync('git', ['add', '.'], { cwd: tree }); execFileSync('git', ['commit', '-qm', 'fix'], { cwd: tree });
  return { root, dir, tree, run, lane: step.lane, step };
}

test('strict CLI verification executes real red/green and accepts only its receipts', (t) => {
  const f = fixture(t);
  assert.throws(() => accept(f.dir, f.run, f.step), /missing complete controller-observed/);
  const r = spawnSync(process.execPath, [cli, 'verify-run', '--run-dir', f.dir, '--offline'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const run = loadRun(f.dir);
  const lane = run.lanes[0];
  const receipts = lane.verification.receipts.map((r) => JSON.parse(readFileSync(r.path, 'utf8')));
  assert.equal(receipts.length, 2);
  assert.equal(receipts[0].red.exitCode, 1); assert.equal(receipts[0].green.exitCode, 0);
  assert.equal(receipts[0].red.summaries.at(-1).failed, 1);
  assertVerified(f.dir, run, lane);
  accept(f.dir, run, findStep(run, 'implement'));
  assert.equal(loadRun(f.dir).lanes[0].stages[0].state, 'approved');
  assert.equal(decide(f.dir, run, { offline: true }).reason, 'offline');
  run.offline = false;
  assert.equal(decide(f.dir, run, { offline: false }).command, 'ship', 'online strict runs reach the ship gate without a reference error');
});

test('receipt hash, log hash, untracked inputs, and superseded attempts cannot authorize acceptance', (t) => {
  const f = fixture(t); verifyLane(f.dir, f.run, f.lane);
  const rec = f.lane.verification.receipts[0]; const bytes = readFileSync(rec.path);
  writeFileSync(rec.path, '{}'); assert.throws(() => assertVerified(f.dir, f.run, f.lane), /tampered/); writeFileSync(rec.path, bytes);
  const receipt = JSON.parse(bytes); const log = readFileSync(receipt.green.outputPath);
  appendFileSync(receipt.green.outputPath, 'edited'); assert.throws(() => assertVerified(f.dir, f.run, f.lane), /tampered/); writeFileSync(receipt.green.outputPath, log);
  writeFileSync(join(f.tree, 'untracked.txt'), 'new input'); assert.throws(() => assertVerified(f.dir, f.run, f.lane), /stale/); rmSync(join(f.tree, 'untracked.txt'));
  f.step.stage.at.briefed = new Date(Date.now() + 1000).toISOString(); assert.throws(() => assertVerified(f.dir, f.run, f.lane), /stale/);
});

test('post-fix HEAD is automatically verified before another review and before ready', (t) => {
  const f = fixture(t); verifyLane(f.dir, f.run, f.lane); accept(f.dir, f.run, f.step);
  f.lane.pr = { number: 1, url: 'https://example.invalid/1' };
  const head = f.lane.verification.head;
  const entry = { round: 1, head, registered: true, posted: true, verdict: 'converged', fix: null };
  f.lane.review.rounds = [entry];
  writeFileSync(join(f.tree, 'answer.cjs'), 'module.exports = 42; // review correction\n');
  execFileSync('git', ['commit', '-am', 'review correction'], { cwd: f.tree });
  let action = decide(f.dir, f.run, { offline: true });
  assert.equal(action.command, 'verify-run'); assert.equal(action.args.phase, 'review');
  entry.verdict = 'blocked'; entry.fix = { briefed: true, reported: true };
  action = decide(f.dir, f.run, { offline: true });
  assert.equal(action.command, 'verify-run'); assert.equal(action.args.phase, 'review');
  verifyLane(f.dir, f.run, f.lane);
  assert.equal(decide(f.dir, f.run, { offline: true }).command, 'review-brief');
});

test('abandoned review retains evidence and cap, and cannot register stale outputs', (t) => {
  const f = fixture(t); f.lane.pr = { number: 1, url: 'https://example.invalid/1' }; f.lane.review.maxRounds = 2;
  const options = { head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: f.tree, encoding: 'utf8' }).trim(), diffText: laneDiff(f.tree, 'main') };
  openRound(f.dir, f.run, f.lane, options);
  assert.throws(() => cancelReview(f.dir, f.run, f.lane, { reason: 'partial' }), /workers-released/);
  cancelReview(f.dir, f.run, f.lane, { reason: 'parent observed terminal workers', workersReleased: true });
  assert.throws(() => registerRound(f.dir, f.run, f.lane, 1, { tree: f.tree }), /cancelled/);
  openRound(f.dir, f.run, f.lane, options);
  assert.equal(currentRound(f.lane).round, 2);
  assert.ok(f.lane.review.rounds[0].cancelled);
});

test('a required full-suite process failure cannot be erased by targeted green', (t) => {
  const f = fixture(t, (c) => ({ ...c, checks: [...c.checks, { id: 'full', type: 'command', criteria: ['C1'], argv: [process.execPath, '-e', 'process.exit(1)'] }] }));
  assert.throws(() => verifyLane(f.dir, f.run, f.lane), /failed or stale obligation full/);
  assert.equal(f.lane.verification.receipts.length, 3);
  assert.throws(() => accept(f.dir, f.run, f.step), /full/);
});

test('load-error red, zero-test green and real nonzero status are refused', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.tree, 'answer.test.cjs'), "require('./missing.cjs');\n");
  execFileSync('git', ['commit', '-am', 'invalid test'], { cwd: f.tree });
  assert.throws(() => verifyLane(f.dir, f.run, f.lane), /failed or stale/);
  for (const text of ['# pass 0\n# fail 1\n# pass 0\n# fail 0\n', '# pass 0\n# fail 1\n# pass 2\n# fail 0\nexit code 7\n']) assert.equal(twoSided(parseAllEvidence(text)).ok, false);
});

test('contracts reject incomplete criteria, traversal, disguised code and out-of-scope edits', (t) => {
  assert.throws(() => contractFromPlan('no contract'), /exactly one/);
  assert.throws(() => validateContract({ ...contract(), allowedPaths: ['../escape'] }), /relative/);
  assert.throws(() => validateContract({ ...contract(), criteria: [...contract().criteria, { id: 'C2', description: 'uncovered' }] }), /every criterion/);
  assert.equal(observedRisk(['README.md'], () => 'A spelling correction.').kind, 'fast-docs');
  assert.equal(observedRisk(['skills/sample/SKILL.md']).kind, 'standard');
  assert.equal(observedRisk(['src/auth.js']).kind, 'deep');
  const f = fixture(t); writeFileSync(join(f.tree, 'outside.txt'), 'unauthorized'); execFileSync('git', ['add', '.'], { cwd: f.tree }); execFileSync('git', ['commit', '-qm', 'outside'], { cwd: f.tree });
  assert.throws(() => verifyLane(f.dir, f.run, f.lane), /unapproved paths/);
});

test('ignored runtime inputs and installed offline dependencies are fingerprinted and available to red', (t) => {
  const f = fixture(t);
  mkdirSync(join(f.tree, 'node_modules/local-fixture'), { recursive: true });
  writeFileSync(join(f.tree, 'node_modules/local-fixture/index.js'), 'module.exports = 42;');
  writeFileSync(join(f.tree, '.offset'), '0');
  writeFileSync(join(f.tree, 'answer.test.cjs'), testSource.replace('42)', "require('local-fixture') + Number(require('node:fs').readFileSync('.offset','utf8')))"));
  execFileSync('git', ['commit', '-am', 'exercise local runtime inputs'], { cwd: f.tree });
  verifyLane(f.dir, f.run, f.lane);
  assertVerified(f.dir, f.run, f.lane);
  writeFileSync(join(f.tree, '.offset'), '10');
  const result = spawnSync(process.execPath, ['--test', 'answer.test.cjs'], { cwd: f.tree, env: { ...process.env, NODE_TEST_CONTEXT: undefined } });
  assert.equal(result.status, 1, 'changed runtime input actually breaks the regression');
  assert.throws(() => accept(f.dir, f.run, f.step), /stale/);
  writeFileSync(join(f.tree, '.offset'), '0');
  writeFileSync(join(f.tree, 'node_modules/local-fixture/index.js'), 'module.exports = 43;');
  assert.throws(() => assertVerified(f.dir, f.run, f.lane), /stale/);
});

test('report-only repair at the same HEAD gets a fresh verification batch, not a stale-receipt loop', (t) => {
  const f = fixture(t);
  const brief = join(f.dir, 'repair-brief.md'); const output = artifactPath(f.dir, f.step);
  writeFileSync(brief, 'Synthetic dispatch'); recordDispatch(f.dir, f.run, brief, [output]);
  completeAttempt(f.run.harness.attempts['root/implement.md'].manifest);
  verifyLane(f.dir, f.run, f.lane);
  const firstBatch = f.lane.verification.batchId;
  // Same timestamp as well as same commit: UUID, not clock resolution, separates attempts.
  writeFileSync(brief, 'Synthetic corrected report dispatch'); recordDispatch(f.dir, f.run, brief, [output]);
  completeAttempt(f.run.harness.attempts['root/implement.md'].manifest); saveRun(f.dir, f.run);
  assert.equal(verificationCurrent(f.dir, f.run, f.lane), false);
  assert.equal(decide(f.dir, f.run, { offline: true }).command, 'verify-run');
  verifyLane(f.dir, f.run, f.lane);
  assert.notEqual(f.lane.verification.batchId, firstBatch);
  accept(f.dir, f.run, f.step);
  assert.equal(f.step.stage.state, 'approved');
});

test('invalid completion can recover only after explicit native worker release acknowledgement', (t) => {
  const f = fixture(t);
  const brief = join(f.dir, 'repair-brief.md'); const output = artifactPath(f.dir, f.step);
  writeFileSync(brief, 'Synthetic dispatch'); recordDispatch(f.dir, f.run, brief, [output]);
  completeAttempt(f.run.harness.attempts['root/implement.md'].manifest);
  appendFileSync(output, '\nLate formatting change');
  f.run.dispatch.queue = { items: [{ prompt: brief }], active: [{ prompt: brief }], cursor: 1, released: false }; saveRun(f.dir, f.run);
  const invoke = (...args) => spawnSync(process.execPath, [cli, 'cancel-wave', '--run-dir', f.dir, ...args], { encoding: 'utf8' });
  assert.equal(invoke('--reason', 'worker stopped').status, 2);
  assert.equal(loadRun(f.dir).dispatch.queue.active.length, 1);
  const recovered = invoke('--workers-released', '--reason', 'parent observed terminal worker');
  assert.equal(recovered.status, 0, recovered.stderr);
  const run = loadRun(f.dir);
  assert.equal(run.dispatch.queue, undefined);
  assert.equal(run.harness.attempts['root/implement.md'].state, 'cancelled');
  assert.equal(decide(f.dir, run, { offline: true }).command, 'brief');
  assert.equal(run.harness.cancelledWaves.length, 1);
});

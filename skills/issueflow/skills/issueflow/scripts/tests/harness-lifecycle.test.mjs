/**
 * Synthetic offline workers + persistent fake GitHub; real CLI, Git and tests.
 * No model clients, real GitHub, network provisioning, or real CI are invoked.
 * Set ISSUEFLOW_HARNESS_KEEP=1 to retain command logs, receipts and repositories.
 * ISSUEFLOW_HARNESS_SOURCE optionally pins an independently frozen skill tree.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, copyFileSync, chmodSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const source = process.env.ISSUEFLOW_HARNESS_SOURCE ?? fileURLToPath(new URL('../..', import.meta.url));
const cli = join(source, 'scripts/issueflow.js');
const { createRun, saveRun } = await import(pathToFileURL(join(source, 'scripts/lib/run.mjs')));
const { approvePlan } = await import(pathToFileURL(join(source, 'scripts/tests/helpers.mjs')));
const json = p => JSON.parse(readFileSync(p, 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const put = (p, value) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, typeof value === 'string' ? value : JSON.stringify(value, null, 2)); };
const passedReview = { findings: [{ severity: 'low', disposition: 'note', cite: 'investigate.md § Unknowns', text: 'Synthetic offline independent review input.' }], notExamined: ['Live workers and GitHub'], verdict: 'pass' };
const implementation = '# Synthetic offline implementation\n\n## Changed\nCount helper and regression tests.\n\n## Deviations\nSynthetic workers, no live model.\n\n## Command\nThe controller runs actual Node tests.\n\n## Two-sided\nIdentical tests run on base and implementation.\n\n## Result\nCommitted code passes the exercised cases.\n';
const tests = "const test=require('node:test');const assert=require('node:assert/strict');const count=require('./count.cjs');\ntest('three items',()=>assert.equal(count([1,2,3]),3));\ntest('empty items',()=>assert.equal(count([]),0));\n";
function plan(docs = false) {
  const c = docs
    ? { schema: 1, risk: 'docs', criteria: [{ id: 'D1', description: 'Clarify local docs' }], nonGoals: ['Source changes'], allowedPaths: ['README.md'], checks: [{ id: 'docs', type: 'command', argv: ['node', '-e', "require('node:assert/strict').match(require('node:fs').readFileSync('README.md','utf8'),/local/)"], criteria: ['D1'] }], ci: { mode: 'none', reason: 'Synthetic local docs fixture has no CI' } }
    : { schema: 1, risk: 'standard', criteria: [{ id: 'C1', description: 'Count all array items and empty arrays correctly' }], nonGoals: ['Changing exports'], allowedPaths: ['count.cjs', 'count.test.cjs'], checks: [{ id: 'regression', type: 'regression', argv: ['node', '--test', '--test-reporter=tap', 'count.test.cjs'], criteria: ['C1'], testFiles: ['count.test.cjs'] }, { id: 'suite', type: 'test', argv: ['node', '--test', '--test-reporter=tap'], criteria: ['C1'] }], ci: { mode: 'required', requiredChecks: ['test'] } };
  return '# Synthetic offline plan\n\n## Root cause\n' + (docs ? 'README.md needs clearer local wording.' : 'count.cjs:1 subtracts one from the length.') + '\n\n## Evidence\n' + (docs ? 'The existing local description is imprecise.' : 'Three items return 2 and empty arrays return -1.') + '\n\n## Unknowns\nNative workers untested.\n\n## Approach\n' + (docs ? 'Clarify README.md only.' : 'Correct the helper and test three-item and empty arrays; preserve every element.') + '\n\n## Rejected\nChanging unrelated code is outside scope.\n\n## Files\n' + c.allowedPaths.join(', ') + '\n\n## Proof\nController executes the approved relevant checks.\n\n```issueflow-contract\n' + JSON.stringify(c) + '\n```\n';
}

function fixture(t, { legacy = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'issueflow-harness-lifecycle-'));
  t.diagnostic(`Synthetic local lifecycle evidence: ${root}`);
  t.after(() => { if (!process.env.ISSUEFLOW_HARNESS_KEEP) rmSync(root, { recursive: true, force: true }); });
  const repo = join(root, 'repo'), dir = join(root, 'run'), bin = join(root, 'bin');
  mkdirSync(repo); mkdirSync(bin); mkdirSync(join(root, 'workspace')); mkdirSync(join(root, 'logs'));
  copyFileSync(fileURLToPath(new URL('./fixtures/harness-gh.cjs', import.meta.url)), join(bin, 'gh')); chmodSync(join(bin, 'gh'), 0o755);
  const env = { ...process.env, PATH: bin + ':' + process.env.PATH, ISSUEFLOW_FAKE_GH_ROOT: root, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_ALLOW_PROTOCOL: 'file', TMPDIR: root };
  // Nested node --test must not inherit the outer runner's IPC/reporting mode.
  delete env.NODE_TEST_CONTEXT;
  let sequence = 0;
  function command(exe, args, { cwd = repo, expected = 0 } = {}) {
    const r = spawnSync(exe, args, { cwd, env, encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
    put(join(root, 'logs', `${++sequence}.json`), { command: [exe, ...args], cwd, exitCode: r.status, signal: r.signal, error: r.error?.message, stdout: r.stdout, stderr: r.stderr });
    assert.equal(r.status, expected, `${exe} ${args.join(' ')}\n${r.stdout}\n${r.stderr}\n${r.error ?? ''}`);
    return r;
  }
  const invoke = (...args) => command(process.execPath, [cli, ...args, '--run-dir', dir, ...(legacy ? ['--offline'] : [])]);
  const state = () => json(join(dir, 'run.json'));
  const tree = () => state().execution ? join(state().execution.path, 'worktrees/root') : join(dir, 'worktrees/root');
  const git = (args, cwd = repo) => command('git', args, { cwd }).stdout.trim();
  const deliver = (key, bytes) => {
    const attempt = state().harness.attempts[key]; assert.ok(attempt, `missing dispatched attempt ${key}`);
    put(attempt.outputs[0], bytes);
    command(process.execPath, [join(source, 'scripts/complete-worker.mjs'), attempt.manifest]);
    return attempt;
  };
  put(join(repo, legacy ? 'README.md' : 'count.cjs'), legacy ? 'Old local documentation.\n' : 'module.exports=items=>items.length-1;\n');
  for (const args of [['init', '-qb', 'dev'], ['config', 'user.name', 'Synthetic offline fixture'], ['config', 'user.email', 'offline@example.invalid'], ['add', '.'], ['commit', '-qm', 'Synthetic base defect']]) git(args);
  if (legacy) {
    const run = createRun({ strict: false, repo: { path: repo, owner: 'offline', name: 'evolution' }, issue: { number: 2, title: 'Clarify local docs' }, policy: { base: 'dev', branchPrefix: 'feature/' }, offline: true, auto: true, runtime: 'claude' });
    saveRun(dir, run); approvePlan(dir, run, { auto: true }); saveRun(dir, run);
    put(join(dir, 'inputs/issue.json'), { number: 2, title: 'Clarify local docs', body: 'Synthetic legacy issue: clarify README.md local wording only.', comments: [], labels: [] });
  } else {
    git(['init', '--bare', '-q', join(root, 'remote.git')]); git(['remote', 'add', 'origin', join(root, 'remote.git')]); git(['push', '-u', 'origin', 'dev']);
    put(join(root, 'fake-gh-state.json'), { issue: { number: 1, title: 'Fix array item count', body: 'Count every item, including falsy values. Three items returns 3; empty returns 0. Preserve CommonJS.', state: 'OPEN', url: 'https://example.invalid/offline/count-prflow/issues/1', labels: [], comments: [], author: { login: 'offline' } }, comments: [], pr: null, prComments: [], reviews: [], threads: [], graphql: [], ci: [] });
    invoke('start', '--repo', repo, '--issue', '1', '--runtime', 'codex', '--workspace-root', join(root, 'workspace'));
  }
  return { root, repo, dir, command, invoke, state, tree, git, deliver, remote: () => json(join(root, 'fake-gh-state.json')) };
}
function throughImplementation(f) {
  f.invoke('next');
  f.deliver('shared/investigate.md', plan()); f.invoke('next', '--workers-released');
  f.deliver('reviews/investigate-r1.findings.json', passedReview); f.invoke('next', '--workers-released');
  assert.equal(f.state().stages[0].state, 'approved');
  put(join(f.tree(), 'count.cjs'), 'module.exports=items=>items.filter(Boolean).length;\n'); put(join(f.tree(), 'count.test.cjs'), tests);
  f.git(['add', 'count.cjs', 'count.test.cjs'], f.tree()); f.git(['commit', '-qm', 'Synthetic initial implementation with real falsy bug'], f.tree());
  f.deliver('root/implement.md', implementation); f.invoke('next', '--workers-released');
  assert.equal(f.state().lanes[0].stages[0].state, 'approved');
  assert.equal(f.remote().pr.isDraft, true);
}

test('strict CLI lifecycle: real proof, synthetic PR fix/review, automatic fresh receipts, resumable readiness', { timeout: 180000 }, t => {
  const f = fixture(t); throughImplementation(f);
  const initial = structuredClone(f.state().lanes[0].verification);
  assert.equal(initial.complete, true);
  assert.match(readFileSync(f.state().harness.attempts['root/review/r1/candidates-1.json'].brief, 'utf8'), /Round 1 of at most 2\./);
  f.deliver('root/review/r1/candidates-1.json', { candidates: [{ file: 'count.cjs', line: 1, side: 'RIGHT', category: 'line-by-line', summary: 'filter(Boolean) drops zero and false array elements.', short_summary: 'Falsy elements are dropped from the count', failure_scenario: 'count([0]) returns 0 instead of 1.', introduced_by_diff: true }], notExamined: ['Synthetic finder, no live reviewer'] });
  f.invoke('next', '--workers-released');
  f.deliver('root/review/r1/verdicts-1.json', { verdicts: [{ id: 'c-1-1', verdict: 'CONFIRMED', severity: 'major', quote: 'module.exports=items=>items.filter(Boolean).length;', introduced_by_diff: true, explanation: 'Synthetic verifier: zero is filtered out.' }] });
  f.invoke('next', '--workers-released');
  const finding = f.state().lanes[0].review.findings[0]; assert.equal(finding.status, 'open'); assert.equal(f.remote().reviews.length, 1);
  const assertion = "require('node:assert/strict').equal(require('./count.cjs')([0]),1)";
  f.command(process.execPath, ['-e', assertion], { cwd: f.tree(), expected: 1 });
  put(join(f.tree(), 'count.cjs'), 'module.exports=items=>items.length;\n');
  f.command(process.execPath, ['-e', assertion], { cwd: f.tree() });
  const suite = f.command(process.execPath, ['--test', '--test-reporter=tap'], { cwd: f.tree() });
  put(join(f.state().execution.path, 'artifacts/root/test-output.txt'), suite.stdout + suite.stderr);
  f.git(['add', 'count.cjs'], f.tree()); f.git(['commit', '-qm', `Fix ${finding.id}: count falsy items`], f.tree()); f.git(['push', 'origin', 'feature/issue-1'], f.tree());
  const head = f.git(['rev-parse', 'HEAD'], f.tree());
  f.deliver('root/review/r1/fix-report.json', { [finding.id]: { status: 'fixed', note: 'Synthetic fixer: actual zero assertion now passes.' }, _summary: 'Synthetic fixer pushed ' + head });
  const afterFix = f.invoke('next', '--workers-released');
  assert.match(afterFix.stdout, /verify-run/);
  const verified = f.state().lanes[0].verification;
  assert.notEqual(verified.batchId, initial.batchId); assert.equal(verified.head, head); assert.equal(verified.complete, true);
  f.deliver('root/review/r2/candidates-1.json', { candidates: [], notExamined: ['Synthetic follow-up finder'] }); f.invoke('next', '--workers-released');
  f.deliver('root/review/r2/verdicts-1.json', { verdicts: [{ id: finding.id, verdict: 'fixed', quote: 'module.exports=items=>items.length;', line: 1, note: 'Synthetic follow-up verifier; real zero assertion passes.' }] });
  const remote = f.remote(); remote.failSummaryReadOnce = true; put(join(f.root, 'fake-gh-state.json'), remote);
  const interrupted = f.command(process.execPath, [cli, 'next', '--workers-released', '--run-dir', f.dir], { expected: 3 });
  assert.match(interrupted.stderr, /Synthetic interruption/); assert.equal(f.remote().pr.isDraft, false);
  f.invoke('next');
  const stable = f.remote(); const repeated = f.invoke('next');
  assert.match(repeated.stdout, /stop — shipped/); assert.deepEqual(f.remote(), stable, 'repeated next has no remote effects');
  assert.equal(stable.pr.state, 'OPEN'); assert.equal(stable.pr.isDraft, false); assert.equal(stable.reviews.length, 2); assert.equal(stable.reviews.filter(r => r.submitted).length, 2);
  assert.equal(stable.threads.length, 1); assert.equal(stable.threads[0].isResolved, true); assert.equal(stable.threads[0].comments.nodes.length, 3); assert.equal(stable.prComments.length, 1);
  const calls = readFileSync(join(f.root, 'fake-gh-calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(calls.filter(c => c.args[0] === 'pr' && c.args[1] === 'create').length, 1); assert.equal(calls.filter(c => c.args[0] === 'pr' && c.args[1] === 'ready').length, 1);
  assert.ok(stable.ci.some(c => c.head === head && c.exit === 0), 'local CI substitute executed on final pushed head');
  const lane = f.state().lanes[0]; assert.equal(lane.review.findings[0].status, 'fixed'); assert.equal(lane.verification.head, head);
  assert.ok(Object.values(f.state().operations).every(o => o.state === 'confirmed'));
  assert.equal(lane.verification.receipts.length, 2, 'regression and full suite are both required');
  for (const reference of lane.verification.receipts) {
    assert.equal(hash(readFileSync(reference.path)), reference.hash);
    const receipt = json(reference.path); assert.equal(receipt.head, head); assert.equal(receipt.passed, true); assert.equal(receipt.green.exitCode, 0);
    assert.ok(receipt.green.summaries.some(s => s.passed > 0 && s.failed === 0));
    assert.equal(hash(readFileSync(receipt.green.outputPath)), receipt.green.outputHash);
    if (receipt.type === 'regression') { assert.equal(receipt.red.exitCode, 1); assert.ok(receipt.red.summaries.some(s => s.failed > 0 && !s.loadError)); assert.equal(hash(readFileSync(receipt.red.outputPath)), receipt.red.outputHash); }
  }
  assert.equal(f.git(['rev-parse', 'HEAD'], f.tree()), head); assert.equal(f.git(['--git-dir', join(f.root, 'remote.git'), 'rev-parse', 'refs/heads/feature/issue-1']), head); assert.equal(f.git(['status', '--porcelain'], f.tree()), '');
  assert.doesNotMatch(stable.comments[0].body, /Each stage below ran as its own subagent and was gated/);
});

test('migration and identical-byte amendment require fresh independent review while retaining history', { timeout: 60000 }, t => {
  const f = fixture(t, { legacy: true }), before = f.state();
  f.invoke('migrate-run', '--workers-released', '--reason', 'Synthetic offline strict migration');
  const migrated = f.state(); assert.equal(migrated.schema, 4); assert.equal(migrated.stages[0].state, 'pending'); assert.equal(migrated.harness.contract, null);
  assert.equal(migrated.createdAt, before.createdAt); assert.deepEqual(migrated.complexity, before.complexity); assert.equal(migrated.stages[0].review.rounds.length, 1);
  f.invoke('next', '--workers-released');
  assert.ok(f.state().harness.attempts['shared/investigate.md'], 'next must issue a new plan instead of accepting historical review');
  f.deliver('shared/investigate.md', plan(true)); f.invoke('next', '--workers-released');
  f.deliver('reviews/investigate-r2.findings.json', passedReview); f.invoke('next', '--workers-released'); assert.equal(f.state().stages[0].state, 'approved');
  f.invoke('amend', '--workers-released', '--reason', 'Recheck the same scope with fresh independent review');
  f.invoke('next', '--workers-released'); f.deliver('shared/investigate.md', plan(true)); f.invoke('next', '--workers-released');
  assert.notEqual(f.state().stages[0].state, 'approved', 'identical plan bytes cannot reuse pre-amend review');
  assert.ok(f.state().harness.attempts['reviews/investigate-r3.findings.json']);
  f.deliver('reviews/investigate-r3.findings.json', passedReview); f.invoke('next', '--workers-released');
  const final = f.state(); assert.equal(final.stages[0].state, 'approved'); assert.equal(final.stages[0].review.rounds.length, 3); assert.equal(final.createdAt, before.createdAt); assert.deepEqual(final.complexity, before.complexity);
  assert.equal(final.harness.amendments.length, 2);
  for (const a of final.harness.amendments) { assert.equal(hash(readFileSync(join(a.archive, 'run.json'))), a.stateHash); for (const file of a.artifacts) assert.equal(hash(readFileSync(join(a.archive, file.archive))), file.hash); }
});

test('review-cancel retains abandoned round and partial evidence, then permits a new round within the cap', { timeout: 120000 }, t => {
  const f = fixture(t); throughImplementation(f);
  const before = f.state(), attempt = before.harness.attempts['root/review/r1/candidates-1.json'];
  const partial = '{"synthetic":"interrupted worker; incomplete candidate output"'; put(attempt.outputs[0], partial);
  f.invoke('cancel-wave', '--workers-released', '--reason', 'Synthetic parent observed every interrupted worker terminal');
  f.invoke('review-cancel', '--lane', 'root', '--workers-released', '--reason', 'Synthetic interrupted review is abandoned, not completed');
  const cancelled = f.state(); assert.ok(cancelled.lanes[0].review.rounds[0].cancelled); assert.ok(!cancelled.lanes[0].review.rounds[0].registered); assert.equal(readFileSync(attempt.outputs[0], 'utf8'), partial);
  f.invoke('next');
  const fresh = f.state(); assert.equal(fresh.lanes[0].review.rounds.length, 2); assert.equal(fresh.lanes[0].review.maxRounds, before.lanes[0].review.maxRounds); assert.equal(fresh.createdAt, before.createdAt);
  assert.ok(fresh.harness.attempts['root/review/r2/candidates-1.json']); assert.equal(readFileSync(attempt.outputs[0], 'utf8'), partial);
  assert.equal(f.remote().reviews.length, 0, 'abandoned partial review never posts');
  f.invoke('cancel-wave', '--workers-released', '--reason', 'Synthetic second interrupted worker is terminal');
  f.invoke('review-cancel', '--lane', 'root', '--workers-released', '--reason', 'Synthetic second abandoned round consumes the remaining budget');
  const exhausted = f.command(process.execPath, [cli, 'next', '--run-dir', f.dir], { expected: 4 });
  assert.match(exhausted.stdout, /stop — exhausted/);
  assert.equal(f.state().lanes[0].review.rounds.length, 2, 'cancellation never buys an extra round');
});

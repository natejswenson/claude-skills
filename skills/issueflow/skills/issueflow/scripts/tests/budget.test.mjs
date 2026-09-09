import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { artifactPath, briefPath, createRun, evidencePath, findStep, loadRun, markBriefed, saveRun } from '../lib/run.mjs';
import { decide, renderAction } from '../lib/next.mjs';
import { markReviewBriefed, reviewBriefPath } from '../lib/reviews.mjs';
import { GOOD_EVIDENCE, approvePlan, redTeamBlock, redTeamPass, writeGood, writeReview } from './helpers.mjs';

const CLI = fileURLToPath(new URL('../issueflow.js', import.meta.url));
const ISSUE = { number: 292, title: 'Budget recovery', url: 'https://example.invalid/292', body: 'x' };
const POLICY = { base: 'dev', featurePrefix: 'feature/', mergeMethod: 'squash', source: 'test', shipflow: true };
const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const cli = (dir, args) => spawnSync(process.execPath, [CLI, ...args, '--run-dir', dir], {
  encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: undefined },
});

function fixture(t, { expired = true, runtime = 'claude', auto = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'issueflow-budget-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, "run with 'quote'");
  const repoPath = join(root, 'repo');
  mkdirSync(repoPath);
  git(['init', '-q', '-b', 'dev'], repoPath);
  git(['config', 'user.email', 'test@example.invalid'], repoPath);
  git(['config', 'user.name', 'test'], repoPath);
  writeFileSync(join(repoPath, 'a.js'), 'export const a = 1;\n');
  git(['add', 'a.js'], repoPath);
  git(['commit', '-qm', 'seed'], repoPath);
  git(['checkout', '-qb', 'feature/issue-292'], repoPath);
  const run = createRun({ repo: { owner: 'acme', name: 'w', path: repoPath, defaultBranch: 'dev' }, issue: ISSUE, policy: POLICY, offline: true, auto, runtime });
  run.createdAt = new Date(Date.now() - (expired ? 7200 : 0) * 1000).toISOString();
  run.complexity.budgetSeconds = 1800;
  saveRun(dir, run);
  mkdirSync(join(dir, 'inputs'), { recursive: true });
  writeFileSync(join(dir, 'inputs', 'issue.json'), JSON.stringify(ISSUE));
  return { dir, run, repoPath };
}

function implementation(dir, run) {
  approvePlan(dir, run);
  const step = findStep(run, 'implement');
  markBriefed(dir, run, step, () => new Date(Date.now() - 90_000).toISOString());
  mkdirSync(dirname(briefPath(dir, step)), { recursive: true });
  writeFileSync(briefPath(dir, step), 'original brief\n');
  writeGood(dir, run, 'implement');
  writeFileSync(evidencePath(dir, step), GOOD_EVIDENCE);
  // Shipping is already complete so next reaches the first finder boundary offline.
  run.lanes[0].pr = { number: 1, url: 'https://example.invalid/pull/1', title: 'fix' };
  saveRun(dir, run);
  return step;
}

for (const offset of [-1, 0, 1]) {
  test(`budget: implementation delivered ${offset}s from deadline reaches acceptance`, (t) => {
    const { dir, run } = fixture(t);
    const step = implementation(dir, run);
    const deadline = Date.parse(run.createdAt) + 1800_000;
    step.stage.at.briefed = new Date(deadline - 60_000).toISOString();
    const delivery = new Date(deadline + offset * 1000);
    utimesSync(artifactPath(dir, step), delivery, delivery);
    const action = decide(dir, run, { now: () => new Date(deadline + 2000).toISOString() });
    assert.deepEqual([action.kind, action.command], ['run', 'accept']);
  });
}

test('budget: CLI accepts and checkpoints the delivered commit, then refuses and never repeats acceptance', (t) => {
  const { dir, run, repoPath } = fixture(t);
  const step = implementation(dir, run);
  const head = git(['rev-parse', 'HEAD'], repoPath);
  const originalBrief = readFileSync(briefPath(dir, step), 'utf8');
  const result = cli(dir, ['next']);
  assert.match(result.stdout, /▶ accept/);
  assert.equal(result.status, 4, result.stderr);
  assert.match(result.stdout, /next: stop — budget/);
  const after = loadRun(dir);
  assert.equal(findStep(after, 'implement').stage.state, 'approved');
  assert.ok(findStep(after, 'implement').stage.at.delivered);
  assert.match(result.stdout, /accepted|approved/i);
  const second = cli(dir, ['next']);
  assert.equal(second.status, 4, second.stderr);
  assert.doesNotMatch(second.stdout, /▶ accept|Dispatch ONE/);
  assert.equal(readFileSync(briefPath(dir, step), 'utf8'), originalBrief);
  assert.equal(git(['rev-parse', 'HEAD'], repoPath), head);
  assert.deepEqual(findStep(loadRun(dir), 'implement').stage, findStep(after, 'implement').stage);
});

test('budget: exact deadline blocks a new dispatch, but an in-flight worker can finish', (t) => {
  const { dir, run } = fixture(t);
  const now = () => new Date(Date.parse(run.createdAt) + 1800_000).toISOString();
  const action = decide(dir, run, { now });
  assert.deepEqual([action.kind, action.reason], ['stop', 'budget']);
  assert.deepEqual(action.budget, {
    elapsedSeconds: 1800, allowanceSeconds: 1800, remainingSeconds: 0, expired: true,
    deadline: now(),
  });
  const step = findStep(run, 'investigate');
  markBriefed(dir, run, step, now);
  const waiting = decide(dir, run, { now });
  assert.equal(waiting.kind, 'wait');
  assert.equal(waiting.budget.expired, true);
});

for (const args of [
  ['next'], ['brief', '--stage', 'investigate'], ['brief', '--stage', 'implement'],
  ['brief', '--stage', 'investigate', '--review'], ['brief', '--ready'],
  ['review-brief', '--lane', 'root'], ['review-verify', '--lane', 'root'],
  ['review-fix-brief', '--lane', 'root'],
]) {
  test(`budget: direct dispatch boundary refuses ${args.join(' ')} before mutation`, (t) => {
    const { dir, run } = fixture(t);
    const original = structuredClone(run);
    const result = cli(dir, args);
    assert.match(result.stdout, /next: stop — budget/);
    assert.equal(result.status, 4, result.stderr);
    assert.doesNotMatch(result.stdout, /Dispatch ONE|next: dispatch/);
    assert.deepEqual(loadRun(dir), original);
    assert.equal(existsSync(join(dir, 'briefs')), false);
    assert.equal(existsSync(join(dir, 'worktrees')), false);
  });
}

test('budget: delivered unreviewed plan is saved without approval before stopping', (t) => {
  const { dir, run } = fixture(t);
  const step = findStep(run, 'investigate');
  markBriefed(dir, run, step, () => new Date(Date.now() - 60_000).toISOString());
  writeGood(dir, run, 'investigate');
  const result = cli(dir, ['next']);
  assert.ok(findStep(loadRun(dir), 'investigate').stage.at.delivered);
  assert.equal(result.status, 4, result.stderr);
  assert.equal(findStep(loadRun(dir), 'investigate').stage.state, 'briefed');
  assert.equal(existsSync(reviewBriefPath(dir, step, 1)), false);
  assert.match(result.stdout, /delivery metadata saved/i);
});

for (const defect of ['missing evidence', 'green-only evidence', 'malformed artifact', 'dirty tree']) {
  test(`budget: expired ${defect} still fails its gate without rebriefing`, (t) => {
    const { dir, run, repoPath } = fixture(t);
    const step = implementation(dir, run);
    if (defect === 'missing evidence') rmSync(evidencePath(dir, step));
    if (defect === 'green-only evidence') writeFileSync(evidencePath(dir, step), '# pass 3\n# fail 0\nexit code 0\n');
    if (defect === 'malformed artifact') writeFileSync(artifactPath(dir, step), '# missing required sections\n');
    if (defect === 'dirty tree') writeFileSync(join(repoPath, 'a.js'), 'uncommitted\n');
    const artifact = readFileSync(artifactPath(dir, step), 'utf8');
    const result = cli(dir, ['next']);
    assert.match(result.stdout, /gate refused:/);
    assert.equal(result.status, 4, result.stderr);
    assert.match(result.stdout, /next: stop — budget/);
    assert.doesNotMatch(result.stdout, /next: dispatch|Dispatch ONE/);
    const after = findStep(loadRun(dir), 'implement');
    assert.equal(after.stage.at.briefed, step.stage.at.briefed);
    assert.ok(after.stage.at.delivered);
    assert.notEqual(after.stage.state, 'approved');
    assert.equal(readFileSync(artifactPath(dir, step), 'utf8'), artifact);
    assert.equal(readFileSync(briefPath(dir, step), 'utf8'), 'original brief\n');
  });
}

for (const auto of [false, true]) {
  test(`budget: delivered plan review registers and preserves auto=${auto}`, (t) => {
    const { dir, run } = fixture(t, { auto });
    const step = writeGood(dir, run, 'investigate');
    markBriefed(dir, run, step, () => new Date(Date.now() - 60_000).toISOString());
    markReviewBriefed(dir, run, step, 1);
    writeReview(dir, step);
    const result = cli(dir, ['next', '--no-worktree']);
    assert.match(result.stdout, /Round 1 of 3 on investigate: PASS/);
    assert.equal(findStep(loadRun(dir), 'investigate').stage.state, auto ? 'approved' : 'briefed');
    assert.match(result.stdout, auto ? /next: stop — budget/ : /next: stop — human/);
    assert.doesNotMatch(result.stdout, /Dispatch ONE/);
  });
}

for (const runtime of ['claude', 'codex']) {
  test(`budget: real resume preserves all state and grants a full window for ${runtime}`, (t) => {
    const { dir, run, repoPath } = fixture(t, { runtime, auto: false });
    const step = implementation(dir, run);
    run.checkpoint.commentId = 123;
    run.checkpoint.commentUrl = 'https://example.invalid/comment/123';
    run.checkpoint.pushed.root = git(['rev-parse', 'HEAD'], repoPath);
    saveRun(dir, run);
    const before = loadRun(dir);
    const artifact = readFileSync(artifactPath(dir, step), 'utf8');
    const evidence = readFileSync(evidencePath(dir, step), 'utf8');
    const start = Date.now();
    const result = cli(dir, ['resume', '--budget-seconds', '1800']);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const after = loadRun(dir);
    const { budgetRenewals, ...unchanged } = after;
    assert.deepEqual(unchanged, before);
    assert.equal(budgetRenewals.length, 1);
    assert.equal(budgetRenewals[0].budgetSeconds, 1800);
    assert.ok(Date.parse(budgetRenewals[0].at) >= start && Date.parse(budgetRenewals[0].at) <= Date.now());
    assert.equal(readFileSync(artifactPath(dir, step), 'utf8'), artifact);
    assert.equal(readFileSync(evidencePath(dir, step), 'utf8'), evidence);
    assert.equal(git(['rev-parse', 'HEAD'], repoPath), before.checkpoint.pushed.root);
    assert.doesNotMatch(result.stdout, /Dispatch ONE|next: dispatch/);
    assert.match(result.stdout, /next --run-dir/);
    const activeBytes = readFileSync(join(dir, 'run.json'), 'utf8');
    const again = cli(dir, ['resume', '--budget-seconds', '1800']);
    assert.equal(again.status, 2);
    assert.match(again.stderr, /already active/);
    assert.equal(readFileSync(join(dir, 'run.json'), 'utf8'), activeBytes);
    const deadline = Date.parse(budgetRenewals[0].at) + 1800_000;
    const action = decide(dir, after, { now: () => new Date(deadline - 1000).toISOString() });
    assert.equal(action.budget.remainingSeconds, 1);
    assert.equal(action.budget.allowanceSeconds, 1800);
    assert.equal(action.budget.expired, false);
  });
}

for (const value of [undefined, true, '0', '-1', '0.5', 'abc', 'NaN', 'Infinity', '9007199254740992', '8640000000000', '']) {
  test(`budget: resume rejects ${String(value)} before writing`, (t) => {
    const { dir } = fixture(t);
    const original = readFileSync(join(dir, 'run.json'), 'utf8');
    const args = ['resume'];
    if (value !== undefined) args.push(value === true ? '--budget-seconds' : `--budget-seconds=${value}`);
    const result = cli(dir, args);
    assert.match(result.stderr, /budget-seconds.*(positive|representable)/);
    assert.equal(result.status, 2);
    assert.equal(readFileSync(join(dir, 'run.json'), 'utf8'), original);
  });
}

test('budget: completed runs stay done and cannot be resumed', (t) => {
  const { dir, run } = fixture(t);
  run.lanes[0].landed = { at: new Date().toISOString() };
  run.finished = { at: new Date().toISOString(), issueClosed: false };
  saveRun(dir, run);
  const action = decide(dir, run);
  assert.deepEqual([action.kind, action.reason], ['stop', 'done']);
  const result = cli(dir, ['resume', '--budget-seconds', '1800']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /completed/);
  assert.deepEqual(loadRun(dir), run);
});

for (const barrier of ['review cap', 'scope decision', 'repeated blocker', 'hash changed']) {
  test(`budget: ${barrier} survives expiry and explicit resume`, (t) => {
    const { dir, run } = fixture(t);
    const step = writeGood(dir, run, 'investigate');
    markBriefed(dir, run, step, () => new Date(Date.now() - 60_000).toISOString());
    if (barrier === 'review cap') {
      for (const part of ['Evidence', 'Approach', 'Rejected']) redTeamBlock(dir, run, step, `wrong ${part}`, `investigate.md § ${part}`);
    } else if (barrier === 'repeated blocker') {
      redTeamBlock(dir, run, step);
      redTeamBlock(dir, run, step);
    } else if (barrier === 'scope decision') {
      writeReview(dir, step, { findings: [{ severity: 'high', disposition: 'scope-change', cite: 'investigate.md § Approach', text: 'requires user scope decision' }] });
      // Use the CLI so the ordinary registrar validates this finding.
      const result = cli(dir, ['review', '--stage', 'investigate']);
      assert.equal(result.status, 0, result.stderr);
    } else {
      redTeamPass(dir, run, step);
      writeFileSync(artifactPath(dir, step), readFileSync(artifactPath(dir, step), 'utf8') + '\nchanged bytes\n');
    }
    const before = loadRun(dir);
    const expired = decide(dir, before);
    const expected = { 'review cap': 'exhausted', 'scope decision': 'human', 'repeated blocker': 'dispute', 'hash changed': 'budget' }[barrier];
    assert.equal(expired.reason, expected);
    const resumed = cli(dir, ['resume', '--budget-seconds', '1800']);
    assert.equal(resumed.status, 0, resumed.stderr);
    const after = loadRun(dir);
    assert.deepEqual(after.stages, before.stages);
    const action = decide(dir, after);
    if (barrier === 'hash changed') assert.deepEqual([action.command, action.args.review], ['brief', true]);
    else assert.equal(action.reason, expected);
  });
}

test('budget: the emitted recovery command executes with a quoted path and help documents it', (t) => {
  const { dir, run } = fixture(t);
  const rendered = renderAction(decide(dir, run), { skillCommand: `node '${CLI}'`, runDir: dir });
  const command = rendered.match(/^  command: (.+)$/m)[1];
  const result = spawnSync('/bin/sh', ['-c', command], { encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: undefined } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(loadRun(dir).budgetRenewals[0].budgetSeconds, 1800);
  const help = cli(dir, ['--help']);
  assert.match(help.stdout, /issueflow resume.*--budget-seconds/);
  const next = cli(dir, ['next']);
  assert.equal(next.status, 0, next.stderr);
  assert.match(next.stdout, /next: dispatch/);
});

test('budget: a later expired window needs a second explicit renewal', (t) => {
  const { dir, run } = fixture(t);
  const old = new Date(Date.now() - 3_600_000).toISOString();
  run.budgetRenewals = [{ at: old, budgetSeconds: 10 }];
  saveRun(dir, run);
  const before = decide(dir, run);
  assert.equal(before.reason, 'budget');
  const result = cli(dir, ['resume', '--budget-seconds', '600']);
  assert.equal(result.status, 0, result.stderr);
  const after = loadRun(dir);
  assert.deepEqual(after.budgetRenewals[0], run.budgetRenewals[0]);
  assert.equal(after.budgetRenewals.length, 2);
  const resumed = after.budgetRenewals[1].at;
  const action = decide(dir, after, { now: () => resumed });
  assert.equal(action.budget.allowanceSeconds, 600);
  assert.equal(action.budget.remainingSeconds, 600);
  assert.equal(action.budget.elapsedSeconds, (Date.parse(resumed) - Date.parse(run.createdAt)) / 1000);
});

test('budget: stale implementation remains in flight after expiry', (t) => {
  const { dir, run } = fixture(t);
  const step = implementation(dir, run);
  const stale = new Date(Date.parse(step.stage.at.briefed) - 1000);
  utimesSync(artifactPath(dir, step), stale, stale);
  const result = cli(dir, ['next']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /next: wait/);
  assert.match(result.stdout, /successor dispatch requires explicit resume/);
  assert.doesNotMatch(result.stdout, /▶ accept/);
  assert.equal(findStep(loadRun(dir), 'implement').stage.at.delivered, undefined);
});

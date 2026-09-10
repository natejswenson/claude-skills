/**
 * `next` — every reachable state yields exactly one action, and the CLI's
 * exit codes are a contract.
 *
 * `decide()` is driven over real run directories the way the CLI drives it,
 * with the two things it needs from outside the run — CI state and the remote
 * head — injected, so nothing here touches the network. The CLI cases run the
 * real binary offline and assert on the exit code, because the exit code is
 * the thing an orchestrator branches on without parsing English.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { accept, artifactPath, briefPath, createRun, findStep, loadRun, markBriefed, saveRun } from '../lib/run.mjs';
import { markReviewBriefed, registerReview, reviewBriefPath, reviewPath } from '../lib/reviews.mjs';
import { candidatesPath, currentRound, fixBriefPath, fixReportPath, headOf, laneDiff, openRound, planVerification, readCandidates, registerRound, verdictsPath } from '../lib/prreview.mjs';
import { decide, renderAction, timeoutFor, waitLine } from '../lib/next.mjs';
import { prepareCheckout, prepareExecution, releaseSourceLease } from '../lib/execution.mjs';
import { ensureWorktree } from '../lib/worktree.mjs';
import { approveImplement, approvePlan, redTeamBlock, redTeamPass, writeGood, writeReview } from './helpers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = join(HERE, '..', '..');
const CLI = join(SKILL, 'scripts', 'issueflow.js');
const INPUTS = join(SKILL, 'evals', 'inputs');

const ISSUE = { number: 8, title: 'Drive the run', url: 'https://example.invalid/8', body: 'x' };
const POLICY = { base: 'dev', featurePrefix: 'feature/', mergeMethod: 'squash', source: 'test', shipflow: true };
const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const cli = (args) => {
  try {
    const out = execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_TEST_CONTEXT: undefined } });
    return { code: 0, out, err: '' };
  } catch (e) {
    return { code: e.status ?? 1, out: String(e.stdout ?? ''), err: String(e.stderr ?? '') };
  }
};

function repo() {
  const path = mkdtempSync(join(tmpdir(), 'issueflow-next-repo-'));
  git(['init', '-q', '-b', 'dev'], path);
  git(['config', 'user.email', 'test@example.invalid'], path);
  git(['config', 'user.name', 'test'], path);
  writeFileSync(join(path, 'a.js'), 'export const a = 1;\n');
  git(['add', 'a.js'], path);
  git(['commit', '-qm', 'seed'], path);
  return path;
}

function freshRun({ auto = false, repoPath = repo() } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'issueflow-next-'));
  const run = createRun({ repo: { owner: 'acme', name: 'w', path: repoPath, defaultBranch: 'dev' }, issue: ISSUE, policy: POLICY, offline: true, auto });
  saveRun(dir, run);
  mkdirSync(join(dir, 'inputs'), { recursive: true });
  writeFileSync(join(dir, 'inputs', 'issue.json'), `${JSON.stringify(ISSUE, null, 2)}\n`);
  return { dir, run, repoPath, cleanup: () => { rmSync(dir, { recursive: true, force: true }); rmSync(repoPath, { recursive: true, force: true }); } };
}

/** Make `path` look older than `than` — the artifact predates the brief. */
const backdate = (path, seconds) => {
  const t = new Date(Date.now() - seconds * 1000);
  utimesSync(path, t, t);
};

const at = (s) => new Date(Date.now() + s * 1000).toISOString();

// ---------------------------------------------------------------------------
// The plan.
// ---------------------------------------------------------------------------

test('decide: a fresh run briefs the plan; a briefed plan waits on its artifact; a delivered plan briefs the red team', () => {
  const { dir, run, cleanup } = freshRun();
  let a = decide(dir, run);
  assert.deepEqual([a.kind, a.command, a.args], ['run', 'brief', { stage: 'investigate' }]);
  const step = findStep(run, 'investigate');
  markBriefed(dir, run, step, () => at(-60));
  a = decide(dir, run);
  assert.equal(a.kind, 'wait');
  assert.match(a.wait, /^sh -c 'end=\$\(\( \$\(date \+%s\) \+ \d+ \)\); until \[ .*shared\/investigate\.md.* -nt .*briefs\/investigate\.md.* \]; do \[ \$\(date \+%s\) -ge \$end \] && exit 124; sleep 1; done; a=\$\(wc -c < .*\); sleep 2; b=.*; while \[ "\$a" != "\$b" \]; do a=\$b; sleep 2; b=.*; done'$/);
  assert.doesNotMatch(a.wait, /^timeout /, 'GNU timeout is not on a stock Mac — the deadline is shell arithmetic');
  writeGood(dir, run, 'investigate');
  a = decide(dir, run);
  assert.deepEqual([a.kind, a.command, a.args], ['run', 'brief', { review: true, stage: 'investigate' }]);
  cleanup();
});

test('decide: a briefed red team waits on its findings; landed findings register; a pass stops for the human — or accepts on an auto run', () => {
  const { dir, run, cleanup } = freshRun();
  const step = writeGood(dir, run, 'investigate');
  markBriefed(dir, run, step, () => at(-60));
  mkdirSync(join(dir, 'briefs'), { recursive: true });
  writeFileSync(reviewBriefPath(dir, step, 1), '# review brief\n');
  markReviewBriefed(dir, run, step, 1);
  let a = decide(dir, run);
  assert.equal(a.kind, 'wait');
  assert.match(a.what, /red-team round 1/);
  writeReview(dir, step, { findings: [] });
  a = decide(dir, run);
  assert.deepEqual([a.kind, a.command], ['run', 'review']);
  redTeamPass(dir, run, step);
  a = decide(dir, run);
  assert.equal(a.kind, 'stop');
  assert.equal(a.reason, 'human');
  assert.match(a.command, /accept --stage investigate/);
  assert.ok(a.artifact.endsWith('investigate.md'));

  const auto = freshRun({ auto: true });
  const s2 = writeGood(auto.dir, auto.run, 'investigate');
  markBriefed(auto.dir, auto.run, s2, () => at(-60));
  redTeamPass(auto.dir, auto.run, s2);
  const b = decide(auto.dir, auto.run);
  assert.deepEqual([b.kind, b.command, b.args], ['run', 'accept', { stage: 'investigate', auto: true }]);
  auto.cleanup();
  cleanup();
});

test('decide: a blocked round sends the plan back, waits for the new delivery, then reviews again; three blocks stop the run', () => {
  const { dir, run, cleanup } = freshRun({ auto: true });
  const step = writeGood(dir, run, 'investigate');
  markBriefed(dir, run, step, () => at(-120));
  redTeamBlock(dir, run, step);
  let a = decide(dir, run);
  assert.deepEqual([a.kind, a.command], ['run', 'brief'], 'blocked → send the stage back');
  // the re-brief happens; the old artifact predates it
  markBriefed(dir, run, step, () => at(0));
  backdate(artifactPath(dir, step), 30);
  a = decide(dir, run);
  assert.equal(a.kind, 'wait', 'the old artifact is not the new delivery');
  writeGood(dir, run, 'investigate'); // redelivered
  a = decide(dir, run);
  assert.deepEqual([a.kind, a.command, a.args], ['run', 'brief', { review: true, stage: 'investigate' }], 'redelivered → round 2');
  redTeamBlock(dir, run, step, 'the second mechanism is wrong.', 'investigate.md § Approach');
  redTeamBlock(dir, run, step, 'the third mechanism is wrong.', 'investigate.md § Rejected');
  a = decide(dir, run);
  assert.equal(a.kind, 'stop');
  assert.equal(a.reason, 'exhausted');
  assert.match(a.command, /--another-round/);
  cleanup();
});

test('decide: a scope-change finding stops for a user decision instead of auto-rewriting', () => {
  const { dir, run, cleanup } = freshRun({ auto: true });
  const step = writeGood(dir, run, 'investigate');
  markBriefed(dir, run, step, () => at(-120));
  writeReview(dir, step, {
    findings: [{ severity: 'critical', disposition: 'scope-change', cite: 'investigate.md § Approach', text: 'the requested behavior expands the issue scope.' }],
  });
  registerReview(dir, run, step);
  const action = decide(dir, run);
  assert.equal(action.kind, 'stop');
  assert.equal(action.reason, 'human');
  assert.match(action.detail, /scope change/);
  cleanup();
});

test('decide: findings newer than the artifact register even when the review brief was re-rendered after them; findings older than the artifact re-brief', () => {
  const { dir, run, cleanup } = freshRun({ auto: true });
  const step = writeGood(dir, run, 'investigate');
  markBriefed(dir, run, step, () => at(-120));
  backdate(artifactPath(dir, step), 60);
  mkdirSync(join(dir, 'briefs'), { recursive: true });
  writeFileSync(reviewBriefPath(dir, step, 1), '# review brief\n');
  markReviewBriefed(dir, run, step, 1);
  writeReview(dir, step, { findings: [] });
  // the brief is re-rendered AFTER the findings landed (what a racing `next` did on the first real run)
  execFileSync('sh', ['-c', `sleep 1; touch ${reviewBriefPath(dir, step, 1)}`]);
  let a = decide(dir, run);
  assert.deepEqual([a.kind, a.command], ['run', 'review'], 'a finished review is registered, not re-briefed');
  // findings older than the artifact reviewed different bytes: re-brief, and the registrar refuses them
  writeFileSync(artifactPath(dir, step), `${readFileSync(artifactPath(dir, step), 'utf8')}\nmore, after the review\n`);
  backdate(reviewPath(dir, step, 1), 30);
  a = decide(dir, run);
  assert.deepEqual([a.kind, a.command, a.args], ['run', 'brief', { review: true, stage: 'investigate' }]);
  // the registrar refuses the stale findings file outright (redTeamPass would overwrite it, so call the registrar directly)
  assert.throws(() => registerReview(dir, run, step), /changed after the review was written/);
  cleanup();
});

test('decide: a plan edited after its pass is reviewed again before anyone approves it', () => {
  const { dir, run, cleanup } = freshRun({ auto: true });
  const step = writeGood(dir, run, 'investigate');
  markBriefed(dir, run, step, () => at(-60));
  redTeamPass(dir, run, step);
  writeFileSync(artifactPath(dir, step), `${readFileSync(artifactPath(dir, step), 'utf8')}\nedited after the pass\n`);
  const a = decide(dir, run);
  assert.deepEqual([a.kind, a.command, a.args], ['run', 'brief', { review: true, stage: 'investigate' }]);
  cleanup();
});

// ---------------------------------------------------------------------------
// Split, implement, ship.
// ---------------------------------------------------------------------------

test('decide: an approved plan with work items splits once; then the bottom lane is briefed, waited on, and gated', () => {
  const { dir, run, cleanup } = freshRun({ auto: true });
  const step = findStep(run, 'investigate');
  const declared = readFileSync(join(SKILL, 'scripts', 'lib', 'stages.mjs'), 'utf8') && ['Root cause', 'Evidence', 'Unknowns', 'Approach', 'Rejected', 'Files', 'Proof'];
  writeFileSync(artifactPath(dir, step), `${declared.map((r) => `## ${r}\n\nx\n`).join('\n')}\n## Work items\n\nWhy split: two layers a reviewer needs apart\n\n- first: the first layer\n- second: the second layer\n`);
  markBriefed(dir, run, step, () => at(-60));
  redTeamPass(dir, run, step);
  accept(dir, run, step, { auto: true });
  let a = decide(dir, run);
  assert.deepEqual([a.kind, a.command], ['run', 'split']);
  cli(['split', '--run-dir', dir, '--offline']);
  const split = loadRun(dir);
  assert.equal(split.lanes.length, 2);
  a = decide(dir, split);
  assert.deepEqual([a.kind, a.command, a.args], ['run', 'brief', { stage: 'implement', lane: 'first' }]);
  markBriefed(dir, split, findStep(split, 'implement', 'first'), () => at(-60));
  ensureWorktree(split.repo.path, dir, split.lanes[0], { offline: true });
  a = decide(dir, split);
  assert.equal(a.kind, 'wait');
  assert.match(a.wait, /first\/implement\.md|first\/implement/);
  writeGood(dir, split, 'implement', 'first');
  a = decide(dir, split);
  assert.deepEqual([a.kind, a.command, a.args], ['run', 'accept', { stage: 'implement', lane: 'first', auto: true }]);
  cleanup();
});

test('decide: a plan with no work items never splits, and a stage past the stall threshold stops with a re-dispatch', () => {
  const { dir, run, cleanup } = freshRun({ auto: true });
  approvePlan(dir, run, { auto: true });
  let a = decide(dir, run);
  assert.deepEqual([a.kind, a.command, a.args], ['run', 'brief', { stage: 'implement', lane: 'root' }]);
  markBriefed(dir, run, findStep(run, 'implement'), () => at(-4000));
  ensureWorktree(run.repo.path, dir, run.lanes[0], { offline: true });
  a = decide(dir, run, { now: () => at(0) });
  assert.equal(a.kind, 'stop');
  assert.equal(a.reason, 'stalled');
  assert.equal(a.items.length, 1);
  cleanup();
});

test('decide: every gate step approved → ship; a lane with a pull request and no round → open round 1', () => {
  const { dir, run, cleanup } = freshRun({ auto: true });
  approvePlan(dir, run, { auto: true });
  approveImplement(dir, run, null, { auto: true });
  let a = decide(dir, run);
  assert.deepEqual([a.kind, a.command], ['run', 'ship']);
  run.lanes[0].pr = { number: 1, url: 'u', title: 't' };
  saveRun(dir, run);
  a = decide(dir, run);
  assert.deepEqual([a.kind, a.command, a.args], ['run', 'review-brief', { lane: 'root' }]);
  cleanup();
});

// ---------------------------------------------------------------------------
// The loop, state by state, over a real lane diff.
// ---------------------------------------------------------------------------

function loopFixture() {
  const repoPath = repo();
  git(['checkout', '-q', '-b', 'feature/issue-8'], repoPath);
  writeFileSync(join(repoPath, 'a.js'), 'export const a = 2;\nexport const b = 3;\n');
  git(['commit', '-qam', 'change'], repoPath);
  const ctx = freshRun({ auto: true, repoPath });
  prepareCheckout(ctx.dir, ctx.run, ctx.run.lanes[0], { noWorktree: true });
  approvePlan(ctx.dir, ctx.run, { auto: true });
  approveImplement(ctx.dir, ctx.run, null, { auto: true });
  ctx.run.lanes[0].pr = { number: 1, url: 'u', title: 't' };
  saveRun(ctx.dir, ctx.run);
  return ctx;
}

const CAND = { file: 'a.js', line: 1, side: 'RIGHT', category: 'line-by-line', summary: 'a is 2', short_summary: 'a is now 2', failure_scenario: 'callers expecting 1 break', introduced_by_diff: true };

for (const delivery of ['finders', 'verifiers', 'fixer']) {
  test(`budget: expired ${delivery} delivery follows its ordinary registration boundary`, (t) => {
    const { dir, run, repoPath, cleanup } = loopFixture();
    t.after(cleanup);
    const lane = run.lanes[0];
    openRound(dir, run, lane, { head: headOf(repoPath), diffText: laneDiff(repoPath, 'dev') });
    writeFileSync(candidatesPath(dir, lane, 1, 1), JSON.stringify({ candidates: [CAND], notExamined: [] }));
    if (delivery !== 'finders') {
      planVerification(dir, run, lane, 1, readCandidates(dir, lane, 1).candidates);
      writeFileSync(verdictsPath(dir, lane, 1, 1), JSON.stringify({ verdicts: [{ id: 'c-1-1', verdict: 'CONFIRMED', severity: 'major', quote: 'q' }] }));
    }
    if (delivery === 'fixer') {
      registerRound(dir, run, lane, 1, { tree: repoPath });
      lane.review.maxRounds = 1;
      currentRound(lane).fix = { briefed: true };
      mkdirSync(dirname(fixBriefPath(dir, lane, 1)), { recursive: true });
      writeFileSync(fixBriefPath(dir, lane, 1), '# fix\n');
      writeFileSync(fixReportPath(dir, lane, 1), JSON.stringify({ _summary: 'fixed', [lane.review.findings[0].id]: { status: 'fixed', note: 'fixed in commit' } }));
      git(['commit', '-q', '--allow-empty', '-m', 'fix'], repoPath);
    }
    releaseSourceLease(dir, run);
    run.createdAt = at(-20_000);
    prepareCheckout(dir, run, lane, { noWorktree: true });
    saveRun(dir, run);
    const result = cli(['next', '--run-dir', dir, '--offline']);
    if (delivery === 'verifiers') {
      assert.match(result.out, /▶ review-register/);
      assert.ok(currentRound(loadRun(dir).lanes[0]).registered);
    } else if (delivery === 'fixer') {
      assert.match(result.out, /▶ review-fix-report/);
      assert.ok(currentRound(loadRun(dir).lanes[0]).fix.reported);
    } else {
      assert.match(result.out, /next: stop — budget/);
      assert.equal(currentRound(loadRun(dir).lanes[0]).verifiers, null);
      const direct = cli(['review-verify', '--lane', 'root', '--run-dir', dir, '--offline']);
      assert.equal(direct.code, 4, direct.err);
      assert.equal(currentRound(loadRun(dir).lanes[0]).verifiers, null);
    }
    assert.equal(result.code, 4, result.err);
    if (delivery === 'fixer') {
      assert.match(result.out, /next: stop — exhausted/);
      assert.match(result.out, /Offline: saved locally; no remote checkpoint attempted/);
    } else assert.match(result.out, /next: stop — budget/);
    assert.doesNotMatch(result.out, /Dispatch ONE|next: dispatch/);
  });
}

for (const command of ['brief', 'review-brief', 'review-verify', 'review-fix-brief']) {
  test(`budget: ${command} rechecks expiry immediately before mutation`, (t) => {
    const { dir, run, repoPath, cleanup } = loopFixture();
    t.after(cleanup);
    const lane = run.lanes[0];
    if (['review-verify', 'review-fix-brief'].includes(command)) {
      openRound(dir, run, lane, { head: headOf(repoPath), diffText: laneDiff(repoPath, 'dev') });
      writeFileSync(candidatesPath(dir, lane, 1, 1), JSON.stringify({ candidates: [CAND], notExamined: [] }));
      if (command === 'review-fix-brief') {
        planVerification(dir, run, lane, 1, readCandidates(dir, lane, 1).candidates);
        writeFileSync(verdictsPath(dir, lane, 1, 1), JSON.stringify({ verdicts: [{ id: 'c-1-1', verdict: 'CONFIRMED', severity: 'major', quote: 'q' }] }));
        registerRound(dir, run, lane, 1, { tree: repoPath });
      }
    }
    const clock = join(dir, 'clock.mjs');
    const now = Date.now();
    releaseSourceLease(dir, run);
    run.createdAt = new Date(now).toISOString();
    prepareCheckout(dir, run, lane, { noWorktree: true });
    saveRun(dir, run);
    writeFileSync(clock, `const RealDate = Date; let reads = 0; globalThis.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [${now} + (++reads >= 2 ? 20000000 : 0)])); } };\n`);
    const extra = command === 'brief' ? ['--stage', 'implement'] : [];
    const result = spawnSync(process.execPath, ['--import', clock, CLI, command, ...extra, '--lane', 'root', '--run-dir', dir, '--offline'], {
      encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: undefined },
    });
    assert.match(result.stdout, /next: stop — budget/);
    assert.equal(result.status, 4, result.stderr);
    assert.deepEqual(loadRun(dir), run);
    assert.doesNotMatch(result.stdout, /Dispatch ONE/);
  });
}

test('budget: renewed CI fixer still needs its report, pushed commit and another review', (t) => {
  const { dir, run, repoPath, cleanup } = loopFixture();
  t.after(cleanup);
  const lane = run.lanes[0];
  openRound(dir, run, lane, { head: headOf(repoPath), diffText: laneDiff(repoPath, 'dev') });
  writeFileSync(candidatesPath(dir, lane, 1, 1), JSON.stringify({ candidates: [], notExamined: [] }));
  planVerification(dir, run, lane, 1, []);
  registerRound(dir, run, lane, 1, { tree: repoPath });
  const entry = currentRound(lane);
  entry.fix = { briefed: true };
  mkdirSync(dirname(fixBriefPath(dir, lane, 1)), { recursive: true });
  writeFileSync(fixBriefPath(dir, lane, 1), '# fix CI\n');
  releaseSourceLease(dir, run);
  run.createdAt = at(-20_000);
  prepareCheckout(dir, run, lane, { noWorktree: true });
  saveRun(dir, run);
  assert.equal(decide(dir, run).kind, 'wait');
  const result = cli(['resume', '--run-dir', dir, '--budget-seconds', '1800']);
  assert.equal(result.code, 0, result.err);
  let after = loadRun(dir);
  assert.equal(decide(dir, after, { checks: () => [] }).kind, 'wait');
  currentRound(after.lanes[0]).fix.reported = true;
  saveRun(dir, after);
  assert.equal(decide(dir, after).reason, 'unpushed');
  git(['commit', '-q', '--allow-empty', '-m', 'fix CI'], repoPath);
  after.offline = false;
  currentRound(after.lanes[0]).posted = { url: 'posted' };
  assert.equal(decide(dir, after, { offline: false, remoteHead: () => entry.head }).reason, 'unpushed');
  after.offline = true;
  assert.equal(decide(dir, after).command, 'review-brief');
  const loop = after.lanes[0].review;
  loop.findings = [{ id: 'f-open', severity: 'major', status: 'open' }];
  loop.rounds = Array.from({ length: 4 }, (_, i) => ({ ...structuredClone(entry), verdict: 'blocked', round: i + 1, fix: { briefed: true, reported: true } }));
  assert.equal(decide(dir, after).reason, 'exhausted');
});

test('decide: finders wait → verify → verifiers wait → register → fix brief → fixer wait → fix report → unpushed stop → next round; converged → ready', () => {
  const { dir, run, repoPath, cleanup } = loopFixture();
  const lane = run.lanes[0];
  openRound(dir, run, lane, { head: headOf(repoPath), diffText: laneDiff(repoPath, 'dev') });
  let a = decide(dir, run);
  assert.equal(a.kind, 'wait');
  assert.match(a.what, /finders \(0\/1 delivered\)/);
  writeFileSync(candidatesPath(dir, lane, 1, 1), JSON.stringify({ candidates: [CAND], notExamined: ['b'] }));
  a = decide(dir, run);
  assert.deepEqual([a.kind, a.command], ['run', 'review-verify']);
  planVerification(dir, run, lane, 1, readCandidates(dir, lane, 1).candidates);
  a = decide(dir, run);
  assert.equal(a.kind, 'wait');
  assert.match(a.what, /verifiers \(0\/1 delivered\)/);
  writeFileSync(verdictsPath(dir, lane, 1, 1), JSON.stringify({ verdicts: [{ id: 'c-1-1', verdict: 'CONFIRMED', severity: 'major', quote: 'export const a = 2;' }] }));
  a = decide(dir, run);
  assert.deepEqual([a.kind, a.command], ['run', 'review-register']);
  registerRound(dir, run, lane, 1, { tree: repoPath });
  a = decide(dir, run);
  assert.deepEqual([a.kind, a.command], ['run', 'review-fix-brief'], 'offline: no post step; a major is open → fix');
  const entry = currentRound(lane);
  entry.fix = { briefed: true, model: 'sonnet' };
  mkdirSync(dirname(fixBriefPath(dir, lane, 1)), { recursive: true });
  writeFileSync(fixBriefPath(dir, lane, 1), '# fix\n');
  saveRun(dir, run);
  a = decide(dir, run);
  assert.equal(a.kind, 'wait');
  assert.match(a.what, /fixer/);
  writeFileSync(fixReportPath(dir, lane, 1), JSON.stringify({ [lane.review.findings[0].id]: { status: 'fixed' } }));
  a = decide(dir, run);
  assert.deepEqual([a.kind, a.command], ['run', 'review-fix-report']);
  entry.fix.reported = true;
  saveRun(dir, run);
  a = decide(dir, run);
  assert.equal(a.kind, 'stop');
  assert.equal(a.reason, 'unpushed', 'the fixer reported but HEAD did not move');
  writeFileSync(join(repoPath, 'a.js'), 'export const a = 1;\nexport const b = 3;\n');
  git(['commit', '-qam', 'fix'], repoPath);
  a = decide(dir, run);
  assert.deepEqual([a.kind, a.command], ['run', 'review-brief'], 'a new head → round 2');

  // Round 2 converges: ready, unless CI says otherwise.
  openRound(dir, run, lane, { head: headOf(repoPath), diffText: laneDiff(repoPath, 'dev') });
  writeFileSync(candidatesPath(dir, lane, 2, 1), JSON.stringify({ candidates: [], notExamined: [] }));
  planVerification(dir, run, lane, 2, []);
  writeFileSync(verdictsPath(dir, lane, 2, 1), JSON.stringify({ verdicts: [{ id: lane.review.findings[0].id, verdict: 'fixed', quote: 'export const a = 1;' }] }));
  registerRound(dir, run, lane, 2, { tree: repoPath });
  assert.equal(currentRound(lane).verdict, 'converged');
  a = decide(dir, run, { checks: () => [{ name: 'ci', bucket: 'pending' }] });
  assert.equal(a.kind, 'wait');
  assert.match(a.wait, /gh pr checks 1 --watch/);
  a = decide(dir, run, { checks: () => [{ name: 'ci', bucket: 'fail' }] });
  assert.deepEqual([a.kind, a.command], ['run', 'review-fix-brief'], 'converged on findings, red on CI → a fix round');
  a = decide(dir, run, { checks: () => [] });
  assert.deepEqual([a.kind, a.command, a.args], ['run', 'ready', { lane: 'root' }]);
  lane.review.converged = true;
  saveRun(dir, run);
  a = decide(dir, run);
  assert.equal(a.kind, 'stop');
  assert.equal(a.reason, 'shipped');
  a = decide(dir, run, { landings: () => [{ lane, state: 'merged', pr: 1 }] });
  assert.deepEqual([a.kind, a.command], ['run', 'finish']);
  cleanup();
});

test('next (CLI): a converged review with red CI briefs a fixer and accepts its report', () => {
  const { dir, run, repoPath, cleanup } = loopFixture();
  const lane = run.lanes[0];
  openRound(dir, run, lane, { head: headOf(repoPath), diffText: laneDiff(repoPath, 'dev') });
  writeFileSync(candidatesPath(dir, lane, 1, 1), JSON.stringify({ candidates: [], notExamined: [] }));
  planVerification(dir, run, lane, 1, []);
  registerRound(dir, run, lane, 1, { tree: repoPath });
  assert.equal(currentRound(lane).verdict, 'converged');
  saveRun(dir, run);

  const bin = mkdtempSync(join(tmpdir(), 'issueflow-red-ci-bin-'));
  const gh = join(bin, 'gh');
  writeFileSync(gh, '#!/bin/sh\nprintf \'%s\\n\' \'[{"name":"ci / skillhelp","bucket":"fail","state":"FAILURE","link":"https://example.invalid/check"}]\'\n');
  chmodSync(gh, 0o755);

  try {
    const result = spawnSync(process.execPath, [CLI, 'next', '--run-dir', dir], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, NODE_TEST_CONTEXT: undefined },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /▶ review-fix-brief/);
    assert.match(result.stdout, /\| root \| 1\s+\| sonnet \| 0\s+\| 1\s+\|/);
    assert.match(result.stdout, /next: dispatch \(review-fix-brief\)/);
    assert.match(readFileSync(fixBriefPath(dir, lane, 1), 'utf8'), /ci \/ skillhelp/);

    writeFileSync(fixReportPath(dir, lane, 1), JSON.stringify({ _summary: 'fixed CI in the next commit' }));
    const report = cli(['review-fix-report', '--lane', lane.slug, '--run-dir', dir, '--offline']);
    assert.equal(report.code, 0, report.err);
    assert.equal(currentRound(loadRun(dir).lanes[0]).fix.reported, true);
  } finally {
    rmSync(bin, { recursive: true, force: true });
    cleanup();
  }
});

test('decide: an in-flight CI-only fix is reported and re-reviewed before pending or green CI can ready it', () => {
  const { dir, run, repoPath, cleanup } = loopFixture();
  const lane = run.lanes[0];
  openRound(dir, run, lane, { head: headOf(repoPath), diffText: laneDiff(repoPath, 'dev') });
  writeFileSync(candidatesPath(dir, lane, 1, 1), JSON.stringify({ candidates: [], notExamined: ['none'] }));
  planVerification(dir, run, lane, 1, []);
  registerRound(dir, run, lane, 1, { tree: repoPath });
  const entry = currentRound(lane);
  entry.fix = { briefed: true, model: 'sonnet' };
  mkdirSync(dirname(fixBriefPath(dir, lane, 1)), { recursive: true });
  writeFileSync(fixBriefPath(dir, lane, 1), '# fix CI\n');
  saveRun(dir, run);

  let action = decide(dir, run, { checks: () => [{ name: 'ci', bucket: 'pending' }] });
  assert.equal(action.kind, 'wait');
  assert.match(action.what, /fixer/, 'pending checks cannot hide the in-flight fixer');

  writeFileSync(fixReportPath(dir, lane, 1), JSON.stringify({ _summary: 'fixed CI' }));
  action = decide(dir, run, { checks: () => [] });
  assert.deepEqual([action.kind, action.command], ['run', 'review-fix-report'], 'green checks cannot skip the delivered report');

  entry.fix.reported = true;
  writeFileSync(join(repoPath, 'a.js'), 'export const a = 2;\nexport const b = 4;\n');
  git(['commit', '-qam', 'fix CI'], repoPath);
  saveRun(dir, run);
  action = decide(dir, run, { checks: () => [] });
  assert.deepEqual([action.kind, action.command], ['run', 'review-brief'], 'the pushed CI fix is reviewed before ready');
  cleanup();
});

test('decide: a finder fleet that never delivers is a stall with the prompts to re-dispatch, not a wait forever', () => {
  const { dir, run, repoPath, cleanup } = loopFixture();
  const lane = run.lanes[0];
  openRound(dir, run, lane, { head: headOf(repoPath), diffText: laneDiff(repoPath, 'dev') });
  const brief = join(dir, 'briefs', 'root-review-r1-finder-1.md');
  mkdirSync(dirname(brief), { recursive: true });
  writeFileSync(brief, '# finder\n');
  let a = decide(dir, run);
  assert.equal(a.kind, 'wait', 'a fresh brief is waited on');
  backdate(brief, 4000);
  a = decide(dir, run);
  assert.equal(a.kind, 'stop');
  assert.equal(a.reason, 'stalled');
  assert.equal(a.items.length, 1);
  assert.match(a.items[0].prompt, /root-review-r1-finder-1\.md/);
  assert.equal(a.items[0].model, 'opus');
  cleanup();
});

test('decide: an unpushed fix is a stop when the remote head disagrees, and a stacked lane is rebased before its first round', () => {
  const { dir, run, repoPath, cleanup } = loopFixture();
  const lane = run.lanes[0];
  openRound(dir, run, lane, { head: headOf(repoPath), diffText: laneDiff(repoPath, 'dev') });
  writeFileSync(candidatesPath(dir, lane, 1, 1), JSON.stringify({ candidates: [CAND], notExamined: [] }));
  planVerification(dir, run, lane, 1, readCandidates(dir, lane, 1).candidates);
  writeFileSync(verdictsPath(dir, lane, 1, 1), JSON.stringify({ verdicts: [{ id: 'c-1-1', verdict: 'CONFIRMED', severity: 'major', quote: 'q' }] }));
  registerRound(dir, run, lane, 1, { tree: repoPath });
  const entry = currentRound(lane);
  entry.fix = { briefed: true, reported: true };
  entry.posted = { url: 'posted' };
  run.offline = false;
  saveRun(dir, run);
  git(['commit', '-q', '--allow-empty', '-m', 'fix'], repoPath);
  const a = decide(dir, run, { offline: false, remoteHead: () => 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', checks: () => [] });
  assert.equal(a.kind, 'stop');
  assert.equal(a.reason, 'unpushed');
  assert.match(a.command, /git -C .* push origin 'feature\/issue-8'/);

  // A second lane stacked on the first, whose branch then moved: rebase first.
  const second = { ...structuredClone(lane), id: 'second', slug: 'second', branch: 'feature/issue-8-second', base: lane.branch, pr: { number: 2, url: 'u2', title: 't2' }, review: { rounds: [], converged: false, draft: true }, stages: structuredClone(lane.stages) };
  git(['branch', 'feature/issue-8-second', 'HEAD~1'], repoPath);
  run.lanes = [lane, second];
  lane.review.converged = true;
  saveRun(dir, run);
  releaseSourceLease(dir, run);
  delete run.checkout;
  git(['checkout', '-q', 'dev'], repoPath);
  ensureWorktree(repoPath, dir, lane, { offline: true });
  ensureWorktree(repoPath, dir, second, { offline: true, lanes: run.lanes });
  const b = decide(dir, run, { offline: true });
  assert.deepEqual([b.kind, b.command, b.args], ['run', 'rebase', { lane: 'second' }]);
  cleanup();
});

test('decide: a lane above waits for the lane below — the bottom lane is the active one until it converges', () => {
  const { dir, run, repoPath, cleanup } = loopFixture();
  const lane = run.lanes[0];
  const second = { ...structuredClone(lane), id: 'second', slug: 'second', branch: 'feature/issue-8-second', base: lane.branch, pr: { number: 2, url: 'u2', title: 't2' }, review: { rounds: [], converged: false, draft: true } };
  run.lanes = [lane, second];
  saveRun(dir, run);
  const a = decide(dir, run);
  assert.deepEqual([a.kind, a.command, a.args], ['run', 'review-brief', { lane: 'root' }]);
  void repoPath;
  cleanup();
});

// ---------------------------------------------------------------------------
// Rendering, waits, timeouts.
// ---------------------------------------------------------------------------

test('renderAction: a fixed shape — the first line is `next: <kind>`, a wait carries `wait:` and `then:`', () => {
  const text = renderAction({ kind: 'wait', what: 'the plan', wait: "timeout 60s sh -c 'x'", note: null }, { skillCommand: 'issueflow', runDir: '/r' });
  assert.match(text, /^next: wait\n/);
  assert.match(text, /\nwait: timeout 60s sh -c 'x'\nthen: issueflow next --run-dir '\/r'$/);
  const stopText = renderAction({ kind: 'stop', reason: 'human', detail: 'read it', command: 'accept --stage investigate' }, { skillCommand: 'issueflow', runDir: '/r' });
  assert.match(stopText, /^next: stop — human\n  read it\n  command: issueflow accept --stage investigate --run-dir '\/r'$/);
});

for (const [label, subcommand] of [['command', 'accept --stage investigate'], ['or', 'brief --stage investigate']]) {
  test(`renderAction: executable ${label} preserves the run-directory argument`, () => {
    const runDir = "/tmp/run 'quote' $HOME $(printf expanded) `printf expanded`";
    const rendered = renderAction({ kind: 'stop', reason: 'human', detail: 'read it', command: subcommand, alternative: subcommand }, { skillCommand: 'issueflow', runDir });
    const command = rendered.match(new RegExp(`^  ${label}: +(.+)$`, 'm'))[1];
    const result = spawnSync('/bin/sh', ['-c', `issueflow() { printf '%s\\n' "$@"; }; ${command}`], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.stdout.trimEnd().split('\n'), [...subcommand.split(' '), '--run-dir', runDir]);
  });
}

for (const runtime of ['claude', 'codex']) {
  for (const suffix of ['plain', 'with spaces', "with 'quote' $HOME $(printf expanded) `printf expanded`"]) {
    test(`next (CLI): executable follow-up in a fresh shell — ${runtime}, ${suffix}`, (t) => {
      const root = mkdtempSync(join(tmpdir(), 'issueflow-follow-up-'));
      t.after(() => rmSync(root, { recursive: true, force: true }));
      const plugin = join(root, `plugin-${suffix}`);
      const dir = join(root, `run-${suffix}`);
      const cwd = join(root, 'unrelated');
      mkdirSync(cwd);
      cpSync(SKILL, plugin, { recursive: true });
      const source = runtime === 'codex' ? repo() : join(INPUTS, 'repo');
      if (runtime === 'codex') t.after(() => rmSync(source, { recursive: true, force: true }));
      const run = createRun({ repo: { owner: 'acme', name: 'w', path: source, defaultBranch: 'dev' }, issue: ISSUE, policy: POLICY, offline: true, runtime });
      saveRun(dir, run);
      if (runtime === 'codex') prepareExecution(dir, run, { workspaceRoot: root });
      mkdirSync(join(dir, 'inputs'), { recursive: true });
      writeFileSync(join(dir, 'inputs', 'issue.json'), JSON.stringify(ISSUE));
      const env = { ...process.env };
      delete env.SKILL_DIR;
      delete env.NODE_TEST_CONTEXT;
      const dispatch = spawnSync(process.execPath, [join(plugin, 'scripts', 'issueflow.js'), 'next', '--run-dir', dir], { cwd, env, encoding: 'utf8' });
      assert.equal(dispatch.status, 0, dispatch.stderr);
      assert.match(dispatch.stdout, /next: dispatch/);
      const command = dispatch.stdout.match(/^then: (.+)$/m)[1];
      const result = spawnSync('/bin/sh', ['-c', command], { cwd, env, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /^next: wait/m);
      assert.equal(result.stdout.match(/^wait: (.+)$/m)[1], waitLine({
        pairs: [[artifactPath(dir, findStep(run, 'investigate')), briefPath(dir, findStep(run, 'investigate'))]], timeout: 1800,
      }));
    });
  }
}

test('waitLine quotes paths and uses -nt against the brief; timeoutFor is 3× the repo median, else 30 minutes', () => {
  assert.equal(
    waitLine({ pairs: [['/a b/out.md', '/a b/brief.md']], timeout: 10, settle: 1 }),
"sh -c 'end=$(( $(date +%s) + 10 )); until [ '\\''/a b/out.md'\\'' -nt '\\''/a b/brief.md'\\'' ]; do [ $(date +%s) -ge $end ] && exit 124; sleep 1; done; a=$(wc -c < '\\''/a b/out.md'\\'' 2>/dev/null); sleep 1; b=$(wc -c < '\\''/a b/out.md'\\'' 2>/dev/null); while [ \"$a\" != \"$b\" ]; do a=$b; sleep 1; b=$(wc -c < '\\''/a b/out.md'\\'' 2>/dev/null); done'",
  );
  assert.match(waitLine({ pairs: [['/x', null]], timeout: 5 }), /^sh -c 'end=\$\(\( \$\(date \+%s\) \+ 5 \)\); until \[ -f '\\''\/x'\\'' \]; do/);
  // and it actually runs on this machine's sh: a settled pair returns 0, a file still growing holds the wait, a missing one hits the deadline with 124
  const dirW = mkdtempSync(join(tmpdir(), 'issueflow-wait-'));
  writeFileSync(join(dirW, 'brief.md'), 'b');
  const out = join(dirW, 'out.md');
  const runWait = (line) => execFileSync('sh', ['-c', line.replace(/^sh -c '/, '').replace(/'$/, '').replace(/'\\''/g, "'")], { encoding: 'utf8' });
  execFileSync('sh', ['-c', `sleep 1; printf x > ${out}`]);
  const started = Date.now();
  runWait(waitLine({ pairs: [[out, join(dirW, 'brief.md')]], timeout: 30, settle: 1 }));
  assert.ok(Date.now() - started >= 900, 'the settle window must be waited out even when the file is already there');
  // a file that keeps growing during the settle window holds the wait until it stops:
  // the writer appends every 0.4s for ~3s, sampled at 1s the size never holds still before it ends
  const t2 = Date.now();
  runWait(`sh -c '(i=0; while [ $i -lt 8 ]; do printf y >> ${out}; sleep 0.4; i=$((i+1)); done) & ${waitLine({ pairs: [[out, join(dirW, 'brief.md')]], timeout: 30, settle: 1 }).replace(/^sh -c '/, '').replace(/'$/, '').replace(/'\\''/g, "'")}'`);
  assert.ok(Date.now() - t2 >= 2500, `the wait returned after ${Date.now() - t2}ms while the file was still growing`);
  rmSync(dirW, { recursive: true, force: true });
  let code = 0;
  try { execFileSync('sh', ['-c', "end=$(( $(date +%s) + 1 )); until [ -f /nonexistent-issueflow ]; do [ $(date +%s) -ge $end ] && exit 124; sleep 1; done"], { stdio: 'ignore' }); } catch (e) { code = e.status; }
  assert.equal(code, 124, 'the deadline must exit 124, the code next reads as a stall');
  const dir = mkdtempSync(join(tmpdir(), 'issueflow-next-timeout-'));
  assert.equal(timeoutFor(join(dir, 'issue-1'), 'implement'), 1800, 'no history → the default');
  rmSync(dir, { recursive: true, force: true });
  // this repo's frozen timings: implement median 3m50s → 690s
  const root = mkdtempSync(join(tmpdir(), 'issueflow-next-timeout-'));
  const owner = join(root, 'x__y');
  mkdirSync(owner, { recursive: true });
  execFileSync('cp', ['-R', join(INPUTS, 'timings') + '/.', owner]);
  assert.equal(timeoutFor(join(owner, 'issue-000'), 'implement'), 690);
  rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The CLI: exit codes, and `next` end to end, offline.
// ---------------------------------------------------------------------------

test('exit codes: a gate refusal is 2, a hand-back is 4, an unknown command is 2, success is 0', () => {
  const { dir, run, cleanup } = freshRun({ auto: true });
  const r2 = cli(['brief', '--stage', 'implement', '--run-dir', dir, '--offline']);
  assert.equal(r2.code, 2, `a gated brief must exit 2: ${r2.err}`);
  const step = writeGood(dir, run, 'investigate');
  markBriefed(dir, run, step);
  for (let i = 0; i < 3; i += 1) redTeamBlock(dir, run, step);
  const r4 = cli(['brief', '--stage', 'investigate', '--run-dir', dir, '--offline']);
  assert.equal(r4.code, 4, `an exhausted stage must exit 4: ${r4.err}`);
  const r0 = cli(['status', '--run-dir', dir, '--offline']);
  assert.equal(r0.code, 0);
  cleanup();
});

test('next (CLI): --review-plan drives a fresh run through review and stops once at the human — one call per turn', () => {
  const dir = mkdtempSync(join(tmpdir(), 'issueflow-next-cli-'));
  const repoPath = repo();
  cpSync(join(INPUTS, 'repo'), repoPath, { recursive: true });
  cli(['start', '--repo', repoPath, '--repo-json', join(INPUTS, 'repo.json'), '--run-dir', dir, '--issue', '133', '--issue-json', join(INPUTS, 'issue-133.json'), '--review-plan']);

  let r = cli(['next', '--run-dir', dir]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /▶ brief/);
  assert.match(r.out, /next: dispatch \(brief\)/);
  assert.match(r.out, /Dispatch ONE subagent, model `opus`/);
  assert.match(r.out, /wait: sh -c 'end=\$\(\( \$\(date \+%s\) \+ \d+ \)\); until \[ .*investigate\.md.* -nt .*briefs\/investigate\.md/);
  assert.ok(r.out.includes(`then: node '${CLI}' next --run-dir '${dir}'`));

  r = cli(['next', '--run-dir', dir]);
  assert.match(r.out, /^next: wait/m, 'nothing delivered yet → wait, no new brief');

  // the plan lands (newer than the brief)
  writeFileSync(join(dir, 'shared', 'investigate.md'), readFileSync(join(INPUTS, 'artifacts', 'investigate.md')));
  r = cli(['next', '--run-dir', dir]);
  assert.match(r.out, /▶ brief — the plan is delivered — briefing red-team round 1/);
  assert.match(r.out, /next: dispatch \(brief\)/);
  assert.match(r.out, /review-investigate-r1\.md/);

  // the red team lands
  mkdirSync(join(dir, 'reviews'), { recursive: true });
  writeFileSync(join(dir, 'reviews', 'investigate-r1.findings.json'), readFileSync(join(INPUTS, 'artifacts', 'review-investigate-r1.findings.json')));
  r = cli(['next', '--run-dir', dir]);
  assert.match(r.out, /▶ review/);
  assert.match(r.out, /Round 1 of 3 on investigate: PASS/);
  assert.match(r.out, /next: stop — human/);
  assert.ok(r.out.includes(`command: node '${CLI}' accept --stage investigate --run-dir '${dir}'`));
  assert.equal(r.code, 0, 'the human stop is not an error');

  // the human approves; the plan has work items → split → brief the first lane
  cli(['accept', '--stage', 'investigate', '--run-dir', dir]);
  r = cli(['next', '--run-dir', dir, '--no-worktree']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /▶ split/);
  assert.match(r.out, /▶ brief — descriptions\/implement is ready to be briefed/);
  assert.match(r.out, /next: dispatch \(brief\)/);
  rmSync(dir, { recursive: true, force: true });
  rmSync(repoPath, { recursive: true, force: true });
});

test('next (CLI): a refused gate is a send-back — exit 2, the refusal printed, the brief re-rendered', () => {
  const { dir, run, cleanup } = freshRun({ auto: true });
  approvePlan(dir, run, { auto: true });
  const step = findStep(run, 'implement');
  markBriefed(dir, run, step, () => at(-30));
  writeGood(dir, run, 'implement'); // delivered, but with no evidence file
  const r = cli(['next', '--run-dir', dir]);
  assert.equal(r.code, 2);
  assert.match(r.out, /gate refused: cannot accept root\/implement: no test output/);
  assert.match(r.out, /next: dispatch \(send-back\)/);
  assert.match(r.out, /The gate refused your last delivery/);
  const after = findStep(loadRun(dir), 'implement');
  assert.ok(Date.parse(after.stage.at.briefed) > Date.parse(at(-10)), 'the clock was reset by the re-brief');
  cleanup();
});

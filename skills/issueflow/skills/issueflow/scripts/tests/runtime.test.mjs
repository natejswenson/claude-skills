import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { renderBrief, renderReviewBrief } from '../lib/brief.mjs';
import { renderAction } from '../lib/next.mjs';
import { finderProfile, fixerProfile, verifierProfile } from '../lib/prreview.mjs';
import { createRun, findStep, loadRun, saveRun } from '../lib/run.mjs';
import { assertRuntime, dispatchProfile } from '../lib/runtime.mjs';
import * as runtime from '../lib/runtime.mjs';

const ISSUE = { number: 42, title: 'make both hosts work', body: 'Codex cannot dispatch opus.' };
const REPO = { owner: 'acme', name: 'widgets', path: '/tmp/widgets', defaultBranch: 'dev' };
const POLICY = { base: 'dev', featurePrefix: 'feature/', mergeMethod: 'squash' };
const CLI = new URL('../issueflow.js', import.meta.url).pathname;

for (const stage of ['investigate', 'implement', 'redTeam']) {
  test(`${stage} receives scoped guidance from the actual worktree`, () => {
    const tree = mkdtempSync(join(tmpdir(), 'issueflow-guidance-'));
    mkdirSync(join(tree, 'src'));
    for (const [path, content] of Object.entries({ 'CLAUDE.md': 'ROOT_CLAUDE_RULE', 'AGENTS.md': 'SHADOWED_ROOT_RULE', 'AGENTS.override.md': 'ROOT_OVERRIDE_RULE', 'REVIEW.md': 'ROOT_REVIEW_RULE', 'src/AGENTS.md': 'NESTED_AGENT_RULE', 'src/CLAUDE.md': 'NESTED_CLAUDE_RULE', 'src/REVIEW.md': 'NESTED_REVIEW_RULE' })) writeFileSync(join(tree, path), content);
    const run = createRun({ repo: REPO, issue: ISSUE, policy: POLICY, runtime: 'codex' });
    const step = findStep(run, stage === 'redTeam' ? 'investigate' : stage);
    const text = stage === 'redTeam' ? renderReviewBrief('/tmp/run', run, step, ISSUE, 1, tree) : renderBrief('/tmp/run', run, step, ISSUE, tree);
    for (const rule of ['ROOT_CLAUDE_RULE', 'ROOT_OVERRIDE_RULE', 'ROOT_REVIEW_RULE', 'NESTED_AGENT_RULE', 'NESTED_CLAUDE_RULE', 'NESTED_REVIEW_RULE']) assert.ok(text.includes(rule), `missing ${rule}`);
    assert.doesNotMatch(text, /SHADOWED_ROOT_RULE/);
    assert.ok(text.indexOf('ROOT_OVERRIDE_RULE') < text.indexOf('NESTED_AGENT_RULE'));
  });
}

for (const role of ['investigate', 'implement', 'redTeam', 'finder', 'verifier', 'fixer', 'fixerEscalated']) {
  test(`host adapter: ${role} omits the Codex model override`, () => {
    assert.equal(Object.hasOwn(dispatchProfile('codex', role), 'model'), false);
  });
  test(`host adapter: ${role} explicitly starts cold`, () => {
    assert.equal(dispatchProfile('codex', role).fork_turns, 'none');
  });
  test(`host adapter: ${role} can write its delivery`, () => {
    assert.equal(dispatchProfile('codex', role).agent, 'worker');
  });
  test(`host adapter: ${role} preserves Claude`, () => {
    assert.deepEqual(dispatchProfile('claude', role), {
      model: role === 'fixer' ? 'sonnet' : 'opus', agent: 'general-purpose',
    });
  });
}

test('host selection and child capacity survive save/load', () => {
  const dir = mkdtempSync(join(tmpdir(), 'issueflow-host-'));
  const run = createRun({ repo: REPO, issue: ISSUE, policy: POLICY, host: 'codex', childSlots: 2 });
  saveRun(dir, run);
  const resumed = loadRun(dir);
  assert.deepEqual([runtime.runtimeOf(resumed), resumed.dispatch?.childSlots], ['codex', 2]);
});

test('a legacy run can adopt Codex before artifacts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'issueflow-adopt-'));
  const run = createRun({ repo: REPO, issue: ISSUE, policy: POLICY });
  delete run.host; delete run.runtime; delete run.dispatch;
  saveRun(dir, run);
  const adopted = loadRun(dir, { host: 'codex', childSlots: 2 });
  assert.equal(runtime.runtimeOf(adopted), 'codex');
  assert.equal(runtime.runtimeOf(loadRun(dir)), 'codex');
  assert.equal(Object.hasOwn(findStep(adopted, 'investigate').stage, 'model'), false);
});

for (const path of ['briefs/investigate.md', 'shared/investigate.md', 'reviews/investigate-r1.findings.json', 'root/review/r1/candidates-1.json']) {
  test(`legacy adoption refuses existing output: ${path}`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'issueflow-adopt-used-'));
    const run = createRun({ repo: REPO, issue: ISSUE, policy: POLICY });
    delete run.host; delete run.runtime; delete run.dispatch;
    saveRun(dir, run);
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), 'already dispatched');
    assert.throws(() => loadRun(dir, { host: 'codex' }), /cannot.*host|cannot.*adopt/i);
    assert.equal(runtime.runtimeOf(loadRun(dir)), 'claude');
  });
}

test('artifact-bearing old Codex runs preserve their host while dropping fixed model aliases', () => {
  const dir = mkdtempSync(join(tmpdir(), 'issueflow-old-codex-'));
  const run = createRun({ repo: REPO, issue: ISSUE, policy: POLICY, runtime: 'codex' });
  delete run.host; delete run.dispatch;
  run.stages[0].model = 'gpt-5.6-terra';
  run.stages[0].at.briefed = '2026-01-01T00:00:00Z';
  saveRun(dir, run);
  const loaded = loadRun(dir);
  assert.equal(runtime.runtimeOf(loaded), 'codex');
  assert.equal(Object.hasOwn(loaded.stages[0], 'model'), false);
});

for (const count of [5, 8]) {
  test(`capacity host drains all ${count} briefs only after delivery AND slot release`, () => {
    const run = createRun({ repo: REPO, issue: ISSUE, policy: POLICY, runtime: 'codex', childSlots: 2 });
    const items = Array.from({ length: count }, (_, n) => ({ prompt: `brief-${n}`, writes: `output-${n}` }));
    // The pre-adapter host prints the whole fleet; the test file still loads on that baseline.
    const start = runtime.startWave ?? ((_run, fleet) => fleet);
    const delivered = new Set();
    const active = new Set();
    const seen = [];
    let wave = start(run, items);
    while (wave.length) {
      for (const item of wave) {
        assert.ok(active.size < 2, 'host refuses a spawn while both slots are retained');
        active.add(item.prompt); seen.push(item.prompt); delivered.add(item.writes);
      }
      assert.equal(runtime.waveState(run, (item) => delivered.has(item.writes)).kind, 'release');
      assert.throws(() => runtime.startWave(run, items), /active|release|wave/i);
      // Completion files do not free this host's children. Native wait/close must happen first.
      active.clear();
      runtime.releaseWave(run, (item) => delivered.has(item.writes));
      wave = runtime.advanceWave(run);
    }
    assert.deepEqual(seen, items.map((item) => item.prompt));
    assert.equal(new Set(seen).size, count);
  });
}

test('codex runtime inherits the parent model with cold writable workers', () => {
  const run = createRun({ repo: REPO, issue: ISSUE, policy: POLICY, runtime: 'codex' });
  const plan = findStep(run, 'investigate');
  const implement = findStep(run, 'implement', 'root');

  assert.deepEqual(
    [plan.stage.model, plan.stage.reasoning, plan.stage.agent],
    [undefined, 'high', 'worker'],
  );
  assert.deepEqual(
    [implement.stage.model, implement.stage.reasoning, implement.stage.agent],
    [undefined, 'high', 'worker'],
  );
  const profile = { reasoning: 'high', agent: 'worker', fork_turns: 'none' };
  assert.deepEqual(finderProfile(run), profile);
  assert.deepEqual(verifierProfile(run), profile);
  assert.deepEqual(fixerProfile(run, run.lanes[0]), profile);

  run.lanes[0].review.findings = [{ severity: 'major', status: 'open', stillOpenRounds: 1 }];
  assert.deepEqual(fixerProfile(run, run.lanes[0]), { ...profile, reasoning: 'xhigh' });
});

test('codex briefs use AGENTS.md and native completion; Claude defaults stay Claude-shaped', () => {
  const codex = createRun({ repo: REPO, issue: ISSUE, policy: POLICY, runtime: 'codex' });
  const codexText = renderBrief('/tmp/run', codex, findStep(codex, 'investigate'), ISSUE);
  assert.match(codexText, /read every applicable `AGENTS\.md`/);
  assert.match(codexText, /Codex returns that\s+final response to the parent automatically/);
  assert.doesNotMatch(codexText, /`SendMessage`/);
  assert.doesNotMatch(codexText, /progress\//, 'Codex briefs do not trigger optional out-of-sandbox progress writes');
  const reviewText = renderReviewBrief('/tmp/run', codex, findStep(codex, 'investigate'), ISSUE, 1);
  assert.match(reviewText, /Codex returns that\s+final response to the parent automatically/);
  assert.doesNotMatch(reviewText, /`SendMessage`/);
  assert.doesNotMatch(reviewText, /progress\//);

  const claude = createRun({ repo: REPO, issue: ISSUE, policy: POLICY });
  const claudeText = renderBrief('/tmp/run', claude, findStep(claude, 'investigate'), ISSUE);
  assert.match(claudeText, /`SendMessage`, addressed to `main`/);
  assert.doesNotMatch(claudeText, /read every applicable `AGENTS\.md`/);
  assert.match(claudeText, /progress\//, 'Claude keeps its existing file-based progress channel');
});

test('start --runtime codex persists the host contract; an invalid host writes no run', () => {
  const root = mkdtempSync(join(tmpdir(), 'issueflow-codex-runtime-'));
  const runDir = join(root, 'run');
  const workspaceRoot = join(root, 'workspace');
  const repoJson = join(root, 'repo.json');
  const issueJson = join(root, 'issue.json');
  const source = join(root, 'source');
  mkdirSync(source); mkdirSync(workspaceRoot);
  execFileSync('git', ['init', '-qb', 'dev'], { cwd: source });
  execFileSync('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.test', 'commit', '--allow-empty', '-qm', 'base'], { cwd: source });
  writeFileSync(repoJson, `${JSON.stringify({ ...REPO, path: source })}\n`);
  writeFileSync(issueJson, `${JSON.stringify(ISSUE)}\n`);

  const output = execFileSync('node', [CLI, 'start', '--repo', source, '--issue', '42', '--runtime', 'codex', '--offline', '--repo-json', repoJson, '--issue-json', issueJson, '--run-dir', runDir], { encoding: 'utf8' });
  const persisted = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'));
  assert.equal(persisted.runtime, 'codex');
  assert.equal(persisted.auto, true, 'autoflow starts autonomously by default');
  assert.match(output, /Auto run: every stage is gated by a red-team review instead of a human/);
  assert.match(output, /Codex run: dispatches include native model, reasoning effort and role fields/);
  const next = execFileSync('node', [CLI, 'next', '--run-dir', runDir, '--offline', '--workspace-root', workspaceRoot], { encoding: 'utf8' });
  assert.match(next, /model override omitted.*reasoning_effort `high`.*role `worker`.*fork_turns `none`/);
  assert.match(next, /next: dispatch \(brief\)/);

  const reviewDir = join(root, 'review-plan');
  execFileSync('node', [CLI, 'start', '--repo', REPO.path, '--issue', '43', '--runtime', 'codex', '--review-plan', '--offline', '--repo-json', repoJson, '--issue-json', issueJson, '--run-dir', reviewDir]);
  const reviewPlan = JSON.parse(readFileSync(join(reviewDir, 'run.json'), 'utf8'));
  assert.equal(reviewPlan.auto, false, '--review-plan is the explicit human-gate mode');

  const badDir = join(root, 'bad');
  assert.throws(
    () => execFileSync('node', [CLI, 'start', '--repo', REPO.path, '--issue', '42', '--runtime', 'other', '--offline', '--repo-json', repoJson, '--issue-json', issueJson, '--run-dir', badDir], { stdio: 'pipe' }),
    (err) => /unknown runtime `other`/.test(String(err.stderr)),
  );
  assert.equal(existsSync(join(badDir, 'run.json')), false);
});

test('codex dispatch output names the exact spawn fields and invalid runtimes refuse', () => {
  const rendered = renderAction({
    kind: 'dispatch',
    items: [{ model: 'gpt-6-astra', reasoning: 'high', agent: 'worker', prompt: 'Read /tmp/brief.md.' }],
    wait: 'wait-command',
  }, { skillCommand: 'issueflow', runDir: '/tmp/run' });
  assert.match(rendered, /model `gpt-6-astra`, reasoning_effort `high`, role `worker`/);
  assert.throws(() => assertRuntime('other'), /unknown runtime `other`/);
});

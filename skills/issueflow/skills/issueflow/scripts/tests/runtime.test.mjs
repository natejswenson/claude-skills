import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { renderBrief, renderReviewBrief } from '../lib/brief.mjs';
import { renderAction } from '../lib/next.mjs';
import { finderProfile, fixerProfile, verifierProfile } from '../lib/prreview.mjs';
import { createRun, findStep } from '../lib/run.mjs';
import { assertRuntime } from '../lib/runtime.mjs';

const ISSUE = { number: 42, title: 'make both hosts work', body: 'Codex cannot dispatch opus.' };
const REPO = { owner: 'acme', name: 'widgets', path: '/tmp/widgets', defaultBranch: 'dev' };
const POLICY = { base: 'dev', featurePrefix: 'feature/', mergeMethod: 'squash' };
const CLI = new URL('../issueflow.js', import.meta.url).pathname;

test('codex runtime resolves every worker to a native model, reasoning effort and role', () => {
  const run = createRun({ repo: REPO, issue: ISSUE, policy: POLICY, runtime: 'codex' });
  const plan = findStep(run, 'investigate');
  const implement = findStep(run, 'implement', 'root');

  assert.deepEqual(
    [plan.stage.model, plan.stage.reasoning, plan.stage.agent],
    ['gpt-5.6-terra', 'high', 'explorer'],
  );
  assert.deepEqual(
    [implement.stage.model, implement.stage.reasoning, implement.stage.agent],
    ['gpt-6-astra', 'high', 'worker'],
  );
  assert.deepEqual(finderProfile(run), { model: 'gpt-5.6-terra', reasoning: 'high', agent: 'explorer' });
  assert.deepEqual(verifierProfile(run), { model: 'gpt-6-astra', reasoning: 'high', agent: 'default' });
  assert.deepEqual(fixerProfile(run, run.lanes[0]), { model: 'gpt-5.6-terra', reasoning: 'high', agent: 'worker' });

  run.lanes[0].review.findings = [{ severity: 'major', status: 'open', stillOpenRounds: 1 }];
  assert.deepEqual(fixerProfile(run, run.lanes[0]), { model: 'gpt-6-astra', reasoning: 'xhigh', agent: 'worker' });
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
  const repoJson = join(root, 'repo.json');
  const issueJson = join(root, 'issue.json');
  writeFileSync(repoJson, `${JSON.stringify(REPO)}\n`);
  writeFileSync(issueJson, `${JSON.stringify(ISSUE)}\n`);

  const output = execFileSync('node', [CLI, 'start', '--repo', REPO.path, '--issue', '42', '--runtime', 'codex', '--offline', '--repo-json', repoJson, '--issue-json', issueJson, '--run-dir', runDir], { encoding: 'utf8' });
  const persisted = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'));
  assert.equal(persisted.runtime, 'codex');
  assert.equal(persisted.auto, true, 'autoflow starts autonomously by default');
  assert.match(output, /Auto run: every stage is gated by a red-team review instead of a human/);
  assert.match(output, /Codex run: dispatches include native model, reasoning effort and role fields/);
  const next = execFileSync('node', [CLI, 'next', '--run-dir', runDir, '--offline'], { encoding: 'utf8' });
  assert.match(next, /model `gpt-5\.6-terra`, reasoning_effort `high`, role `explorer`/);
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

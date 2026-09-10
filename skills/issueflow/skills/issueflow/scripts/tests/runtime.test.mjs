import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { renderBrief, renderReviewBrief } from '../lib/brief.mjs';
import { renderAction } from '../lib/next.mjs';
import { finderProfile, fixerProfile, verifierProfile } from '../lib/prreview.mjs';
import { artifactPath, createRun, evidencePath, findStep, laneTree, loadRun, progressPath, saveRun } from '../lib/run.mjs';
import { assertRuntime, DEFAULT_CODEX_CHILD_SLOTS, dispatchProfile } from '../lib/runtime.mjs';
import * as runtime from '../lib/runtime.mjs';
import { resolveGuidance } from '../lib/guidance.mjs';
import { activePath, prepareExecution } from '../lib/execution.mjs';
import { renderFinderBrief, renderFixBrief, renderVerifierBrief } from '../lib/reviewbrief.mjs';
import { STAGES } from '../lib/stages.mjs';
import { GOOD_EVIDENCE } from './helpers.mjs';

const ISSUE = { number: 42, title: 'make both hosts work', body: 'Codex cannot dispatch opus.' };
const REPO = { owner: 'acme', name: 'widgets', path: '/tmp/widgets', defaultBranch: 'dev' };
const POLICY = { base: 'dev', featurePrefix: 'feature/', mergeMethod: 'squash' };
const CLI = new URL('../issueflow.js', import.meta.url).pathname;

function cliFixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'issueflow-runtime-cli-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, 'source'), dir = join(root, 'run'), workspaceRoot = join(root, 'workspace');
  mkdirSync(source); mkdirSync(workspaceRoot);
  const git = (args, cwd = source) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
  git(['init', '-qb', 'dev']);
  git(['config', 'user.name', 'fixture']); git(['config', 'user.email', 'fixture@example.invalid']);
  git(['commit', '--allow-empty', '-qm', 'base']);
  const run = createRun({ repo: { ...REPO, path: source }, issue: ISSUE, policy: POLICY, host: 'codex', childSlots: 2, offline: true, auto: true });
  saveRun(dir, run);
  mkdirSync(join(dir, 'inputs')); writeFileSync(join(dir, 'inputs', 'issue.json'), JSON.stringify(ISSUE));
  prepareExecution(dir, run, { workspaceRoot });
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args, '--run-dir', dir, '--offline'], { encoding: 'utf8', cwd: source });
  const ok = (...args) => {
    const result = cli(...args);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return result.stdout;
  };
  ok('next');
  writeFileSync(artifactPath(dir, findStep(run, 'investigate')), stageReport('investigate'));
  ok('next', '--workers-released');
  writeFileSync(activePath(dir, 'reviews', 'investigate-r1.findings.json'), JSON.stringify({ verdict: 'pass', findings: [], notExamined: ['external deployment'] }));
  const implementation = ok('next', '--workers-released');
  const resumed = loadRun(dir), tree = laneTree(dir, resumed, resumed.lanes[0]);
  return { source, dir, run: resumed, tree, git, cli, ok, implementation };
}

const stageReport = (id) => STAGES.find((s) => s.id === id).requires.map((s) => `## ${s}\n\nfixture proof\n`).join('\n');
const dispatchedPaths = (text) => [...text.matchAll(/Read (.+) and follow it exactly\. It is your complete brief\./g)].map((m) => m[1]);
const backdate = (path, seconds) => {
  const at = new Date(Date.now() - seconds * 1000);
  utimesSync(path, at, at);
};

test('CLI drains five finder and four verifier briefs through persisted waves and native slot release', (t) => {
  const { dir, run, tree, git, cli, ok } = cliFixture(t);
  writeFileSync(join(tree, 'a.js'), Array.from({ length: 751 }, (_, n) => `export const a${n} = ${n};`).join('\n') + '\n');
  git(['add', 'a.js'], tree); git(['commit', '-qm', 'large change'], tree);
  const step = findStep(run, 'implement');
  mkdirSync(join(artifactPath(dir, step), '..'), { recursive: true });
  writeFileSync(artifactPath(dir, step), stageReport('implement'));
  writeFileSync(evidencePath(dir, step), GOOD_EVIDENCE);
  run.lanes[0].pr = { number: 1, url: 'https://example.invalid/pr/1' };
  saveRun(dir, run);
  let output = ok('next', '--workers-released');
  const seen = new Set(), slots = new Set(), delivered = new Set();
  for (const [role, count] of [['finder', 5], ['verifier', 4]]) {
    const initial = loadRun(dir).dispatch.queue;
    assert.equal(initial.items.length, count);
    const expected = initial.items.map((item) => item.prompt);
    // Queued briefs wait over 30 minutes before later workers acquire slots.
    for (const item of initial.items) backdate(item.prompt, 2400);
    let observed = 0;
    while (observed < count) {
      const paths = dispatchedPaths(output);
      const queue = loadRun(dir).dispatch.queue;
      assert.deepEqual(paths, queue.active.map((item) => item.prompt));
      assert.ok(paths.length > 0 && paths.length <= 2);
      assert.equal(queue.cursor, observed + paths.length);
      for (const item of queue.active) {
        assert.ok(item.dispatchedAt >= Date.now() - 10000, 'timeout starts at dispatch, not brief creation');
        assert.ok(slots.size < 2, 'native host refuses a spawn without a free slot');
        assert.equal(seen.has(item.prompt), false, 'brief dispatched twice');
        slots.add(item.prompt); seen.add(item.prompt);
      }
      const early = cli('next', '--workers-released');
      assert.notEqual(early.status, 0, 'release must refuse missing output files');
      const waiting = ok('next');
      assert.match(waiting, /Codex worker wave/);
      assert.deepEqual(dispatchedPaths(waiting), []);
      for (const item of queue.active) {
        const candidates = item.n === 1 ? Array.from({ length: 24 }, (_, n) => ({
          file: 'a.js', line: n * 10 + 1, category: 'correctness', summary: `Distinct failure ${n}`, short_summary: `Failure ${n}`, failure_scenario: `Input ${n} fails`,
        })) : [];
        const verdicts = role === 'verifier' ? JSON.parse(readFileSync(item.prompt, 'utf8').match(/```json\n([\s\S]*?)\n```/)[1]).map((c) => ({ id: c.id, verdict: 'REFUTED', quote: `export const a${c.line - 1} = ${c.line - 1};` })) : [];
        writeFileSync(item.writes, JSON.stringify(role === 'finder' ? { candidates, notExamined: [] } : { verdicts }));
        assert.ok(statSync(item.writes).mtimeMs > statSync(item.prompt).mtimeMs);
        delivered.add(item.writes);
      }
      const retained = ok('next');
      assert.match(retained, /native slot/);
      assert.deepEqual(dispatchedPaths(retained), [], 'files alone cannot start another wave');
      assert.equal(loadRun(dir).dispatch.queue.released, false);
      slots.clear(); // Native wait/close stand-in, distinct from filesystem delivery.
      observed += paths.length;
      output = ok('next', '--workers-released');
    }
    assert.deepEqual([...seen].filter((path) => expected.includes(path)), expected);
    assert.equal(delivered.size, role === 'finder' ? 5 : 9);
  }
  assert.equal(seen.size, 9);
  assert.equal(loadRun(dir).dispatch.queue, undefined);
  assert.equal(loadRun(dir).lanes[0].review.rounds[0].verdict, 'converged');
});

for (const activity of ['silent', 'progress', 'evidence', 'checkout']) {
  test(`CLI implementation wave retains heartbeat detection: ${activity}`, (t) => {
    const { dir, tree, cli, ok, implementation } = cliFixture(t);
    assert.equal(dispatchedPaths(implementation).length, 1);
    const run = loadRun(dir), step = findStep(run, 'implement');
    const age = activity === 'silent' ? 420 : 1860;
    const at = new Date(Date.now() - age * 1000).toISOString();
    step.stage.at.briefed = at;
    run.dispatch.queue.active[0].dispatchedAt = Date.parse(at);
    assert.equal(run.dispatch.queue.active[0].artifact, artifactPath(dir, step));
    backdate(run.dispatch.queue.active[0].prompt, age);
    writeFileSync(progressPath(dir, step), 'started implementation\n');
    backdate(progressPath(dir, step), 360);
    run.budgetRenewals = [{ at, budgetSeconds: 300 }];
    saveRun(dir, run);
    ok('resume', '--budget-seconds', '3600');
    if (activity !== 'silent') {
      const path = activity === 'progress' ? progressPath(dir, step) : activity === 'evidence' ? evidencePath(dir, step) : join(tree, 'a.js');
      writeFileSync(path, 'worker is still active\n');
    }
    const result = cli('next');
    if (activity === 'silent') {
      assert.equal(result.status, 4, result.stdout + result.stderr);
      assert.match(result.stdout, /no progress, evidence, or worktree activity for 6 minutes/);
    } else {
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /root\/implement is in flight/);
      assert.doesNotMatch(result.stdout, /terminate|stalled/);
    }
  });
}

for (const role of ['finder', 'verifier', 'fixer']) {
  test(`${role} filters guidance by worktree paths and root-to-leaf scope`, (t) => {
    const { dir, run, source, tree } = cliFixture(t);
    const rules = {
      'CLAUDE.md': 'ROOT_CLAUDE_RULE', 'AGENTS.md': 'SHADOWED_ROOT_RULE', 'AGENTS.override.md': 'ROOT_OVERRIDE_RULE', 'REVIEW.md': 'ROOT_REVIEW_RULE',
      'src/AGENTS.md': 'SRC_AGENT_RULE', 'src/CLAUDE.md': 'SRC_CLAUDE_RULE', 'src/REVIEW.md': 'SRC_REVIEW_RULE',
      'src/lib/AGENTS.md': 'SHADOWED_LEAF_RULE', 'src/lib/AGENTS.override.md': 'LEAF_OVERRIDE_RULE', 'src/lib/CLAUDE.md': 'LEAF_CLAUDE_RULE', 'src/lib/REVIEW.md': 'LEAF_REVIEW_RULE',
      'src/other/AGENTS.md': 'UNRELATED_SIBLING_RULE', 'docs/REVIEW.md': 'UNRELATED_DOC_RULE',
    };
    for (const [path, rule] of Object.entries(rules)) {
      for (const checkout of [source, tree]) {
        mkdirSync(join(checkout, path, '..'), { recursive: true });
        writeFileSync(join(checkout, path), checkout === tree ? rule : `SOURCE_ONLY_${rule}`);
      }
    }
    const lane = run.lanes[0]; lane.pr = { number: 1, url: 'https://example.invalid/pr/1' };
    const entry = { round: 1, head: 'a'.repeat(40), finders: 1, verifiers: 1 };
    const items = [{ id: 'f-one', file: 'src/lib/a.js', line: 1, severity: 'major', summary: 'fixture', failure_scenario: 'fixture' }];
    const text = role === 'finder' ? renderFinderBrief(dir, run, lane, entry, 1, { angles: ['conventions'], issue: ISSUE, files: [{ path: items[0].file }], prior: [] })
      : role === 'verifier' ? renderVerifierBrief(dir, run, lane, entry, 1, { items, issue: ISSUE })
        : renderFixBrief(dir, run, lane, entry, { items, checks: [], issue: ISSUE });
    for (const [path, rule] of Object.entries(rules)) {
      if (/SHADOWED|UNRELATED/.test(rule)) assert.ok(!text.includes(rule), `out-of-scope ${rule}`);
      else {
        assert.ok(text.includes(rule), `missing ${rule}`);
        assert.ok(text.includes(`\`${path}\` — scope:`), `missing scope for ${path}`);
      }
    }
    assert.doesNotMatch(text, /SOURCE_ONLY_/);
    assert.ok(text.indexOf('ROOT_OVERRIDE_RULE') < text.indexOf('SRC_AGENT_RULE'));
    assert.ok(text.indexOf('SRC_AGENT_RULE') < text.indexOf('LEAF_OVERRIDE_RULE'));
  });
}

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

test('Codex defaults to bounded concurrency while Claude keeps its host default', () => {
  assert.equal(runtime.dispatchPolicy('codex').childSlots, DEFAULT_CODEX_CHILD_SLOTS);
  assert.equal(runtime.dispatchPolicy('claude').childSlots, 1);
  assert.equal(createRun({ repo: REPO, issue: ISSUE, policy: POLICY, runtime: 'codex' }).dispatch.childSlots, 4);
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

test('start --runtime codex adopts a pre-artifact legacy run', () => {
  const root = mkdtempSync(join(tmpdir(), 'issueflow-start-runtime-adopt-'));
  const source = join(root, 'source'); const dir = join(root, 'run'); const repoJson = join(root, 'repo.json'); const issueJson = join(root, 'issue.json');
  mkdirSync(source); execFileSync('git', ['init', '-qb', 'dev'], { cwd: source });
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-qm', 'base'], { cwd: source });
  const legacy = createRun({ repo: { ...REPO, path: source }, issue: ISSUE, policy: POLICY, offline: true });
  delete legacy.host; delete legacy.runtime; delete legacy.dispatch;
  saveRun(dir, legacy); writeFileSync(repoJson, JSON.stringify({ ...REPO, path: source })); writeFileSync(issueJson, JSON.stringify(ISSUE));
  const output = execFileSync('node', [CLI, 'start', '--repo', source, '--issue', '42', '--runtime', 'codex', '--offline', '--repo-json', repoJson, '--issue-json', issueJson, '--run-dir', dir], { encoding: 'utf8' });
  assert.match(output, /Host retained as codex/);
  assert.equal(loadRun(dir).host, 'codex');
});

test('next adopts a pre-artifact legacy run before Codex execution preparation', () => {
  const root = mkdtempSync(join(tmpdir(), 'issueflow-next-adopt-'));
  const source = join(root, 'source'); const workspace = join(root, 'workspace'); const dir = join(root, 'run');
  mkdirSync(source); mkdirSync(workspace);
  execFileSync('git', ['init', '-qb', 'dev'], { cwd: source });
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-qm', 'base'], { cwd: source });
  const run = createRun({ repo: { ...REPO, path: source }, issue: ISSUE, policy: POLICY, offline: true });
  delete run.host; delete run.runtime; delete run.dispatch;
  saveRun(dir, run); mkdirSync(join(dir, 'inputs')); writeFileSync(join(dir, 'inputs', 'issue.json'), JSON.stringify(ISSUE));
  const result = execFileSync('node', [CLI, 'next', '--run-dir', dir, '--host', 'codex', '--workspace-root', workspace, '--offline'], { encoding: 'utf8' });
  assert.match(result, /fork_turns `none`/);
  assert.equal(loadRun(dir).host, 'codex');
});

test('start with --host codex restarts a completed run instead of retaining it', () => {
  const root = mkdtempSync(join(tmpdir(), 'issueflow-restart-host-'));
  const source = join(root, 'source'); const dir = join(root, 'run'); const repoJson = join(root, 'repo.json'); const issueJson = join(root, 'issue.json');
  mkdirSync(source); execFileSync('git', ['init', '-qb', 'dev'], { cwd: source });
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-qm', 'base'], { cwd: source });
  const old = createRun({ repo: { ...REPO, path: source }, issue: ISSUE, policy: POLICY, offline: true }); old.finished = '2026-01-01T00:00:00.000Z';
  saveRun(dir, old); writeFileSync(repoJson, JSON.stringify({ ...REPO, path: source })); writeFileSync(issueJson, JSON.stringify(ISSUE));
  execFileSync('node', [CLI, 'start', '--repo', source, '--issue', '42', '--host', 'codex', '--offline', '--repo-json', repoJson, '--issue-json', issueJson, '--run-dir', dir]);
  const restarted = loadRun(dir);
  assert.equal(restarted.host, 'codex'); assert.equal(restarted.finished, null);
});

test('guidance follows safe in-checkout symlinks and skips unreadable unrelated directories', () => {
  const tree = mkdtempSync(join(tmpdir(), 'issueflow-guidance-links-'));
  writeFileSync(join(tree, 'rules.md'), 'OVERRIDE_THROUGH_SYMLINK');
  writeFileSync(join(tree, 'AGENTS.md'), 'SHADOWED_AGENT_RULE');
  symlinkSync('rules.md', join(tree, 'AGENTS.override.md'));
  mkdirSync(join(tree, 'unreadable')); chmodSync(join(tree, 'unreadable'), 0);
  try {
    const text = resolveGuidance(tree).map((entry) => entry.text).join('\n');
    assert.match(text, /OVERRIDE_THROUGH_SYMLINK/);
    assert.doesNotMatch(text, /SHADOWED_AGENT_RULE/);
  } finally {
    chmodSync(join(tree, 'unreadable'), 0o700);
  }
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

test('each queued Codex wave receives a fresh dispatch timestamp and release acknowledgement is retry-safe', () => {
  const run = createRun({ repo: REPO, issue: ISSUE, policy: POLICY, runtime: 'codex', childSlots: 1 });
  const items = [{ prompt: 'one', writes: 'one.out' }, { prompt: 'two', writes: 'two.out' }];
  const first = runtime.startWave(run, items); const firstAt = first[0].dispatchedAt;
  assert.ok(firstAt >= Date.now() - 1000);
  runtime.releaseWave(run, () => true);
  const second = runtime.advanceWave(run);
  assert.ok(second[0].dispatchedAt >= firstAt);
  runtime.releaseWave(run, () => true);
  assert.equal(runtime.releaseWave(run, () => true), false);
});

test('codex runtime uses role-sized reasoning with cold writable workers', () => {
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
  assert.deepEqual(finderProfile(run), { ...profile, reasoning: 'medium' });
  assert.deepEqual(verifierProfile(run), profile);
  assert.deepEqual(fixerProfile(run, run.lanes[0]), { ...profile, reasoning: 'medium' });

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

test('start --autonomous persists bounded budget automation as an explicit opt-in', () => {
  const root = mkdtempSync(join(tmpdir(), 'issueflow-autonomous-'));
  const runDir = join(root, 'run');
  const repoJson = join(root, 'repo.json');
  const issueJson = join(root, 'issue.json');
  writeFileSync(repoJson, `${JSON.stringify(REPO)}\n`);
  writeFileSync(issueJson, `${JSON.stringify(ISSUE)}\n`);
  execFileSync('node', [CLI, 'start', '--repo', REPO.path, '--issue', '42', '--runtime', 'codex', '--autonomous', '--offline', '--repo-json', repoJson, '--issue-json', issueJson, '--run-dir', runDir], { encoding: 'utf8' });
  const persisted = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'));
  assert.equal(persisted.autonomous, true);
  assert.ok(persisted.totalBudgetSeconds > persisted.complexity.budgetSeconds);
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

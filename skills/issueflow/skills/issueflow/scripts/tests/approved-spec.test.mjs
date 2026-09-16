import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { loadRun, findStep, blockers } from '../lib/run.mjs';
import { shipBlockers, prBody } from '../lib/ship.mjs';
import { renderComment } from '../lib/checkpoint.mjs';
import { controllerTestEnv } from './helpers.mjs';

const cli = new URL('../issueflow.js', import.meta.url).pathname;
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
function fixture(t, host = 'codex') {
  const root = mkdtempSync(join(tmpdir(), 'issueflow-approved-spec-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, 'repo'), dir = join(root, 'run'), workspace = join(root, 'workspace');
  mkdirSync(repo); mkdirSync(workspace);
  git(repo, 'init', '-qb', 'main'); git(repo, 'config', 'user.name', 'test'); git(repo, 'config', 'user.email', 'test@example.invalid');
  writeFileSync(join(repo, 'README.md'), 'Before.\n'); git(repo, 'add', 'README.md'); git(repo, 'commit', '-qm', 'base');
  const meta = join(root, 'repo.json'), issue = join(root, 'issue.json'), spec = join(root, 'spec.md'), contract = join(root, 'contract.json');
  writeFileSync(meta, JSON.stringify({ owner: 'fixture', name: 'approved-spec', defaultBranch: 'main' }));
  writeFileSync(issue, JSON.stringify({ number: 1, title: 'Clarify README', body: 'Use the accepted specification.', labels: [], comments: [] }));
  const text = '# Accepted design\n\nChange README wording to After.\n';
  writeFileSync(spec, text);
  const task = { schema: 2, risk: 'docs', criteria: [{ id: 'D1', description: 'README says After.' }], nonGoals: ['code changes'], allowedPaths: ['README.md'], checks: [{ id: 'docs', type: 'command', argv: [process.execPath, '-e', "require('node:assert/strict').equal(require('node:fs').readFileSync('README.md','utf8'), 'After.\\n')"], criteria: ['D1'] }] };
  writeFileSync(contract, JSON.stringify(task));
  const invoke = (args, env = {}) => spawnSync(process.execPath, [cli, ...args, '--run-dir', dir], { encoding: 'utf8', env: { ...controllerTestEnv('approved-spec-controller'), ...env } });
  const base = ['start', '--repo', repo, '--repo-json', meta, '--issue-json', issue, '--issue', '1', '--host', host, ...(host === 'codex' ? ['--workspace-root', workspace] : [])];
  const selection = ['--approved-spec', spec, '--spec-contract', contract, '--spec-approval', 'User accepted the proven design and requested implementation.'];
  const start = (args = selection, env) => invoke([...base, ...args], env);
  return { root, repo, dir, spec, text, contract, task, start, invoke, selection };
}

for (const host of ['claude', 'codex']) test(`${host}: approved spec dispatches implementation first and reports skipped planning`, t => {
  const f = fixture(t, host), started = f.start();
  assert.equal(started.status, 0, started.stdout + started.stderr);
  const run = loadRun(f.dir);
  assert.equal(run.stages[0].state, 'skipped');
  assert.deepEqual(run.stages[0].review.rounds, []);
  assert.equal(run.stages[0].at.approved, undefined);
  assert.equal(readFileSync(join(f.dir, 'inputs/approved-spec.md'), 'utf8'), f.text);
  assert.deepEqual(run.harness.contract, f.task);
  assert.deepEqual(blockers(run, findStep(run, 'implement')), []);
  assert.deepEqual(shipBlockers(run).map(b => b.step), ['root/implement']);
  const next = f.invoke(['next']);
  assert.equal(next.status, 0, next.stdout + next.stderr);
  const updated = loadRun(f.dir);
  const attempt = Object.values(updated.harness.attempts).find(a => a.brief.endsWith('/root-implement.md'));
  assert.ok(attempt, 'first worker must implement');
  assert.equal(Object.values(updated.harness.attempts).some(a => a.brief.endsWith('/investigate.md')), false);
  const brief = readFileSync(attempt.brief, 'utf8');
  assert.match(brief, /approved-spec\.md/);
  assert.match(brief, /README says After/);
  assert.doesNotMatch(prBody(f.dir, updated, updated.lanes[0]), /plan passed independent red-team/);
  assert.match(renderComment(f.dir, updated), /[Pp]lanning.*skipped/);
  assert.doesNotMatch(renderComment(f.dir, updated), /ship` keeps refusing/);
  const accept = f.invoke(['accept', '--stage', 'implement']);
  assert.notEqual(accept.status, 0, 'import is not implementation acceptance');
});

test('normal starts still dispatch planning; generic skips do not authorize implementation', t => {
  const f = fixture(t); assert.equal(f.start([]).status, 0);
  const run = loadRun(f.dir); run.stages[0].state = 'skipped';
  assert.deepEqual(blockers(run, findStep(run, 'implement')).map(s => s.key), ['investigate']);
  assert.deepEqual(shipBlockers(run).map(b => b.step), ['investigate', 'root/implement']);
  assert.equal(f.invoke(['next']).status, 0);
  assert.ok(Object.values(loadRun(f.dir).harness.attempts).some(a => a.brief.endsWith('/investigate.md')));
});

test('import refuses missing authority, missing contract, ambiguous contracts and contradictory review mode before claiming', t => {
  const f = fixture(t);
  for (const args of [
    ['--approved-spec', f.spec, '--spec-contract', f.contract],
    ['--approved-spec', f.spec, '--spec-approval', 'User request'],
    [...f.selection, '--review-plan'],
    ['--spec-contract', f.contract],
  ]) {
    assert.notEqual(f.start(args).status, 0, JSON.stringify(args));
    assert.equal(existsSync(join(f.dir, 'run.json')), false);
  }
  writeFileSync(f.spec, f.text + '\n```issueflow-contract\n' + JSON.stringify(f.task) + '\n```\n');
  assert.notEqual(f.start().status, 0, 'two contract sources are ambiguous');
  assert.equal(f.start(['--approved-spec', f.spec, '--spec-approval', 'User request']).status, 0);
});

test('resumption uses frozen bytes and rejects replacing the accepted input', t => {
  const f = fixture(t); assert.equal(f.start().status, 0);
  writeFileSync(f.spec, 'Changed upstream document.');
  assert.notEqual(f.start().status, 0, 'start must not silently replace or ignore a new spec');
  assert.equal(f.start([]).status, 0, 'resume without import flags retains the snapshot');
  assert.equal(f.invoke(['next']).status, 0);
  writeFileSync(join(f.dir, 'inputs/approved-spec.md'), 'tampered frozen input');
  const refused = f.invoke(['next']);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /spec.*(changed|identity|hash)|frozen/i);
});

test('interrupted initialization retains the approved spec without rereading its source', t => {
  const f = fixture(t);
  assert.notEqual(f.start(f.selection, { ISSUEFLOW_INIT_FAIL_AFTER: 'inputs' }).status, 0);
  rmSync(f.spec); rmSync(f.contract);
  const retry = f.start([]); assert.equal(retry.status, 0, retry.stderr);
  const run = loadRun(f.dir); assert.equal(run.stages[0].state, 'skipped');
  assert.equal(readFileSync(join(f.dir, 'inputs/approved-spec.md'), 'utf8'), f.text);
});

test('invalid obligations and unavailable commands cannot enter implementation', t => {
  const f = fixture(t);
  writeFileSync(f.contract, JSON.stringify({ ...f.task, checks: [] }));
  assert.notEqual(f.start().status, 0);
  assert.equal(existsSync(join(f.dir, 'run.json')), false);
  f.task.checks[0].argv = ['definitely-not-an-installed-issueflow-tool'];
  writeFileSync(f.contract, JSON.stringify(f.task));
  const start = f.start(); assert.notEqual(start.status, 0);
  assert.match(start.stderr, /executable unavailable/);
  const next = f.invoke(['next']); assert.notEqual(next.status, 0);
  assert.equal(Object.keys(loadRun(f.dir).harness.attempts ?? {}).length, 0);
});

test('sensitive approved scope retains deeper code review even when the issue only says docs', t => {
  const f = fixture(t);
  f.task.risk = 'sensitive';
  f.task.allowedPaths.push('regression.test.cjs');
  f.task.checks.push({ id: 'regression', type: 'regression', criteria: ['D1'], argv: [process.execPath, '--test', 'regression.test.cjs'], testFiles: ['regression.test.cjs'] });
  writeFileSync(f.contract, JSON.stringify(f.task));
  assert.equal(f.start().status, 0);
  const run = loadRun(f.dir);
  assert.equal(run.complexity.kind, 'deep');
  assert.equal(run.lanes[0].review.maxRounds, 4);
});

for (const host of ['claude', 'codex']) for (const correct of [true, false]) {
  test(`${host}: imported spec retains real red/green verification and ${correct ? 'review handoff' : 'failure refusal'}`, t => {
    const f = fixture(t, host);
    const ok = result => assert.equal(result.status, 0, result.stdout + result.stderr);
    f.task.risk = 'standard'; f.task.allowedPaths.push('wording.test.cjs');
    f.task.checks = [
      { id: 'regression', type: 'regression', argv: [process.execPath, '--test', '--test-reporter=tap', 'wording.test.cjs'], testFiles: ['wording.test.cjs'], criteria: ['D1'] },
      { id: 'suite', type: 'test', argv: [process.execPath, '--test', '--test-reporter=tap'], criteria: ['D1'] },
    ];
    writeFileSync(f.contract, JSON.stringify(f.task));
    ok(f.start()); ok(f.invoke(['next']));
    let run = loadRun(f.dir);
    const attempt = run.harness.attempts['root/implement.md'];
    const tree = join(run.execution?.path ?? f.dir, 'worktrees/root');
    if (correct) writeFileSync(join(tree, 'README.md'), 'After.\n');
    writeFileSync(join(tree, 'wording.test.cjs'), "const test=require('node:test');const assert=require('node:assert/strict');test('approved wording',()=>assert.equal(require('node:fs').readFileSync('README.md','utf8'),'After.\\n'));\n");
    git(tree, 'add', 'README.md', 'wording.test.cjs');
    git(tree, '-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'implement supplied spec');
    writeFileSync(attempt.outputs[0], '## Changed\nREADME and regression.\n## Deviations\nNone.\n## Command\nNode tests.\n## Two-sided\nController checks base and fixed code.\n## Result\nCommitted.\n');
    ok(spawnSync(process.execPath, [new URL('../complete-worker.mjs', import.meta.url).pathname, attempt.manifest], { encoding: 'utf8', env: controllerTestEnv('approved-spec-controller') }));
    const next = f.invoke(['next', '--workers-released']);
    run = loadRun(f.dir);
    assert.equal(run.stages[0].state, 'skipped'); assert.deepEqual(run.stages[0].review.rounds, []);
    if (!correct) {
      assert.notEqual(run.lanes[0].stages[0].state, 'approved');
      assert.notEqual(f.invoke(['ship', '--dry-run']).status, 0);
      assert.ok(run.lanes[0].verification.receipts.some(r => !JSON.parse(readFileSync(r.path)).passed));
      return;
    }
    assert.equal(run.lanes[0].stages[0].state, 'approved', next.stdout + next.stderr);
    const regression = JSON.parse(readFileSync(run.lanes[0].verification.receipts[0].path));
    assert.equal(regression.red.exitCode, 1); assert.equal(regression.green.exitCode, 0);
    assert.equal(regression.red.summaries.at(-1).failed, 1);
    ok(f.invoke(['ship', '--dry-run']));
    // Synthetic offline PR identity only; the public CLI renders the actual review handoff.
    run.lanes[0].pr = { number: 101, url: 'https://example.invalid/pull/101' };
    run.lanes[0].review.draft = true;
    writeFileSync(join(f.dir, 'run.json'), JSON.stringify(run));
    ok(f.invoke(['review-brief', '--lane', 'root', '--offline']));
    run = loadRun(f.dir);
    const finders = Object.values(run.harness.attempts).filter(a => a.outputs.some(p => p.includes('candidates')));
    assert.ok(finders.length > 0);
    for (const finder of finders) assert.match(readFileSync(finder.brief, 'utf8'), /approved-spec\.md/);
  });
}

test('an approved-spec amendment reopens planning instead of reusing the shortcut', t => {
  const f = fixture(t); assert.equal(f.start().status, 0);
  const amend = f.invoke(['amend', '--workers-released', '--reason', 'Revise the accepted execution requirements.']);
  assert.equal(amend.status, 0, amend.stderr);
  assert.equal(f.invoke(['next', '--workers-released']).status, 0);
  const run = loadRun(f.dir);
  assert.notEqual(run.stages[0].state, 'skipped');
  assert.ok(run.harness.attempts['shared/investigate.md']);
  assert.deepEqual(blockers(run, findStep(run, 'implement')).map(s => s.key), ['investigate']);
});

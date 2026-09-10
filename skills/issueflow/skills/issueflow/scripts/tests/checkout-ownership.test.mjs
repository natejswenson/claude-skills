import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRun, findStep, laneTree, loadRun, saveRun, worktreePath } from '../lib/run.mjs';
import { ensureWorktree, removeWorktree } from '../lib/worktree.mjs';
import { prepareCheckout } from '../lib/execution.mjs';
import { verify } from '../lib/verify.mjs';
import { GOOD_EVIDENCE, approvePlan } from './helpers.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'issueflow.js');
const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const cli = (dir, ...args) => spawnSync(process.execPath, [CLI, ...args, '--run-dir', dir], {
  encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: undefined },
});
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "issueflow owner's space "));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, 'source');
  mkdirSync(repo);
  git(['init', '-qb', 'main'], repo);
  git(['config', 'user.name', 'test'], repo);
  git(['config', 'user.email', 'test@example.invalid'], repo);
  writeFileSync(join(repo, 'tracked'), 'original\n');
  git(['add', 'tracked'], repo);
  git(['commit', '-qm', 'seed'], repo);
  const make = (number) => {
    const dir = join(root, 'run ' + number);
    const issue = { number, title: 'checkout ownership', body: 'fix', url: 'https://example.invalid/' + number };
    const run = createRun({ repo: { path: repo, owner: 'a', name: 'b' }, issue,
      policy: { base: 'main', featurePrefix: 'feature/' }, offline: true, auto: true });
    saveRun(dir, run);
    mkdirSync(join(dir, 'inputs'));
    writeFileSync(join(dir, 'inputs', 'issue.json'), JSON.stringify(issue));
    approvePlan(dir, run);
    return { dir, run, lane: run.lanes[0] };
  };
  return { root, repo, make, ...make(1) };
}
const snapshot = (repo) => [git(['status', '--porcelain'], repo), git(['rev-parse', 'HEAD'], repo),
  git(['show-ref', '--heads'], repo), readFileSync(join(repo, '.git', 'index')).toString('hex')];

for (const command of ['brief', 'next']) {
  for (const failure of ['base', 'mkdir', 'permission', 'destination']) {
    test(command + ' refuses ' + failure + ' provisioning without dispatch or source mutation', (t) => {
      const f = fixture(t);
      if (failure === 'base') f.run.lanes[0].base = 'missing-base';
      if (failure === 'mkdir') writeFileSync(join(f.dir, 'worktrees'), 'not a directory');
      if (failure === 'destination') mkdirSync(worktreePath(f.dir, f.lane), { recursive: true });
      if (failure === 'permission') {
        mkdirSync(join(f.dir, 'worktrees'));
        chmodSync(join(f.dir, 'worktrees'), 0o500);
      }
      saveRun(f.dir, f.run);
      const before = snapshot(f.repo);
      const result = cli(f.dir, command, '--stage', 'implement');
      if (failure === 'permission') chmodSync(join(f.dir, 'worktrees'), 0o700);
      assert.equal(result.status, 3, result.stdout + result.stderr);
      assert.equal(existsSync(join(f.dir, 'briefs', 'root-implement.md')), false);
      assert.equal(loadRun(f.dir).lanes[0].stages[0].state, 'pending');
      assert.deepEqual(snapshot(f.repo), before);
    });
  }
}
for (const invalid of ['directory', 'symlink', 'branch', 'foreign']) {
  test('existing ' + invalid + ' is not an owned lane', (t) => {
    const f = fixture(t);
    const path = worktreePath(f.dir, f.lane);
    mkdirSync(dirname(path), { recursive: true });
    if (invalid === 'directory') mkdirSync(path);
    if (invalid === 'symlink') symlinkSync(f.repo, path);
    if (invalid === 'branch') {
      ensureWorktree(f.repo, f.dir, f.lane, { offline: true });
      git(['checkout', '-qb', 'wrong-branch'], path);
    }
    if (invalid === 'foreign') {
      git(['init', '-qb', 'main', path], f.repo);
    }
    assert.throws(() => ensureWorktree(f.repo, f.dir, f.lane, { offline: true }), /worktree|checkout|branch|repository/i);
  });
}
test('missing lane never resolves to source', (t) => {
  const f = fixture(t);
  assert.throws(() => laneTree(f.dir, f.run, f.lane), /missing|restore/i);
});
test('verify reports the missing checkout', (t) => {
  const f = fixture(t);
  assert.throws(() => verify(f.dir, f.run, findStep(f.run, 'implement')), /missing|restore/i);
});
test('explicit source mode persists across reload and rebrief', (t) => {
  const f = fixture(t);
  assert.equal(cli(f.dir, 'brief', '--stage', 'implement', '--no-worktree').status, 0);
  const run = loadRun(f.dir);
  assert.equal(run.checkout?.mode, 'source');
  assert.equal(laneTree(f.dir, run, run.lanes[0]), f.repo);
  assert.equal(cli(f.dir, 'brief', '--stage', 'implement').status, 0);
  assert.equal(existsSync(worktreePath(f.dir, f.lane)), false);
});
test('source lease excludes a different run root', (t) => {
  const f = fixture(t);
  assert.equal(cli(f.dir, 'brief', '--stage', 'implement', '--no-worktree').status, 0);
  const second = f.make(2);
  const result = cli(second.dir, 'brief', '--stage', 'implement', '--no-worktree');
  assert.equal(result.status, 3, result.stdout + result.stderr);
});
test('source lease excludes overlapping lanes of the same run', (t) => {
  const f = fixture(t);
  assert.equal(cli(f.dir, 'brief', '--stage', 'implement', '--no-worktree').status, 0);
  const run = loadRun(f.dir);
  run.lanes.push({ ...structuredClone(run.lanes[0]), slug: 'other', id: 'other', branch: 'feature/other' });
  saveRun(f.dir, run);
  assert.equal(cli(f.dir, 'brief', '--stage', 'implement', '--lane', 'other', '--no-worktree').status, 3);
});
test('a stale run cannot transfer a lease acquired before dispatch was saved', (t) => {
  const f = fixture(t);
  f.run.lanes.push({ ...structuredClone(f.lane), slug: 'other', id: 'other', branch: 'feature/other' });
  saveRun(f.dir, f.run);
  const stale = loadRun(f.dir);
  prepareCheckout(f.dir, f.run, f.lane, { noWorktree: true });
  assert.throws(() => prepareCheckout(f.dir, stale, stale.lanes[1], { noWorktree: true }), /leased by active lane/);
});
test('start reserves source mode before split and first next claims the selected lane', (t) => {
  const f = fixture(t);
  const repoJson = join(f.root, 'repo.json');
  writeFileSync(repoJson, JSON.stringify({ ...f.run.repo, defaultBranch: 'main' }));
  const issueJson = join(f.root, 'issue.json');
  writeFileSync(issueJson, JSON.stringify({ ...f.run.issue, body: 'fix' }));
  const dir = join(f.root, 'started run');
  const result = cli(dir, 'start', '--issue', '1', '--repo', f.repo,
    '--repo-json', repoJson, '--issue-json', issueJson, '--no-worktree');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const lease = join(f.repo, '.git', 'issueflow-source-lease.json');
  assert.equal(JSON.parse(readFileSync(lease)).lane, null);
  const run = loadRun(dir);
  run.lanes[0].slug = run.lanes[0].id = 'split-lane';
  saveRun(dir, run);
  approvePlan(dir, run);
  const next = cli(dir, 'next');
  assert.equal(next.status, 0, next.stdout + next.stderr);
  assert.equal(JSON.parse(readFileSync(lease)).lane, 'split-lane');
  assert.equal(laneTree(dir, loadRun(dir), run.lanes[0]), f.repo);
});
test('checkout mode cannot change after implementation dispatch', (t) => {
  const f = fixture(t);
  assert.equal(cli(f.dir, 'brief', '--stage', 'implement').status, 0);
  assert.equal(cli(f.dir, 'brief', '--stage', 'implement', '--no-worktree').status, 3);
});
test('deleted dispatched lane blocks next', (t) => {
  const f = fixture(t);
  assert.equal(cli(f.dir, 'brief', '--stage', 'implement').status, 0);
  removeWorktree(f.repo, f.dir, f.lane);
  assert.equal(cli(f.dir, 'next').status, 3);
});

for (const command of ['accept', 'review-brief', 'review-verify', 'review-fix-brief', 'rebase']) {
  test('deleted lane blocks ' + command + ' without inspecting the source checkout', (t) => {
    const f = fixture(t);
    assert.equal(cli(f.dir, 'brief', '--stage', 'implement').status, 0);
    const run = loadRun(f.dir);
    run.lanes[0].pr = { number: 1, url: 'https://example.invalid/pr/1' };
    saveRun(f.dir, run);
    writeFileSync(join(f.dir, 'root', 'implement.md'),
      ['Changed', 'Deviations', 'Command', 'Two-sided', 'Result'].map((s) => '## ' + s + '\n\nfixture\n').join('\n'));
    writeFileSync(join(f.dir, 'root', 'test-output.txt'), GOOD_EVIDENCE);
    removeWorktree(f.repo, f.dir, f.lane);
    const before = snapshot(f.repo);
    const result = cli(f.dir, command, '--lane', 'root', '--stage', 'implement', '--offline');
    assert.equal(result.status, 3, result.stdout + result.stderr);
    assert.match(result.stderr, /missing lane checkout/);
    assert.deepEqual(snapshot(f.repo), before);
  });
}

test('a linked source checkout cannot evade another run lease', (t) => {
  const f = fixture(t);
  assert.equal(cli(f.dir, 'brief', '--stage', 'implement', '--no-worktree').status, 0);
  const other = f.make(2);
  const linked = join(f.root, 'linked source');
  git(['worktree', 'add', '-b', 'linked', linked], f.repo);
  other.run.repo.path = linked;
  saveRun(other.dir, other.run);
  const result = cli(other.dir, 'brief', '--stage', 'implement', '--no-worktree');
  assert.equal(result.status, 3, result.stdout + result.stderr);
});

test('takeover releases only its source lease and preserves archived output', (t) => {
  const f = fixture(t);
  assert.equal(cli(f.dir, 'brief', '--stage', 'implement', '--no-worktree').status, 0);
  const repoJson = join(f.root, 'repo.json');
  writeFileSync(repoJson, JSON.stringify({ ...f.run.repo, defaultBranch: 'main' }));
  const issueJson = join(f.root, 'issue.json');
  writeFileSync(issueJson, JSON.stringify({ ...f.run.issue, body: 'fix' }));
  const result = cli(f.dir, 'start', '--issue', '1', '--repo', f.repo,
    '--repo-json', repoJson, '--issue-json', issueJson, '--take-over');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(existsSync(join(f.repo, '.git', 'issueflow-source-lease.json')), false);
  assert.equal(existsSync(join(f.dir, 'superseded')), true);
});

test('finish releases the source lease after a confirmed merge', (t) => {
  const f = fixture(t);
  assert.equal(cli(f.dir, 'brief', '--stage', 'implement', '--no-worktree').status, 0);
  const run = loadRun(f.dir);
  run.offline = false;
  saveRun(f.dir, run);
  const bin = join(f.root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'gh'), '#!/usr/bin/env node\nconsole.log(JSON.stringify([{number:1,state:"MERGED",url:"https://example.invalid/pr/1",mergedAt:"2026-09-09T00:00:00Z",baseRefName:"main"}]));\n');
  chmodSync(join(bin, 'gh'), 0o755);
  const result = spawnSync(process.execPath, [CLI, 'finish', '--run-dir', f.dir], {
    encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: undefined, PATH: bin + ':' + process.env.PATH },
  });
  // Checkpoint output from the stub is irrelevant to the local merge/cleanup fact.
  assert.ok(loadRun(f.dir).finished, result.stdout + result.stderr);
  assert.equal(existsSync(join(f.repo, '.git', 'issueflow-source-lease.json')), false);
});

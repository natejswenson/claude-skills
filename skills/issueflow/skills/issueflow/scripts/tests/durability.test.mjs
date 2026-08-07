/**
 * The checkpoint, the worktrees, and the promise that offline means offline.
 *
 * These drive real things — a real temporary git repository, a real `gh` on
 * `PATH` — rather than mocks, for the same reason the gate tests do: a mocked
 * remote proves the mock. The one place a stub appears is the offline test,
 * where the stub IS the assertion: a `gh` that records being called, and a run
 * that must never call it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkpoint, marker, renderComment, tipOf } from '../lib/checkpoint.mjs';
import { accept, artifactPath, createRun, findStep, saveRun, worktreePath } from '../lib/run.mjs';
import { ensureWorktree, removeWorktree } from '../lib/worktree.mjs';
import { STAGES } from '../lib/stages.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '..', 'issueflow.js');

const ISSUE = { number: 9, title: 'Checkpoint the run', url: 'https://example.invalid/9', body: 'x' };
const POLICY = { base: 'main', featurePrefix: 'feature/', mergeMethod: 'squash', source: 'test', shipflow: true };

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** A real git repository with one commit — enough for a branch, a worktree and a tip. */
function tempRepo() {
  const path = mkdtempSync(join(tmpdir(), 'issueflow-repo-'));
  git(['init', '-q', '-b', 'main'], path);
  git(['config', 'user.email', 'test@example.invalid'], path);
  git(['config', 'user.name', 'issueflow tests'], path);
  writeFileSync(join(path, 'README.md'), '# fixture\n');
  git(['add', 'README.md'], path);
  git(['commit', '-qm', 'initial'], path);
  return path;
}

function fixture() {
  const repoPath = tempRepo();
  const dir = mkdtempSync(join(tmpdir(), 'issueflow-run-'));
  const repo = { owner: 'acme', name: 'widgets', path: repoPath, defaultBranch: 'main' };
  const run = createRun({ repo, issue: ISSUE, policy: POLICY });
  saveRun(dir, run);
  return {
    dir,
    run,
    repoPath,
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true });
      rmSync(repoPath, { recursive: true, force: true });
    },
  };
}

/** Write an artifact that satisfies the stage's required sections. */
function writeGood(dir, run, stageId, lane = null) {
  const step = findStep(run, stageId, lane);
  const declared = STAGES.find((s) => s.id === stageId);
  mkdirSync(join(artifactPath(dir, step), '..'), { recursive: true });
  writeFileSync(artifactPath(dir, step), declared.requires.map((r) => `## ${r}\n\nreal content for ${r}.\n`).join('\n'));
  return step;
}

// ---------------------------------------------------------------------------
// Offline means offline. Without this, the "checkpoint at every gate" design
// silently puts the network — and its cost, and its flakiness — into CI.
// ---------------------------------------------------------------------------

test('an offline run makes no gh call at all', () => {
  const { dir, run, repoPath, cleanup } = fixture();
  const bin = mkdtempSync(join(tmpdir(), 'issueflow-bin-'));
  const sentinel = join(bin, 'gh-was-called');
  // A `gh` that records being run. If issueflow dials out, this file appears.
  writeFileSync(join(bin, 'gh'), `#!/bin/sh\necho "$@" >> "${sentinel}"\nexit 0\n`);
  chmodSync(join(bin, 'gh'), 0o755);

  run.offline = true;
  saveRun(dir, run);
  writeGood(dir, run, 'investigate');

  execFileSync(process.execPath, [CLI, 'accept', '--stage', 'investigate', '--run-dir', dir], {
    encoding: 'utf8',
    cwd: repoPath,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, NODE_TEST_CONTEXT: undefined },
  });

  assert.equal(existsSync(sentinel), false, `issueflow called gh on an offline run: ${existsSync(sentinel) ? readFileSync(sentinel, 'utf8') : ''}`);
  rmSync(bin, { recursive: true, force: true });
  cleanup();
});

test('a run started from frozen payloads is offline for the rest of its life', () => {
  // The flag is recorded on the run, not on the invocation — so a later
  // `accept --run-dir <x>` with no flags cannot reach the network either.
  const { dir, run, cleanup } = fixture();
  run.offline = true;
  saveRun(dir, run);
  const rows = checkpoint(dir, run, {});
  assert.deepEqual(rows.map((r) => r.state), ['offline']);
  cleanup();
});

// ---------------------------------------------------------------------------
// The sticky comment.
// ---------------------------------------------------------------------------

test('the comment carries the marker that lets another machine adopt it', () => {
  const { dir, run, cleanup } = fixture();
  const body = renderComment(dir, run);
  assert.ok(body.startsWith(marker(run)), 'the marker must be the first thing in the comment');
  assert.match(body, /acme\/widgets#9/);
  cleanup();
});

test('the comment carries every approved artifact, and nothing that is not approved', () => {
  const { dir, run, cleanup } = fixture();
  writeGood(dir, run, 'investigate');
  writeGood(dir, run, 'design'); // written but NEVER approved
  accept(dir, run, findStep(run, 'investigate'));

  const body = renderComment(dir, run);
  assert.match(body, /<details><summary><b>investigate<\/b>/, 'the approved artifact is missing');
  assert.doesNotMatch(body, /<details><summary><b>design<\/b>/, 'an unapproved artifact was published as though it were decided');
  cleanup();
});

test('an oversized artifact is truncated visibly, never silently', () => {
  const { dir, run, cleanup } = fixture();
  const step = findStep(run, 'investigate');
  mkdirSync(join(artifactPath(dir, step), '..'), { recursive: true });
  writeFileSync(artifactPath(dir, step), `## Root cause\n\n## Evidence\n\n## Unknowns\n\n${'x'.repeat(5000)}`);
  accept(dir, run, step);

  const body = renderComment(dir, run, { budget: 200 });
  assert.match(body, /… truncated at 200 characters/);
  assert.ok(body.length < 2000, 'the budget was not applied');
  cleanup();
});

test('a skipped stage appears in the comment as a hole, not as a stage that happened', () => {
  const { dir, run, cleanup } = fixture();
  findStep(run, 'investigate').stage.state = 'skipped';
  findStep(run, 'investigate').stage.skipReason = 'covered by #12';
  const body = renderComment(dir, run);
  assert.match(body, /Skipped — these are holes, not passes/);
  assert.match(body, /covered by #12/);
  cleanup();
});

// ---------------------------------------------------------------------------
// Worktrees — the thing that makes two concurrent lanes safe.
// ---------------------------------------------------------------------------

test('a lane gets its own checkout, on its own branch, outside the user`s tree', () => {
  const { dir, run, repoPath, cleanup } = fixture();
  const lane = run.lanes[0];
  const { path, created } = ensureWorktree(repoPath, dir, lane);

  assert.equal(created, true);
  assert.equal(path, worktreePath(dir, lane));
  assert.ok(!path.startsWith(repoPath), 'the worktree must not live inside the repository being worked on');
  assert.equal(git(['rev-parse', '--abbrev-ref', 'HEAD'], path), lane.branch);
  // and the user's own checkout is untouched, still on its own branch
  assert.equal(git(['rev-parse', '--abbrev-ref', 'HEAD'], repoPath), 'main');
  cleanup();
});

test('provisioning a worktree twice is a no-op, so re-briefing a stage disturbs nothing', () => {
  const { dir, run, repoPath, cleanup } = fixture();
  const lane = run.lanes[0];
  ensureWorktree(repoPath, dir, lane);
  writeFileSync(join(worktreePath(dir, lane), 'work-in-progress.txt'), 'do not lose me\n');

  const second = ensureWorktree(repoPath, dir, lane);
  assert.equal(second.created, false);
  assert.equal(readFileSync(join(worktreePath(dir, lane), 'work-in-progress.txt'), 'utf8'), 'do not lose me\n');
  cleanup();
});

test('a commit made in a lane`s worktree is a commit on the branch the main checkout can see', () => {
  // This is the property the whole design rests on: `ship` still pushes from
  // the repository, so it must be able to see what the lane's worktree did.
  const { dir, run, repoPath, cleanup } = fixture();
  const lane = run.lanes[0];
  const wt = ensureWorktree(repoPath, dir, lane).path;

  writeFileSync(join(wt, 'fix.txt'), 'the change\n');
  git(['add', 'fix.txt'], wt);
  git(['commit', '-qm', 'fix the thing'], wt);

  assert.ok(tipOf(repoPath, lane.branch), 'the branch tip is invisible from the repository');
  assert.equal(git(['rev-list', '--count', `main..${lane.branch}`], repoPath), '1');
  cleanup();
});

test('removing a worktree keeps the branch and its commits', () => {
  const { dir, run, repoPath, cleanup } = fixture();
  const lane = run.lanes[0];
  const wt = ensureWorktree(repoPath, dir, lane).path;
  writeFileSync(join(wt, 'fix.txt'), 'x\n');
  git(['add', 'fix.txt'], wt);
  git(['commit', '-qm', 'work'], wt);
  const tip = tipOf(repoPath, lane.branch);

  removeWorktree(repoPath, dir, lane);
  assert.equal(existsSync(worktreePath(dir, lane)), false);
  assert.equal(tipOf(repoPath, lane.branch), tip, 'removing the checkout must not touch the branch');
  cleanup();
});

test('a lane whose branch has no commits reports nothing to push, not a failure', () => {
  const { dir, run, repoPath, cleanup } = fixture();
  assert.equal(tipOf(repoPath, run.lanes[0].branch), null);
  cleanup();
});

test('a repo path that is not a repository root is refused, never worked around', () => {
  // `git` walks upwards to find a repository, so a run pointed at a
  // subdirectory would create its branch and its worktree in the ENCLOSING
  // repo. The first offline eval run of this feature did exactly that and left
  // a stray `feature/issue-133` branch in claude-skills.
  const { dir, run, repoPath, cleanup } = fixture();
  const inner = join(repoPath, 'nested');
  mkdirSync(inner, { recursive: true });

  assert.throws(
    () => ensureWorktree(inner, dir, run.lanes[0]),
    /not the root of a git repository/,
  );
  // and nothing was created in the enclosing repository
  assert.equal(tipOf(repoPath, run.lanes[0].branch), null);
  cleanup();
});

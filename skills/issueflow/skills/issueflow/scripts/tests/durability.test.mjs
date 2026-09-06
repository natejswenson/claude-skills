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
import { finish, FinishError } from '../lib/finish.mjs';
import { accept, artifactPath, createRun, findStep, saveRun, worktreePath } from '../lib/run.mjs';
import { FetchError, WorktreeError, ensureWorktree, removeWorktree } from '../lib/worktree.mjs';
import { STAGES } from '../lib/stages.mjs';
import { approvePlan, redTeamPass } from './helpers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '..', 'issueflow.js');

const ISSUE = { number: 9, title: 'Checkpoint the run', url: 'https://example.invalid/9', body: 'x' };
const POLICY = { base: 'main', featurePrefix: 'feature/', mergeMethod: 'squash', source: 'test', shipflow: true };

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** The CLI as a child process, for the assertions that are about its exit code. */
const spawnCli = (args) => {
  try {
    return { code: 0, out: execFileSync(process.execPath, [CLI, ...args], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_TEST_CONTEXT: undefined },
    }), err: '' };
  } catch (e) {
    return { code: e.status ?? 1, out: String(e.stdout ?? ''), err: String(e.stderr ?? '') };
  }
};

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
  redTeamPass(dir, run, writeGood(dir, run, 'investigate'));

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
  approvePlan(dir, run);
  writeGood(dir, run, 'implement'); // written but NEVER approved

  const body = renderComment(dir, run);
  assert.match(body, /<details><summary><b>investigate<\/b>/, 'the approved artifact is missing');
  assert.doesNotMatch(body, /<details><summary><b>root\/implement<\/b>/, 'an unapproved artifact was published as though it were decided');
  cleanup();
});

test('an oversized artifact is truncated visibly, never silently', () => {
  const { dir, run, cleanup } = fixture();
  const step = findStep(run, 'investigate');
  const declared = STAGES.find((s) => s.id === 'investigate');
  mkdirSync(join(artifactPath(dir, step), '..'), { recursive: true });
  writeFileSync(artifactPath(dir, step), `${declared.requires.map((r) => `## ${r}\n`).join('\n')}\n${'x'.repeat(5000)}`);
  redTeamPass(dir, run, step);
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

test('a finished run\'s comment carries a Landed table and a finished line; an unfinished one carries neither', () => {
  const { dir, run, cleanup } = fixture();
  const before = renderComment(dir, run);
  assert.doesNotMatch(
    before, /Landed|Finished/,
    'an unfinished run must not grow either section — this is the other half of the frozen checkpoint-comment.md pin',
  );

  run.lanes[0].landed = { pr: 42, url: 'https://example.invalid/pull/42', mergedAt: '2026-08-12T00:00:00Z', at: '2026-08-12T00:00:01Z' };
  run.finished = { at: '2026-08-12T00:00:02Z', issueClosed: true };
  const after = renderComment(dir, run);
  assert.match(after, /#42/);
  assert.match(after, /\*\*Finished\*\*/);
  assert.match(after, /issue closed/);
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

// ---------------------------------------------------------------------------
// The base a lane is cut from (#251). Every test above runs against a repo with
// no `origin` at all, which is exactly the regression floor: an unconditional
// fetch would break all of them. These need a real bare origin instead.
// ---------------------------------------------------------------------------

/**
 * A bare origin, a clone of it, and a second clone that can land work on the
 * base behind the first clone's back — which is what session A merging while
 * session B is still working looks like from inside session B's checkout.
 */
function tempRepoWithOrigin() {
  const home = mkdtempSync(join(tmpdir(), 'issueflow-origin-'));
  const origin = join(home, 'origin.git');
  const seed = join(home, 'seed');
  const path = join(home, 'clone');
  const other = join(home, 'other');

  git(['init', '-q', '--bare', '-b', 'main', origin], home);
  git(['init', '-q', '-b', 'main', seed], home);
  const commit = (cwd, file, message) => {
    writeFileSync(join(cwd, file), `${message}\n`);
    git(['add', file], cwd);
    git(['-c', 'user.email=test@example.invalid', '-c', 'user.name=issueflow tests', 'commit', '-qm', message], cwd);
  };
  commit(seed, 'README.md', 'initial');
  git(['remote', 'add', 'origin', origin], seed);
  git(['push', '-q', '-u', 'origin', 'main'], seed);

  git(['clone', '-q', origin, path], home);
  git(['clone', '-q', origin, other], home);
  return { home, origin, path, other, commit, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

test('a lane is cut from the base as it is NOW, not as this checkout last saw it', () => {
  // Session A's pull request merges into the base; session B starts an hour
  // later. Before 0.8.0 B's branch was cut from whatever `origin/<base>` B's
  // checkout last happened to fetch, so it did not contain A's work.
  const o = tempRepoWithOrigin();
  const dir = mkdtempSync(join(tmpdir(), 'issueflow-run-'));
  const run = createRun({ repo: { owner: 'acme', name: 'widgets', path: o.path, defaultBranch: 'main' }, issue: ISSUE, policy: POLICY });
  const lane = run.lanes[0];

  const stale = git(['rev-parse', 'origin/main'], o.path);
  o.commit(o.other, 'landed.txt', 'session A landed');
  git(['push', '-q', 'origin', 'main'], o.other);
  const current = git(['rev-parse', 'HEAD'], o.other);
  assert.notEqual(current, stale, 'the fixture must actually move origin');

  const wt = ensureWorktree(o.path, dir, lane).path;
  assert.equal(git(['rev-parse', 'HEAD'], wt), current, 'the lane was cut from a stale base');

  rmSync(dir, { recursive: true, force: true });
  o.cleanup();
});

test('a base that was force-pushed still cuts a lane, because the refspec is forced', () => {
  // `dev` is unprotected in this repo's own policy, so a force-push of the base
  // is permitted. An unforced refspec exits 1 with `! [rejected] …
  // (non-fast-forward)`, which — paired with a fatal exit 3 — would hard-block
  // every new lane after one rewind.
  const o = tempRepoWithOrigin();
  const dir = mkdtempSync(join(tmpdir(), 'issueflow-run-'));
  const run = createRun({ repo: { owner: 'acme', name: 'widgets', path: o.path, defaultBranch: 'main' }, issue: ISSUE, policy: POLICY });

  o.commit(o.other, 'a.txt', 'first');
  git(['push', '-q', 'origin', 'main'], o.other);
  git(['reset', '-q', '--hard', 'HEAD~1'], o.other);
  o.commit(o.other, 'b.txt', 'rewritten');
  git(['push', '-q', '--force', 'origin', 'main'], o.other);
  const rewound = git(['rev-parse', 'HEAD'], o.other);

  const wt = ensureWorktree(o.path, dir, run.lanes[0]).path;
  assert.equal(git(['rev-parse', 'HEAD'], wt), rewound, 'a rewound base must still be reachable');

  rmSync(dir, { recursive: true, force: true });
  o.cleanup();
});

test('an offline run cuts its lane without a fetch, even when origin is unreachable', () => {
  // The other half: cases above cannot pass without a real fetch, and this one
  // cannot pass if the fetch fires when the run says it is offline.
  const o = tempRepoWithOrigin();
  const dir = mkdtempSync(join(tmpdir(), 'issueflow-run-'));
  const run = createRun({ repo: { owner: 'acme', name: 'widgets', path: o.path, defaultBranch: 'main' }, issue: ISSUE, policy: POLICY });

  const stale = git(['rev-parse', 'origin/main'], o.path);
  o.commit(o.other, 'landed.txt', 'session A landed');
  git(['push', '-q', 'origin', 'main'], o.other);
  rmSync(o.origin, { recursive: true, force: true });

  const wt = ensureWorktree(o.path, dir, run.lanes[0], { offline: true }).path;
  assert.equal(git(['rev-parse', 'HEAD'], wt), stale, 'an offline lane is cut from what the checkout already had');

  rmSync(dir, { recursive: true, force: true });
  o.cleanup();
});

test('a fetch that fails is a FetchError, and `brief` surfaces it as exit 3 instead of warning past it', () => {
  const o = tempRepoWithOrigin();
  const dir = mkdtempSync(join(tmpdir(), 'issueflow-run-'));
  const run = createRun({ repo: { owner: 'acme', name: 'widgets', path: o.path, defaultBranch: 'main' }, issue: ISSUE, policy: POLICY });
  saveRun(dir, run);
  // `implement` is the stage that gets a checkout, so it is the one whose
  // brief has to stop; opening its gate is what makes the case reachable.
  approvePlan(dir, run);
  mkdirSync(join(dir, 'inputs'), { recursive: true });
  writeFileSync(join(dir, 'inputs', 'issue.json'), `${JSON.stringify(ISSUE, null, 2)}\n`);
  rmSync(o.origin, { recursive: true, force: true });

  let err = null;
  try {
    ensureWorktree(o.path, dir, run.lanes[0]);
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof FetchError, `expected a FetchError, got ${err}`);
  assert.match(String(err.message), /must not be cut from a stale base/);
  assert.equal(err instanceof WorktreeError, true, 'a FetchError is still a WorktreeError, so `next` still classifies it');

  // And the caller stops rather than warning past it. Every OTHER
  // `WorktreeError` is survivable — the stage can run in the repository — but
  // a stage briefed after a failed fetch would work on a stale base.
  const brief = spawnCli(['brief', '--stage', 'implement', '--run-dir', dir]);
  assert.equal(brief.code, 3, `expected infrastructure exit 3, got ${brief.code}: ${brief.err}`);
  assert.match(brief.err, /stale base/);

  rmSync(dir, { recursive: true, force: true });
  o.cleanup();
});

// ---------------------------------------------------------------------------
// finish — the run's terminal state (#219). A lane whose pull request GitHub
// confirms MERGED gets its worktree removed and its branch deleted; a lane
// whose pull request is not a confirmed merge is left completely alone. This
// is `accept`'s drift refusal with the polarity inverted, so it is tested the
// same two-sided way: one half proves the destructive path runs, the other
// proves it is the ONLY path in.
// ---------------------------------------------------------------------------

/**
 * A `gh` that answers from a small table instead of the network: `pr list
 * --head <branch>` returns `prsByBranch[branch]`, `issue view` returns
 * `issue`, and `issue close` appends its own arguments to `closeLog` when one
 * is given. The offline test above stubs a `gh` that records being called;
 * `finish` needs one that answers, so this extends that shape rather than
 * duplicating it.
 */
function stubGh(bin, { prsByBranch = {}, issue = { state: 'OPEN' }, closeLog = null } = {}) {
  const table = join(bin, 'gh-table.json');
  writeFileSync(table, JSON.stringify({ prsByBranch, issue }));
  const script = [
    '#!/usr/bin/env node',
    "const { readFileSync, appendFileSync } = require('node:fs');",
    `const table = JSON.parse(readFileSync(${JSON.stringify(table)}, 'utf8'));`,
    'const args = process.argv.slice(2);',
    "if (args[0] === 'pr' && args[1] === 'list') {",
    "  const branch = args[args.indexOf('--head') + 1];",
    '  console.log(JSON.stringify(table.prsByBranch[branch] ?? []));',
    "} else if (args[0] === 'issue' && args[1] === 'view') {",
    '  console.log(JSON.stringify(table.issue));',
    "} else if (args[0] === 'issue' && args[1] === 'close') {",
    closeLog ? `  appendFileSync(${JSON.stringify(closeLog)}, args.join(' ') + '\\n');` : '',
    '} else {',
    '  process.exit(1);',
    '}',
  ].filter(Boolean).join('\n');
  writeFileSync(join(bin, 'gh'), script);
  chmodSync(join(bin, 'gh'), 0o755);
}

/** Run `fn` with `bin` in front of `PATH`, so `finish`'s own `gh`/`git` calls find the stub. Restores PATH after. */
function withGh(bin, fn) {
  const original = process.env.PATH;
  process.env.PATH = `${bin}:${original}`;
  try {
    return fn();
  } finally {
    process.env.PATH = original;
  }
}

/** A lane object shaped like `split()` produces, without going through the gate `finish` does not care about. */
const laneFor = (slug, branch, base) => ({ id: slug, slug, title: slug, branch, base });

test('a lane whose pull request GitHub reports MERGED is finished: worktree gone, branch gone, landing recorded', () => {
  const { dir, run, repoPath, cleanup } = fixture();
  const l = run.lanes[0];
  git(['branch', l.branch, 'main'], repoPath);
  const wt = ensureWorktree(repoPath, dir, l).path;

  const bin = mkdtempSync(join(tmpdir(), 'issueflow-bin-'));
  stubGh(bin, {
    prsByBranch: {
      [l.branch]: [{ number: 42, state: 'MERGED', url: 'https://example.invalid/pull/42', mergedAt: '2026-08-12T00:00:00Z', baseRefName: 'main' }],
    },
  });

  const result = withGh(bin, () => finish(dir, run, {}));
  assert.deepEqual(result.rows, [{ lane: l.slug, state: 'landed', detail: '#42' }]);
  assert.equal(existsSync(wt), false, 'the worktree must be gone');
  assert.throws(() => git(['rev-parse', '--verify', `refs/heads/${l.branch}`], repoPath), 'the local branch must be gone');
  assert.equal(l.landed.pr, 42);
  assert.ok(run.finished, 'the only lane landed, so the run is over');

  rmSync(bin, { recursive: true, force: true });
  cleanup();
});

test('a lane whose pull request is still OPEN is not touched at all — the mirror of accept\'s drift refusal', () => {
  const { dir, run, repoPath, cleanup } = fixture();
  const l = run.lanes[0];
  git(['branch', l.branch, 'main'], repoPath);
  const wt = ensureWorktree(repoPath, dir, l).path;

  const bin = mkdtempSync(join(tmpdir(), 'issueflow-bin-'));
  stubGh(bin, {
    prsByBranch: { [l.branch]: [{ number: 7, state: 'OPEN', url: 'https://example.invalid/pull/7', baseRefName: 'main' }] },
  });

  withGh(bin, () => {
    assert.throws(() => finish(dir, run, {}), (err) => {
      assert.ok(err instanceof FinishError);
      assert.deepEqual(err.rows, [{ lane: l.slug, state: 'open', detail: '#7 is still open — left untouched' }]);
      return true;
    });
  });

  assert.equal(existsSync(wt), true, 'the worktree must survive an open pull request');
  assert.ok(git(['rev-parse', '--verify', `refs/heads/${l.branch}`], repoPath), 'the branch must survive');
  assert.ok(!l.landed, 'left untouched');
  assert.ok(!run.finished);

  rmSync(bin, { recursive: true, force: true });
  cleanup();
});

test('a lane with no pull request at all is reported as never shipped, and a gh that fails is reported as unknown — neither is treated as merged', () => {
  const { dir, run, repoPath, cleanup } = fixture();
  const l = run.lanes[0];
  git(['branch', l.branch, 'main'], repoPath);

  const bin = mkdtempSync(join(tmpdir(), 'issueflow-bin-'));
  stubGh(bin, { prsByBranch: {} }); // no entry for this branch at all
  withGh(bin, () => {
    assert.throws(() => finish(dir, run, {}), (err) => {
      assert.equal(err.rows[0].state, 'none');
      return true;
    });
  });
  assert.ok(!l.landed);

  writeFileSync(join(bin, 'gh'), '#!/bin/sh\nexit 1\n');
  chmodSync(join(bin, 'gh'), 0o755);
  withGh(bin, () => {
    assert.throws(() => finish(dir, run, {}), (err) => {
      assert.equal(err.rows[0].state, 'unknown');
      return true;
    });
  });
  assert.ok(!l.landed, 'a gh failure must never be read as a merge');

  rmSync(bin, { recursive: true, force: true });
  cleanup();
});

test('a partially-landed split run finishes the merged lane, leaves the open one intact, and completes when finish runs again', () => {
  const { dir, run, repoPath, cleanup } = fixture();
  const first = laneFor('first', 'feature/first', 'main');
  const second = laneFor('second', 'feature/second', 'feature/first');
  run.lanes = [first, second];
  saveRun(dir, run);
  git(['branch', first.branch, 'main'], repoPath);
  git(['branch', second.branch, first.branch], repoPath);

  const bin = mkdtempSync(join(tmpdir(), 'issueflow-bin-'));
  stubGh(bin, {
    prsByBranch: {
      [first.branch]: [{ number: 1, state: 'MERGED', url: 'https://example.invalid/pull/1', mergedAt: '2026-08-12T00:00:00Z', baseRefName: 'main' }],
      [second.branch]: [{ number: 2, state: 'OPEN', url: 'https://example.invalid/pull/2', baseRefName: 'feature/first' }],
    },
  });

  const firstPass = withGh(bin, () => finish(dir, run, {}));
  assert.deepEqual(firstPass.rows.map((r) => r.state), ['landed', 'open']);
  assert.ok(first.landed);
  assert.ok(!second.landed);
  assert.ok(!run.finished, 'the split run is not over — one lane is still open');

  // The second lane merges. Running finish again completes the run without
  // redoing the first lane's work.
  stubGh(bin, {
    prsByBranch: {
      [first.branch]: [{ number: 1, state: 'MERGED', url: 'https://example.invalid/pull/1', mergedAt: '2026-08-12T00:00:00Z', baseRefName: 'main' }],
      [second.branch]: [{ number: 2, state: 'MERGED', url: 'https://example.invalid/pull/2', mergedAt: '2026-08-12T01:00:00Z', baseRefName: 'feature/first' }],
    },
  });
  const secondPass = withGh(bin, () => finish(dir, run, {}));
  assert.deepEqual(secondPass.rows.map((r) => r.state), ['already landed', 'landed']);
  assert.ok(second.landed);
  assert.ok(run.finished, 'every lane has now landed');

  rmSync(bin, { recursive: true, force: true });
  cleanup();
});

test('--close-issue closes an open issue and reports an already-closed one as already closed, never claiming an action it did not take', () => {
  const { dir, run, repoPath, cleanup } = fixture();
  const l = run.lanes[0];
  git(['branch', l.branch, 'main'], repoPath);

  const bin = mkdtempSync(join(tmpdir(), 'issueflow-bin-'));
  const closeLog = join(bin, 'close-log.txt');
  stubGh(bin, {
    prsByBranch: { [l.branch]: [{ number: 3, state: 'MERGED', url: 'https://example.invalid/pull/3', mergedAt: '2026-08-12T00:00:00Z', baseRefName: 'main' }] },
    issue: { state: 'OPEN' },
    closeLog,
  });
  withGh(bin, () => finish(dir, run, { closeIssueFlag: true }));
  assert.equal(run.finished.issueClosed, true);
  assert.ok(existsSync(closeLog), '`gh issue close` must have been called for an open issue');
  rmSync(bin, { recursive: true, force: true });
  cleanup();
});

test('a second --close-issue over an already-closed issue reports it as already closed and never calls gh issue close again', () => {
  const { dir, run, repoPath, cleanup } = fixture();
  const l = run.lanes[0];
  git(['branch', l.branch, 'main'], repoPath);

  const bin = mkdtempSync(join(tmpdir(), 'issueflow-bin-'));
  const closeLog = join(bin, 'close-log.txt');
  stubGh(bin, {
    prsByBranch: { [l.branch]: [{ number: 4, state: 'MERGED', url: 'https://example.invalid/pull/4', mergedAt: '2026-08-12T00:00:00Z', baseRefName: 'main' }] },
    issue: { state: 'CLOSED' },
    closeLog,
  });
  const result = withGh(bin, () => finish(dir, run, { closeIssueFlag: true }));
  assert.ok(result.rows.some((r) => r.detail === 'already closed'));
  assert.equal(existsSync(closeLog), false, 'an already-closed issue must not be closed again');
  rmSync(bin, { recursive: true, force: true });
  cleanup();
});

test('an offline run refuses to finish, on the flag and on the run — a network question with no way to answer it honestly offline', () => {
  const { dir, run, cleanup } = fixture();
  assert.throws(() => finish(dir, run, { offline: true }), /cannot verify a merge/);
  run.offline = true;
  assert.throws(() => finish(dir, run, {}), /cannot verify a merge/);
  cleanup();
});

test('a run that never provisioned a worktree finishes cleanly — the --no-worktree case', () => {
  const { dir, run, repoPath, cleanup } = fixture();
  const l = run.lanes[0];
  git(['branch', l.branch, 'main'], repoPath);
  // no ensureWorktree call here — nothing was ever provisioned to remove

  const bin = mkdtempSync(join(tmpdir(), 'issueflow-bin-'));
  stubGh(bin, {
    prsByBranch: { [l.branch]: [{ number: 5, state: 'MERGED', url: 'https://example.invalid/pull/5', mergedAt: '2026-08-12T00:00:00Z', baseRefName: 'main' }] },
  });
  const result = withGh(bin, () => finish(dir, run, {}));
  assert.equal(result.rows[0].state, 'landed');
  assert.equal(l.landed.pr, 5);

  rmSync(bin, { recursive: true, force: true });
  cleanup();
});

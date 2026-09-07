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
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FINISHED_MARKER, checkpoint, claimedIn, marker, renderComment, tipOf } from '../lib/checkpoint.mjs';
import { finish, FinishError } from '../lib/finish.mjs';
import { accept, artifactPath, createRun, findStep, loadRun, saveRun, split, worktreePath } from '../lib/run.mjs';
import { FetchError, WorktreeError, ensureWorktree, originConfigured, removeWorktree } from '../lib/worktree.mjs';
import { STAGES } from '../lib/stages.mjs';
import { approveImplement, approvePlan, redTeamPass } from './helpers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '..', 'issueflow.js');

const ISSUE = { number: 9, title: 'Checkpoint the run', url: 'https://example.invalid/9', body: 'x' };
const POLICY = { base: 'main', featurePrefix: 'feature/', mergeMethod: 'squash', source: 'test', shipflow: true };

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** The CLI as a child process, for the assertions that are about its exit code. */
const spawnCli = (args, extraEnv = {}) => {
  try {
    return { code: 0, out: execFileSync(process.execPath, [CLI, ...args], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_TEST_CONTEXT: undefined, ...extraEnv },
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

  // The unfinished comment is a LIVE claim, and must read as one. This is the
  // green half of the pair below: without it the consumer assertion could pass
  // by `claimedIn` having stopped matching anything at all.
  const asComment = (body) => [{ body, url: 'https://example.invalid/c#issuecomment-5' }];
  const who = [run.repo.owner, run.repo.name, run.issue.number];
  assert.ok(claimedIn(asComment(before), ...who), 'a live run\'s own comment must read as a claim');

  run.lanes[0].landed = { pr: 42, url: 'https://example.invalid/pull/42', mergedAt: '2026-08-12T00:00:00Z', at: '2026-08-12T00:00:01Z' };
  run.finished = { at: '2026-08-12T00:00:02Z', issueClosed: true };
  const after = renderComment(dir, run);
  assert.match(after, /#42/);
  assert.match(after, /issue closed/);
  // Anchored to the marker, not just to the prose beside it. `claimedIn` and
  // `adoptComment` both decide a run is over by finding `FINISHED_MARKER` on
  // its own line; asserting only on `**Finished**` lets the marker be dropped
  // as noise with every test still green, and the finished exemption then
  // silently stops working in production.
  assert.match(
    after,
    new RegExp(`^${FINISHED_MARKER.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')} \\*\\*Finished\\*\\*`, 'm'),
    'the marker its own consumers key on must actually be emitted, on its own line',
  );
  // And the consumer, driven on the real rendered body rather than one the
  // test builds by hand: this is the only assertion that fails if the producer
  // and the consumer ever stop agreeing on the spelling.
  assert.equal(claimedIn(asComment(after), ...who), null, 'a finished run\'s comment must not read as a live claim');
  cleanup();
});

test('an artifact that merely quotes the finished marker does not hide a live run\'s claim', () => {
  // `renderComment` splices approved artifacts into the same comment body,
  // verbatim. Working issueflow on its own repository is the concrete case:
  // the plan for #251 quotes `<!-- issueflow:finished -->` while describing
  // this design. A substring search anywhere in the body would read that live
  // run's own comment as a dead one, `board` would print `—` for a claimed
  // issue, and a second session's `start` would republish over it.
  const { dir, run, cleanup } = fixture();
  const step = findStep(run, 'investigate');
  mkdirSync(join(dir, 'shared'), { recursive: true });
  writeFileSync(
    artifactPath(dir, step),
    STAGES.find((s) => s.id === 'investigate').requires.map((r) => `## ${r}\n\nthe run publishes ${FINISHED_MARKER} when it ends.\n`).join('\n'),
  );
  redTeamPass(dir, run, step);
  accept(dir, run, step);

  const body = renderComment(dir, run);
  assert.ok(body.includes(FINISHED_MARKER), 'the fixture must actually carry the marker inside the artifact');
  assert.ok(
    claimedIn([{ body, url: 'https://example.invalid/c#issuecomment-6' }], run.repo.owner, run.repo.name, run.issue.number),
    'a live run whose artifact quotes the marker still holds the issue',
  );
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
  // `o.path` — the clone `ensureWorktree` will actually fetch into — must see
  // commit A before it is rewound, or the fetch below is a plain fast-forward
  // (this fixture's own clone never having seen A) and passes byte-for-byte
  // with the `+` dropped from the refspec, which is exactly the gap f-e877ef1a
  // found: measured by rebuilding this fixture with an unforced refspec and
  // watching it fetch A -> B clean, because `o.path` had never fetched A.
  git(['fetch', 'origin', 'main'], o.path);
  const seen = git(['rev-parse', 'origin/main'], o.path);

  git(['reset', '-q', '--hard', 'HEAD~1'], o.other);
  o.commit(o.other, 'b.txt', 'rewritten');
  git(['push', '-q', '--force', 'origin', 'main'], o.other);
  const rewound = git(['rev-parse', 'HEAD'], o.other);
  assert.notEqual(seen, rewound, 'the fixture must actually rewrite history away from what the clone already saw');

  const wt = ensureWorktree(o.path, dir, run.lanes[0]).path;
  assert.equal(git(['rev-parse', 'HEAD'], wt), rewound, 'a rewound base must still be reachable');

  rmSync(dir, { recursive: true, force: true });
  o.cleanup();
});

test('the fetch refspec is explicit, because a single-branch clone`s default fetch spec does not cover every base', () => {
  // `tempRepoWithOrigin`'s plain `git clone` already covers every branch via
  // its default `+refs/heads/*:refs/remotes/origin/*`, so a bare `git fetch
  // origin <base>` would still update `refs/remotes/origin/<base>` there and
  // every other fetch test in this file would stay green with the explicit
  // half of the refspec dropped — f-dc008f9c found exactly that gap. A
  // `--single-branch` clone (the shape CI runners' shallow clones have) is
  // the one fixture where a bare fetch answers exit 0 while leaving
  // `refs/remotes/origin/<base>` absent, because its `remote.origin.fetch`
  // covers only the branch it was cloned for.
  const home = mkdtempSync(join(tmpdir(), 'issueflow-repo-'));
  const origin = join(home, 'origin.git');
  const seed = join(home, 'seed');
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
  git(['checkout', '-q', '-b', 'dev'], seed);
  commit(seed, 'dev.txt', 'dev work');
  git(['push', '-q', 'origin', 'dev'], seed);

  const path = join(home, 'clone');
  git(['clone', '-q', '--single-branch', '--branch', 'main', origin, path], home);
  let sawDev = true;
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/dev'], { cwd: path, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    sawDev = false;
  }
  assert.equal(sawDev, false, 'the fixture must actually be a single-branch clone that has never heard of `dev`');

  const dir = mkdtempSync(join(tmpdir(), 'issueflow-run-'));
  const run = createRun({
    repo: { owner: 'acme', name: 'widgets', path, defaultBranch: 'main' },
    issue: ISSUE,
    policy: { ...POLICY, base: 'dev' },
  });

  const wt = ensureWorktree(path, dir, run.lanes[0]).path;
  assert.equal(
    git(['rev-parse', 'HEAD'], wt),
    git(['rev-parse', 'dev'], seed),
    'a single-branch clone must still see the base — the explicit half of the refspec is what makes that so',
  );

  rmSync(dir, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
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

test('the benign-fetch-failure check is not fooled by a git that localizes "couldn\'t find remote ref" (fetchBase pins LC_ALL=C)', () => {
  // git ships gettext catalogs and can translate this exact message. Without
  // pinning the locale on the fetch, a base that exists only locally —
  // resolvePolicy's own documented case, the one this benign-failure branch
  // exists for — turns into a hard FetchError on any machine whose LANG/
  // LC_ALL triggers translation (f-ad1c9a15). This drives a stub `git` that
  // answers the fetch however ITS OWN env says to, so the assertion is
  // deterministic and does not depend on a French locale actually being
  // installed on the machine running this test.
  const o = tempRepoWithOrigin();
  git(['branch', 'onlylocal'], o.path);
  const local = git(['rev-parse', 'onlylocal'], o.path);

  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  const bin = mkdtempSync(join(tmpdir(), 'issueflow-git-locale-'));
  const script = [
    '#!/usr/bin/env node',
    "const { spawnSync } = require('node:child_process');",
    `const REAL_GIT = ${JSON.stringify(realGit)};`,
    'const args = process.argv.slice(2);',
    "if (args[0] === 'fetch' && args[1] === 'origin' && String(args[2] ?? '').includes('onlylocal')) {",
    "  if (process.env.LC_ALL === 'C') {",
    "    process.stderr.write(\"fatal: couldn't find remote ref onlylocal\\n\");",
    '  } else {',
    "    // What a French git actually prints for this failure — never matched",
    '    // by the English-only regex, which is exactly the bug this drives.',
    "    process.stderr.write(\"fatal: la référence distante « onlylocal » est introuvable\\n\");",
    '  }',
    '  process.exit(1);',
    '}',
    'const r = spawnSync(REAL_GIT, args, { cwd: process.cwd(), stdio: "inherit" });',
    'process.exit(r.status ?? 1);',
  ].join('\n');
  writeFileSync(join(bin, 'git'), script);
  chmodSync(join(bin, 'git'), 0o755);

  const dir = mkdtempSync(join(tmpdir(), 'issueflow-run-'));
  const run = createRun({ repo: { owner: 'acme', name: 'widgets', path: o.path, defaultBranch: 'main' }, issue: ISSUE, policy: { ...POLICY, base: 'onlylocal' } });
  saveRun(dir, run);
  approvePlan(dir, run);
  mkdirSync(join(dir, 'inputs'), { recursive: true });
  writeFileSync(join(dir, 'inputs', 'issue.json'), `${JSON.stringify(ISSUE, null, 2)}\n`);

  const brief = spawnCli(['brief', '--stage', 'implement', '--run-dir', dir], { PATH: `${bin}:${process.env.PATH}` });
  assert.equal(brief.code, 0, `a base that exists only locally must still provision cleanly under a localizing git, got ${brief.code}: ${brief.err}`);

  const wt = worktreePath(dir, run.lanes[0]);
  assert.equal(git(['rev-parse', 'HEAD'], wt), local, 'the lane must be cut from the local-only base, not fail on a false-fatal fetch');

  rmSync(dir, { recursive: true, force: true });
  rmSync(bin, { recursive: true, force: true });
  o.cleanup();
});

test('a stacked lane whose base is a sibling lane\'s local-only branch is still cut from it, even though the fetch fires and finds nothing there', () => {
  // `split` gives a later lane a base that lives only locally until that lane
  // is pushed. Unaware of the sibling (no `lanes` passed), `stacked` reads
  // false and the fetch still fires — but origin has genuinely never heard of
  // `feature/issue-9-a`, which is the same shape `resolvePolicy` can hand back
  // for a declared-but-never-pushed SHARED base too (f-d1d5b257). Before that
  // fix this was a FetchError — a hard stop — where the pre-fetch code cut the
  // lane from the local branch just fine; the fix is what makes it do that
  // again instead of failing.
  const o = tempRepoWithOrigin();
  const dir = mkdtempSync(join(tmpdir(), 'issueflow-run-'));
  const run = createRun({ repo: { owner: 'acme', name: 'widgets', path: o.path, defaultBranch: 'main' }, issue: ISSUE, policy: POLICY });
  const laneA = { ...run.lanes[0], slug: 'a', branch: 'feature/issue-9-a' };
  const laneB = { ...run.lanes[0], slug: 'b', branch: 'feature/issue-9-b', base: laneA.branch };
  git(['branch', laneA.branch], o.path);

  const wt = ensureWorktree(o.path, dir, laneB).path;
  assert.equal(
    git(['rev-parse', 'HEAD'], wt),
    git(['rev-parse', laneA.branch], o.path),
    'still cut from the sibling branch even though the fetch was attempted and found nothing',
  );

  rmSync(dir, { recursive: true, force: true });
  o.cleanup();
});

test('a stacked lane whose base is a sibling lane\'s local-only branch skips the fetch entirely when the sibling list says so', () => {
  // The optimization proper. Told which lanes are siblings, `ensureWorktree`
  // never attempts the fetch at all — proved by deleting origin outright,
  // which a real fetch attempt reports as a hard FetchError (unreachable),
  // never the benign "no such ref" the test above tolerates. If the stacked
  // check stopped skipping the fetch, this test would fail on the deleted
  // origin rather than on a wrong tip.
  const o = tempRepoWithOrigin();
  const dir = mkdtempSync(join(tmpdir(), 'issueflow-run-'));
  const run = createRun({ repo: { owner: 'acme', name: 'widgets', path: o.path, defaultBranch: 'main' }, issue: ISSUE, policy: POLICY });
  const laneA = { ...run.lanes[0], slug: 'a', branch: 'feature/issue-9-a' };
  const laneB = { ...run.lanes[0], slug: 'b', branch: 'feature/issue-9-b', base: laneA.branch };
  git(['branch', laneA.branch], o.path);
  rmSync(o.origin, { recursive: true, force: true });

  const wt = ensureWorktree(o.path, dir, laneB, { lanes: [laneA, laneB] }).path;
  assert.equal(
    git(['rev-parse', 'HEAD'], wt),
    git(['rev-parse', laneA.branch], o.path),
    'still cut from the sibling branch, with origin gone and no fetch attempted at all',
  );

  rmSync(dir, { recursive: true, force: true });
  o.cleanup();
});

test('originConfigured tells "no origin" apart from a git failure — only the first is silently false', () => {
  const withOrigin = tempRepoWithOrigin();
  assert.equal(originConfigured(withOrigin.path), true);
  withOrigin.cleanup();

  // `git init` only, no remote added — the one legitimate false case.
  const bare = tempRepo();
  assert.equal(originConfigured(bare), false);
  rmSync(bare, { recursive: true, force: true });

  // Not a git repository at all: `git remote` fails outright, and that must
  // not be read as "no origin" and silently skipped — it is the exact
  // stale-base defect the fetch exists to prevent, made invisible instead of
  // fatal.
  const notARepo = mkdtempSync(join(tmpdir(), 'issueflow-not-a-repo-'));
  let err = null;
  try {
    originConfigured(notARepo);
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof WorktreeError, 'a git failure must surface, not read as "no origin"');
  // And it must surface as the FATAL kind. `briefOne` re-throws a `FetchError`
  // and swallows every other `WorktreeError` into a warning that briefs the
  // stage against the user's LIVE checkout — so a transient `git remote`
  // failure (two parallel sessions contending for `.git/config.lock`, EMFILE)
  // classified as survivable silently drops a lane out of its own worktree,
  // which is the hazard the worktree exists to remove.
  assert.ok(err instanceof FetchError, `not knowing whether there is an origin is not knowing whether the base is stale; got ${err?.constructor?.name}`);
  rmSync(notARepo, { recursive: true, force: true });
});

test('`brief` provisions a stacked lane over a repo that HAS an origin — the production call, not the library one', () => {
  // The library skips the fetch for a stacked lane only when it is handed the
  // run's sibling lanes. `briefOne` is the only production caller, so a test
  // that passes `lanes` in by hand proves nothing about whether a split run
  // works: every one of them hard-stopped at exit 3 on its second lane with
  // that test green. This drives the CLI, which is what a split run runs.
  const o = tempRepoWithOrigin();
  // Nested one level below the temp root on purpose: this is the only case here
  // that APPROVES an implement stage, and `readTimings` reads every sibling of a
  // run directory for past stage durations. A run directory sitting directly in
  // the temp root is a sibling of every other test's, including the frozen
  // baseline replay, whose golden says "no past timings on this repo".
  const dir = join(mkdtempSync(join(tmpdir(), 'issueflow-stacked-')), 'run');
  mkdirSync(dir, { recursive: true });
  const run = createRun({ repo: { owner: 'acme', name: 'widgets', path: o.path, defaultBranch: 'main' }, issue: ISSUE, policy: POLICY });
  saveRun(dir, run);
  approvePlan(dir, run);
  split(dir, run, [{ title: 'the first half', slug: 'a' }, { title: 'the second half', slug: 'b' }]);
  mkdirSync(join(dir, 'inputs'), { recursive: true });
  writeFileSync(join(dir, 'inputs', 'issue.json'), `${JSON.stringify(ISSUE, null, 2)}\n`);

  // Lane a first, because lane b's base IS lane a's branch and nothing creates
  // it until lane a is provisioned. Its base is the repo's own, so it fetches.
  const a = spawnCli(['brief', '--stage', 'implement', '--lane', 'a', '--run-dir', dir]);
  assert.equal(a.code, 0, `lane a must brief, got ${a.code}: ${a.err}`);
  // Lane b's gate is lane a's approved implement — the same order a real split
  // run walks, and the reason lane b is where every split run stopped.
  const briefed = loadRun(dir);
  approveImplement(dir, briefed, 'a');

  const b = spawnCli(['brief', '--stage', 'implement', '--lane', 'b', '--run-dir', dir]);
  assert.equal(b.code, 0, `lane b must brief, got ${b.code}: ${b.err}`);
  assert.doesNotMatch(b.err, /could not fetch/, 'a stacked lane must not fetch a branch origin has never had');
  assert.equal(
    git(['rev-parse', 'HEAD'], worktreePath(dir, run.lanes[1])),
    git(['rev-parse', run.lanes[0].branch], o.path),
    'the stacked lane is still cut from the sibling branch below it',
  );

  rmSync(dirname(dir), { recursive: true, force: true });
  o.cleanup();
});

test('a WorktreeError that is not a FetchError still warns and `brief` continues — the survivable half of the fatal split', () => {
  // The mirror of the FetchError case above: `repoPath` pointed at a
  // subdirectory of a real repo is refused by `ensureWorktree`'s own
  // toplevel check, which is a WorktreeError but never a FetchError.
  const repoPath = tempRepo();
  const sub = join(repoPath, 'subdir');
  mkdirSync(sub);
  const dir = mkdtempSync(join(tmpdir(), 'issueflow-run-'));
  const run = createRun({ repo: { owner: 'acme', name: 'widgets', path: sub, defaultBranch: 'main' }, issue: ISSUE, policy: POLICY });
  saveRun(dir, run);
  approvePlan(dir, run);
  mkdirSync(join(dir, 'inputs'), { recursive: true });
  writeFileSync(join(dir, 'inputs', 'issue.json'), `${JSON.stringify(ISSUE, null, 2)}\n`);

  let err = null;
  try {
    ensureWorktree(sub, dir, run.lanes[0]);
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof WorktreeError, `expected a WorktreeError, got ${err}`);
  assert.equal(err instanceof FetchError, false, 'this must be the survivable kind, not the fatal one');

  // `spawnCli`/`spawnSync` above discard stderr on a 0 exit — this is the one
  // case that needs it captured either way, so it runs the child directly.
  const brief = spawnSync(process.execPath, [CLI, 'brief', '--stage', 'implement', '--run-dir', dir], {
    encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: undefined },
  });
  assert.equal(brief.status, 0, `a non-fetch WorktreeError must warn and continue, got ${brief.status}: ${brief.stderr}`);
  assert.match(brief.stderr, /no worktree for root/);
  assert.match(brief.stderr, /the stage will work in the repository itself/);

  rmSync(dir, { recursive: true, force: true });
  rmSync(repoPath, { recursive: true, force: true });
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

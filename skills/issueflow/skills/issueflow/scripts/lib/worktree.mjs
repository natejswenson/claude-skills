/**
 * A checkout per lane, so two lanes can be worked at once.
 *
 * Two things forced this. The first is concurrency: once the dependency graph
 * lets lane 2's implement run alongside lane 1's test, two subagents are editing
 * at the same time, and one working tree between them is a corrupted change with
 * no way to tell whose.
 *
 * The second is that the single tree was already the wrong place even serially.
 * The test stage is required to prove its test two-sided, and on the run this
 * was measured against it did so by reverting the fix **in the user's live
 * checkout**, running the suite red, and restoring it — in a repo whose own
 * CLAUDE.md warns that parallel sessions hold uncommitted work in that tree. It
 * worked. It was one interrupted command away from not working.
 *
 * Worktrees share the repository's object store and refs, so a commit made in a
 * lane's worktree is immediately visible to `git` run from the main checkout —
 * which is why `ship` still pushes from there and needs no change.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { worktreePath } from './run.mjs';

export class WorktreeError extends Error {}

const real = (path) => {
  try {
    return realpathSync(resolve(path));
  } catch {
    return resolve(path);
  }
};

const git = (args, cwd) => {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    throw new WorktreeError(
      String(err.stderr ?? err.message ?? '').trim().split('\n').filter(Boolean).pop() ?? `git ${args[0]} failed`,
    );
  }
};

const exists = (repoPath, ref) => {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', ref], { cwd: repoPath, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

/**
 * Where a lane's branch should be created from.
 *
 * A stacked lane starts at the branch below it, which exists only locally until
 * that lane is pushed. An unstacked lane starts at the remote's copy of the base
 * when there is one — starting from a stale local `dev` is how a change gets
 * built on last week's tree.
 */
function startPoint(repoPath, lane) {
  if (exists(repoPath, `refs/heads/${lane.base}`) && exists(repoPath, `refs/remotes/origin/${lane.base}`)) {
    // Both exist: prefer the remote, which is the branch everyone else sees.
    return `origin/${lane.base}`;
  }
  if (exists(repoPath, `refs/remotes/origin/${lane.base}`)) return `origin/${lane.base}`;
  if (exists(repoPath, `refs/heads/${lane.base}`)) return lane.base;
  throw new WorktreeError(`base branch ${lane.base} exists neither locally nor on origin`);
}

/**
 * The lane's own checkout, created if it is not there yet.
 *
 * Idempotent: a second call on an existing worktree returns it untouched, which
 * is what lets `brief` be re-run on a stage without disturbing work in progress.
 *
 * Refuses when `repoPath` is not the root of its own repository. `git` walks
 * upwards to find one, so a run pointed at a subdirectory — or at a fixture
 * directory that happens to sit inside a checkout — creates a branch and a
 * worktree in the enclosing repo instead. That is not theoretical: the first
 * offline eval run of this feature created a stray `feature/issue-133` branch
 * in this very repository, because its fixture repo lives under `evals/`.
 */
export function ensureWorktree(repoPath, dir, lane) {
  const path = worktreePath(dir, lane);
  if (existsSync(path)) return { path, created: false };

  // Compared through `realpath`: on macOS a temporary directory is handed out
  // as `/var/folders/…` and reported by git as `/private/var/folders/…`, and a
  // string comparison would call every such repo a subdirectory of itself.
  const top = git(['rev-parse', '--show-toplevel'], repoPath);
  if (real(top) !== real(repoPath)) {
    throw new WorktreeError(`${repoPath} is not the root of a git repository (that is ${top})`);
  }

  mkdirSync(dirname(path), { recursive: true });
  if (exists(repoPath, `refs/heads/${lane.branch}`)) {
    git(['worktree', 'add', path, lane.branch], repoPath);
  } else {
    git(['worktree', 'add', '-b', lane.branch, path, startPoint(repoPath, lane)], repoPath);
  }
  return { path, created: true };
}

/** Drop a lane's checkout. The branch and its commits are untouched. */
export function removeWorktree(repoPath, dir, lane) {
  const path = worktreePath(dir, lane);
  if (!existsSync(path)) return { path, removed: false };
  git(['worktree', 'remove', '--force', path], repoPath);
  return { path, removed: true };
}

/** Forget worktrees whose directories are gone, so `git worktree list` stays truthful. */
export function pruneWorktrees(repoPath) {
  git(['worktree', 'prune'], repoPath);
}

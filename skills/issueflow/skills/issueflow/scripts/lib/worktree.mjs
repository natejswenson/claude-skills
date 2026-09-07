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

/**
 * A failed fetch, told apart from every other provisioning failure.
 *
 * `brief` tolerates a `WorktreeError` — a stage can still run in the repository
 * itself, so a missing checkout is a warning. A failed fetch is not that: the
 * branch would be cut anyway, from whatever `origin/<base>` this checkout last
 * happened to see, which is the stale base this class exists to refuse. Its own
 * class is what lets the caller re-throw this one and keep warning on the rest.
 */
export class FetchError extends WorktreeError {}

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

/** Wait, synchronously — this whole module is `execFileSync`, and a promise here would infect the caller. */
const sleep = (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

/**
 * Whether this checkout has an `origin` at all. A fixture repo made by `git init` does not —
 * that is the one case this returns `false` for. Any other failure (lock contention, an
 * unreadable `.git/config`, EMFILE) is not "no origin", and must not be read as one: silently
 * skipping the fetch on a transient error is the exact stale-base defect this change exists to
 * prevent, made invisible instead of fatal.
 *
 * It fails as a `FetchError`, not a plain `WorktreeError`, because of what the
 * caller does with each: `brief` tolerates a `WorktreeError` by briefing the
 * stage against the user's live checkout, and a transient `git remote` failure
 * — two parallel sessions contending for `.git/config.lock`, which is the
 * scenario this whole change is for — must not be the thing that silently
 * downgrades a lane out of its own worktree. Not knowing whether there is an
 * origin is not knowing whether the base is stale, which is exactly what
 * `FetchError` means everywhere else in this file.
 */
export function originConfigured(repoPath) {
  try {
    return execFileSync('git', ['remote'], { cwd: repoPath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n').map((l) => l.trim()).includes('origin');
  } catch (err) {
    throw new FetchError(`could not read the remotes of ${repoPath}: ${String(err.message ?? err)}`);
  }
}

/**
 * Refresh what `origin/<base>` means, right before a branch is cut from it.
 *
 * Without this a lane is cut from whatever this checkout last happened to
 * fetch: session A's pull request merges into `dev`, session B starts an hour
 * later, and B's branch does not contain A's work. In serial use that is last
 * week's base at worst; in parallel use it is a merge conflict by design.
 *
 * The refspec is explicit AND forced, and both halves were measured against a
 * throwaway bare origin:
 *
 * - Explicit, because a clone whose `remote.origin.fetch` does not cover the
 *   base (`--single-branch`) answers a plain `git fetch origin <base>` with
 *   exit 0, writes `FETCH_HEAD`, and leaves `refs/remotes/origin/<base>`
 *   absent — which is the ref `startPoint` reads, so the fetch would report
 *   success and buy nothing.
 * - Forced, because a base rewound on origin is not a fast-forward: git exits 1
 *   with `! [rejected] … (non-fast-forward)`. This repo's own policy permits
 *   force-pushing `dev`, and without the `+` one force-push would hard-block
 *   every new lane.
 *
 * Retried once, unconditionally, rather than on lock-shaped stderr: a fetch is
 * idempotent and cheap, and matching git's message text is how a retry quietly
 * stops firing on the failure it was written for. Two concurrent sessions
 * contend for the same `refs/remotes/origin/<base>` lock, so the retry is the
 * common case, not a rare one.
 *
 * One failure is not retried and not fatal: `couldn't find remote ref` means
 * origin was reached and answered — it simply has never heard of this branch.
 * `resolvePolicy` can name a base that exists only locally (a repo that
 * adopted a policy before ever pushing the branch it names), and before this
 * fetch existed `startPoint` already handled that by falling back to the
 * local ref. Treating "origin doesn't have it" as the same failure as "origin
 * could not be reached" would turn that fallback into a hard stop for every
 * such repo, which is a regression this fetch must not cause.
 */
function fetchBase(repoPath, base) {
  const refspec = `+${base}:refs/remotes/origin/${base}`;
  for (const attempt of [0, 1]) {
    try {
      execFileSync('git', ['fetch', 'origin', refspec], { cwd: repoPath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LC_ALL: 'C' } });
      return;
    } catch (err) {
      const stderr = String(err.stderr ?? err.message ?? '');
      if (/couldn't find remote ref/i.test(stderr)) return;
      if (attempt === 1) {
        throw new FetchError(
          `could not fetch ${base} from origin — a lane must not be cut from a stale base: ` +
            (stderr.trim().split('\n').filter(Boolean).pop() ?? 'git fetch failed'),
        );
      }
      sleep(700);
    }
  }
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
 *
 * `offline` is the run's own, and it skips the fetch. An offline run makes no
 * network call by contract, and the evals replay frozen payloads against
 * fixture repositories that have no remote at all.
 *
 * `lanes` is the run's full lane list, used only to tell a stacked lane's base
 * apart from the repo's own base: a stacked lane's base is a sibling lane's
 * branch, which lives only locally until that lane is pushed, so origin has
 * never heard of it and a `git fetch` for it fails every time, not just when
 * stale. Fetching is only ever meant to refresh a *shared* base like `dev`.
 */
export function ensureWorktree(repoPath, dir, lane, { offline = false, lanes = [] } = {}) {
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
    // Only on the path that creates a branch: an existing worktree returned
    // above, and a branch that already exists has nothing left to cut from a
    // base, so re-briefing a stage still costs no network. Also skipped when
    // the base is a sibling lane's branch — a stacked lane's base is local-only
    // until that lane ships, so origin has no ref for it to fetch.
    const stacked = lanes.some((l) => l.branch === lane.base);
    if (!offline && !stacked && originConfigured(repoPath)) fetchBase(repoPath, lane.base);
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

/**
 * Every worktree git still has registered under `dir/worktrees/`, read
 * straight from git's own registration rather than from `run.json`.
 *
 * This is the one source of lane identity that survives a `run.json`
 * truncated mid-write — `--take-over`'s documented remedy for a run
 * `loadRun` refuses — because a linked worktree's registration lives in the
 * main repository's `.git/worktrees/<name>`, independent of both the run's
 * own state file and the linked worktree's own (possibly unreadable) `.git`
 * file. `lane.branch` comes back `null` for a detached worktree; callers
 * that force-delete a branch must guard for that.
 */
export function registeredLanesUnder(repoPath, dir) {
  let out;
  try {
    out = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: repoPath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return [];
  }
  const prefix = `${real(resolve(dir, 'worktrees'))}/`;
  const lanes = [];
  for (const block of out.split('\n\n')) {
    const pathMatch = block.match(/^worktree (.+)$/m);
    if (!pathMatch) continue;
    const path = real(pathMatch[1]);
    if (!`${path}/`.startsWith(prefix)) continue;
    const branchMatch = block.match(/^branch refs\/heads\/(.+)$/m);
    lanes.push({ slug: path.slice(prefix.length), branch: branchMatch ? branchMatch[1] : null });
  }
  return lanes;
}

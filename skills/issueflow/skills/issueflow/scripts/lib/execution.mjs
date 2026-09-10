/** Checkout selection and the repository-wide source-mode lease. */
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { saveRun, worktreePath } from './run.mjs';
import { ensureWorktree, validateWorktree, WorktreeError } from './worktree.mjs';

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const began = (lane) => lane.stages.some((s) => s.state !== 'pending' || s.at?.briefed);
const ownerOf = (dir, run) => ({ dir: realpathSync(dir), createdAt: run.createdAt, issue: run.issue.number });
const matches = (a, b) => a.dir === b.dir && a.createdAt === b.createdAt && a.issue === b.issue;

function sourceInfo(run) {
  const path = realpathSync(run.repo.path);
  if (realpathSync(git(['rev-parse', '--show-toplevel'], path)) !== path) {
    throw new WorktreeError(`source checkout ${path} is not a repository root`);
  }
  const common = realpathSync(git(['rev-parse', '--path-format=absolute', '--git-common-dir'], path));
  return { path, common, lease: join(common, 'issueflow-source-lease.json') };
}

function sourceLease(dir, run, lane, acquire, reserve = false) {
  let lock = null;
  try {
    const info = sourceInfo(run);
    if (run.checkout?.path && (run.checkout.path !== info.path || run.checkout.common !== info.common)) {
      throw new WorktreeError('source checkout identity changed; restore the recorded checkout');
    }
    if (acquire) {
      mkdirSync(info.lease + '.lock');
      lock = info.lease + '.lock';
    }
    const owner = { ...ownerOf(dir, run), lane: reserve ? null : lane.slug, path: info.path };
    if (lstatSync(info.lease, { throwIfNoEntry: false })?.isSymbolicLink()) {
      throw new WorktreeError(`source checkout lease is a symlink: ${info.lease}`);
    }
    if (acquire && !existsSync(info.lease)) {
      try {
        writeFileSync(info.lease, JSON.stringify(owner), { flag: 'wx' });
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
      }
    }
    if (!existsSync(info.lease)) throw new WorktreeError(`missing source checkout lease at ${info.lease} — rebrief explicitly with --no-worktree`);
    const held = JSON.parse(readFileSync(info.lease, 'utf8'));
    if (!matches(held, owner) || held.path !== owner.path) {
      throw new WorktreeError(`source checkout is leased by ${held.dir} (${info.lease}); finish that run or explicitly take it over`);
    }
    if (held.lane !== owner.lane) {
      const previous = run.lanes.find((l) => l.slug === held.lane);
      if (!acquire || held.lane !== null && !previous?.landed) {
        throw new WorktreeError(`source checkout is leased by active lane ${held.lane}; overlapping writable lanes require worktrees`);
      }
      writeFileSync(info.lease, JSON.stringify(owner));
    }
    return info;
  } catch (err) {
    if (err instanceof WorktreeError) throw err;
    throw new WorktreeError(`source checkout lease for ${run.repo.path}: ${err.message}`);
  } finally {
    if (lock) rmdirSync(lock);
  }
}

export function sourceTree(dir, run, lane) {
  sourceLease(dir, run, lane, false);
  return run.repo.path;
}

/** A persisted mode is sticky. Missing legacy mode never grants source access. */
export function prepareCheckout(dir, run, lane, { noWorktree = false, reserve = false } = {}) {
  if (run.checkout && !['source', 'worktree'].includes(run.checkout.mode)) {
    throw new WorktreeError('unknown checkout mode; restore the run record');
  }
  if (noWorktree && run.checkout?.mode === 'worktree' && run.lanes.some(began)) {
    throw new WorktreeError('cannot change checkout mode after implementation has begun');
  }
  if (noWorktree && !run.checkout && began(lane) && existsSync(worktreePath(dir, lane))) {
    validateWorktree(run.repo.path, dir, lane);
    throw new WorktreeError('legacy implementation already owns a worktree; restore that checkout instead of changing mode');
  }
  if (noWorktree || run.checkout?.mode === 'source') {
    const info = sourceLease(dir, run, lane, true, reserve);
    run.checkout = { mode: 'source', path: info.path, common: info.common };
    saveRun(dir, run);
    return run.repo.path;
  }
  // A disappeared dispatched checkout may contain unpushed work; recreating
  // one from a branch would conceal the loss.
  if (began(lane)) validateWorktree(run.repo.path, dir, lane);
  const tree = ensureWorktree(run.repo.path, dir, lane, { offline: run.offline, lanes: run.lanes }).path;
  run.checkout = { mode: 'worktree' };
  saveRun(dir, run);
  return tree;
}

/** Release only this durable run's owner; an unrelated lease is never removed. */
export function releaseSourceLease(dir, run) {
  if (run.checkout?.mode !== 'source') return;
  let lock = null;
  try {
    const info = sourceInfo(run);
    mkdirSync(info.lease + '.lock');
    lock = info.lease + '.lock';
    if (!existsSync(info.lease)) return;
    const held = JSON.parse(readFileSync(info.lease, 'utf8'));
    if (!matches(held, ownerOf(dir, run))) throw new WorktreeError(`refusing to release another run's source lease at ${info.lease}`);
    unlinkSync(info.lease);
  } catch (err) {
    if (err instanceof WorktreeError) throw err;
    throw new WorktreeError(`release source checkout lease: ${err.message}`);
  } finally {
    if (lock) rmdirSync(lock);
  }
}

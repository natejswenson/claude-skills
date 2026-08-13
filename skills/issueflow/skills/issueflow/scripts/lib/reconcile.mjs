/**
 * Asking GitHub what is actually true before advancing a gate.
 *
 * On the run this was measured against, the change was pushed, opened as pull
 * request #174, merged, promoted, and the issue closed — all while the run sat
 * at the implement gate. Four minutes after the issue closed, the user approved
 * that implement stage; issueflow accepted it, briefed the test stage, and ran a
 * subagent for another three minutes against a branch whose pull request had
 * already merged. It then wanted to build a second lane on top of a branch that
 * no longer existed.
 *
 * Nothing in the run was wrong about its own state. It simply had no way to
 * know that reality had moved, because after `start` it never asked again.
 *
 * This module asks. It never decides — it returns facts, and `accept` refuses on
 * the two that mean the work is already done.
 */
import { execFileSync } from 'node:child_process';
import { issueState, prsForBranch } from './gh.mjs';

/** A drift row: what was checked, what is true, and whether it should stop a run. */
const row = (check, state, detail, blocking = false) => ({ check, state, detail, blocking });

const git = (args, cwd) => {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
};

/**
 * What has changed underneath this run.
 *
 * `lane` narrows the pull request check to the lane about to advance; without
 * it every lane is checked, which is what `status` wants.
 *
 * Every GitHub call is wrapped: a reconcile that throws would turn a network
 * blip into a blocked gate, and a gate that fails closed on an unrelated
 * outage is worse than one that says it could not check.
 */
export function reconcile(run, { lane = null, offline = false } = {}) {
  if (offline || run.offline) return [];
  const repoPath = run.repo.path;
  const rows = [];

  try {
    const issue = issueState(repoPath, run.issue.number);
    if (issue.state === 'CLOSED') {
      rows.push(row('issue', 'closed', `#${run.issue.number} was closed ${issue.closedAt ?? 'already'}`, true));
    }
  } catch (err) {
    rows.push(row('issue', 'unknown', String(err.message ?? err).split('\n')[0]));
  }

  for (const l of lane ? [lane] : run.lanes) {
    try {
      const prs = prsForBranch(repoPath, l.branch);
      const merged = prs.find((p) => p.state === 'MERGED');
      const open = prs.find((p) => p.state === 'OPEN');
      if (merged) rows.push(row(`lane ${l.slug}`, 'already merged', `#${merged.number} merged into ${merged.baseRefName}`, true));
      else if (open) rows.push(row(`lane ${l.slug}`, 'pull request open', `#${open.number} → ${open.baseRefName}`));
    } catch (err) {
      rows.push(row(`lane ${l.slug}`, 'unknown', String(err.message ?? err).split('\n')[0]));
    }
  }

  // The base branch is checked locally against the remote-tracking ref rather
  // than through `gh`: it is the one fact git already knows, and a fetch here
  // would put the network in the path of a check meant to be cheap.
  const bases = new Set((lane ? [lane] : run.lanes).map((l) => l.base));
  for (const base of bases) {
    if (run.lanes.some((l) => l.branch === base)) continue; // a stacked base is a lane, not a remote branch
    if (git(['rev-parse', '--verify', `refs/remotes/origin/${base}`], repoPath) === null) {
      rows.push(row(`base ${base}`, 'not on origin', 'the branch these lanes target is not on the remote', true));
    }
  }

  return rows;
}

/** The rows that mean the run should stop and ask, rather than advance. */
export const blockingDrift = (rows) => rows.filter((r) => r.blocking);

/**
 * What happened to each lane's pull request — the same question `reconcile`
 * asks `gh`, with the opposite polarity `finish` needs. `reconcile`'s
 * `already merged` stops a run from advancing; `finish` needs exactly that
 * same fact before it will touch a worktree or a branch. A single `blocking`
 * flag that means "stop" to one caller and "go" to the other is how a gate
 * stops being readable, so this is its own function rather than `reconcile`'s
 * flag inverted in place. `reconcile` itself is unchanged.
 */
export function landings(run, { lane = null } = {}) {
  const repoPath = run.repo.path;
  const lanes = lane ? [lane] : run.lanes;
  return lanes.map((l) => {
    try {
      const prs = prsForBranch(repoPath, l.branch);
      const merged = prs.find((p) => p.state === 'MERGED');
      if (merged) return { lane: l, state: 'merged', pr: merged.number, url: merged.url, mergedAt: merged.mergedAt };
      const open = prs.find((p) => p.state === 'OPEN');
      if (open) return { lane: l, state: 'open', pr: open.number, url: open.url };
      return { lane: l, state: 'none' };
    } catch (err) {
      return { lane: l, state: 'unknown', detail: String(err.message ?? err).split('\n')[0] };
    }
  });
}

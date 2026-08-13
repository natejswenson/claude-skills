/**
 * The run's terminal state — the lifecycle finding #219 measured as manual
 * work, done by hand twice: watch the pull requests merge, remove the lane
 * worktrees, delete the local branches, optionally close the issue, and say
 * the run is over. `ship` ends at pull request URLs; this is what happens
 * after, and until now nothing recorded that it happened at all.
 *
 * The polarity is `accept`'s drift refusal, inverted on purpose. `accept`
 * refuses a stage whose lane already merged, because approving it would sign
 * off on work already landed. `finish` requires exactly that same fact
 * before it will touch a worktree or a branch — the only path to
 * `git branch -D` is a merge GitHub confirmed, never a guess.
 */
import { execFileSync } from 'node:child_process';
import { closeIssue, issueState } from './gh.mjs';
import { landings } from './reconcile.mjs';
import { recordFinished, recordLanding } from './run.mjs';
import { pruneWorktrees, removeWorktree } from './worktree.mjs';

export class FinishError extends Error {
  constructor(message, rows = []) {
    super(message);
    this.rows = rows;
  }
}

const git = (args, cwd) => {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    throw new FinishError(
      String(err.stderr ?? err.message ?? '').trim().split('\n').filter(Boolean).pop() ?? `git ${args[0]} failed`,
    );
  }
};

/** Why a lane was left alone, for the row — not just the state word. */
const detailFor = (result) => {
  if (result.state === 'open') return `#${result.pr} is still open — left untouched`;
  if (result.state === 'none') return 'never shipped — no pull request found';
  return result.detail ?? 'gh could not answer';
};

/**
 * Per lane, in order: verify GitHub confirms the merge, remove the worktree,
 * delete the local branch, record the landing. Run-wide, once every lane has
 * landed: close the issue when asked, and write the run's terminal state.
 *
 * Idempotent — a lane already recorded as landed is reported and left alone,
 * so finishing a partially-landed run only touches the lanes still owed.
 * Never touches a lane whose pull request is not a confirmed merge.
 *
 * Returns the per-lane rows; throws only when nothing on the run could be
 * finished, carrying those rows on the error so the caller can still print
 * the table before failing — the mirror of `accept`'s drift stance.
 */
export function finish(dir, run, { offline = false, closeIssueFlag = false, now = () => new Date().toISOString() } = {}) {
  if (offline || run.offline) {
    throw new FinishError(
      'finish is a question about GitHub — an offline run cannot verify a merge, so it refuses rather than finishing on an assumption',
    );
  }

  const repo = run.repo.path;
  const results = landings(run, {});
  const rows = [];

  for (const result of results) {
    const lane = result.lane;
    if (lane.landed) {
      rows.push({ lane: lane.slug, state: 'already landed', detail: `#${lane.landed.pr}` });
      continue;
    }
    if (result.state !== 'merged') {
      rows.push({ lane: lane.slug, state: result.state, detail: detailFor(result) });
      continue;
    }

    removeWorktree(repo, dir, lane);
    pruneWorktrees(repo);
    try {
      // -D, not -d: the merge landed on the remote, which this checkout may
      // not have fetched, so -d's local-reachability check would refuse a
      // deletion GitHub already confirmed is safe — that confirmation is the
      // stronger check, and it already happened above.
      git(['branch', '-D', lane.branch], repo);
    } catch {
      // Already gone — a second `finish` after a first that deleted it, or a
      // branch removed by hand. Not a reason to refuse recording the landing.
    }
    recordLanding(dir, run, lane, { pr: result.pr, url: result.url, mergedAt: result.mergedAt }, now);
    rows.push({ lane: lane.slug, state: 'landed', detail: `#${result.pr}` });
  }

  if (run.lanes.every((l) => !l.landed)) {
    throw new FinishError(`no lane could be finished: ${rows.map((r) => `${r.lane} ${r.state}`).join(', ')}`, rows);
  }

  if (run.lanes.every((l) => l.landed)) {
    let issueClosed = false;
    if (closeIssueFlag) {
      const state = issueState(repo, run.issue.number);
      if (state.state === 'CLOSED') {
        rows.push({ lane: '—', state: 'issue', detail: 'already closed' });
      } else {
        closeIssue(repo, run.issue.number, 'Finished by issueflow — every lane landed.');
        rows.push({ lane: '—', state: 'issue', detail: 'closed' });
      }
      issueClosed = true;
    }
    recordFinished(dir, run, { issueClosed }, now);
  }

  return { rows, run };
}

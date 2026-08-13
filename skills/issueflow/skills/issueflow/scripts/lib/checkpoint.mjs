/**
 * Getting the run off this machine, at every gate.
 *
 * issueflow 0.1.0 wrote to GitHub in exactly one place — `ship`, the last step.
 * On the run this was measured against, `ship` never ran: 23 minutes of opus and
 * sonnet output existed only as untracked files under `$HOME` and one unpushed
 * local commit. Nothing about the run was visible to anyone but the person
 * watching the terminal, and nothing would have survived losing the machine.
 *
 * So every state transition checkpoints. Two writes, both cheap and both
 * reversible:
 *
 *   1. the lane's branch is pushed, so the commits exist somewhere else;
 *   2. ONE comment on the issue is rewritten in place, carrying the board, the
 *      lanes, and every approved artifact.
 *
 * The comment is the durable part. It is what lets a run be picked up on
 * another machine, and it is what makes the issue — rather than a terminal
 * scrollback — the record of how the change was decided.
 *
 * **A checkpoint failure never rolls back an approval.** The approval happened;
 * pretending otherwise would lose the very state this module exists to keep. It
 * is reported instead, loudly, as a row the caller prints.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { addIssueComment, issueComments, updateIssueComment } from './gh.mjs';
import { artifactPath, board, gateSteps, saveRun } from './run.mjs';

/** How much artifact prose the sticky comment may carry, in characters. */
const ARTIFACT_BUDGET = 20000;

/**
 * The line that identifies the comment as this run's.
 *
 * Without it, a run resumed on a machine with no `run.json` would open a second
 * comment and the issue would grow one per machine. With it, the comment is
 * found and adopted.
 */
export const marker = (run) => `<!-- issueflow:run ${run.repo.owner}/${run.repo.name}#${run.issue.number} -->`;

const git = (args, cwd) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const tryGit = (args, cwd) => {
  try {
    return { ok: true, out: git(args, cwd) };
  } catch (err) {
    return { ok: false, out: String(err.stderr ?? err.message ?? '').trim().split('\n').filter(Boolean).pop() ?? 'git failed' };
  }
};

const bar = (headers, rows) =>
  [`| ${headers.join(' | ')} |`, `|${headers.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');

/** The short sha at the tip of a lane's branch, or null when the branch has no commits yet. */
export function tipOf(repoPath, branch) {
  const r = tryGit(['rev-parse', '--short', `refs/heads/${branch}`], repoPath);
  return r.ok ? r.out : null;
}

/**
 * Push one lane's branch, if it has anything to push.
 *
 * A branch with no commits is not a failure — the lane simply has not been
 * implemented yet — so it reports `skipped`, never an error the user has to
 * read past on every early checkpoint.
 */
export function pushLane(repoPath, lane) {
  const tip = tipOf(repoPath, lane.branch);
  if (!tip) return { lane: lane.slug, state: 'skipped', detail: 'no commits yet' };
  // A plain push, deliberately: a rejected non-fast-forward means local and
  // remote have diverged, and the user needs to hear that at the gate it
  // happened rather than have a force flag quietly resolve it.
  const pushed = tryGit(['push', '-u', 'origin', `${lane.branch}:${lane.branch}`], repoPath);
  if (!pushed.ok) return { lane: lane.slug, state: 'failed', detail: pushed.out };
  return { lane: lane.slug, state: 'pushed', detail: tip, sha: tip };
}

/**
 * The sticky comment's body.
 *
 * Pure given the run and what is on disk, so it can be byte-compared by the
 * baseline instead of being taken on trust — the same reason the dispatch
 * briefs are rendered rather than improvised.
 */
export function renderComment(dir, run, { budget = ARTIFACT_BUDGET } = {}) {
  const steps = gateSteps(run);
  const lines = [
    marker(run),
    '',
    `### 🤖 issueflow — ${run.repo.owner}/${run.repo.name}#${run.issue.number}`,
    '',
    'Each stage below ran as its own subagent and was approved by a human before',
    'the next one started. This comment is rewritten at every gate.',
    '',
    bar(
      ['Step', 'Model', 'State', 'Took'],
      board(run).map((r) => [r.step, r.model, r.state === 'approved' ? '✅ approved' : r.state, r.took]),
    ),
    '',
    bar(
      ['Lane', 'Branch', 'Base', 'Pushed'],
      run.lanes.map((l) => [l.slug, `\`${l.branch}\``, `\`${l.base}\``, run.checkpoint?.pushed?.[l.slug] ?? '—']),
    ),
  ];

  // Both blocks are conditional on purpose: an unfinished run must render
  // identically to before `finish` existed, which is what lets the frozen
  // `checkpoint-comment.md` stay byte-identical.
  const landed = run.lanes.filter((l) => l.landed);
  if (landed.length > 0) {
    lines.push(
      '',
      bar(
        ['Lane', 'Pull request', 'Merged at'],
        landed.map((l) => [l.slug, `#${l.landed.pr}`, l.landed.mergedAt ?? '—']),
      ),
    );
  }
  if (run.finished) {
    lines.push(
      '',
      `**Finished** ${run.finished.at} — every lane landed${run.finished.issueClosed ? ', issue closed' : ''}.`,
    );
  }

  const skipped = steps.filter((s) => s.stage.state === 'skipped');
  if (skipped.length > 0) {
    lines.push(
      '',
      '**Skipped — these are holes, not passes, and `ship` keeps refusing them:**',
      '',
      ...skipped.map((s) => `- \`${s.key}\` — ${s.stage.skipReason ?? 'no reason recorded'}`),
    );
  }

  const approved = steps.filter((s) => s.stage.state === 'approved');
  if (approved.length > 0) {
    lines.push('', '---', '');
    let left = budget;
    for (const step of approved) {
      const path = artifactPath(dir, step);
      if (!existsSync(path)) continue;
      const text = readFileSync(path, 'utf8').trim();
      const body = text.length <= left
        ? text
        : `${text.slice(0, Math.max(0, left))}\n\n… truncated at ${left} characters. The whole artifact is at \`${step.stage.artifact}\` in the run directory.`;
      left -= Math.min(text.length, Math.max(0, left));
      lines.push(`<details><summary><b>${step.key}</b> — ${step.stage.artifact}</summary>`, '', body, '', '</details>', '');
      if (left <= 0) {
        lines.push('_Remaining artifacts omitted — the comment reached its size budget._', '');
        break;
      }
    }
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

/**
 * Find this run's comment on the issue when `run.json` does not know it.
 *
 * This is what makes a run resumable from a machine that never saw it: the
 * marker is the identity, not the local state file.
 */
function adoptComment(repoPath, run) {
  const mine = marker(run);
  for (const c of issueComments(repoPath, run.issue.number)) {
    if (String(c.body ?? '').includes(mine) && c.commentId) return { commentId: c.commentId, url: c.url };
  }
  return null;
}

/**
 * Write the run's state to GitHub: push every lane, then sync the comment.
 *
 * Returns one row per action for the caller to print. Nothing here throws —
 * a checkpoint that failed is a fact to report, not a reason to unwind a gate
 * the user already passed.
 */
export function checkpoint(dir, run, { offline = false, push = true, comment = true } = {}) {
  if (offline || run.offline) return [{ action: 'checkpoint', state: 'offline', detail: 'nothing sent' }];

  const repoPath = run.repo.path;
  const rows = [];

  if (push) {
    for (const lane of run.lanes) {
      const result = pushLane(repoPath, lane);
      if (result.state === 'pushed') {
        run.checkpoint.pushed[lane.slug] = result.sha;
        rows.push({ action: `push ${lane.slug}`, state: 'pushed', detail: `origin/${lane.branch} @ ${result.sha}` });
      } else if (result.state === 'failed') {
        rows.push({ action: `push ${lane.slug}`, state: 'failed', detail: result.detail });
      }
    }
  }

  if (comment) {
    try {
      if (!run.checkpoint.commentId) {
        const found = adoptComment(repoPath, run);
        if (found) {
          run.checkpoint.commentId = found.commentId;
          run.checkpoint.commentUrl = found.url;
        }
      }
      const body = renderComment(dir, run);
      const bodyFile = join(dir, 'checkpoint.md');
      mkdirSync(dir, { recursive: true });
      writeFileSync(bodyFile, body);

      let result;
      if (run.checkpoint.commentId) {
        const inputFile = join(dir, 'checkpoint.json');
        writeFileSync(inputFile, `${JSON.stringify({ body })}\n`);
        result = updateIssueComment(repoPath, {
          owner: run.repo.owner, name: run.repo.name, commentId: run.checkpoint.commentId, inputFile,
        });
        rows.push({ action: 'issue comment', state: 'updated', detail: result.url });
      } else {
        result = addIssueComment(repoPath, { number: run.issue.number, bodyFile });
        rows.push({ action: 'issue comment', state: 'posted', detail: result.url });
      }
      run.checkpoint.commentId = result.commentId ?? run.checkpoint.commentId;
      run.checkpoint.commentUrl = result.url ?? run.checkpoint.commentUrl;
    } catch (err) {
      rows.push({ action: 'issue comment', state: 'failed', detail: String(err.message ?? err).split('\n')[0] });
    }
  }

  saveRun(dir, run);
  return rows.length > 0 ? rows : [{ action: 'checkpoint', state: 'nothing to send', detail: '—' }];
}

/**
 * Every call that leaves this machine.
 *
 * Isolated in one file so the baseline evals can run the whole skill offline by
 * feeding frozen JSON in through `--issues-json` / `--issue-json` instead. A
 * CI gate that reaches the network costs money and flakes; the only way to keep
 * that promise is to have one place where the network is.
 */
import { execFileSync } from 'node:child_process';

const run = (args, cwd) =>
  execFileSync('gh', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 });

export class GhError extends Error {}

function gh(args, cwd) {
  try {
    return run(args, cwd);
  } catch (err) {
    const detail = String(err.stderr ?? err.message ?? '').trim().split('\n')[0];
    if (err.code === 'ENOENT') throw new GhError('gh is not installed — issueflow reads issues through the GitHub CLI');
    throw new GhError(detail || `gh ${args[0]} failed`);
  }
}

/** owner, name and default branch of the repo at `cwd`. */
export function repoInfo(cwd) {
  const raw = gh(['repo', 'view', '--json', 'owner,name,defaultBranchRef'], cwd);
  const data = JSON.parse(raw);
  return {
    owner: data.owner?.login ?? 'unknown',
    name: data.name ?? 'unknown',
    defaultBranch: data.defaultBranchRef?.name ?? 'main',
  };
}

/** Every open issue, newest activity first. Pull requests are excluded by `gh issue list`. */
export function listIssues(cwd, limit = 100) {
  const raw = gh(
    ['issue', 'list', '--state', 'open', '--limit', String(limit), '--json', 'number,title,labels,comments,updatedAt,body,url'],
    cwd,
  );
  return JSON.parse(raw);
}

/** One issue with its full body and every comment — the run's only input. */
export function viewIssue(cwd, number) {
  const raw = gh(
    ['issue', 'view', String(number), '--json', 'number,title,body,labels,comments,url,state,author'],
    cwd,
  );
  return JSON.parse(raw);
}

/** Open a pull request and return its URL. */
export function createPr(cwd, { head, base, title, bodyFile, draft }) {
  const args = ['pr', 'create', '--head', head, '--base', base, '--title', title, '--body-file', bodyFile];
  if (draft) args.push('--draft');
  return gh(args, cwd).trim().split('\n').filter(Boolean).pop() ?? '';
}

/** Just the issue's state, for the cheap "has reality moved?" check before every advance. */
export function issueState(cwd, number) {
  const raw = gh(['issue', 'view', String(number), '--json', 'state,stateReason,closedAt,url'], cwd);
  return JSON.parse(raw);
}

/**
 * Every pull request whose head is `branch`, open or closed.
 *
 * Closed ones matter most: a merged pull request for a lane means the work
 * already landed, and a run still walking that lane is a run about to redo it.
 */
export function prsForBranch(cwd, branch) {
  const raw = gh(
    ['pr', 'list', '--head', branch, '--state', 'all', '--limit', '10', '--json', 'number,state,url,mergedAt,baseRefName'],
    cwd,
  );
  return JSON.parse(raw);
}

/**
 * The numeric comment id GitHub hides in a comment's own URL.
 *
 * `gh` reports comments by URL, and the REST endpoint that edits one wants the
 * number. This is the seam between them.
 */
export const commentIdFromUrl = (url) => Number(/#issuecomment-(\d+)/.exec(String(url ?? ''))?.[1]) || null;

/** Every comment on the issue, so a run resumed elsewhere can find the one it owns. */
export function issueComments(cwd, number) {
  const raw = gh(['issue', 'view', String(number), '--json', 'comments'], cwd);
  return (JSON.parse(raw).comments ?? []).map((c) => ({ ...c, commentId: commentIdFromUrl(c.url) }));
}

/** Post the run's sticky comment for the first time. Returns its id and URL. */
export function addIssueComment(cwd, { number, bodyFile }) {
  const url = gh(['issue', 'comment', String(number), '--body-file', bodyFile], cwd)
    .trim().split('\n').filter(Boolean).pop() ?? '';
  return { url, commentId: commentIdFromUrl(url) };
}

/**
 * Rewrite the run's sticky comment in place.
 *
 * Editing rather than appending is the whole point: a gated run makes six or
 * more transitions, and six comments on an issue is noise nobody reads.
 *
 * The body crosses as a JSON file through `--input` rather than as a `-F`
 * field: a markdown body is arbitrary text, and `gh`'s field parsing applies
 * type conversion to it.
 */
export function updateIssueComment(cwd, { owner, name, commentId, inputFile }) {
  const raw = gh(
    ['api', `repos/${owner}/${name}/issues/comments/${commentId}`, '-X', 'PATCH', '--input', inputFile,
      '--jq', '.html_url'],
    cwd,
  );
  const url = raw.trim();
  return { url, commentId };
}

/**
 * Every call that leaves this machine.
 *
 * Isolated in one file so the baseline evals can run the whole skill offline by
 * feeding frozen JSON in through `--issues-json` / `--issue-json` instead. A
 * CI gate that reaches the network costs money and flakes; the only way to keep
 * that promise is to have one place where the network is.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const run = (args, cwd) =>
  execFileSync('gh', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000, maxBuffer: 32 * 1024 * 1024 });

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

/**
 * Open a pull request and return its URL.
 *
 * Draft when asked, with a fallback: a private repository on a plan without
 * draft pull requests refuses `--draft` outright, and a run must not die on
 * a billing tier. The caller learns which happened through `draft` in the
 * result and labels the pull request instead.
 */
export function createPr(cwd, { head, base, title, bodyFile, draft }) {
  const args = ['pr', 'create', '--head', head, '--base', base, '--title', title, '--body-file', bodyFile];
  if (draft) {
    try {
      const url = gh([...args, '--draft'], cwd).trim().split('\n').filter(Boolean).pop() ?? '';
      return { url, draft: true };
    } catch (err) {
      if (!/draft/i.test(String(err.message))) throw err;
    }
  }
  const url = gh(args, cwd).trim().split('\n').filter(Boolean).pop() ?? '';
  return { url, draft: false };
}

/** Just the issue's state, for the cheap "has reality moved?" check before every advance. */
export function issueState(cwd, number) {
  const raw = gh(['issue', 'view', String(number), '--json', 'state,stateReason,closedAt,url'], cwd);
  return JSON.parse(raw);
}

/**
 * Close the issue, with a comment saying why.
 *
 * `finish` calls this only after checking `issueState` itself, so a second
 * `finish --close-issue` reports "already closed" rather than reaching `gh`
 * to claim an action it did not take.
 */
export function closeIssue(cwd, number, comment) {
  gh(['issue', 'close', String(number), '--comment', comment], cwd);
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

/** Full REST pagination; partial comment inventories cannot prove absence. */
export function issueCommentsAll(cwd, owner, name, number) {
  const pages = JSON.parse(gh(['api', `repos/${owner}/${name}/issues/${number}/comments?per_page=100`, '--paginate', '--slurp'], cwd));
  if (!Array.isArray(pages) || pages.some((p) => !Array.isArray(p))) throw new GhError('incomplete issue comment pagination');
  return pages.flat().map((c) => ({ body: c.body, commentId: c.id, url: c.html_url, author: c.user?.login }));
}
export const viewerLogin = (cwd) => gh(['api', 'user', '--jq', '.login'], cwd).trim();

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

// ---------------------------------------------------------------------------
// The pull request review loop. Every write below is one GraphQL mutation
// through `gh api graphql --input <file>` — a file, never `-f` fields, for the
// same reason the sticky comment crosses as a file: the bodies are arbitrary
// markdown. The REST review endpoint is deliberately NOT used to post
// threads: `POST pulls/{n}/reviews` with `comments[]` is atomic, so one line
// GitHub cannot anchor loses every comment in the round. The pending-review
// flow posts thread by thread, and a refused anchor costs one thread.
// ---------------------------------------------------------------------------

/** The pull request the loop reviews: node id for GraphQL, head sha for binding, draft state. */
export function prView(cwd, number) {
  const raw = gh(['pr', 'view', String(number), '--json', 'id,number,url,headRefOid,headRefName,baseRefName,isDraft,title,state,labels'], cwd);
  return JSON.parse(raw);
}

export function prOperationView(cwd, number) {
  return JSON.parse(gh(['pr', 'view', String(number), '--json', 'number,url,body,headRefOid,headRefName,baseRefName,isDraft,state'], cwd));
}

/**
 * Every check on the pull request, bucketed the way `gh pr checks` reports
 * them. A repository with no CI at all makes `gh pr checks` exit non-zero
 * with "no checks reported" — that is `[]` here, not an error: the loop
 * treats it as nothing to wait for, and says so.
 */
export function prChecks(cwd, number) {
  try {
    const raw = gh(['pr', 'checks', String(number), '--json', 'name,bucket,state,link'], cwd);
    return JSON.parse(raw);
  } catch (err) {
    if (/no checks reported/i.test(String(err.message))) return [];
    throw err;
  }
}

/** Mark a draft pull request ready for review. */
export function prReady(cwd, number) {
  gh(['pr', 'ready', String(number)], cwd);
}

/** Retitle a pull request — used to drop the `[reviewing]` prefix the draft fallback added. */
export function prRetitle(cwd, number, title) {
  gh(['pr', 'edit', String(number), '--title', title], cwd);
}

/** Add or remove a label on a pull request; a missing label is created. */
export function prLabel(cwd, number, label, { remove = false } = {}) {
  if (remove) {
    gh(['pr', 'edit', String(number), '--remove-label', label], cwd);
    return;
  }
  try {
    gh(['pr', 'edit', String(number), '--add-label', label], cwd);
  } catch {
    gh(['label', 'create', label, '--color', 'FBCA04', '--description', 'issueflow review loop in progress', '--force'], cwd);
    gh(['pr', 'edit', String(number), '--add-label', label], cwd);
  }
}

/** A plain top-level pull request comment (the convergence summary). Returns its URL. */
export function prComment(cwd, number, bodyFile) {
  return gh(['pr', 'comment', String(number), '--body-file', bodyFile], cwd).trim().split('\n').filter(Boolean).pop() ?? '';
}

/**
 * One GraphQL call. `variables` and `query` cross as a JSON file so no body
 * is ever shell-quoted. Errors GitHub reports inside a 200 are thrown too —
 * `gh api graphql` exits 0 on them, and a mutation that "succeeded" with an
 * `errors` array did nothing.
 */
export function graphql(cwd, inputFile, { query, variables }) {
  writeFileSync(inputFile, `${JSON.stringify({ query, variables })}\n`);
  const raw = gh(['api', 'graphql', '--input', inputFile], cwd);
  const data = JSON.parse(raw);
  if (Array.isArray(data.errors) && data.errors.length > 0) {
    throw new GhError(data.errors.map((e) => e.message).join('; '));
  }
  return data.data;
}

export const GQL = {
  addReview: `mutation($pr: ID!, $body: String) {
    addPullRequestReview(input: { pullRequestId: $pr, body: $body }) { pullRequestReview { id } }
  }`,
  addThread: `mutation($review: ID!, $path: String!, $line: Int!, $side: DiffSide!, $body: String!) {
    addPullRequestReviewThread(input: { pullRequestReviewId: $review, path: $path, line: $line, side: $side, body: $body }) {
      thread { id }
    }
  }`,
  submitReview: `mutation($review: ID!, $body: String) {
    submitPullRequestReview(input: { pullRequestReviewId: $review, event: COMMENT, body: $body }) {
      pullRequestReview { id url }
    }
  }`,
  reply: `mutation($thread: ID!, $body: String!) {
    addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $thread, body: $body }) { comment { id } }
  }`,
  resolve: `mutation($thread: ID!) {
    resolveReviewThread(input: { threadId: $thread }) { thread { id isResolved } }
  }`,
  threads: `query($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        reviewThreads(first: 100) {
          nodes { id isResolved isOutdated path line comments(first: 1) { nodes { body } } }
        }
      }
    }
  }`,
};

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

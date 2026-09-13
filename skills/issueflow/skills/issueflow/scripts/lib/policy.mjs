/**
 * The target repo's own branch policy, read rather than assumed.
 *
 * A skill that hardcodes `feature/* → dev` works in exactly one repo. Every
 * repo that has adopted shipflow already committed its answer to
 * `.github/shipflow.json`; repos that have not get a conservative default that
 * targets the repo's actual default branch, never a guessed `dev`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The branch names on `origin`, from the local remote-tracking refs — no network. */
export function remoteBranchesOf(repoPath) {
  try {
    const out = execFileSync('git', ['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin/'], {
      cwd: repoPath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    return out.split('\n').map((l) => l.trim().replace(/^origin\//, '')).filter(Boolean);
  } catch {
    return [];
  }
}

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
};

/**
 * Resolve the branch policy for `repoPath`.
 *
 * `defaultBranch` is the remote's default, supplied by the caller because only
 * `gh` knows it — passing it in keeps this function pure and testable.
 */
export function resolvePolicy(repoPath, defaultBranch = 'main', { remoteBranches = null } = {}) {
  const configPath = join(repoPath, '.github', 'shipflow.json');
  const config = existsSync(configPath) ? readJson(configPath) : null;

  if (!config) {
    // No shipflow config, but the remote has a `dev` branch beside the
    // default: that is the dev → main shape with the policy written in prose
    // instead of JSON. The first real 0.7.0 run opened four pull requests into
    // `main` on exactly such a repo, and the review loop's own conventions
    // angle caught it against the repo's CLAUDE.md. A `dev` that exists on
    // origin is the integration branch; a guessed one would still be wrong.
    const remote = remoteBranches ?? remoteBranchesOf(repoPath);
    const hasDev = remote.includes('dev') && defaultBranch !== 'dev';
    return {
      base: hasDev ? 'dev' : defaultBranch,
      featurePrefix: 'feature/',
      mergeMethod: 'squash',
      source: hasDev ? 'origin has a dev branch (no .github/shipflow.json)' : 'defaults (no .github/shipflow.json)',
      shipflow: false,
    };
  }

  // shipflow's `dev` is the integration branch feature work targets. A config
  // that declares no dev branch is a single-branch repo, so feature work goes
  // to main — inventing a `dev` that does not exist would open a PR into
  // nothing.
  const githubFlow = config.workflowPattern === 'github-flow';
  const base = githubFlow ? (config.branches?.main ?? defaultBranch) : (config.branches?.dev ?? config.branches?.main ?? defaultBranch);

  return {
    base,
    featurePrefix: config.featureBranchPrefix ?? 'feature/',
    mergeMethod: (githubFlow ? config.mergeMethod?.devToMainMethod : config.mergeMethod?.featureToDevMethod) ?? 'squash',
    source: '.github/shipflow.json',
    shipflow: true,
  };
}

/**
 * A branch-safe slug. Never empty, never longer than a git ref wants to be, and
 * never cut mid-word.
 *
 * A hard slice at `max` produced `shipflow-refuses-the-ambiguous-f` on a real
 * run — a slug that reads as a typo in the branch name, the lane column, the
 * pull request title and the run board, all of which a human looks at. Backing
 * off to the last whole word costs a few characters and buys a name that looks
 * deliberate.
 */
export function slugify(text, max = 32) {
  const full = String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (full.length <= max) return full || 'issue';
  // Slice one past the limit so a boundary landing exactly on it still counts.
  const boundary = full.slice(0, max + 1).lastIndexOf('-');
  const cut = boundary > 0 ? full.slice(0, boundary) : full.slice(0, max);
  return cut.replace(/-+$/g, '') || 'issue';
}

/** The branch one lane lands on. Deterministic from the issue and the lane. */
export function branchFor(policy, issueNumber, laneSlug) {
  const suffix = laneSlug && laneSlug !== 'root' ? `-${laneSlug}` : '';
  return `${policy.featurePrefix}issue-${issueNumber}${suffix}`;
}

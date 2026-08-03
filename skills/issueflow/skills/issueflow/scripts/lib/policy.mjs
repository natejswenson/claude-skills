/**
 * The target repo's own branch policy, read rather than assumed.
 *
 * A skill that hardcodes `feature/* → dev` works in exactly one repo. Every
 * repo that has adopted shipflow already committed its answer to
 * `.github/shipflow.json`; repos that have not get a conservative default that
 * targets the repo's actual default branch, never a guessed `dev`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

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
export function resolvePolicy(repoPath, defaultBranch = 'main') {
  const configPath = join(repoPath, '.github', 'shipflow.json');
  const config = existsSync(configPath) ? readJson(configPath) : null;

  if (!config) {
    return {
      base: defaultBranch,
      featurePrefix: 'feature/',
      mergeMethod: 'squash',
      source: 'defaults (no .github/shipflow.json)',
      shipflow: false,
    };
  }

  // shipflow's `dev` is the integration branch feature work targets. A config
  // that declares no dev branch is a single-branch repo, so feature work goes
  // to main — inventing a `dev` that does not exist would open a PR into
  // nothing.
  const base = config.branches?.dev ?? config.branches?.main ?? defaultBranch;

  return {
    base,
    featurePrefix: config.featureBranchPrefix ?? 'feature/',
    mergeMethod: config.mergeMethod?.featureToDevMethod ?? 'squash',
    source: '.github/shipflow.json',
    shipflow: true,
  };
}

/** A branch-safe slug. Never empty, never longer than a git ref wants to be. */
export function slugify(text, max = 32) {
  const slug = String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
  return slug || 'issue';
}

/** The branch one lane lands on. Deterministic from the issue and the lane. */
export function branchFor(policy, issueNumber, laneSlug) {
  const suffix = laneSlug && laneSlug !== 'root' ? `-${laneSlug}` : '';
  return `${policy.featurePrefix}issue-${issueNumber}${suffix}`;
}

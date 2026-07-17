import * as devMainPromotion from './patterns/dev-main-promotion/index.mjs';
import * as githubFlow from './patterns/github-flow/index.mjs';
import * as gitflow from './patterns/gitflow/index.mjs';

const PATTERNS = [devMainPromotion, githubFlow, gitflow];

export function listPatterns() {
  return PATTERNS.map((p) => ({ id: p.id, templateTargetPaths: p.templateTargetPaths }));
}

export function resolvePattern(config) {
  const wanted = config?.workflowPattern ?? 'dev-main-promotion';
  const found = PATTERNS.find((p) => p.id === wanted);
  if (!found) throw new Error(`resolvePattern: unknown workflowPattern "${wanted}"`);
  return found;
}

// Strips a leading '<remote>/' ONLY when it exactly matches one of repoState's
// configuredRemotes — never a blind "strip to first slash," which would corrupt a
// purely local release/1.2.0 into 1.2.0. configuredRemotes is populated by
// detect.mjs (Task 7) via `git remote` — this function takes the already-collected
// repoState, no git calls of its own, keeping it a pure, easily-testable function.
function normalizeBranchName(name, remotes) {
  for (const remote of remotes) {
    if (name.startsWith(`${remote}/`)) return name.slice(remote.length + 1);
  }
  return name;
}

const DEV_BRANCH_RE = /^(dev|develop|staging)$/;
const RELEASE_HOTFIX_RE = /^(release|hotfix)\//;

// Computes the 6 shared boolean signals every pattern's detect() consumes. Pure
// given its single repoState input (matches the contract's scoreAll(repoState)
// signature — repoPath/git calls stay confined to detect.mjs's collection step,
// Task 7 — repoState must already carry the raw material (branches,
// configuredRemotes, tags, .gitflow marker, workflow-shape scan) that step gathers.
export function computeDetectionSignals(repoState) {
  const remotes = repoState.configuredRemotes ?? [];
  const normalized = (repoState.branches?.local ?? []).map((b) => normalizeBranchName(b, remotes));
  return {
    hasDevBranch: normalized.some((b) => DEV_BRANCH_RE.test(b)),
    hasReleaseOrHotfixBranch: normalized.some((b) => RELEASE_HOTFIX_RE.test(b)),
    hasGitflowMarker: repoState.hasGitflowMarker ?? false,
    hasRestrictedPromotionWorkflow: repoState.hasRestrictedPromotionWorkflow ?? false,
    hasUnrestrictedAutomergeWorkflow: repoState.hasUnrestrictedAutomergeWorkflow ?? false,
    hasTagsFromMain: repoState.hasTagsFromMain ?? false,
  };
}

function scoreFromSignals(signals) {
  return PATTERNS.map((p) => ({ id: p.id, ...p.detect(signals) })).sort((a, b) => b.score - a.score);
}

export function scoreAll(repoState) {
  return scoreFromSignals(computeDetectionSignals(repoState));
}
// Test-only seam: exercise scoring against a hand-built DetectionSignals object
// directly, bypassing computeDetectionSignals/repoState entirely. Not part of the
// public CLI-facing API — the 5 worked-example tests above use this seam because
// they're testing the SCORING rules in isolation; the two normalization tests
// above instead call computeDetectionSignals(repoState) directly, since THAT is
// what those tests are about. Attaching a property to an exported `function`
// declaration works fine in ESM (the export binding is the function object
// itself, and function objects are ordinary mutable objects) — this is not the
// same footgun as trying to reassign a `const`-exported binding from outside the
// module, which ESM does forbid.
scoreAll.__scoreFromSignals = scoreFromSignals;

// Confident: top >= 0.7 AND (top - second) > 0.3. Greenfield: top < 0.4. Else
// Ambiguous — the residual/else branch, no separate condition to satisfy, which is
// what makes this exhaustive by construction (see design doc's Autodetection section).
export function classify(ranked) {
  const [top, second] = ranked;
  const secondScore = second?.score ?? 0;
  if (top.score >= 0.7 && top.score - secondScore > 0.3) return 'confident';
  if (top.score < 0.4) return 'greenfield';
  return 'ambiguous';
}

#!/usr/bin/env bash
#
# Repo settings + `main` branch protection for claude-skills, as code.
#
# Idempotent. Captures the GitHub configuration the auto-merge release flow depends on
# so it's reproducible and reviewable, instead of living only in the GitHub UI.
# Requires the `gh` CLI authenticated as a repo admin.
#
#   bash .github/repo-settings.sh
#
set -euo pipefail

REPO="${REPO:-natejswenson/claude-skills}"

echo "==> Enabling native auto-merge + merge commits + delete-branch-on-merge on $REPO"
# delete_branch_on_merge=true auto-cleans every merged PR's head branch. This is SAFE for
# the dev->main PR (whose head is `dev`) ONLY because `dev` is deletion-protected below, so
# GitHub skips deleting it and only feature/* heads get auto-removed.
gh api -X PATCH "repos/$REPO" \
  -F allow_auto_merge=true \
  -F allow_merge_commit=true \
  -F delete_branch_on_merge=true >/dev/null

echo "==> Enabling the dependency graph (via vulnerability alerts) for security / deps"
# `actions/dependency-review-action` in security.yml hard-fails with "Dependency review is
# not supported on this repository" unless the dependency graph is on — a 5-second failure
# that reads like a security finding and isn't one. Public repos do NOT always have it
# enabled; this one did not. Enabling vulnerability alerts is what turns the graph on
# (there is no separate dependency-graph endpoint), so this is the toggle, not a bonus.
gh api -X PUT "repos/$REPO/vulnerability-alerts" >/dev/null

echo "==> Protecting dev from DELETION (it stays push-open; only deletion is blocked)"
# Minimal protection: no required checks/PR (direct pushes to dev still allowed), force-push
# allowed, but allow_deletions=false so delete-branch-on-merge can't eat dev on a dev->main merge.
gh api -X PUT "repos/$REPO/branches/dev/protection" --input - >/dev/null <<'JSON'
{
  "required_status_checks": null,
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "allow_force_pushes": true,
  "allow_deletions": false
}
JSON

echo "==> Re-asserting main branch protection (PR + one ci/<skill> check per skill, 0 approvals)"
# Mirrors the protection the 2026-06-19 CI/CD design requires. Re-applying is a no-op
# when already in this state. required_linear_history is intentionally OMITTED so
# dev->main merge commits are allowed.
gh api -X PUT "repos/$REPO/branches/main/protection" --input - >/dev/null <<'JSON'
{
  "required_status_checks": {
    "strict": false,
    "contexts": ["ci / devlog", "ci / resume", "ci / ghostwriter", "ci / ghostwriter-x", "ci / github-stats", "ci / shipflow", "ci / city-report", "ci / press", "ci / forge", "ci / smith", "ci / assay"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 0,
    "dismiss_stale_reviews": false,
    "require_code_owner_reviews": false
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON

echo "==> Current state:"
gh api "repos/$REPO" \
  --jq '{allow_auto_merge, allow_merge_commit, delete_branch_on_merge}'
echo "    required checks:"
gh api "repos/$REPO/branches/main/protection/required_status_checks" \
  --jq '.contexts'
echo "Done."

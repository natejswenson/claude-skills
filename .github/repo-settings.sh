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

echo "==> Enabling native auto-merge + merge commits on $REPO"
# delete_branch_on_merge stays FALSE on purpose: a dev->main PR's head IS `dev`, and
# delete-on-merge would delete the long-lived `dev` branch. Keep it off to protect dev.
gh api -X PATCH "repos/$REPO" \
  -F allow_auto_merge=true \
  -F allow_merge_commit=true \
  -F delete_branch_on_merge=false >/dev/null

echo "==> Re-asserting main branch protection (PR + four ci/<skill> checks, 0 approvals)"
# Mirrors the protection the 2026-06-19 CI/CD design requires. Re-applying is a no-op
# when already in this state. required_linear_history is intentionally OMITTED so
# dev->main merge commits are allowed.
gh api -X PUT "repos/$REPO/branches/main/protection" --input - >/dev/null <<'JSON'
{
  "required_status_checks": {
    "strict": false,
    "contexts": ["ci / devlog", "ci / resume", "ci / ghostwriter", "ci / github-stats"]
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

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

echo "==> Enabling native auto-merge + squash + delete-branch-on-merge on $REPO"
# Feature PRs squash into main; only main is long-lived after cutover.
gh api -X PATCH "repos/$REPO" \
  -F allow_auto_merge=true \
  -F default_branch=main \
  -F allow_squash_merge=true \
  -F allow_merge_commit=false \
  -F allow_rebase_merge=false \
  -F delete_branch_on_merge=true >/dev/null

echo "==> Enabling the dependency graph (via vulnerability alerts) for security / deps"
# `actions/dependency-review-action` in security.yml hard-fails with "Dependency review is
# not supported on this repository" unless the dependency graph is on — a 5-second failure
# that reads like a security finding and isn't one. Public repos do NOT always have it
# enabled; this one did not. Enabling vulnerability alerts is what turns the graph on
# (there is no separate dependency-graph endpoint), so this is the toggle, not a bonus.
gh api -X PUT "repos/$REPO/vulnerability-alerts" >/dev/null

echo "==> Re-asserting main branch protection (PR + one ci/<skill> check per skill, 0 approvals)"
# Mirrors the protection the 2026-06-19 CI/CD design requires. Re-applying is a no-op
# when already in this state. The solo-maintainer approval/admin policy is preserved.
gh api -X PUT "repos/$REPO/branches/main/protection" --input - >/dev/null <<'JSON'
{
  "required_status_checks": {
    "strict": false,
    "contexts": ["ci / devlog", "ci / resume", "ci / ghostwriter", "ci / ghostwriter-x", "ci / github-stats", "ci / shipflow", "ci / city-report", "ci / press", "ci / ghfactory", "ci / skillfactory", "ci / eval", "ci / release", "ci / pluginsync", "ci / issueflow", "ci / shipreport", "ci / gmailtriage", "ci / skillhelp", "ci / brandreport", "ci / netwatch", "ci / appletv", "ci / issuecreator"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 0,
    "dismiss_stale_reviews": false,
    "require_code_owner_reviews": false
  },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON

# Compare the live policy with source after applying it.
python3 - "$REPO" "${BASH_SOURCE[0]}" <<'PYVERIFY'
import json, re, subprocess, sys
from pathlib import Path
repo = sys.argv[1]
def read(endpoint):
    return json.loads(subprocess.check_output(["gh", "api", f"repos/{repo}/{endpoint}".rstrip("/")], text=True))
r = read("")
for key, expected in {"default_branch": "main", "allow_auto_merge": True,
        "allow_squash_merge": True, "allow_merge_commit": False,
        "allow_rebase_merge": False, "delete_branch_on_merge": True}.items():
    if r.get(key) != expected:
        raise SystemExit(f"settings read-back mismatch: {key}")
p = read("branches/main/protection")
source = Path(sys.argv[2]).read_text()
expected = json.loads(re.search(r'"contexts":\s*(\[[^\]]*\])', source).group(1))
checks = p.get("required_status_checks") or {}
if sorted(checks.get("contexts", [])) != sorted(expected) or checks.get("strict") is not False:
    raise SystemExit("settings read-back mismatch: required checks")
reviews = p.get("required_pull_request_reviews")
if not isinstance(reviews, dict) or reviews.get("required_approving_review_count") != 0:
    raise SystemExit("settings read-back mismatch: PR requirement")
for key, expected in {"enforce_admins": False, "allow_deletions": False,
        "allow_force_pushes": False, "required_linear_history": True}.items():
    if p.get(key, {}).get("enabled") != expected:
        raise SystemExit(f"settings read-back mismatch: {key}")
print("Verified main settings and every required skill check.")
PYVERIFY

#!/usr/bin/env bash
# Fixture house — the shape of .github/repo-settings.sh, trimmed to the one
# thing a scaffold run has to edit: the required-check contexts array.
set -euo pipefail

gh api -X PUT "repos/${OWNER}/${REPO}/branches/main/protection" --input - <<JSON
{
  "required_status_checks": {
    "strict": false,
    "contexts": ["ci / press", "ci / tally"]
  }
}
JSON

#!/usr/bin/env bash
#
# Install (or repair) the release-radar launchd agent.
#
# Renders release_radar.plist.example against the *resolved current* location of
# this repo and (re)loads it. Idempotent — safe to re-run any time, and the fix
# whenever the repo moves. A moved repo has silently killed the radar twice
# (launchd kept firing the old absolute path, exit 127, no digest); running this
# script after any restructure is the cure.
#
# It also unloads + removes any OTHER "*linkedin-release-radar*" agents found in
# ~/Library/LaunchAgents so a stale install can't keep failing in parallel.
#
#     bash scripts/install_radar.sh
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE="$REPO/scripts/release_radar.plist.example"
AGENTS_DIR="$HOME/Library/LaunchAgents"
LABEL="com.${USER}.linkedin-release-radar"
PLIST="$AGENTS_DIR/${LABEL}.plist"

[[ -f "$TEMPLATE" ]] || { echo "ERROR: template not found: $TEMPLATE" >&2; exit 1; }
[[ -f "$REPO/scripts/release_radar.sh" ]] || { echo "ERROR: release_radar.sh not next to installer?" >&2; exit 1; }
mkdir -p "$AGENTS_DIR"

# Retire every other radar agent (stale labels/paths from before a repo move).
for old in "$AGENTS_DIR"/*linkedin-release-radar*.plist; do
  [[ -e "$old" && "$old" != "$PLIST" ]] || continue
  echo "Removing stale agent: $old"
  launchctl unload "$old" >/dev/null 2>&1 || true
  rm -f "$old"
done

sed -e "s|REPO_PATH|$REPO|g" \
    -e "s|com.example.linkedin-release-radar|$LABEL|g" \
    "$TEMPLATE" >"$PLIST"

launchctl unload "$PLIST" >/dev/null 2>&1 || true
launchctl load -w "$PLIST"

if launchctl list "$LABEL" >/dev/null 2>&1; then
  echo "Loaded $LABEL"
  echo "  script: $REPO/scripts/release_radar.sh"
  echo "  log:    $REPO/research/.radar.log"
  echo "  runs:   Mon + Thu 07:53 (edit $PLIST to change)"
  echo "Kick off a run now with: launchctl start $LABEL"
else
  echo "ERROR: agent failed to load — check: launchctl list | grep release-radar" >&2
  exit 1
fi

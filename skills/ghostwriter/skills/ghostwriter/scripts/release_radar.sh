#!/usr/bin/env bash
#
# Release Radar — twice-weekly research run for the LinkedIn ghostwriter.
#
# Runs headless `claude -p` to research recent Claude Code / Anthropic releases and
# write a dated digest to research/. Fires a macOS notification on success. This job
# does RESEARCH ONLY — it never posts to LinkedIn (LinkedIn ToS §3.1; see COMPLIANCE.md).
#
# Invoked by the launchd agent com.nate.linkedin-release-radar, or run manually:
#     bash scripts/release_radar.sh
#
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO" || exit 1

LOG="$REPO/research/.radar.log"
TODAY="$(date +%F)"
DIGEST="research/release-radar-${TODAY}.md"
PROMPT_FILE="$REPO/scripts/release_radar_prompt.md"

mkdir -p "$REPO/research"

log() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >>"$LOG"; }

# Make sure the claude CLI is reachable when launchd runs us with a minimal PATH.
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

if ! command -v claude >/dev/null 2>&1; then
  log "ERROR: 'claude' CLI not found on PATH; aborting."
  exit 127
fi

log "Release radar starting (digest: $DIGEST)"

# Append the concrete output target so the run writes a predictable filename.
# Every digest from the last ~3 weeks, so the prompt can dedup against all of them
# (deduping against only the newest file re-listed items twice; seen 2026-08-31).
RECENT_DIGESTS="$(ls -1 research/release-radar-*.md 2>/dev/null | sort | tail -6 | tr '\n' ' ')"

PROMPT="$(cat "$PROMPT_FILE")
Today is ${TODAY}. Write the digest to ${DIGEST}.
Previous digests to dedup against (read EVERY one): ${RECENT_DIGESTS:-none}"

# --max-budget-usd is a hard cost ceiling (Sonnet keeps a normal run well under it).
# acceptEdits lets the unattended run write the digest without a permission prompt
# (no TTY => prompts would auto-deny); tools are restricted to research + file writes.
claude -p "$PROMPT" \
  --model claude-sonnet-4-6 \
  --max-budget-usd 1.00 \
  --permission-mode acceptEdits \
  --allowedTools "WebSearch,WebFetch,Read,Write" \
  >>"$LOG" 2>&1

STATUS=$?

if [[ $STATUS -eq 0 && -f "$REPO/$DIGEST" ]]; then
  log "Release radar done: $DIGEST"
  osascript -e "display notification \"New digest: ${DIGEST}. Say 'draft a post from item N in the radar'.\" with title \"LinkedIn Release Radar\"" >/dev/null 2>&1
else
  log "ERROR: run exited $STATUS or digest not written ($DIGEST missing)."
  osascript -e "display notification \"Release radar run failed (exit ${STATUS}). Check research/.radar.log.\" with title \"LinkedIn Release Radar\"" >/dev/null 2>&1
  exit 1
fi

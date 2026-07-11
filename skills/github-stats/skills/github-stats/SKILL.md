---
name: github-stats
version: 0.1.1
user_invocable: true
description: Show GitHub profile statistics for a user — total commits, followers/following, stars, pull requests, and issues — as a clean summary table, plus a repository browser and per-repo detail. Use when the user asks for "github stats", "github-stats", a GitHub profile summary, "how many stars/followers/commits does <user> have", repo stats for a GitHub account, or wants to create a repo while looking at stats. Powered by the gh CLI.
---

# GitHub Stats

Show GitHub profile statistics for any username using the `gh` CLI. This is a
conversational re-make of the `github-stats-cli` app: instead of an interactive
prompt loop, the user just asks and you respond, then handle follow-ups.

All numbers come from one deterministic script — **never compute stats by hand
from raw API JSON.** Run the script and present its output.

## Prerequisites

- `gh` (GitHub CLI), authenticated: check `gh auth status`. If not authed, tell
  the user to run `gh auth login` (suggest they type `! gh auth login`).
- `jq` for the script's JSON aggregation.

The script lives next to this file at `scripts/gh-stats.sh`. Run it from the
skill directory (the folder containing this `SKILL.md`).

## Core flow — profile overview

When the user names a GitHub username (or asks for "github stats"):

```bash
scripts/gh-stats.sh overview <username>
```

This prints the five-metric summary table (commits, followers, stars, pull
requests, issues). Show that table to the user. Add `--json` if you need the
raw numbers to reason about. Note: commit counting walks the user's repos, so
for accounts with many repos it can take a little while — that's expected.

If `gh` reports the user does not exist, say so plainly and stop.

## Follow-ups

After the overview, the user may want to drill in. Map their request to a
subcommand (full catalog in `reference/commands.md`, read it when you need the
exact invocation or the repo-creation flow):

| User asks for…                      | Run |
|-------------------------------------|-----|
| just one metric in detail           | `scripts/gh-stats.sh <commits\|followers\|stars\|prs\|issues> <username>` |
| their repositories / "list repos"   | `scripts/gh-stats.sh repos <username>` |
| detail on one repository            | `scripts/gh-stats.sh repo <username> <repo-name>` |
| stats for a different user          | re-run `overview` with the new username |
| **create a new repository**         | see `reference/commands.md` → **never create without explicit confirmation** |

## Rules

- Run the script; present its output. Do not invent or recompute numbers.
- The metric definitions intentionally match the original CLI (e.g. commits are
  those authored by the user across their own repos, bounded per repo; PR/issue
  close rates are estimated from a sample). Don't "fix" them silently.
- Creating a repository is the only state-changing action. Always confirm the
  name, visibility, and description with the user first, then run the documented
  `gh repo create` command. Never auto-create.

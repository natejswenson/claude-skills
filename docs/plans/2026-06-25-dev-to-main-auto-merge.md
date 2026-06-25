---
ticket: "n/a"
title: "Auto-merge dev→main when all skill CI checks pass"
date: "2026-06-25"
source: "design"
---

# Auto-merge dev→main

Extends `2026-06-19-repo-cicd-reusable-workflows-design.md`. That design built per-skill
test gating (one required `ci / <skill>` check each, always reporting on every PR) and
per-skill releases on push to `main`. This change adds the missing piece: a `dev → main`
PR **merges itself automatically once those checks pass**, modeled on the `local-fitness`
release flow.

## Problem

Promotion to `main` was a manual merge. The required `ci / <skill>` checks already gated
it, but nothing merged the PR automatically on green, and native auto-merge was disabled
at the repo level (`allow_auto_merge: false`).

## Decisions

- **Native GitHub auto-merge**, not a custom merge action. `.github/repo-settings.sh`
  sets `allow_auto_merge: true` (+ `allow_merge_commit: true`) as code. Branch protection
  already requires the four `ci / <skill>` checks, so a PR can only auto-merge when every
  skill's CI is green; a failing check blocks it indefinitely.
- **`auto-merge.yml` enables auto-merge on the promotion PR.** On a `pull_request_target`
  targeting `main` with `head_ref == 'dev'`, it runs `gh pr merge --auto --merge`. Opening
  a non-draft `dev → main` PR therefore means "ship when green."
- **Release tagging is decoupled from auto-merge (current decision).** Auto-merge runs as the
  default `GITHUB_TOKEN`, which does not trigger downstream workflows (loop-prevention), so a
  promotion never cuts a release on its own. Release tags are a separate, deliberate step: after
  opening a `dev → main` PR the agent asks whether a release is needed and, if so, cuts
  `<skill>-v<version>` from `main` by hand (see CLAUDE.md → Release process). The per-skill `release`
  job remains in each caller, dormant under bot auto-merge — kept as the path for a future
  re-coupling (enable auto-merge via a `RELEASE_PAT` so the push-to-main release fires automatically).
  - `pull_request_target` (not `pull_request`) so the job has a write-scoped token. It
    never checks out or runs PR code — it only calls the `gh` API — so the usual
    `pull_request_target` risk does not apply.
  - **Bootstrap:** `pull_request_target` runs the workflow from the *base* (`main`), so
    this file must be on `main` before it fires. The first promotion PR (the one adding
    the file) is merged by hand; every dev→main PR after that auto-merges.
- **Merge commit, not squash.** `dev` and `main` stay linked, so `dev` never diverges and
  needs no post-merge reset (the reset automation `local-fitness` left unbuilt). Trade-off:
  `main` carries merge commits; `required_linear_history` is intentionally not set.
- **Draft PR = hold.** The workflow skips drafts, so a draft `dev → main` PR is the way to
  stage a promotion without shipping it.
- **`delete_branch_on_merge` stays false.** A `dev → main` PR's head is `dev`; enabling
  delete-on-merge would delete the long-lived `dev` branch.

## Monorepo correctness

Auto-merge is reliable regardless of which skills a promotion PR touches because the
per-skill `ci` jobs' PR triggers are un-filtered (per the 2026-06-19 design): all four
checks report on every PR — running real tests for changed skills, short-circuiting to
success for unchanged ones — so the required-check set is always satisfiable. Each changed
skill then releases its own `<skill>-v<version>` tag on the resulting push to `main`.

## Out of scope

- Coverage-gate parity: only ghostwriter enforces `--cov-fail-under`. The others run tests
  that must pass but set no coverage floor. A possible follow-up, not required here.

## Files

- `.github/workflows/auto-merge.yml` — enables native auto-merge on dev→main PRs.
- `.github/repo-settings.sh` — repo + `main` protection as code (auto-merge, required checks).
- `README.md` — "Branch & release flow" section.

## Verification

- `gh api repos/<owner>/<repo>` → `allow_auto_merge: true`, `allow_merge_commit: true`,
  `delete_branch_on_merge: false`.
- Open a no-op `dev → main` PR: the workflow enables auto-merge, the four `ci / <skill>`
  checks pass, the PR merges via a merge commit, and no skill release fires (no version
  bumped). A draft PR does not auto-merge until marked ready. `dev` still exists afterward.

# CLAUDE.md — claude-skills monorepo

A monorepo of self-contained, independently-released Claude Code skills. Each skill under
`skills/<name>/` is versioned, tested, and released on its own cadence with a namespaced tag
(`<skill>-v<version>`). This file is the source of truth for the **branch and release process** —
read it before opening any PR.

## Golden rules (read first)

- **Never PR a feature branch straight into `main`.** The only path to `main` is a `dev → main`
  promotion PR. Feature work goes `feature/* → dev`, then `dev → main`. (If a feature PR is
  accidentally opened against `main`, retarget its base to `dev`: `gh pr edit <n> --base dev`.)
- **Never push directly to `main`.** It is protected; the four `ci / <skill>` checks must pass and
  a PR is required. `dev` is unprotected — direct pushes there are fine.
- **A release is cut by a version bump, not by a merge.** To release a skill, bump its version
  (`package.json` for node skills, `SKILL.md` frontmatter `version:` for python skills) **and** add
  a `CHANGELOG.md` entry in the same change. A `dev → main` merge with no bump is a no-op release.
- **Keep this file current in the same PR.** Any change to the branch model, CI, release flow, or
  repo settings updates the relevant section here as part of that same change, not as a follow-up.

## Branch model

```
feature/* ──PR──▶ dev ──PR (auto-merge)──▶ main ──▶ per-skill release
```

- **`main`** — default + protected release branch. Required: a PR, the four `ci / <skill>` checks
  green, no force-push, no deletion. **0 required approvals** (solo maintainer self-merges).
  **`enforce_admins: false`** — the admin keeps a direct-push break-glass path; protection is a
  discipline gate for the normal flow, not a hard wall.
- **`dev`** — integration branch, **unprotected**. Land feature work here (via PR or direct push).
  `dev` is long-lived and must never be deleted.
- Merge style: **merge commit** for `dev → main` (keeps `dev` and `main` linked so `dev` never
  diverges and needs no reset). Feature → `dev` is typically squashed for a clean integration commit.

## Release process (step by step)

1. **Branch off `dev`**, do the work. If the change is a skill release, bump that skill's version +
   `CHANGELOG.md` entry. Each skill must keep its own tests green (`ci / <skill>` runs them).
2. **Land it on `dev`** — open a PR into `dev` and merge it, or push directly (dev is unprotected).
3. **Promote: open a PR from `dev` into `main`.** The **`auto-merge dev to main`** workflow
   (`.github/workflows/auto-merge.yml`) turns on GitHub native auto-merge, and the PR **merges
   itself once all four `ci / <skill>` checks pass**. If any check fails, it never merges.
   - **Hold a promotion** by opening the `dev → main` PR as a **draft** — it won't auto-merge until
     you mark it *ready for review*.
4. **On the merge to `main`**, each **changed** skill's `release` job tags `<skill>-v<version>` and
   publishes a GitHub Release from its `CHANGELOG.md` — only if that version isn't already tagged.
   Unchanged skills are untouched; a no-bump promotion releases nothing.

## CI architecture (how the gate works)

- One reusable **`_release.yml`** (`workflow_call`) + one caller **`<skill>.yml`** per skill +
  **`tools.yml`** (shared `tools/score_skill.py` scorer) + **`auto-merge.yml`**.
- Each caller has a **`ci` job** (Tier-1 `tools/score_skill.py` SKILL.md lint + the skill's own
  Tier-2 tests) and a **`release` job** (`needs: ci`, runs only on push to `main`).
- **Why all four checks always pass on any PR:** the `pull_request` trigger is **un-filtered**, so
  every `ci / <skill>` check reports on every PR — running real tests when that skill changed, and
  short-circuiting to success (via `dorny/paths-filter`) when it didn't. This is what makes the
  required-check set always satisfiable, so a `dev → main` PR can auto-merge no matter which skills
  it touches. **The `push` trigger IS path-filtered** so a skill only releases when its own files
  changed.

## Repo settings (as code)

`.github/repo-settings.sh` is the idempotent source of truth for repo + `main` protection
(run by an admin with `gh`). Key settings:

- `allow_auto_merge: true`, `allow_merge_commit: true` — required for the `dev → main` auto-merge.
- `delete_branch_on_merge: false` — **deliberate**: a `dev → main` PR's head is `dev`, so
  delete-on-merge would delete the long-lived `dev` branch. Keep it off.
- `main` required checks: `ci / devlog`, `ci / resume`, `ci / ghostwriter`, `ci / github-stats`.
  These names are the job `name:` values — **renaming a caller or its `ci` job silently
  un-requires it; update branch protection in the same change.**

**Bootstrap note:** `auto-merge.yml` runs via `pull_request_target` from the *base* branch, so it
only fires once it's on `main`. The first promotion that introduces it is merged by hand; every
`dev → main` PR afterward auto-merges.

## Adding a new skill

1. Copy a caller `<skill>.yml`. **Keep the `pull_request` trigger un-filtered** and **keep the `ci`
   job's `permissions: { contents: read, pull-requests: read }`** — both are load-bearing
   (`pull-requests: read` lets `dorny/paths-filter` detect changes under the restricted default
   token; dropping it red-lines the required check on every PR).
2. Path-filter only the `push` trigger to `skills/<skill>/**` (+ `tools/score_skill.py` + the caller).
3. Set the release call `with: { skill: <skill> }` (+ `version-source` if not auto-detectable).
4. Ensure the skill has `CHANGELOG.md` and a version (package.json or SKILL.md frontmatter).
5. **Add `ci / <skill>` to `main`'s required checks** (and to `.github/repo-settings.sh`).

## Design docs

- `docs/plans/2026-06-19-repo-cicd-reusable-workflows-design.md` — the reusable-CI + per-skill-test design.
- `docs/plans/2026-06-25-dev-to-main-auto-merge.md` — the `dev → main` auto-merge design.

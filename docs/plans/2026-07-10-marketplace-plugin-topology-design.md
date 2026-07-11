---
ticket: "N/A"
title: "claude-skills as a Plugin Marketplace"
date: "2026-07-10"
source: "design"
---

# Design: claude-skills as a Plugin Marketplace

## Architecture

The repo becomes a self-hosted, monorepo-style Claude Code plugin marketplace, matching the
official `anthropics/claude-plugins-official` pattern. `skills/` keeps its current name and
layout; each skill directory gains a `.claude-plugin/plugin.json`, and repo root gains one
`.claude-plugin/marketplace.json` listing all four via relative-path sources. This is additive,
not a rewrite: existing per-skill versioning (`package.json`/`SKILL.md`), `CHANGELOG.md`, CI
jobs, and `<skill>-vX.Y.Z` release tags are all untouched. Users install via
`/plugin marketplace add natejswenson/claude-skills` then `/plugin install <skill>@claude-skills`.
The manual `ln -sfn` symlink flow is retained as a documented fallback until the marketplace path
is live-verified end-to-end (see Install Docs for the sequencing), then removed in a fast-follow.

**Directory layout decision (auto-resolved):** `skills/` keeps its name rather than renaming to
`plugins/` to match the upstream reference repo's directory naming. The marketplace source path
is arbitrary per the Claude Code plugin spec — renaming buys nothing functionally and would touch
every CI path filter, README link, and doc reference for no benefit.

## Components

- `skills/<name>/.claude-plugin/plugin.json` × 4 — new files.
- `.claude-plugin/marketplace.json` — new file, repo root.
- `tools/lint_plugin.py` — new standalone script (deliberately separate from
  `tools/score_skill.py`, which stays a pure SKILL.md linter). Given a skill dir, asserts:
  - `plugin.json` exists and parses.
  - **`plugin.json.name` equals the directory name**, which must also equal the SKILL.md
    frontmatter `name:`. `plugin.json.name` is NEVER sourced from `package.json.name` — see the
    name/version sourcing rule below.
  - **All version fields present for the skill are mutually equal**: `plugin.json.version`,
    `SKILL.md` frontmatter `version:` (if present), and `package.json.version` (if present) must
    all be the identical string. The linter asserts equality across the whole set, not just
    `plugin.json` vs. one resolved value.
- `tools/lint_marketplace.py` — new standalone script run by a dedicated 5th CI workflow,
  `marketplace.yml` (see CI note below), not by any single skill. Asserts: `marketplace.json`
  parses; every `plugins[].source` path resolves to a real directory containing a `plugin.json`;
  the **bidirectional membership invariant** — the set of `skills/*/` directories that contain
  a `.claude-plugin/plugin.json` is exactly equal to the set of `marketplace.json` `plugins[].name`
  entries (this catches both a marketplace entry with no backing directory AND a plugin directory
  with no marketplace entry — the latter would otherwise merge green yet be non-installable);
  and the **per-row three-way name tie (S-1)** — for EVERY entry in `marketplace.json.plugins[]`,
  `entry.name == basename(entry.source)` AND the `plugin.json.name` found at that `source`
  directory also equals `entry.name`. The membership check above computes set-membership and
  existence *independently*, never joining them per row, so it passes a cross-wired manifest — e.g.
  `{name: "resume", source: "./skills/devlog"}` paired with `{name: "devlog", source: "./skills/resume"}`:
  the name-set still equals the dir-set *as a whole* and both sources still resolve to real
  `plugin.json`-containing directories, yet `/plugin install resume@claude-skills` would resolve to
  devlog's directory. The per-row tie joins manifest-entry name, source-directory basename, and the
  `plugin.json.name` at that source on the SAME row, closing that hole. It also asserts that all
  `plugins[].name` values are **unique** — duplicate entries sharing a `name` (even with distinct,
  individually-valid sources) would otherwise satisfy both the aggregate membership check and each
  row's per-row tie, yet leave `/plugin install <name>@claude-skills` ambiguous.
- Each `.github/workflows/<skill>.yml`'s existing `ci` job — extended, not replaced: add one
  Tier-1.5 step calling `lint_plugin.py`, gated the same way every other step already is. The
  nested `skills/<skill>/.claude-plugin/plugin.json` already matches the existing
  `skills/<skill>/**` glob in that skill's `dorny/paths-filter` list, so no filter change is
  needed. **Deliberately, `.claude-plugin/marketplace.json` is NOT added to any of the four
  per-skill paths-filter lists** — doing so would fire all four skills' full Tier-2 functional
  suites (npm test+audit, pytest with the 100% coverage gate + shellcheck, etc.) on a
  marketplace.json-only edit, which cannot affect any skill's behavior. Marketplace validation
  lives in the dedicated `marketplace.yml` workflow instead (see CI note).
- `.github/workflows/marketplace.yml` — **new, 5th CI workflow**, modeled on the four existing
  per-skill callers (e.g. `devlog.yml`) for its trigger/required-check topology, but **deliberately
  WITHOUT their internal `dorny/paths-filter` short-circuit**: a single `ci` job named
  **`ci / marketplace`** with an **un-filtered `pull_request` trigger** (`branches: [dev, main]`, no
  `paths:` restriction) that runs `lint_marketplace.py` **unconditionally on every PR**. The other
  four callers short-circuit to green (via `paths-filter`) when their skill is untouched purely to
  skip their EXPENSIVE Tier-2 suites (npm test+audit, 100%-coverage pytest, shellcheck);
  `lint_marketplace.py` is a sub-second JSON/path/set check, so a short-circuit would save nothing
  and would open an escape hole: (a) enumerating "the four" `plugin.json` files means the very PR
  that adds skill #5's `plugin.json` isn't in the filter and short-circuits green — disabling the
  membership check exactly when it's most needed; and (b) even a `skills/*/.claude-plugin/plugin.json`
  glob misses a NEW skill directory added with NO `plugin.json` and no `marketplace.json` edit
  (it changes none of the trigger paths), so a non-installable skill lands on `main` with the
  invariant never evaluated. Running the lint unconditionally closes both. It carries the same
  `permissions: { contents: read, pull-requests: read }` as the other callers for parity with their
  token scoping, though `marketplace.yml` doesn't use `dorny/paths-filter` (the reason that permission
  is functionally required in the other callers) — so it isn't strictly needed here, only kept for
  consistency. This is the cheap JSON/path/membership check only — it never fires any skill's
  Tier-2 functional suite.
- **`ci / marketplace` is added to `main`'s required status checks** in `.github/repo-settings.sh`,
  alongside the existing `ci / devlog`, `ci / resume`, `ci / ghostwriter`, `ci / github-stats`.
  **This deliberately reverses round 1's stated reason for avoiding a new required check.** That
  reasoning ("a 5th required check could deadlock every future `dev → main` promotion") was wrong:
  a check wired with the same un-filtered-trigger pattern as the other four always reports on every
  PR, so the required-check set stays satisfiable and auto-merge is never blocked on an unrelated PR
  — provided the required-context string exactly matches the job name. The genuine deadlock hazard is
  a required check that does NOT report on every PR (e.g. one whose `pull_request` trigger is
  path-filtered, so it never reports on PRs that don't touch its paths and the required set can never
  go all-green). Round 1 correctly avoided that hazard — but it did so by the wrong means (hosting the
  lint in `tools.yml`), which produced the Fatal below. The `tools.yml`-hosted approach is rejected
  precisely because `tools.yml`'s `pull_request` trigger is path-filtered to `tools/**` and
  `tools.yml` is not a required check: a PR that edits only the repo-root
  `.claude-plugin/marketplace.json` (which is not under `tools/**`) triggers ZERO `tools.yml` runs,
  so the membership lint never executes — and even if it did and failed, a non-required check cannot
  block `dev → main` auto-merge. The exact invariant violation the check exists to catch would merge
  green. `marketplace.yml` as a required, un-filtered check closes that hole.
  - **Rollout ordering (bootstrap rule — S1):** a brand-new required context is fail-CLOSED, unlike
    the existing four. CLAUDE.md notes the existing four fail OPEN on a job-name/context mismatch
    ("renaming a caller or its `ci` job silently un-requires it" — annoying, but PRs still merge). A
    required context that was NEVER satisfied behaves the opposite way: if the `repo-settings.sh`
    context string doesn't exactly match the job `name:` GitHub actually reports, every `dev → main`
    PR sits at "Expected — waiting for status" **forever**, with no auto-un-require escape — a total
    promotion lockout. Therefore, mirroring this repo's existing `auto-merge.yml` bootstrap pattern
    (a new mechanism that depends on being "already on `main`" is merged by hand first), sequence the
    two changes across separate steps, NOT in one PR:
    1. First, land `marketplace.yml` on `main` (present on `dev`, promoted via a normal `dev → main`
       PR) and observe `ci / marketplace` actually run and pass on a PR.
    2. Only then, as a separate later step, add `ci / marketplace` to `main`'s required checks in
       `repo-settings.sh` and apply the branch-protection change.
    Before applying step 2, verify the job `name:` string in `marketplace.yml` and the context string
    in `repo-settings.sh` are **character-for-character identical** — because this check fails CLOSED,
    a mismatch here is a permanent lockout until fixed, not the silent un-require the other four
    degrade to.
- `README.md` (install section + repo layout diagram) and `CLAUDE.md` — updated in the same PR per
  the repo's own convention. Two `CLAUDE.md` sections must change, not just one:
  - **"Adding a new skill"** checklist — add the `plugin.json` + `marketplace.json` steps and the
    `ci / marketplace` required-check step.
  - **"Release process (step by step)"** runbook — its step 5 currently says to bump "`package.json`
    for node skills, `SKILL.md` frontmatter `version:` for python skills" and does NOT mention
    `plugin.json`. Because `plugin.json.version` is now a required-equal field (lint fails if it
    diverges), every release gains a mandatory `plugin.json.version` sync step. This runbook must be
    updated in the same implementation PR to list `plugin.json.version` alongside the existing
    package.json/SKILL.md bump instruction — otherwise the documented release flow produces a
    lint-failing tree.

**Name/version sourcing rule (load-bearing — F1):** `plugin.json.name` MUST equal the skill's
directory name, which is also its SKILL.md frontmatter `name:`. It is the identifier
`/plugin install <skill>@claude-skills` resolves, so it must be the directory name and nothing
else. It is explicitly NOT taken from `package.json.name` — those are unreliable for this purpose:
`skills/devlog/package.json` has `name: "@natjswenson/devlog"` (scoped, and with a typo — missing
the "e"), `skills/resume/package.json` has `name: "resume-skill"`, and `ghostwriter`/`github-stats`
have no `package.json` at all. Only **`version`** follows the repo's existing package.json-first
resolver precedent; **`name` does not follow it** and is pinned to the directory name.

**Why static-committed plugin.json + lint, not generation (S4):** a generator that emits
`plugin.json` from SKILL.md/package.json would prevent the name/version drift class outright, and
was considered. It is deliberately rejected: the F1/S1/S3 fixes already pin `name` (to the
directory) and `version` (mutual-equality across all fields) unambiguously and add bidirectional
membership checking, so the residual drift surface the lint must catch is small; and a static
committed `plugin.json` matches the upstream `claude-plugins-official` convention without
introducing a new generator script (plus its own tests and failure modes) to maintain. The
tradeoff accepted: authors hand-edit one extra `version` field per release, caught by lint at PR
time if forgotten.

## Data Flow

- **Maintainer path:** bump `package.json`/`SKILL.md` version as today → `plugin.json` version
  must be bumped to match in the same commit → `lint_plugin.py` (inside the now-extended
  `ci / <skill>` job) fails the `dev → main` PR if the version fields aren't all mutually equal →
  merge to `main` → existing `release` job (`needs: ci`) cuts the tag, unchanged. No
  `_release.yml` changes needed.
  - **Where the gate actually runs (corrected — S2):** the version-consistency gate is enforced
    ONLY at `dev → main` PR time, where the skill's diff is present for `dorny/paths-filter` to
    match and the `lint_plugin.py` step therefore runs. It is NOT independently enforced at
    release time. The real release trigger is `workflow_dispatch` (the bot auto-merge doesn't fire
    `push` events — see CLAUDE.md), and on a `workflow_dispatch` run there is no PR diff for
    `paths-filter` to compare against, so the filter reports no changes, the lint step (gated on
    that filter output) is skipped, and `ci` passes trivially without ever running the gate.
    This is an **accepted residual risk**: the PR-time gate normally catches version drift before
    the promotion merges, so a dispatched release almost always runs against an already-validated
    tree. It is explicitly NOT a claim that release time is separately covered.
- **User path:** `/plugin marketplace add natejswenson/claude-skills` reads root
  `marketplace.json` → lists 4 plugins (version shown is *assumed* to resolve from each
  `plugin.json`, since `marketplace.json` entries deliberately omit `version` to avoid a 4th sync
  point — this loader behavior is an **open risk**, see Error Handling) →
  `/plugin install <skill>@claude-skills` pulls from that skill's relative-path source at
  whatever ref the marketplace was added at.
- **Versioning semantics (S-2 — the seam, made explicit):** `/plugin marketplace add
  natejswenson/claude-skills` uses GitHub shorthand, which resolves to the repo's default branch
  (`main`) HEAD — NOT to any `<skill>-vX.Y.Z` release tag. Because all four `plugins[].source`
  entries are relative paths inside this ONE repo, a single marketplace-add pins ALL FOUR skills to
  that ONE ref; a user cannot pin one skill to its release tag while taking another at HEAD through
  this install path. And since a release here is a separate, deliberate per-skill `workflow_dispatch`
  (CLAUDE.md), `main` HEAD routinely contains unreleased `dev → main`-promoted work. Net: marketplace
  installs track `main` HEAD and are structurally decoupled from the `<skill>-vX.Y.Z` release-tag
  cadence that is this repo's defining feature. This is a **deliberate, accepted decoupling** between
  "installed version" and "released version," not an oversight — stated here so no one assumes
  marketplace installs respect release tags.

## Error Handling

- Missing `plugin.json` → `lint_plugin.py` fails that skill's `ci` job with an explicit error
  naming the missing file (mirrors the existing "Could not resolve a version" pattern in
  `_release.yml`).
- `plugin.json.name` ≠ directory name (or ≠ SKILL.md frontmatter `name:`) → `lint_plugin.py` fails
  with all three values printed. This is the guard that keeps `/plugin install <skill>@claude-skills`
  installable regardless of what `package.json.name` happens to be.
- Any two version fields diverge (`plugin.json` vs. `SKILL.md` vs. `package.json`, whichever are
  present) → same job fails with every field's value printed, so the fix is a one-line diff.
- `marketplace.json` fails to parse as JSON → `lint_marketplace.py` fails the `ci / marketplace` job
  with an explicit parse error.
- `marketplace.json` entry with a `source` path that doesn't resolve, OR a `skills/*/` directory
  with a `plugin.json` but no matching `marketplace.json` entry (or vice versa), OR a cross-wired
  manifest whose per-row name/source/`plugin.json.name` don't all tie (e.g. `{name: "resume",
  source: "./skills/devlog"}` paired with `{name: "devlog", source: "./skills/resume"}` — which
  passes the aggregate bidirectional membership check yet mis-resolves an install) → caught by
  `lint_marketplace.py` in the dedicated, required `ci / marketplace` workflow (`marketplace.yml`).
  Because that check's `pull_request` trigger is un-filtered and it is a required status check, the
  violation reliably shows the check red on any PR — including a PR that edits only
  `marketplace.json` — and blocks the `dev → main` auto-merge. Validation runs exactly once (not
  redundantly across four skills), since `marketplace.json` is repo-owned rather than owned by any
  single skill.
- **Open risks, not fully resolved by investigation** (all unverified against the live Claude Code
  product — implementation must verify each before/during build, not trust this design doc):
  - **File schema itself (foundational — S3):** this doc treats the `plugin.json`/`marketplace.json`
    schema (exact field names, the `.claude-plugin/` file locations, and — critically — whether
    `plugins[].source` is a plain resolvable path string vs. an object/URL form) as settled fact
    "matching the `anthropics/claude-plugins-official` pattern." It is NOT independently verified. This
    is more foundational than the two loader-behavior risks below: `lint_marketplace.py`'s entire
    membership-check design (and the required-check architecture built on it) assumes
    `plugins[].source` is a resolvable path string it can walk to a directory. **Before writing
    `lint_marketplace.py`, confirm against the actual reference repo or current Claude Code plugin
    docs: the exact `marketplace.json` field set, the `plugins[].source` shape (string path vs.
    object), and the `.claude-plugin/` file locations.** If `source` turns out not to be a plain
    resolvable path, the membership-lint design — not just a one-file edit — must be revisited.
  - **SKILL.md discovery:** it's unconfirmed whether Claude Code auto-discovers a skill's `SKILL.md`
    at the plugin root or requires an explicit path in `plugin.json` (e.g. a `skills` field). A
    wrong guess here means the plugin installs but doesn't register the skill.
  - **Version resolution from `plugin.json`:** the design assumes `marketplace.json` entries can omit
    `version` and the marketplace listing will resolve/display each plugin's version from its own
    `plugin.json`. This is asserted in Data Flow but is the same class of unverified loader behavior
    as SKILL.md discovery — if the listing instead requires an explicit per-entry `version`, the
    "omit version to avoid a 4th sync point" decision must be revisited.

## Testing

`lint_plugin.py` and `lint_marketplace.py` each get their own unit tests under `tools/` (mirroring
how `score_skill.py` is tested today). Existing per-skill Tier-2 test suites are untouched.

**CI-wiring acceptance criterion (regression-critical — the test that would have caught the round-2
Fatal):** a PR that edits ONLY `.claude-plugin/marketplace.json` into a membership-invariant-violating
state (e.g. removing a `plugins[]` entry whose directory still has a `plugin.json`, or a `source`
that no longer resolves) MUST show the required check **`ci / marketplace` red** — proving the check
both runs on a marketplace-only edit (un-filtered trigger) and can block `dev → main` auto-merge
(required status). A second, S2-specific criterion: a PR that adds a NEW skill directory containing
a `plugin.json` but no matching `marketplace.json` entry (and touches no other plugin/marketplace
file) MUST also show `ci / marketplace` red — proving the lint runs UNCONDITIONALLY, not gated by a
`paths-filter` short-circuit that this exact PR would slip through. Conversely, a PR whose tree
satisfies the membership invariant shows `ci / marketplace` green — because the (cheap, sub-second)
lint ran and passed, NOT because it was skipped. A third criterion covers the per-skill wiring: a PR
that touches ONLY a skill's `skills/<skill>/.claude-plugin/plugin.json` (no other file) MUST show
that skill's `ci / <skill>` check actually RUN the Tier-1.5 `lint_plugin.py` step — proving the
nested `plugin.json` path is matched by the existing `skills/<skill>/**` paths-filter glob and the
step is not skipped.

**Manual smoke test (gates the fallback-removal fast-follow — see Install Docs):** `/plugin
marketplace add ./` (local source, confirmed supported for testing) → install each of the 4 →
confirm each skill still triggers correctly. This can't be automated in CI since it requires a live
Claude Code session. The `ln -sfn` fallback docs stay in place until this smoke test passes
end-to-end; only then does the fast-follow removal land.

## API Surface

- `plugin.json`: `name` (== directory name == SKILL.md `name:`), `description`, `version` (synced
  across all present version fields), `author`, `homepage`, `license` — no
  `skills`/`commands`/`agents` override fields unless the open risk above forces one.
- `marketplace.json`: `name: "claude-skills"`, `owner.name`, `plugins[]` = `{name, source}` only
  (no per-entry `version`). Each `plugins[].name` must equal the directory name of its `source`.
- `tools/lint_plugin.py <skill-dir>` — new CLI, same invocation shape as `score_skill.py`.
- `tools/lint_marketplace.py` — new CLI, run once by the required `marketplace.yml` (`ci /
  marketplace`) workflow; validates `marketplace.json` parse + `source` resolution + the
  bidirectional membership invariant + the per-row three-way name tie (`entry.name ==
  basename(entry.source) ==` the `plugin.json.name` at that source — the S-1 check that closes the
  cross-wired-manifest hole the aggregate membership check alone doesn't catch).
- User-facing: `/plugin marketplace add natejswenson/claude-skills`,
  `/plugin install <skill>@claude-skills`.

## Invariants

- **Checkable by inspection:** every `skills/<name>/` has `.claude-plugin/plugin.json`; every
  `marketplace.json` `source` resolves to a directory containing one; the set of `skills/*/`
  directories containing a `plugin.json` equals the set of `marketplace.json` `plugins[].name`
  entries (bidirectional — no orphans in either direction); every `plugin.json.name` equals its
  directory name and its SKILL.md `name:`; all present version fields per skill (`plugin.json`,
  `SKILL.md`, `package.json`) are mutually equal; no `marketplace.json` entry sets `version`.
- **Testable (CI):** `lint_plugin.py` fails on missing `plugin.json`, on a name that isn't the
  directory name, or on any version-field divergence; `lint_marketplace.py` (in the required
  `ci / marketplace` workflow) fails on a broken `source` path, on an aggregate membership-set
  mismatch, OR on a **per-row name mismatch (S-1)** — for any `plugins[]` entry where `entry.name`,
  `basename(entry.source)`, and that source's `plugin.json.name` are not all the identical string
  (this per-row three-way tie is what rejects a cross-wired manifest that satisfies the aggregate
  set-equality check yet mis-resolves an install); and a marketplace-only PR that violates any of
  these shows `ci / marketplace` red. `ci / marketplace`
  runs its lint UNCONDITIONALLY on every PR (no `paths-filter` short-circuit — see Components, S2), so
  on an unrelated change it goes green by running the sub-second lint and passing, not by skipping;
  the existing four `ci / <skill>` checks retain their own short-circuit-to-green on unrelated changes
  (that is what skips their expensive Tier-2 suites — regression-critical, must be manually
  reconfirmed). Note the version gate is a PR-time check only, not a release-time one (see Data Flow,
  S2).

## Install Docs

The `/plugin marketplace add` + `/plugin install` flow becomes the primary, documented install
path in `README.md` and `skills/resume/README.md`. **The `ln -sfn` symlink instructions are NOT
deleted in the same change** — deleting the only known-working install method before its
replacement is live-verified is a rollback trap (the marketplace path depends on the unverified
SKILL.md-discovery loader behavior in the Error Handling open-risk list). Instead:

1. In this PR, keep the existing `ln -sfn` block, demoted under a **"Manual install / fallback"**
   heading beneath the new marketplace instructions.
2. Run the Testing section's manual smoke test to verify the marketplace install path end-to-end.
3. Only once that smoke test passes, land a **fast-follow** change that removes the `ln -sfn`
   fallback block.

This ordering guarantees there is always at least one documented, working install method at every
commit.

## Addendum (2026-07-11) — SKILL.md auto-discovery correction

The Error Handling open-risk list flagged SKILL.md auto-discovery behavior as unverified and
assumed a root-level `SKILL.md` (directly at `skills/<name>/`, the plugin `source` itself) would
be discovered. **That assumption was wrong.** After the initial promotion (PR #30/#31), a Claude
Desktop install of `ghostwriter@claude-skills` showed "This plugin doesn't have any skills or
agents." Root-caused against `anthropics/claude-plugins-official`'s own `plugin-dev` skill
documentation and all 23 real `SKILL.md` files across that marketplace (zero exceptions): Claude
Code's plugin auto-discovery scans `skills/` for **subdirectories** containing `SKILL.md` — never
a root-level file. The CLI (`claude plugin details`) tolerated the root-level file via an
undocumented fallback; Claude Desktop does not.

Fixed in a follow-up (`feature/plugin-skill-discovery-fix`): each skill's functional content
(`SKILL.md`, `scripts/`, `tests/`, etc.) moved one level deeper to
`skills/<name>/skills/<name>/`, the documented auto-discovery path. Only `.claude-plugin/`,
`LICENSE`, `README.md`, `CHANGELOG.md` stay at the outer plugin root. See `CLAUDE.md`'s "Adding a
new skill" checklist (item 9) for the corrected convention going forward.

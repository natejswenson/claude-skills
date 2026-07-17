---
ticket: "N/A"
title: "shipflow: multi-pattern workflow templates (dev-main-promotion, github-flow, gitflow) with autodetection"
date: "2026-07-16"
source: "design"
---

# shipflow: multi-pattern workflow templates with autodetection

## Overview

shipflow today hard-codes exactly one branching/release-automation shape: long-lived
`dev`/`main`, feature branches off `dev`, a `dev → main` promotion PR that auto-merges on
green, and release tagging keyed off that promotion. This design generalizes shipflow to
support **three** named workflow patterns as first-class, independently-selectable
templates, and adds **deterministic autodetection** so a repo running shipflow for the
first time gets its existing pattern recognized rather than being force-fit into
`dev-main-promotion`.

This does not change what shipflow already does for repos on the existing pattern — it
factors that behavior out into one of three interchangeable pattern modules, adds two new
ones, and adds a selection layer (detect → confident-auto-select, or ambiguous/greenfield →
ask) in front of all three.

## Research: which patterns earn a template

Web research (JetBrains 2023 developer survey; multiple 2026 git-workflow comparison
pieces) converges on five commonly-named patterns: GitHub Flow, GitFlow, GitLab Flow,
Trunk-Based Development, and (Microsoft's) Release Flow. Two findings shaped scope:

- **GitFlow has fallen to ~22% adoption and is still declining**, but it remains the
  standard for software that must maintain multiple released versions concurrently
  (libraries, packaged apps) — a real, distinct shape from either GitHub Flow or this
  repo's own promotion model.
- **Trunk-Based Development does not need its own template.** Its distinguishing
  practice — very short branch life plus feature flags — is a coding discipline, not a
  distinct branch-protection/auto-merge/release-tagging shape. For everything shipflow
  actually automates, a TBD repo is indistinguishable from a GitHub-Flow repo (single
  long-lived `main`, no long-lived integration branch).

**Decided scope: three templates.**

| Pattern id | Shape | Real-world fit |
|---|---|---|
| `dev-main-promotion` | Long-lived `dev` + `main`; promotion PR auto-merges | This repo's existing, already-built pattern |
| `github-flow` | Single long-lived `main`; feature branches merge (and auto-merge) directly to `main` | Dominant pattern for small teams / most GitHub repos; also covers trunk-based-style usage |
| `gitflow` | `develop` + `main` + transient `release/*`/`hotfix/*` branches | Declining but still the standard for multi-version-maintained software |

GitLab Flow (environment branches) and Release Flow are deferred — no evidence of demand
in this repo's own use case, and adding either now would violate the "lean set of
well-chosen templates" constraint. A future pattern module can be added later without
touching this design's registry mechanics.

## Architecture: pattern registry

`detect.mjs`/`plan.mjs`/`apply.mjs` become thin dispatchers over a registry of
self-contained pattern modules — the same "one dir per concern, deterministic code
corralled" convention already used elsewhere in this monorepo.

```
skills/shipflow/skills/shipflow/
  lib/
    detect.mjs              # generalized: loops over pattern registry for scoring
    plan.mjs                # generalized: loops over pattern registry for plan entries
    apply.mjs                # generalized: dispatch stays generic (see below)
    pattern-registry.mjs     # NEW — imports the 3 pattern modules, exposes
                             #   listPatterns(), resolvePattern(config), scoreAll(repoState)
    render.mjs, gh.mjs        # unchanged
    patterns/
      dev-main-promotion/
        index.mjs            # detect(), planEntries(), templates(), protectedBranches()
      github-flow/
        index.mjs
      gitflow/
        index.mjs
  templates/
    dev-main-promotion/dev-to-main-automerge.yml.tmpl      # relocated, unchanged content
    github-flow/main-automerge.yml.tmpl                    # NEW
    gitflow/release-automerge.yml.tmpl                     # NEW
    gitflow/hotfix-automerge.yml.tmpl                      # NEW
    gitflow/hotfix-merge-back.yml.tmpl                     # NEW
```

**Pattern module contract** (every pattern under `lib/patterns/<id>/index.mjs` exports the
same shape — this is the extension point for any future 4th pattern):

```js
export const id = '<pattern-id>';                        // matches directory name
export function detect(repoState) -> { score: number, evidence: string[] }
export function protectedBranches(config) -> string[]     // long-lived branches to
                                                            // deletion-protect
export function templates(config) -> Array<{
  id: string, targetPath: string, templateSource: string, params: object
}>
export function planEntries(repoState, config) -> PlanEntry[]  // pattern-specific
                                                                 // entries beyond the
                                                                 // 3 common ones below
```

Three plan entries stay common across every pattern (unchanged logic in `plan.mjs`,
just parameterized by `pattern.protectedBranches(config)` instead of a hardcoded
`[dev, main]`):
`delete-branch-on-merge`, `deletion-ruleset`, `release-pending-label`. Everything
pattern-specific (which workflow files exist, what their `if:` guards match) lives in
the pattern module.

`apply.mjs`'s dispatch (`applyOne`) needs one concrete change: `deletion-ruleset`
currently hardcodes `refs/heads/${config.branches.dev}` / `${config.branches.main}` in
the ruleset's `ref_name.include` list — it must instead map
`config.branchCleanup.protectedBranches` (now pattern-derived) to `refs/heads/<name>`
generically. Everything else in `applyOne`'s existing per-id dispatch (`template:`
prefix handling, hash recording) already generalizes to "however many template entries
the resolved pattern contributes" with no further change — it was written generically
enough (`templateSource` was already a parameter, not a hardcoded import).

## Config schema changes (backward compatible)

```json
{
  "workflowPattern": "dev-main-promotion",
  "branches": { "main": "main", "dev": "dev" },
  "requiredChecks": [],
  "mergeMethod": { "featureToDevMethod": "squash", "devToMainMethod": "merge" },
  "protectionOwner": "external",
  "release": { "...": "unchanged from existing schema" },
  "branchCleanup": { "deleteOnMerge": true, "protectedBranches": ["dev", "main"] },
  "enforceAdmins": false,
  "renderedTemplateHashes": {},
  "patternConfig": {
    "gitflow": {
      "developBranch": "develop",
      "releaseBranchPrefix": "release/",
      "hotfixBranchPrefix": "hotfix/"
    }
  }
}
```

- **`workflowPattern`** is the only new top-level field. `branches.dev` is reused as the
  shared "second long-lived branch" name for both `dev-main-promotion` and `gitflow`
  (gitflow conventionally calls it `develop`; the field just holds whatever name the
  repo uses) — `github-flow` ignores this field entirely.
- **`patternConfig.<id>`** holds fields meaningful to exactly one pattern. Only
  `gitflow` needs one in v1 (its two branch-prefix conventions); `github-flow` needs
  none. This is a discriminated union in practice, not a formal JSON-schema `oneOf` —
  each pattern module reads only its own `patternConfig[pattern.id]` key and ignores the
  rest, keeping validation logic inside the module that owns the meaning of its fields
  (matching this codebase's existing "no heavy schema-validation dependency" style —
  the only current devDependency is `yaml`).
- **`branchCleanup.protectedBranches`** is no longer always `[dev, main]` — it's
  computed by `pattern.protectedBranches(config)`: `[main]` for `github-flow`,
  `[dev, main]` for `dev-main-promotion`, `[developBranch, main]` for `gitflow`.
  `release/*`/`hotfix/*` are deliberately **not** protected from deletion under
  gitflow — they're transient, cleaned up post-merge exactly like feature branches
  under every other pattern.

**Backward compatibility is a hard invariant, not a migration task.** This repo's own
live `.github/shipflow.json` has no `workflowPattern` field today. Config loading treats
absence of the field as an implicit `"dev-main-promotion"` — the only pattern that
existed before this design — so this repo's production automation keeps running with
**zero file changes required**. `renderedTemplateHashes` keys reference the *target
repo's* output path (`.github/workflows/dev-to-main-automerge.yml`), not the skill
package's internal template location, so relocating the shipped template file under
`templates/dev-main-promotion/` does not invalidate any already-recorded hash either.

## Autodetection

Detection only ever runs **once, on first-run setup against a repo with no existing
`.github/shipflow.json`.** A re-run never re-detects or second-guesses an
already-recorded `workflowPattern` — identical to how branch names/checks/
protectionOwner are already handled today.

Each pattern module's `detect(repoState)` is a small, deterministic point-scoring
function (no ML, no fuzzy matching — a fixed rule table per pattern, unit-testable in
isolation against synthetic `repoState` fixtures):

- **`github-flow`**: +0.5 if no branch matches `/^(dev|develop|staging)$/`; +0.3 if no
  branch matches `/^(release|hotfix)\//`; +0.2 if tags exist reachable from `main` and
  no `dev-to-main-automerge`-shaped workflow is present.
- **`dev-main-promotion`**: +0.5 if a `dev`/`develop`/`staging`-named branch exists;
  +0.3 if an existing workflow file matches the promotion shape (triggers on
  `pull_request` to `main`, a job enabling `gh pr merge --auto`); +0.2 if no
  `release/*`/`hotfix/*` branches exist (rules out gitflow overlap).
- **`gitflow`**: +0.3 if a `develop`/`dev`-named branch exists; +0.5 if any branch
  matches `/^(release|hotfix)\//`; +0.2 if a `.gitflow` marker file or
  `git config --get gitflow.branch.develop` is present (best-effort bonus signal, not
  required — branch naming is the primary, most reliable signal since it doesn't
  depend on the historical git-flow CLI tool having been used).

`pattern-registry.mjs` ranks all three by score. Deterministic thresholds decide what
happens next — this is code, not a judgment call:

- **Confident** (`top.score ≥ 0.7` and `top.score − secondPlace.score ≥ 0.3`): resolve
  to that pattern automatically. `SKILL.md` states what was detected and why (the
  `evidence[]` array), then proceeds straight to that pattern's parameter-confirmation
  interview — it still goes through the existing mandatory confirm-before-write
  checkpoint (a confident auto-detect is not a substitute for the user confirming the
  actual values, per this skill's existing UX bar).
- **Ambiguous** (two patterns within 0.3 of each other) or **greenfield**
  (`top.score < 0.4` — e.g. a brand-new repo with only `main` and nothing else):
  `SKILL.md` presents all three templates with a one-line description and the detected
  evidence (if any), and asks the user to choose. This is the explicit judgment call
  kept in markdown, not code. For a genuinely greenfield repo, `SKILL.md` may suggest
  `github-flow` as the lightweight starting recommendation (matching the research —
  it's the dominant real-world shape for new/small projects) but never silently
  auto-picks it.

## Templates per pattern

- **`dev-main-promotion`**: unchanged — the existing `dev-to-main-automerge.yml.tmpl`,
  relocated.
- **`github-flow`**: `main-automerge.yml.tmpl` — triggers on any PR to `main` (no
  head-ref restriction, since there's no second long-lived branch to distinguish
  promotions from ordinary feature merges); enables native auto-merge on open/
  reopen/synchronize; the `release-pending` label job fires on every merge to `main`
  with no head-ref guard.
- **`gitflow`**: three templates —
  - `release-automerge.yml.tmpl`: PR from `release/*` → `main`, same auto-merge +
    label shape as `dev-main-promotion`, head-ref guard matches the configured
    `releaseBranchPrefix`.
  - `hotfix-automerge.yml.tmpl`: PR from `hotfix/*` → `main`, identical shape, guard
    matches `hotfixBranchPrefix`.
  - `hotfix-merge-back.yml.tmpl`: triggered on `pull_request: closed` for `main`,
    guarded on `merged == true && head.ref` matching `hotfixBranchPrefix`. Checks out
    `developBranch`, attempts `git merge origin/main --no-edit`, and pushes on success.
    **On a merge conflict, it does not attempt resolution** — it opens a PR from a
    temporary branch (`main` → `develop`) for human resolution, flagged clearly, the
    same "surface the conflict, never silently guess" precedent this design already
    uses for hand-edit detection. This automates the behavior real GitFlow's
    `git flow hotfix finish` performs atomically (confirmed via research: the
    dual-merge is the *defining* semantic of a hotfix branch, not an optional
    convention — existing tools like `gitflow-workflow-action` automate exactly this
    shape) without requiring a bespoke polling/blocking job (the class of complexity
    this repo's existing design already rejected for a different reason — see
    `AMB-3` in the prior shipflow contract).

**Scoped out of v1, documented explicitly:** if a release branch is concurrently open
when a hotfix lands, real GitFlow says the hotfix should merge into that release
branch instead of `develop`. v1's `hotfix-merge-back` always targets `develop` — this
is a narrow, named simplification, not a silent gap.

## Data flow

**First run, no existing config:** `detect.mjs` collects `repoState` (branches, workflow
job names, existing template file hashes) as today, then calls
`pattern-registry.mjs`'s `scoreAll(repoState)`. Confident → proceed directly into that
pattern's interview. Ambiguous/greenfield → `SKILL.md` presents the 3 templates,
user picks. Either way, the resolved `pattern.id` is written into `config.workflowPattern`,
and only that pattern's relevant fields (`branches.dev`, `patternConfig.gitflow`, etc.)
are asked about — a `github-flow` setup never asks about a dev branch name at all.

**Re-run / audit:** identical to today — `workflowPattern` (explicit or back-compat
implicit) is read, never re-detected, never re-asked unless the user explicitly
requests reconfiguration.

**Pattern change (reconfigure):** switching `workflowPattern` on an existing repo is
explicitly out of scope for `plan.mjs`'s idempotent diffing — it is not a
"noop/update/create" style change but a structural migration (e.g. `dev-main-promotion`
→ `github-flow` means retiring the promotion workflow and reprotecting only `main`).
v1 requires the user to explicitly say they want to switch patterns, and `SKILL.md`
treats it the same as first-run setup for the fields that change, rather than trying to
compute an automatic transition plan.

## Error handling / edge cases

- **Greenfield repo, ambiguous detection:** already covered above — no default is
  silently applied.
- **`hotfix-merge-back` conflict:** never force-pushes or auto-resolves; opens a
  flagged PR, matching the existing hand-edit-detection philosophy of "surface, don't
  guess."
- **A repo has both a `dev` branch and `release/*`/`hotfix/*` branches** (mid-migration
  between patterns, or genuinely ambiguous): both `dev-main-promotion` and `gitflow`
  score non-trivially; this is exactly the "ambiguous" case the threshold rule routes
  to an explicit user choice, not a silent pick.
- **Existing `.github/shipflow.json` with no `workflowPattern`:** treated as
  `dev-main-promotion`, unconditionally, forever (until the user explicitly
  reconfigures) — see Backward compatibility, above.

## API surface (additions to the existing contract)

- `pattern-registry.mjs`:
  - `listPatterns(): Array<{ id: string }>`
  - `resolvePattern(config): PatternModule` — reads `config.workflowPattern`, defaulting
    to `"dev-main-promotion"` when absent.
  - `scoreAll(repoState): Array<{ id: string, score: number, evidence: string[] }>`
    sorted descending by score.
- Each `lib/patterns/<id>/index.mjs`: `detect`, `protectedBranches`, `templates`,
  `planEntries` — see Architecture, above, for signatures.
- `detectRepoState`, `computePlan`, `applyPlan` keep their existing signatures
  unchanged; their internals now loop over the registry instead of one hardcoded
  pattern.

## Invariants (new, additive to the existing skill-invariants.json set)

**Checkable:**
- A config with no `workflowPattern` field resolves to `dev-main-promotion` everywhere
  it's read — never `undefined`, never a crash, never a different implicit default.
- `deletion-ruleset`'s `ref_name.include` list is always derived from
  `config.branchCleanup.protectedBranches`, never a hardcoded `[dev, main]` literal.
- `release/*`/`hotfix/*` branches never appear in `branchCleanup.protectedBranches`
  under `gitflow`.
- Detection (`scoreAll`) only runs when `existingConfig` is `null`; a re-run with an
  existing config never calls it.

**Testable:**
- Given a synthetic `repoState` with a `develop` branch and an open `release/1.2.0`
  branch, `scoreAll` ranks `gitflow` above the other two.
- Given a synthetic `repoState` with only `main` and no other signals, all three scores
  fall below the greenfield threshold.
- `hotfix-merge-back`'s conflict path: simulate a `develop` branch that has diverged
  from `main` in a conflicting way; assert a PR is opened and no force-push or silent
  resolution occurs.
- Running `apply.mjs` twice against an unchanged `github-flow`-pattern repo produces
  zero mutating calls on the second run (same idempotency invariant as
  `dev-main-promotion` today, re-verified per pattern).

## Testing strategy

Unit tests per pattern module (`detect`, `protectedBranches`, `templates`) against
synthetic `repoState` fixtures — no network/`gh` calls, matching the existing
`detect.test.mjs`/`plan.test.mjs` style. Integration tests (sandbox repo, same tier as
the existing `INV-9`/`INV-11`/`INV-17`-style tests) for: `github-flow`'s single-branch
protection setup end-to-end, and `gitflow`'s hotfix-merge-back both on the clean-merge
and conflict paths.

## Out of scope / deferred

- GitLab Flow (environment branches), Release Flow (Microsoft) — no evidence of demand;
  the registry mechanics make adding either later a contained change (new
  `lib/patterns/<id>/`, no changes to `detect.mjs`/`plan.mjs`/`apply.mjs` dispatch
  logic).
- Automatic `workflowPattern` migration/transition tooling (switching patterns on an
  already-adopted repo) — explicitly a first-run-shaped operation in v1, not a diffed
  transition plan.
- Hotfix-into-open-release-branch targeting (real GitFlow's rule when a release branch
  is concurrently open) — always targets `develop` in v1.

## Migration note for this repo (`claude-skills`)

No action required. `claude-skills`'s own `.github/shipflow.json` has no
`workflowPattern` field and will continue to resolve to `dev-main-promotion` — its
current, live pattern — with no file changes. Adopting this design here means only:
relocating the one existing template file into `templates/dev-main-promotion/`, and
updating `renderedTemplateHashes` bookkeeping is *not* required since those hashes key
off the target-repo output path, not the skill package's internal layout.

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
    gh.mjs                   # unchanged
    render.mjs               # gains exactly two new TOKEN_VALIDATORS/TOKEN_TO_PARAM
                             #   entries (RELEASE_BRANCH_PREFIX, HOTFIX_BRANCH_PREFIX)
                             #   plus a self-check assertion tying the two maps
                             #   together (see below)
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
    gitflow/release-merge-back.yml.tmpl                    # NEW
```

**Pattern module contract** (every pattern under `lib/patterns/<id>/index.mjs` exports the
same shape — this is the extension point for any future 4th pattern):

```js
export const id = '<pattern-id>';                        // matches directory name
export const templateTargetPaths = ['<path>', ...];      // NEW — a plain constant
                                                            // array, NOT a function:
                                                            // the fixed
                                                            // .github/workflows/*.yml
                                                            // path(s) this pattern
                                                            // always writes,
                                                            // independent of any
                                                            // config. Target file
                                                            // PATHS never depend on
                                                            // config in this design —
                                                            // only the rendered
                                                            // CONTENT (params) varies
                                                            // — so this can be a
                                                            // constant, not `templates()`
export function detect(signals) -> { score: number, evidence: string[] }
                                                            // signals: the precomputed
                                                            // DetectionSignals object
                                                            // (see below) — NOT raw
                                                            // repoState
export function protectedBranches(config) -> string[]     // long-lived branches to
                                                            // deletion-protect
export function templates(config) -> Array<{
  id: string, targetPath: string, templateSourcePath: string, params: object
}>                                                          // templateSourcePath is a
                                                             // PATH to the .tmpl file
                                                             // within the skill package
                                                             // — NOT its content. Each
                                                             // entry's targetPath is
                                                             // always one of
                                                             // templateTargetPaths,
                                                             // above.
export function planEntries(repoState, config) -> PlanEntry[]  // pattern-specific
                                                                 // entries beyond the
                                                                 // 3 common ones below
```

**Naming note (path vs. content):** `templates(config)`'s `templateSourcePath` field is
deliberately named differently from `computePlan`'s `templateSources` parameter (see API
surface, below), even though both trace back to the same `.tmpl` file per template entry.
`templateSourcePath` is a path string the caller resolves against the skill package's own
`templates/<pattern>/` directory; it is never itself fed into `renderTemplate()`. The
caller (`SKILL.md`/`bin/shipflow.js`) reads each entry's `templateSourcePath` off disk and
uses its file **content** — not the path — to build the `templateSources: Record<string,
string>` map (keyed by each entry's `id`) that gets passed into `computePlan`.
`computePlan`'s parameter stays named `templateSources` (plural, content, matching the
live code's pre-existing single `templateSource: string` parameter it widens from — see
`lib/plan.mjs`'s current `computePlan` signature), and is now clearly distinct in name
from `templates()`'s `templateSourcePath` (singular per entry, a path). Conflating the two
was a real naming collision in an earlier draft of this design — the live code already
uses `templateSource` to mean raw template text, so reusing that exact name for a path
field on `templates()` would mislead an implementer familiar with `render.mjs`/`plan.mjs`.

`pattern-registry.mjs` computes the six detection signals (`hasDevBranch`,
`hasReleaseOrHotfixBranch`, `hasGitflowMarker`, `hasRestrictedPromotionWorkflow`,
`hasUnrestrictedAutomergeWorkflow`, `hasTagsFromMain` — see Autodetection, below) exactly
**once**, via a shared internal helper: `computeDetectionSignals(repoState) -> {
hasDevBranch, hasReleaseOrHotfixBranch, hasGitflowMarker, hasRestrictedPromotionWorkflow,
hasUnrestrictedAutomergeWorkflow, hasTagsFromMain }`. `scoreAll(repoState)` calls this
helper once and passes that **same** precomputed signals object to all three pattern
modules' `detect(signals)` — no pattern module receives raw `repoState` or re-derives
these booleans itself. This is why `detect`'s signature above takes `signals`, not
`repoState`: computing the six signals in three independent places would risk each
pattern module reimplementing the same branch-name regex/workflow-scan logic slightly
differently, silently invalidating the worked examples in Autodetection, below, the
moment one implementation drifted from another.

Three plan entries stay common across every pattern, but only one of them is
branch-list-parameterized. `deletion-ruleset` is parameterized by
`pattern.protectedBranches(config)` instead of a hardcoded `[dev, main]` (unchanged
logic in `plan.mjs`, just fed a different branch list per pattern). `delete-branch-on-
merge` is unrelated to branch names entirely — it only compares the repo-wide boolean
`config.branchCleanup?.deleteOnMerge` against `repoState.repoSettings?.deleteBranchOnMerge`
and flips the repo's delete-on-merge setting to match; that comparison is identical,
unchanged logic across all three patterns, and it takes no `protectedBranches`
parameter and never consumes the branch list. `release-pending-label`, the third
common entry, is likewise unrelated to branch lists — it only checks whether the
`release-pending` label already exists on the repo and creates it if not, so it too
takes no `protectedBranches` parameter. Everything pattern-specific (which workflow
files exist, what their `if:` guards match) lives in the pattern module.

`apply.mjs`'s dispatch (`applyOne`) needs one concrete change: `deletion-ruleset`
currently hardcodes `refs/heads/${config.branches.dev}` / `${config.branches.main}` in
the ruleset's `ref_name.include` list — it must instead call the resolved pattern's
`protectedBranches(config)` **directly** and map that return value to
`refs/heads/<name>` generically for the actual GitHub API mutation. This is the
authoritative source for the mutating call; `applyOne` does **not** read
`config.branchCleanup.protectedBranches` for it. The stored `branchCleanup
.protectedBranches` field is an output-only record — written via `computePlan`'s new
`Plan.protectedBranches` field (see Config schema changes and API surface, below) — of
whatever `plan.mjs` most recently computed and displayed, never an input either
`apply.mjs` or `plan.mjs` reads back, which would let a stale on-disk copy silently
diverge from what the resolved pattern module computes today. Everything else in
`applyOne`'s existing per-id dispatch
(`template:` prefix handling, hash recording) already generalizes to "however many
template entries the resolved pattern contributes" with no further change — it was
written generically enough (`templateSource` was already a parameter, not a hardcoded
import).

`render.mjs` gains a small, precisely-scoped change — not a wholesale new-token sweep.
Its `TOKEN_VALIDATORS`/`TOKEN_TO_PARAM` allowlist (added after a Siege security audit
found a template-injection gap — see the header comment in `render.mjs`) gains exactly
**two** new entries: `RELEASE_BRANCH_PREFIX` and `HOTFIX_BRANCH_PREFIX`, sourced from
`patternConfig.gitflow.releaseBranchPrefix`/`hotfixBranchPrefix` and used only by
`gitflow`'s four templates to build their `head.ref` match guards. No other template
introduced by this design needs a new token: `github-flow`'s `main-automerge.yml.tmpl`
triggers on any PR to `main` with no head-ref restriction (see Templates per pattern,
below), so it reuses the already-validated `MAIN_BRANCH`/`MERGE_FLAG`/
`RELEASE_CREDENTIAL_SECRET` tokens as-is. Gitflow's `hotfix-merge-back`/
`release-merge-back` check out `config.branches.dev` — the exact same field the
existing `DEV_BRANCH` token already reads (see Config schema changes, above) — so they
need no new branch-name token either; only the two prefix tokens above are genuinely
new. Each of those two gets the same `UNSAFE_YAML_STRING_RE` (or equivalent,
token-appropriate) validation the existing `DEV_BRANCH`/`MAIN_BRANCH` tokens already
get, per this skill's existing hard invariant: "if you add a new substitution token, it
needs a validator in `TOKEN_VALIDATORS` before it ships." No gitflow template renders
without this.

As part of implementing this design, `render.mjs` also gains a **self-check
assertion** — run once, at module load (or equivalently at the top of every
`renderTemplate` call) — that every key present in `TOKEN_TO_PARAM` has a
corresponding key in `TOKEN_VALIDATORS`, throwing a clear internal error if not. This
closes a real gap in the current code, not just a documentation gap: today, a token
that is present in `TOKEN_TO_PARAM` but missing from `TOKEN_VALIDATORS` substitutes
with **zero validation** — the validator lookup (`TOKEN_VALIDATORS[name]`) returns
`undefined`, the `if (validate && !validate(value))` guard short-circuits false, and
`renderTemplate` raises no error. `renderTemplate`'s existing missing-param check only
catches a token that is missing from `TOKEN_TO_PARAM` entirely; it does nothing for a
`TOKEN_TO_PARAM` entry that was added without its matching `TOKEN_VALIDATORS` entry.
The new self-check assertion is what turns "add a validator or the injection risk
reopens" from a documentation-only mandate into a fail-fast structural check: it fires
the moment a new pattern's templates are wired up (module load, or the first
`renderTemplate` call touching the new token), rather than silently accepting an
unvalidated substitution into a committed workflow file.

This assertion is implemented as its own small, separately-callable pure function —
`assertTokenValidatorsComplete(tokenToParam, tokenValidators)`, exported from
`render.mjs` — that throws if any key of its first argument is missing from its
second, rather than being inlined as an anonymous check at module load. Module load
calls this function exactly once against the real, exported `TOKEN_TO_PARAM`/
`TOKEN_VALIDATORS` singletons — this call is what actually enforces the invariant at
runtime. Exporting the assertion logic as its own function (instead of only ever
invoking it inline against the frozen singletons) is what makes it independently
testable: a unit test can call `assertTokenValidatorsComplete` directly with
deliberately mismatched *local, plain-object* fixtures — not the frozen singletons —
to confirm it throws on an inconsistent pair and does not throw on a consistent pair.
This genuinely exercises the assertion logic itself (so deleting the real check from
`render.mjs` would make this test fail), unlike a test that only checks today's live
`TOKEN_TO_PARAM`/`TOKEN_VALIDATORS` objects happen to be in sync — which would keep
passing even if the runtime assertion were removed entirely — and it sidesteps
needing to mutate a frozen object (`TOKEN_VALIDATORS` is `Object.freeze`d) or work
around module-load-once semantics.

`detect.mjs`'s `repoState.templateFiles` also generalizes, in two steps that avoid a
circularity the naive version has. On a genuine first run there is no `.github/
shipflow.json` yet, so there is no `config.workflowPattern` to resolve and nothing to
call `resolvePattern(config).templates(config)` with — computing `templateFiles` from
"the resolved pattern's templates" doesn't work when no pattern has been resolved.
Instead:

1. **`detect.mjs` computes `templateFiles` broadly, unconditionally, with no resolved
   pattern in hand — via a config-independent export, not by calling `templates()`.**
   Target file PATHS never actually depend on config in this design — every pattern's
   rendered file always lands at the same fixed path regardless of branch names (e.g.
   `dev-main-promotion` always writes `.github/workflows/dev-to-main-automerge.yml`;
   `github-flow` always writes `.github/workflows/main-automerge.yml`; `gitflow`
   always writes the same four fixed paths under `.github/workflows/`) — only the
   rendered CONTENT (params) varies by config, never the path. Each pattern module
   therefore exports a second, config-independent constant alongside `templates(config)`:
   `templateTargetPaths: string[]` — a plain array, not a function (see the Pattern
   module contract, above). `detect.mjs` builds its union by calling
   `pattern-registry.mjs`'s `listPatterns()` — which returns each pattern's `id`
   **and** `templateTargetPaths` (see API surface, below) — and flat-mapping the
   `templateTargetPaths` field across every returned entry, then hashing whichever of
   those ~6 paths exist on disk under `.github/workflows/` (`dev-to-main-automerge.yml`,
   `main-automerge.yml`, `release-automerge.yml`, `hotfix-automerge.yml`,
   `hotfix-merge-back.yml`, `release-merge-back.yml`) — no config, no resolved
   pattern, and no call to `templates(config)` at all, so there is nothing circular
   about checking a handful of possible paths before knowing which one the repo
   actually uses. **`detect.mjs` never imports a `lib/patterns/<id>/index.mjs` module
   directly** — it only ever calls the registry's `listPatterns()`, which is what keeps
   the "adding a 4th pattern needs no changes to `detect.mjs`/`plan.mjs`/`apply.mjs`"
   claim (see Out of scope, below) true in practice: a new pattern registers itself
   once, inside `pattern-registry.mjs`, and every caller that only ever goes through
   the registry's own functions picks it up automatically.
2. **`plan.mjs`, once given the resolved pattern + config, reads only the subset of
   `templateFiles` keys relevant to that pattern's own `templates(config)` output.**
   `dev-main-promotion` and `github-flow` each read a one-entry subset (they have one
   template each); `gitflow` reads a four-entry subset. `plan.mjs`'s per-file hash-diff
   (hand-edit detection) iterates only this narrowed subset, not the full broad map
   `detect.mjs` computed, so hand-edit detection keeps working for every pattern
   without ever needing the pattern resolved before `templateFiles` itself can be
   computed.

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
      "releaseBranchPrefix": "release/",
      "hotfixBranchPrefix": "hotfix/"
    }
  }
}
```

- **`workflowPattern` and `patternConfig`** are the only two new top-level fields.
  `branches.dev` is the **sole
  source of truth** for the shared "second long-lived branch" name for both
  `dev-main-promotion` and `gitflow` (gitflow conventionally calls it `develop`; the
  field just holds whatever name the repo uses) — `github-flow` ignores this field
  entirely. `patternConfig.gitflow` deliberately does **not** duplicate this value under
  a `developBranch` key; every reader (`protectedBranches(config)`, the
  `hotfix-merge-back`/`release-merge-back` templates, `SKILL.md`'s interview) reads
  `config.branches.dev`, never a pattern-scoped copy — one field, one name, no
  reconciliation needed between two places that could drift apart.
- **`patternConfig.<id>`** holds fields meaningful to exactly one pattern. Only
  `gitflow` needs one in v1 — its two branch-prefix conventions
  (`releaseBranchPrefix`, `hotfixBranchPrefix`); `github-flow` needs none. This is a
  discriminated union in practice, not a formal JSON-schema `oneOf` — each pattern
  module reads only its own `patternConfig[pattern.id]` key and ignores the rest,
  keeping validation logic inside the module that owns the meaning of its fields
  (matching this codebase's existing "no heavy schema-validation dependency" style —
  the only current devDependency is `yaml`).
- **`mergeMethod.devToMainMethod`** keeps its existing name in v1 but its meaning
  broadens one further notch: it is reused **across all three patterns** as "the merge
  method for whichever single step merges into `main`" — dev→main under
  `dev-main-promotion`, every ordinary feature merge under `github-flow`, and
  release→main / hotfix→main under `gitflow` all share this one configured value.
  This deliberately includes `github-flow` even though that pattern has "no separate
  'promotion' concept" (see Templates per pattern, below): `github-flow`'s
  `main-automerge.yml.tmpl` still needs a `MERGE_FLAG` token, which is derived from
  this same field via `mergeMethodToFlag(config.mergeMethod.devToMainMethod)` — the
  same helper every other pattern's merge-to-main step already uses. The field's
  actual job is simpler than "promotion-style merge" suggests: it is just "how does
  anything merge into `main`," independent of what that merge is conceptually called
  under a given pattern. The field is not renamed and no per-branch-type fields are
  added; per-branch-type merge methods are a possible future enhancement, not a v1
  requirement.
- **`branchCleanup.protectedBranches`** is no longer always `[dev, main]` — it's
  computed by `pattern.protectedBranches(config)`: `[main]` for `github-flow`,
  `[dev, main]` for `dev-main-promotion`, `[config.branches.dev, main]` for `gitflow`.
  `release/*`/`hotfix/*` are deliberately **not** protected from deletion under
  gitflow — they're transient, cleaned up post-merge exactly like feature branches
  under every other pattern. **Both `plan.mjs` and `apply.mjs` call the resolved
  pattern's `protectedBranches(config)` fresh, independently, on every single run** —
  `plan.mjs` to compute the human-readable preview it shows the user, `apply.mjs` to
  compute the actual mutation. **Neither ever reads the stored
  `config.branchCleanup.protectedBranches` field as an input to anything.** It is
  never persisted as a separately-editable value a user could let drift, and it is
  never a second source of truth either side falls back to. The
  `branchCleanup.protectedBranches` key written into `.github/shipflow.json` is purely
  an *output*: a record of what `plan.mjs` most recently computed and displayed,
  written for the user's benefit (so `.github/shipflow.json` stays human-inspectable)
  and never read back as an input by any later `plan.mjs` or `apply.mjs` run (the same
  single-source discipline as the `branches.dev`/`developBranch` fix, above). This
  guarantees the plan a user confirms and the mutation `apply.mjs` actually performs
  can never disagree because one of them read a stale on-disk snapshot — both are
  always computed live from the resolved pattern module and the current config, so a
  snapshot left over from an old run can never cause the wrong branches to be
  (de)protected, and can never cause the previewed plan to disagree with what gets
  applied.

  **The actual write channel this "output record" claim depends on:** `computePlan`'s
  return shape (`Plan`) gains a new field, `protectedBranches: string[]` (alongside
  `creates`/`updates`/`noops`/`sourceStateHash`/`liveRequiredChecks` — see API surface,
  below) — `computePlan` computes it by calling the resolved pattern's
  `protectedBranches(config)` internally, so `computePlan` stays exactly as pure and
  I/O-free as before; it simply surfaces a value it already had to compute as part of
  its output instead of computing it and discarding it. **Persistence of this field
  is agent-driven, not CLI code, and this design changes nothing about that
  mechanism.** Checked against the live `bin/shipflow.js`: `cmdApply` (and every other
  command) only prints its JSON result to stdout (`printJson(result)`) — there is no
  code path anywhere in `bin/shipflow.js` that writes `.github/shipflow.json`.
  `renderedTemplateHashes` is persisted the same way today, and only that way:
  `SKILL.md`'s step 10 ("Report the result") instructs the orchestrating agent, after
  it reads `apply`'s JSON output, to "update `.github/shipflow.json`'s
  `renderedTemplateHashes` field with those values and tell the user to commit the
  config change *and* the rendered workflow file... together, in the same commit."
  `Plan.protectedBranches` is persisted the identical way: the orchestrating agent
  reads the new field off `plan`'s JSON output and, following an equivalent `SKILL.md`
  instruction, writes it into `branchCleanup.protectedBranches` as part of that same
  commit-worthy edit — the same existing agent-followed-prose mechanism already in
  use today, not a new one, and not CLI code either now or after this design ships.
  This is what makes "an output-only record of what `plan.mjs` most recently
  computed" an actual, mechanically-specified fact rather than an unattached claim:
  there is now a named field on `Plan` for `SKILL.md`'s existing step-10-style
  instruction to read and write, exactly as it already does for
  `renderedTemplateHashes`.

**Note on the prior contract's `INV-2`:** the 2026-07-14 contract's `INV-2` ("`config.
branches.main` and `config.branches.dev` always appear in
`branchCleanup.protectedBranches` ... for any branch-name configuration") is narrowed,
not preserved universally, by the per-pattern `protectedBranches(config)` behavior
above — it continues to hold as originally written only for `dev-main-promotion` and
`gitflow`; under `github-flow` there is no `dev` branch to protect, so `INV-2` does not
apply and `[main]` alone is correct. See the Invariants section, below, for the full
supersession note.

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

Each pattern module's `detect(signals)` is a small, deterministic point-scoring
function (no ML, no fuzzy matching — a fixed rule table per pattern, unit-testable in
isolation against synthetic `signals` fixtures). Scoring is defined over six boolean
signals, computed once by `pattern-registry.mjs`'s `computeDetectionSignals(repoState)`
(see Architecture, above) and passed identically to all three modules — never
recomputed per-module:

- `hasDevBranch` — a branch matches `/^(dev|develop|staging)$/`.
- `hasReleaseOrHotfixBranch` — a branch matches `/^(release|hotfix)\//`.
- `hasGitflowMarker` — a `.gitflow` file or `git config --get gitflow.branch.develop`
  succeeds. Best-effort bonus signal only, optional, and does not add to or otherwise
  affect any of the scores below.
- `hasRestrictedPromotionWorkflow` — an existing workflow triggers on `pull_request` to
  `main`, has a job enabling `gh pr merge --auto`, **and** has an `if:` guard
  restricting `head.ref` to one specific branch name (not a wildcard/unrestricted
  match).
- `hasUnrestrictedAutomergeWorkflow` — same shape, but with **no** head-ref
  restriction.
- `hasTagsFromMain` — at least one tag is reachable from `main`'s history.

`hasRestrictedPromotionWorkflow`/`hasUnrestrictedAutomergeWorkflow` need raw material
`detect.mjs` does not currently collect. The existing `listWorkflowJobNames()`
mechanism (see `lib/detect.mjs`) only extracts bare job-**name** strings out of files
that have a `pull_request`/`pull_request_target` trigger somewhere in the file — it
has no notion of an `if:` guard or a head-ref comparison at all, so it cannot supply
either signal on its own. `detect.mjs` needs a new, additional text-based heuristic,
consistent with its existing no-YAML-parser style (the same style already used by
`SETTINGS_AS_CODE_CONTENT_RE`'s content-pattern match for settings-as-code detection,
and by `PULL_REQUEST_TRIGGER_RE`'s trigger-section scan) rather than a full YAML
parser: scan each candidate workflow file under `.github/workflows/` for a `gh pr
merge --auto` step, and — for any file where that step is found — separately check
whether the surrounding job/step condition contains a `head.ref ==` (or equivalent)
comparison against one specific literal branch name. A qualifying auto-merge workflow
whose condition contains such a comparison is `hasRestrictedPromotionWorkflow`
evidence; a qualifying auto-merge workflow with no such comparison is
`hasUnrestrictedAutomergeWorkflow` evidence. This is new raw-material collection
`detect.mjs` must add — distinct from, and in addition to, the existing job-name-only
`listWorkflowJobNames()` — not a re-derivation of data that mechanism already
produces.

**Job/step boundary for the `head.ref ==` check:** "surrounding job/step condition"
above means a boundary **one level finer** than the whole-`jobs:`-section scan
`listWorkflowJobNames()` already implements (see `lib/detect.mjs`) — not the
identical boundary. Reusing `listWorkflowJobNames()`'s existing boundary as-is (the
file's `jobs:` line down to the first line that dedents back to column 0) would scope
across *every* job in the file, not one job's own block — in a file with multiple
jobs, that would let an unrelated job's `head.ref ==` condition get misattributed to
a different job's `gh pr merge --auto` step, since both would fall inside the same
whole-jobs-section region without actually belonging to the same job. Instead, find
each individual job's own line range: from that job's own name line (a line matching
the same `jobNameRe` pattern `listWorkflowJobNames()` already uses,
`/^\s{2}([\w.-]+):\s*$/`, at 2-space indent) down to the next line at that same or
lesser indent — i.e. the next sibling job's name line, or end of file if it's the
last job in the file. The `gh pr merge --auto` step and the `head.ref ==` comparison
must both fall **within that same individual job's line range** for the file to
qualify as evidence for either signal — a `head.ref ==` string appearing in a
*different* job's block, in the file's `on:`/trigger section above `jobs:`, or in
some unrelated file entirely does not count, even though a naive "present anywhere in
the file" (or even "present anywhere in the `jobs:` section") text search would
otherwise match it. This reuses `listWorkflowJobNames()`'s indent-based scanning
*technique* — not its exact whole-jobs-section *scope* — one level more precise: it
closes a real ambiguity, since two implementers building this heuristic from
"surrounding job/step condition" alone, with no boundary spec, could reasonably build
a whole-file scan (too permissive), a whole-jobs-section scan (still too permissive
across multiple jobs), or a single-line-only scan (too narrow) instead of this
single-job-scoped scan, and would silently disagree with each other.

Before any pattern-matching signal is evaluated, `computeDetectionSignals(repoState)`
normalizes every branch name in the branch list using a concrete, unambiguous
algorithm — **not** a blind "strip everything up to the first `/`," which would
corrupt a purely local `release/1.2.0` or `hotfix/1.2.3` branch name (see the
`INV-MP-6` fixture, below, which uses exactly such a name) into `1.2.0`/`1.2.3`,
destroying `hasReleaseOrHotfixBranch` for precisely the un-pushed local branches this
feature needs to recognize. The algorithm: **enumerate configured remote names
first** (`git remote`, e.g. typically just `origin`); then, for each branch name in
the branch list, if it starts with `<remote-name>/` for one of those *exact,
configured* remote names, strip that prefix before pattern-matching; otherwise leave
the branch name unchanged. This correctly normalizes `origin/dev` → `dev` (`origin`
is a configured remote) while leaving a local `release/1.2.0` untouched (`release`
is never a configured remote name, so no prefix strips). `detect.mjs` lists branches
via `git branch -a --format=%(refname:short)`, which returns remote-tracking names
like `origin/dev` (not bare `dev`) for a repo that hasn't checked out every branch
locally — a normal, common state for a repo shipflow is being run against for the
first time. Without this normalization, the anchored regexes in `hasDevBranch`
(`/^(dev|develop|staging)$/`) and `hasReleaseOrHotfixBranch` (`/^(release|hotfix)\//`)
would silently fail to match `origin/dev` or `origin/release/1.2.0`, misdetecting a
repo with a genuine long-lived `dev` branch as having none — directly undermining
this design's own stated goal of an existing pattern being "recognized rather than
force-fit." This normalization is applied once, generally, to the whole branch list
as part of `computeDetectionSignals`'s own processing — not re-implemented per
signal, and never via a naive "strip to first slash" — so `origin/dev` and `dev`
(and `origin/release/1.2.0` and `release/1.2.0`) are treated identically by every
downstream pattern-matching check, while a purely local `release/1.2.0` is never
mistaken for a remote-prefixed name and mangled.

Each of `hasRestrictedPromotionWorkflow` and `hasUnrestrictedAutomergeWorkflow` is
computed independently by scanning **every** existing workflow file under
`.github/workflows/`, not just one — consistent with how `detect.mjs`'s existing
`listWorkflowJobNames` already scans every workflow file rather than assuming a single
candidate. For a repo with only one relevant workflow file, that file's `if:` guard
either restricts `head.ref` to one specific branch or it doesn't, so it can satisfy at
most one of the two signals. But a repo with **multiple** workflow files — e.g. one
restricted-shaped promotion workflow and a separate, unrelated unrestricted-shaped
auto-merge workflow — can legitimately have both signals fire true at once. That's
fine: it's genuine mixed evidence, and the Ambiguous residual bucket (below) already
handles a repo whose scores don't cleanly separate, with no need to force these two
signals into artificial mutual exclusivity.

Each pattern's score is the sum of its own rules below, capped at 1.0. No other rules
and no marker bonus apply except where noted:

- **`github-flow`**: `+0.5` if (`hasUnrestrictedAutomergeWorkflow` OR
  `hasTagsFromMain`); `+0.3` if (NOT `hasDevBranch` AND NOT
  `hasReleaseOrHotfixBranch`).
- **`dev-main-promotion`**: `+0.5` if (`hasDevBranch` AND NOT
  `hasReleaseOrHotfixBranch`); `+0.5` if `hasRestrictedPromotionWorkflow`.
- **`gitflow`**: `+0.5` if `hasDevBranch`; `+0.5` if `hasReleaseOrHotfixBranch`.
  `hasGitflowMarker` is an optional best-effort bonus only — it carries no numeric
  weight and does not change the classification in any of the worked examples below.

`pattern-registry.mjs` ranks all three by score. Deterministic thresholds decide what
happens next — this is code, not a judgment call — and the comparison is always the
**top-scored pattern against the second-place pattern only** (2nd vs. 3rd is never
compared; it has no bearing on whether the winner is confident). The three buckets
below are exhaustive by construction — every possible `(top, secondPlace)` pair falls
into exactly one of them, with no separate gap-check that could leave a coverage hole:

1. **Confident**: if `top.score ≥ 0.7` **and** `top.score − secondPlace.score > 0.3`
   (strict inequality), resolve to that pattern automatically. `SKILL.md` states what
   was detected and why (the `evidence[]` array), then proceeds straight to that
   pattern's parameter-confirmation interview — it still goes through the existing
   mandatory confirm-before-write checkpoint (a confident auto-detect is not a
   substitute for the user confirming the actual values, per this skill's existing UX
   bar).
2. **Greenfield**: else, if `top.score < 0.4`, present all three templates with no
   strong bias (e.g. a brand-new repo with only `main` and nothing else). `SKILL.md`
   may suggest `github-flow` as the lightweight starting recommendation (matching the
   research — it's the dominant real-world shape for new/small projects) but never
   silently auto-picks it.
3. **Ambiguous**: else — this is the residual/`else` branch. No separate condition
   needs to be satisfied: anything that isn't Confident and isn't Greenfield is
   Ambiguous, by definition. `SKILL.md` presents all three templates with a one-line
   description and the detected evidence, and asks the user to choose. This residual
   framing (rather than a separate "two patterns within 0.3 of each other" check)
   closes the coverage hole an earlier draft of this design had, where a mixed-signal
   repo scoring below 0.7 but with a gap greater than 0.3 fell through both explicit
   conditions and matched neither bucket.

**Worked examples** (hand-verified against the exact rules above; usable directly as
unit test fixtures):

- **Bare repo** (only `main`, nothing else): `github-flow` = 0.3 (its `+0.3`
  absence-of-`dev`/absence-of-`release`-`hotfix` rule; no positive signal for `+0.5`),
  `dev-main-promotion` = 0, `gitflow` = 0 → top = 0.3 < 0.4 → **Greenfield**.
- **This repo's own real shape** (a `dev` branch, no release/hotfix branches, an
  existing restricted promotion workflow, **and** tags reachable from `main` — this
  repo's own release process cuts `<skill>-vX.Y.Z` tags off `main`, so
  `hasTagsFromMain` is true here): `dev-main-promotion` = 1.0 (`+0.5` + `+0.5`),
  `gitflow` = 0.5 (`+0.5` for `hasDevBranch`), `github-flow` = 0.5 (its first rule,
  `+0.5` if `hasUnrestrictedAutomergeWorkflow` OR `hasTagsFromMain`, is satisfied via
  `hasTagsFromMain` alone even though `hasUnrestrictedAutomergeWorkflow` is false for
  this repo's actual restricted-shaped workflow; its second `+0.3` absence rule does
  not fire because `hasDevBranch` is true) → top = 1.0; second place is a **tie**
  between `gitflow` and `github-flow`, both at 0.5; gap = 1.0 − 0.5 = 0.5 > 0.3 →
  **Confident: dev-main-promotion**. (This is a real, non-hypothetical check: this
  repo genuinely has tags reachable from `main` today, so `github-flow`'s true score
  here is 0.5, not negligible — the gap is still comfortably wide enough to stay
  Confident.)
- **Clean github-flow signal** (no `dev`/`develop`/`staging` branch, no
  `release`/`hotfix` branch, an unrestricted auto-merge workflow or tags exist):
  `github-flow` = 0.8 (`+0.5` + `+0.3`), `dev-main-promotion` = 0, `gitflow` = 0 → top
  = 0.8, gap = 0.8 > 0.3 → **Confident: github-flow**.
- **Clean gitflow signal** (a `develop` branch AND an open `release/1.2.0` branch, no
  marker, no matching workflow): `gitflow` = 1.0 (`+0.5` + `+0.5`), `dev-main-promotion`
  = 0 (its `hasDevBranch AND NOT hasReleaseOrHotfixBranch` signal fails because a
  release branch exists), `github-flow` = 0 → top = 1.0, gap = 1.0 > 0.3 → **Confident:
  gitflow**.
- **Ambiguous residual case** (only a `hotfix/1.2.3` branch, no
  `develop`/`dev`/`staging` branch, nothing else): `gitflow` = 0.5 (`+0.5` for
  `hasReleaseOrHotfixBranch` only), `dev-main-promotion` = 0, `github-flow` = 0 → top =
  0.5 fails Confident (needs ≥ 0.7), and top is not < 0.4 so it also fails Greenfield →
  falls to the residual **Ambiguous** bucket by construction.

## Templates per pattern

- **`dev-main-promotion`**: unchanged — the existing `dev-to-main-automerge.yml.tmpl`,
  relocated.
- **`github-flow`**: `main-automerge.yml.tmpl` — triggers on any PR to `main` (no
  head-ref restriction, since there's no second long-lived branch to distinguish
  promotions from ordinary feature merges); enables native auto-merge on open/
  reopen/synchronize; the `release-pending` label job fires on every merge to `main`
  with no head-ref guard. This is intentional, not an oversight: under `github-flow`
  there is no separate "promotion" concept distinct from an ordinary feature merge, so
  every merge to `main` is equally release-worthy, and asking every time is the
  correct semantic for this pattern (unlike `dev-main-promotion`/`gitflow`, where the
  ask is scoped to the promotion-specific merge, not every feature merge).
- **`gitflow`**: four templates —
  - `release-automerge.yml.tmpl`: PR from `release/*` → `main`, same auto-merge +
    label shape as `dev-main-promotion`, head-ref guard matches the configured
    `releaseBranchPrefix`.
  - `hotfix-automerge.yml.tmpl`: PR from `hotfix/*` → `main`, identical shape, guard
    matches `hotfixBranchPrefix`.
  - `hotfix-merge-back.yml.tmpl`: triggered on `pull_request: closed` for `main`,
    guarded on `merged == true && head.ref` matching `hotfixBranchPrefix`. Checks out
    `config.branches.dev` (gitflow's develop-branch name — see Config schema changes,
    above, for why `branches.dev` is the sole source of truth for that name, with no
    separate `patternConfig.gitflow.developBranch`), attempts
    `git merge origin/main --no-edit`, and pushes on success. The push step
    authenticates with the same `config.release.releaseCredential` secret every other
    auto-merge step in this design uses — not because of the prior design's Fatal #1
    (GitHub's loop-prevention rule blocking downstream push-triggered workflows, a
    different mechanism entirely, unrelated to whether a push is accepted), but for
    consistency with the rest of this design's credential story: every other
    merge-triggering step here uses a real PAT rather than the default
    `GITHUB_TOKEN`, and using anything else here would be a second, undiscussed
    credential decision. **Any failure to complete the direct merge — a merge conflict, a
    rejected push (e.g. branch protection on `config.branches.dev` blocking a direct
    push), or any other failure — falls back to the same behavior**: it opens a PR
    from a temporary branch (`main` → `config.branches.dev`) for human resolution,
    flagged clearly. It never retries silently and never force-pushes. This is the
    same "surface the problem, never silently guess" precedent this design already
    uses for hand-edit detection. This automates the behavior real GitFlow's
    `git flow hotfix finish` performs atomically (confirmed via research: the
    dual-merge is the *defining* semantic of a hotfix branch, not an optional
    convention — existing tools like `gitflow-workflow-action` automate exactly this
    shape) without requiring a bespoke polling/blocking job (the class of complexity
    this repo's existing design already rejected for a different reason — see
    `AMB-3` in the prior shipflow contract).
  - `release-merge-back.yml.tmpl`: structurally identical to `hotfix-merge-back`, but
    triggered off a `release/*` branch (matching `releaseBranchPrefix`) merging to
    `main` instead of `hotfix/*`. Real GitFlow merges *both* hotfix and release
    branches back into `develop` after they land on `main`, for the identical "keep
    develop from silently diverging forever" reason this design already gives for
    hotfixes — shipping `hotfix-merge-back` without a release-side equivalent would
    have been an unacknowledged gap, not a documented scope cut, so both are first-
    class templates. Same any-failure-falls-back-to-a-PR behavior (never a silent
    retry or force-push) and the same `config.release.releaseCredential` push
    credential as `hotfix-merge-back`.

**Scoped out of v1, documented explicitly:** if a release branch is concurrently open
when a hotfix lands, real GitFlow says the hotfix should merge into that release
branch instead of `develop`. v1's `hotfix-merge-back` always targets
`config.branches.dev` — this is a narrow, named simplification, not a silent gap.

## Data flow

**First run, no existing config:** `detect.mjs` collects `repoState` (branches, tags
reachable from `main` — the raw material `hasTagsFromMain` needs — a `.gitflow`
marker-file/`git config --get gitflow.branch.develop` check — the raw material
`hasGitflowMarker` needs — workflow job names via the existing `listWorkflowJobNames()`,
a **new** head-ref-restriction scan (see Autodetection, above) that gives
`hasRestrictedPromotionWorkflow`/`hasUnrestrictedAutomergeWorkflow` the raw material
`listWorkflowJobNames()` alone cannot supply (that mechanism only extracts bare job
names from `pull_request`-triggered files — it has no notion of an `if:` guard or a
head-ref comparison; the new scan looks for a `gh pr merge --auto` step and separately
checks its surrounding condition for a `head.ref ==`-style comparison against one
literal branch name), and existing template file hashes — the
latter now the broad, unconditional union of every registered pattern module's
`templateTargetPaths` constant, computed with no pattern resolved yet; see
Architecture, above)
then calls `pattern-registry.mjs`'s `scoreAll(repoState)`. Confident → proceed directly into that pattern's interview.
Ambiguous/greenfield → `SKILL.md` presents the 3 templates, user picks. Either way, the
resolved `pattern.id` is written into `config.workflowPattern`, and only that pattern's
relevant fields (`branches.dev`, `patternConfig.gitflow`, etc.) are asked about — a
`github-flow` setup never asks about a dev branch name at all. From this point on,
`plan.mjs` narrows `repoState.templateFiles` down to just the subset the now-resolved
pattern's own `templates(config)` returns (see Architecture, above).

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
- **`hotfix-merge-back`/`release-merge-back`, any push failure:** a merge conflict, a
  rejected push (e.g. branch protection on `config.branches.dev` blocking a direct
  push), or any other failure to complete the direct merge — never force-pushes or
  auto-resolves; opens a flagged PR, matching the existing hand-edit-detection
  philosophy of "surface, don't guess."
- **A repo has both a `dev` branch and `release/*`/`hotfix/*` branches**
  (mid-migration between patterns): under the exact scoring rules in Autodetection,
  above, this is actually a decisive, not ambiguous, case — `gitflow` scores 1.0
  (`hasDevBranch` and `hasReleaseOrHotfixBranch` both fire) while
  `dev-main-promotion` scores 0 (its `hasDevBranch AND NOT hasReleaseOrHotfixBranch`
  signal fails precisely because a release/hotfix branch exists), so this resolves to
  **Confident: gitflow**, not Ambiguous. The genuinely ambiguous residual case looks
  different: e.g. a lone `hotfix/*` branch with no `dev`/`develop`/`staging` branch
  present (the "Ambiguous residual case" worked example in Autodetection, above),
  where no pattern accumulates enough signal to clear the Confident threshold, but the
  top score also isn't low enough to read as Greenfield.
- **Existing `.github/shipflow.json` with no `workflowPattern`:** treated as
  `dev-main-promotion`, unconditionally, forever (until the user explicitly
  reconfigures) — see Backward compatibility, above.

## API surface (additions to the existing contract)

- `pattern-registry.mjs`:
  - `listPatterns(): Array<{ id: string, templateTargetPaths: string[] }>` — the
    `templateTargetPaths` field is why this returns more than a bare id list: it's
    what lets `detect.mjs` build its config-independent template-path union (see
    Architecture, above) by calling this ONE registry function rather than importing
    each `lib/patterns/<id>/index.mjs` module directly itself. This is what keeps the
    "adding a 4th pattern needs no changes to `detect.mjs`" claim true in practice —
    `detect.mjs` only ever calls `listPatterns()` and flat-maps its
    `templateTargetPaths` fields; it never imports a pattern module by name.
  - `resolvePattern(config): PatternModule` — reads `config.workflowPattern`, defaulting
    to `"dev-main-promotion"` when absent.
  - `scoreAll(repoState): Array<{ id: string, score: number, evidence: string[] }>`
    sorted descending by score.
- Each `lib/patterns/<id>/index.mjs`: `detect`, `protectedBranches`, `templates`,
  `planEntries`, and the config-independent constant `templateTargetPaths` — see
  Architecture, above, for signatures.
- `detectRepoState` and `applyPlan` keep their existing signatures unchanged; their
  internals now loop over the registry instead of one hardcoded pattern.
  `computePlan`'s signature genuinely changes in one respect: its third parameter
  widens from the live code's current single `templateSource: string` (see `lib/
  plan.mjs`'s current `computePlan(repoState, config, templateSource)` signature) to
  `templateSources: Record<string, string>` — a map keyed by each template's `id` (the
  same `id` field returned per entry by `pattern.templates(config)`; see the Pattern
  module contract, above). One string parameter cannot carry `gitflow`'s four
  independently-templated plan entries (`release-automerge`, `hotfix-automerge`,
  `hotfix-merge-back`, `release-merge-back`), each with its own template source file.
  The caller (`SKILL.md`/`bin/shipflow.js`) reads each of the resolved pattern's
  `templates(config)` entries' **`templateSourcePath`** off disk and uses that file's
  **content** to build this map (keyed by each entry's `id`); `computePlan` itself
  stays a pure function with no I/O — it now iterates the map (one entry per pattern's
  `templates(config)` output) instead of rendering one hardcoded string. Note the
  naming: `templates()`'s `templateSourcePath` is a path, `computePlan`'s
  `templateSources` is the map of file contents built from those paths — see the
  Naming note under the Pattern module contract, above, for why these are named
  differently despite both tracing back to the same `.tmpl` files. `dev-main-promotion`
  and `github-flow` each populate the map with exactly one key, so this is a strict
  widening, not a breaking change for those two patterns' single-template shape.
- `computePlan`'s return shape (`Plan`) gains one new field beyond the prior
  contract's `{ creates, updates, noops, sourceStateHash, liveRequiredChecks }`:
  `protectedBranches: string[]`, computed internally by calling the resolved
  pattern's `protectedBranches(config)` — `computePlan` remains a pure function with
  no I/O; this is an additional return value, not a new side effect. See the
  `branchCleanup.protectedBranches` paragraph under Config schema changes, above, for
  how this value is actually persisted (via `SKILL.md`'s agent-followed instruction,
  not `bin/shipflow.js` code).

## Invariants (new, additive to the existing skill-invariants.json set)

**Checkable:**
- A config with no `workflowPattern` field resolves to `dev-main-promotion` everywhere
  it's read — never `undefined`, never a crash, never a different implicit default.
- `deletion-ruleset`'s `ref_name.include` list is always derived by calling the
  resolved pattern's `protectedBranches(config)` directly — never a hardcoded
  `[dev, main]` literal, and never read back from the stored
  `config.branchCleanup.protectedBranches` snapshot.
- `release/*`/`hotfix/*` branches never appear in `branchCleanup.protectedBranches`
  under `gitflow`.
- **Supersession of the prior contract's INV-2:** the 2026-07-14 contract's `INV-2`
  states "`config.branches.main` and `config.branches.dev` always appear in
  `branchCleanup.protectedBranches` ... for any branch-name configuration" — written
  when `dev-main-promotion` was the only pattern in existence. This design narrows
  that claim rather than preserving it universally: `INV-2` continues to hold exactly
  as originally written only for `dev-main-promotion` and `gitflow` (both of which
  have a `config.branches.dev`). Under `github-flow`, `INV-2` does not apply —
  there is no `dev` branch to protect, by design, and `protectedBranches(config)`
  correctly returns `[main]` only for that pattern. A reader auditing the prior
  contract's `INV-2` against a `github-flow`-configured repo should treat this note,
  not the original universal wording, as authoritative.
- Detection (`scoreAll`) only runs when `existingConfig` is `null`; a re-run with an
  existing config never calls it.
- The two new substitution tokens this design introduces (`RELEASE_BRANCH_PREFIX`,
  `HOTFIX_BRANCH_PREFIX`) each have a registered entry in `render.mjs`'s
  `TOKEN_VALIDATORS`/`TOKEN_TO_PARAM` before `gitflow`'s templates can render — every
  other template in this design reuses an existing, already-validated token
  (`DEV_BRANCH`/`MAIN_BRANCH`/`MERGE_FLAG`/`RELEASE_CREDENTIAL_SECRET`) and introduces
  none of its own; no pattern ships a template referencing a token without a
  validator.
- `render.mjs` contains a self-check assertion — run at module load (or at the top of
  `renderTemplate`) — that every key present in `TOKEN_TO_PARAM` has a matching key in
  `TOKEN_VALIDATORS`, throwing a clear internal error otherwise. This is what actually
  makes "no token ships without a validator" a runtime-enforced fact rather than a
  documentation-only mandate: without this assertion, a token added to
  `TOKEN_TO_PARAM` but missing from `TOKEN_VALIDATORS` would silently substitute with
  zero validation (see the render.mjs paragraph in Architecture, above). The assertion
  logic is exported as its own pure function,
  `assertTokenValidatorsComplete(tokenToParam, tokenValidators)`, which throws if any
  key of `tokenToParam` is missing from `tokenValidators`; module load calls this
  function once against the real `TOKEN_TO_PARAM`/`TOKEN_VALIDATORS` singletons, and
  that call is what enforces the invariant at runtime. **Verification method:** a
  unit test calls the exported `assertTokenValidatorsComplete` directly with
  deliberately mismatched *local, plain-object* fixtures (not the frozen singletons),
  asserting it throws for an inconsistent `{tokenToParam, tokenValidators}` pair and
  does not throw for a consistent one. This genuinely exercises the real assertion
  logic — deleting it from `render.mjs` would make this test fail — unlike a test
  that only checks `Object.keys(TOKEN_TO_PARAM).every(key => key in
  TOKEN_VALIDATORS)` against today's live exported objects, which would keep passing
  even if the runtime assertion were removed entirely. It also sidesteps two
  practical problems a singleton-mutation test would hit: the live
  `TOKEN_VALIDATORS` is `Object.freeze`d (see `render.mjs`), so deleting a property
  from it either throws (strict mode) or silently no-ops (non-strict) instead of
  cleanly removing the entry; and the module-load assertion runs only once per
  process, which would otherwise require module-cache-busting tricks to re-trigger
  for a second observation. Calling the exported function directly with fresh local
  fixtures avoids both problems.

**Testable:**
- Given a synthetic `repoState` with a `develop` branch and an open `release/1.2.0`
  branch, `scoreAll` ranks `gitflow` above the other two.
- Given a synthetic `repoState` with only `main` and no other signals, all three scores
  fall below the greenfield threshold (0.4) — see the worked example in Autodetection,
  above.
- `hotfix-merge-back`'s and `release-merge-back`'s conflict-or-any-push-failure path:
  simulate a `config.branches.dev`-equivalent branch that has diverged from `main` in a
  conflicting way, and separately simulate a rejected push; assert a PR is opened and
  no force-push or silent resolution occurs in either case.
- Running `apply.mjs` twice against an unchanged `github-flow`-pattern repo produces
  zero mutating calls on the second run (same idempotency invariant as
  `dev-main-promotion` today, re-verified per pattern).

## Testing strategy

Unit tests per pattern module (`detect`, `protectedBranches`, `templates`) against
synthetic `repoState` fixtures — no network/`gh` calls, matching the existing
`detect.test.mjs`/`plan.test.mjs` style. Integration tests (sandbox repo, same tier as
the existing `INV-9`/`INV-11`/`INV-17`-style tests) for: `github-flow`'s single-branch
protection setup end-to-end, and `gitflow`'s `hotfix-merge-back`/`release-merge-back`,
both on the clean-merge and conflict-or-any-push-failure paths.

## Out of scope / deferred

- GitLab Flow (environment branches), Release Flow (Microsoft) — no evidence of demand;
  the registry mechanics make adding either later a contained change (new
  `lib/patterns/<id>/index.mjs` exporting `templateTargetPaths` alongside
  `detect()`/`protectedBranches()`/`templates()`/`planEntries()`, no changes to
  `detect.mjs`/`plan.mjs`/`apply.mjs` dispatch logic — `detect.mjs` iterates the
  registry generically over each module's `templateTargetPaths` rather than
  hardcoding path literals itself).
- Automatic `workflowPattern` migration/transition tooling (switching patterns on an
  already-adopted repo) — explicitly a first-run-shaped operation in v1, not a diffed
  transition plan.
- Hotfix-into-open-release-branch targeting (real GitFlow's rule when a release branch
  is concurrently open) — always targets `config.branches.dev` in v1.

## Migration note for this repo (`claude-skills`)

No action required. `claude-skills`'s own `.github/shipflow.json` has no
`workflowPattern` field and will continue to resolve to `dev-main-promotion` — its
current, live pattern — with no file changes. Adopting this design here means only:
relocating the one existing template file into `templates/dev-main-promotion/`, and
updating `renderedTemplateHashes` bookkeeping is *not* required since those hashes key
off the target-repo output path, not the skill package's internal layout.

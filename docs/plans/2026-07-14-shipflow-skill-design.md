---
ticket: "N/A"
title: "shipflow: portable branching + release-automation skill"
date: "2026-07-14"
source: "design"
---

# shipflow: portable branching + release-automation skill

## Overview

A new shareable skill, `shipflow`, installable into any repo, that scaffolds a
configurable git workflow: long-lived `dev`/`main`, feature branches off `dev`,
`dev → main` promotion PRs that auto-merge once required checks pass, release
tagging that defaults to preserving each repo's existing manual-release gate
and can optionally be made fully automatic where a repo has no conflicting
constraint (see "Two investigated architectural decisions" below), and
automatic deletion of every branch except `dev`/`main` once merged.

It packages as `skills/shipflow/` in this marketplace, following the same
convention as `devlog`: config and logic are separate files, so the same skill
serves repos with different branch names, merge strategies, or release
layouts without code changes.

This design targets the requirements from the original prompt: (1) long-lived
`dev`/`main`, (2) feature branches off `dev`, (3) `dev → main` promotion,
(4) automatic merge on green, (5) release tagging that is automatable but
defaults to this repo's existing deliberate human gate rather than assuming
every repo wants full automation, (6) automatic cleanup of everything else —
built simple, configurable, sharable, minimal-code,
deterministic/nondeterministic-separated, and maintainable.

## Scope decision: `auto` mode stays in v1

The round-4 red-team review observed that the `auto`-mode surface
(release-please manifest handling, the byte-equality pre-flight, the
dual-hop `RELEASE_PAT` wiring, the adoption/migration note) makes up roughly
half of this document's content, remains self-labeled
experimental/unsupported for exactly the repo shape — triple-version-equality
across `package.json`/`SKILL.md`/`plugin.json` — that motivated writing
shipflow in the first place, and is unused by the reference repo (this
repo's own computed default, and what it ships with, is `manual-gate`). The
red-team's recommendation was to defer all of `auto`/release-please to a
separately-scoped follow-up design and ship v1 as `manual-gate` + branch
cleanup + `dev → main` automerge only.

**Decided: keep `auto` mode in v1.** Requirement 5 (automatic tagging) needs
to be satisfiable for adopting repos without this repo's specific
constraint, on day one — not deferred to a hypothetical follow-up. The
larger v1 surface and the unverified-but-tested mechanism (integration tests
+ a written contingency if the credential-authorship assumption doesn't
hold, see Error Handling) are accepted trade-offs for delivering the full
original requirement set now.

## Two investigated architectural decisions

**Branch cleanup (req. 6) needs zero custom code.** GitHub's own docs confirm
that when `delete_branch_on_merge` is on and a branch is deletion-protected
(via a ruleset), a merge whose head is that protected branch — e.g. a
`dev → main` promotion PR — succeeds and GitHub silently skips deleting it.
So: turn on `delete_branch_on_merge` repo-wide, add a ruleset protecting
`dev`/`main` from deletion, and every feature-branch merge self-cleans while
`dev`/`main` survive. No workflow, no script.

**Rulesets vs. an existing settings-as-code source of truth.** A repo may
already manage branch protection as code (this repo does, via
`.github/repo-settings.sh`, run by an admin with `gh`). Installing a GitHub
ruleset for the same purpose on top of that creates two overlapping,
hard-to-audit sources of truth for the same protection rules. `detect.mjs`
therefore looks for a settings-as-code **artifact** — a script or workflow
that actually writes branch protection, matching patterns like
`repo-settings.sh`, a Terraform file touching `github_branch_protection`/
`github_repository_ruleset`, or a Pulumi equivalent — not merely the
presence of protection itself. Three outcomes:

- **Artifact found:** shipflow treats that mechanism as authoritative for
  **protection** (required checks, deletion locks, force-push rules) and
  does not install a competing ruleset — it only manages the pieces that
  mechanism doesn't already own: `delete_branch_on_merge`, auto-merge
  wiring, and release tagging. `protectionOwner: "external"`.
- **No protection exists at all:** shipflow becomes the source of truth and
  says so explicitly in the setup summary shown to the user ("no existing
  branch protection found; shipflow will own `main`/`dev` protection going
  forward"). `protectionOwner: "shipflow"`.
- **Protection exists but no artifact is found** (e.g. an admin
  hand-configured it via the GitHub UI): this is the false-positive case an
  earlier draft of this design got wrong — treating "protection is
  non-empty" alone as proof of external ownership silently left that
  protection un-audited *and* un-managed by anyone. shipflow does not
  silently default to either value here. Instead `SKILL.md` shows what it
  found and asks explicitly: "branch protection exists but isn't managed as
  code — should shipflow take ownership of it (`protectionOwner:
  "shipflow"`), or keep managing it externally (`protectionOwner:
  "external"`) even though no artifact was found?" Whichever the user picks
  is what gets recorded.

This choice is recorded in `config.json` (`protectionOwner: "external" |
"shipflow"`) so later re-runs don't have to re-detect it every time.

**Release tagging (req. 5) defaults to what detection finds, not to a fixed
value; `release-please` is opt-in for repos with no conflicting
constraint.** The original plan proposed `release-please` unconditionally
with "native monorepo support" as the deciding factor. That collides with
two things *this* repo already does: (1) a manual, triple-version-equality
release model — `package.json`, `SKILL.md` frontmatter `version:`, and
`plugin.json.version` must be byte-equal, enforced by `lint_plugin.py` in
CI — where each skill releases independently on demand via
`workflow_dispatch`, not on a shared commit-history-driven cadence; and (2)
a deliberate human gate ("AGENT RULE: ASK whether to cut a release tag")
that exists because not every `dev → main` promotion should produce a
public release. `release-please` in manifest mode only updates
`package.json` by default — `SKILL.md`/`plugin.json` need explicit
`extra-files` updaters — and it batches releases by commit history across
the whole tree rather than per-skill and on-demand. Forcing it in as the
only mode would silently break both invariants for repos shaped like this
one.

But hardcoding `"manual-gate"` as the universal default under-delivers the
original requirement ("all semantic release tags automatically cut") for
the common case: a fresh or greenfield repo with no triple-version-equality
constraint and no existing manual per-skill release workflow would get
*zero* release automation by default — exactly the outcome shipflow exists
to prevent. So the default is **conditional on what `detect.mjs` finds**,
not fixed:

- If `detect.mjs` finds a triple-version-equality-style CI lint (a check
  comparing `package.json`/manifest version fields against a frontmatter or
  plugin-metadata version field, matching this repo's `lint_plugin.py`
  pattern) **or** existing manual per-skill release workflows (one or more
  `workflow_dispatch`-triggered release jobs per package/skill directory),
  the default is **`"manual-gate"`** — automating tagging here would
  silently break an invariant the repo already enforces.
- Otherwise, the default is **`"auto"`**, still gated behind the credential
  check described under Fatal #1 in Error Handling: if the required
  credential is absent, `apply.mjs` fails fast with a clear message naming
  the missing secret and how to create it, rather than silently falling
  back to `"manual-gate"` or proceeding unsafely. **Note a second collision
  on a genuinely greenfield repo:** a fresh repo with few or no CI workflows
  yet also has an empty (or near-empty) `requiredChecks` list, which means
  this same `"auto"` default can walk straight into the empty-checks
  refusal (Error handling, below) — `apply.mjs` blocks auto-merge wiring
  either way, so the net effect is a clear failure message rather than a
  silent gap, but it's worth knowing the two defaults can compound on a
  brand-new repo.
- **If detection is ambiguous — neither a clean hit nor a clean miss —
  `detect.mjs` does not silently pick either default.** A clean hit (an
  exact `lint_plugin.py`-style check, or manual `workflow_dispatch` release
  jobs covering every package directory) yields `"manual-gate"`; a clean
  miss (no version-comparison CI check of any kind, no manual release
  workflows anywhere) yields `"auto"`. Anything in between — e.g. a CI check
  that compares *some* but not all of the three version fields, or manual
  `workflow_dispatch` release jobs present for only some package
  directories and not others — is ambiguous, not a miss, and does not
  silently resolve to either value. `SKILL.md` shows what it found and
  didn't find and asks the user to confirm `release.mode` explicitly before
  writing it, mirroring the `protectionOwner` disambiguation prompt above
  (Rulesets vs. existing settings-as-code source of truth). This
  generalizes the same principle that section already established for
  `protectionOwner`: any unrecognized-but-present protection/release
  machinery routes to a user confirmation prompt rather than a silent
  default — accumulated detection heuristics (settings-as-code artifact
  patterns, triple-version-equality lint detection, manual-release-workflow
  detection) are the design's most brittle surface precisely because
  they're tool-specific pattern matches, so every one of them gets an
  explicit-confirm fallback for its ambiguous case, not just `protectionOwner`.

`SKILL.md` shows the detected signal and the resulting default in the setup
summary (e.g. "found `lint_plugin.py`-style version-equality check →
defaulting `release.mode` to `manual-gate`"), and the user can always
override it during setup.

`release.mode` is a config field with two supported values:

- **`"manual-gate"`.** Preserves the current process, but the ask has to
  happen at a trigger point that actually exists. This design mandates
  native GitHub auto-merge for the `dev → main` promotion (Overview, above),
  and native auto-merge completes **asynchronously** — possibly hours after
  the promotion PR is opened, with no Claude session attached at the moment
  it actually lands. That means shipflow cannot ask "cut a release?"
  *at promotion time*: no session is running when the merge actually
  happens, and if shipflow asked speculatively at promotion time (before the
  async merge lands) and the user said yes, dispatching a release then would
  release the **old** `main` — the promotion hasn't landed yet. This is the
  same architectural problem round 2 caught and fixed for a proposed
  `"same-job"` release-credential option (no live job exists at actual-merge
  time); it applies equally here to manual-gate's ask-flow. So: the ask
  happens on a **subsequent, separate interactive shipflow invocation** —
  but that only works if something durable records *that* a promotion
  landed and is still awaiting a release decision. No Claude session is
  attached to witness the async merge, the merge can land while the user is
  away entirely, and more than one `dev → main` promotion can land between
  shipflow invocations, each independently owed its own ask — relying on the
  user to spontaneously re-run shipflow, or treating "the promotion PR"
  (singular) as if only one is ever pending, both leave a real possibility
  that a promotion never gets asked about.

  **Durable marker:** the `dev-to-main-automerge` template is paired with a
  second, lightweight workflow step, triggered on `pull_request: closed` for
  the configured `main` branch and checking
  `github.event.pull_request.merged == true`, that applies a
  `release-pending` label to the merged promotion PR. (Architecture, below,
  is authoritative on this job's exact guard conditions — it also requires
  `github.event.pull_request.head.ref == config.branches.dev` so a stray
  hotfix-to-`main` merge isn't mislabeled as a `dev → main` promotion.) This
  trigger fires on the actual merge event itself — regardless of whether
  native auto-merge or a manual click produced it — so nothing needs to stay
  alive across the async wait (Architecture, below, lists this alongside
  `dev-to-main-automerge`). The next interactive shipflow invocation, on
  every run, enumerates merged `dev → main` PRs still labeled
  `release-pending` (e.g. `gh pr list --state merged --base <main> --label
  release-pending`) to recover the full pending set rather than assuming
  only the most recent promotion is outstanding. For each one, it first
  verifies the PR actually merged (GitHub PR state `MERGED`) and that its
  target commit is present on `main`, and only *then* asks the user whether
  to cut a release for that promotion's changed skills (matching this
  repo's existing "AGENT RULE"). If yes, the version bump + `CHANGELOG.md`
  entry + `gh workflow run <skill>.yml --ref main` dispatch happens as it
  does today, and shipflow removes the PR's `release-pending` label only
  *after* confirming that dispatch succeeded (e.g. checking the triggered
  run's initial status via `gh run list`/`gh api` rather than assuming
  success the instant `gh workflow run` returns) — **removing the label on
  the user's "yes" alone, before dispatch is confirmed, would mean a failed
  dispatch silently drops the promotion from the pending set with no release
  ever cut and no resurfacing next run.** When a single promotion touches
  multiple skills (e.g. `devlog` + `ghostwriter` changed in the same
  `dev → main` merge), the label is removed only after *every* changed
  skill's dispatch is confirmed; a partial failure (one skill's dispatch
  confirmed, another's not) keeps the label in place and resurfaces the
  whole set of changed skills next run — already-released skills simply
  re-dispatch as idempotent no-ops. If the user answers no, the label
  is removed immediately, since the ask has been answered and there's
  nothing further to confirm. **The ask is a deliberate binary yes/no with no
  "defer" path** — answering "no" is final for that promotion and it cannot
  resurface short of a manual `gh workflow run <skill>.yml --ref main`
  dispatch outside shipflow; this is an accepted v1 simplification, not an
  oversight, on the basis that a promotion the user actively declined to
  release is a rare enough path that a "remind me later" flow isn't worth
  the added state it would require. No `release-please`, no automatic tagging. This matches how the current
  manual CLAUDE.md process actually works: confirm the merge landed, then
  dispatch — never ask-then-dispatch speculatively ahead of the merge. This
  is the only mode a repo with an existing triple-version-equality
  constraint should use unless it explicitly opts into automation and
  accepts the migration work below.
- **`"auto"`.** Uses `release-please` for repos that do *not* have a
  pre-existing manual-release constraint, or that have deliberately
  migrated to let `release-please` own versioning. See "release-please
  manifest (auto mode only)" below for the concrete manifest shape and the
  credential requirement — automatic tagging does **not** work with the
  default `GITHUB_TOKEN` (see Fatal #1 discussion in Error Handling). Under
  `"auto"`, the `dev-to-main-automerge` template's labeling job still applies
  `release-pending` on every merge (it's rendered identically in every mode,
  Architecture, above) but nothing ever clears it, since the manual-gate
  ask-flow that clears the label doesn't run under `"auto"`; this is inert
  and harmless in steady-state `"auto"` (nobody reads the label), but if a
  repo later switches from `"auto"` to `"manual-gate"`, the accumulated
  backlog of historical labels will surface as pending promotions on the
  wizard's next run — expected behavior, not a bug, since the user genuinely
  should be asked about that release history once switching to a mode that
  asks.

`release.tool` stays `"release-please"` regardless of which `mode` a repo
lands on, for config-shape parity across repos — it's simply inert until
`mode: "auto"` (see Config schema, below). For *this* repo specifically,
detection finds the triple-version-equality lint, so `release.mode:
"manual-gate"` is what it ships with.

## Architecture

```
skills/shipflow/                    # the shipped, portable skill package —
                                     # identical across every adopting repo
  .claude-plugin/plugin.json
  CHANGELOG.md, LICENSE, README.md
  skills/shipflow/
    SKILL.md                 # nondeterministic orchestration (Claude-driven)
    config.example.json      # shareable template, committed IN THE SKILL
    package.json
    skill-invariants.json
    scripts/
      detect.mjs              # read live repo state — deterministic
      plan.mjs                # diff live state vs config — deterministic, pure
      apply.mjs               # idempotently apply the plan — deterministic
      templates/               # workflow YAML: dev-to-main-automerge,
                                #  release-please, release-pr-automerge
                                #  (no ci-gate template — see below)

<adopting-repo>/                    # the TARGET repo shipflow is installed into
  .github/
    shipflow.json             # per-target-repo policy instance — COMMITTED
                               # here, NOT inside the skill package (see below)
```

**Templates (`scripts/templates/`):**

- `dev-to-main-automerge` — modeled on the shape of this repo's own
  `auto-merge.yml`, but rendered with the target repo's own parameters (see
  Template rendering, below) rather than shipped as a verbatim copy; turns
  on native GitHub auto-merge for the `dev → main` promotion PR via `gh pr
  merge --auto --merge`. Under `release.mode: "auto"`, the step that runs
  that `gh pr merge` command must be authenticated as `RELEASE_PAT`, not the
  default `GITHUB_TOKEN` — see Fatal #1 in Error Handling for why. It also
  ships a second, small job triggered on `pull_request: closed` for the
  configured `main` branch (guarded on `github.event.pull_request.merged ==
  true` **and** `github.event.pull_request.head.ref == <config.branches.dev>`,
  so a stray hotfix-to-`main` merge that isn't actually a `dev → main`
  promotion doesn't get mislabeled) that applies a `release-pending` label to
  the merged promotion PR — the durable marker `SKILL.md` later enumerates
  to recover the set of promotions still awaiting a release decision under
  `release.mode: "manual-gate"` (see that section, above).

  **The label must exist before this job's first run, or the label-apply
  call errors on a fresh repo where `release-pending` was never defined —
  reintroducing the exact "promotion never gets asked about" gap the label
  was meant to close.** `apply.mjs` provisions the label as part of the same
  idempotent scaffolding step that wires up `dev-to-main-automerge`: before
  (or as part of) writing that template, it checks whether a `release-pending`
  label already exists in the target repo (`gh label list` / `GET
  /repos/{owner}/{repo}/labels/release-pending`) and creates it (`gh label
  create release-pending` or the equivalent API call, with a fixed
  description/color) if it doesn't. **This runs unconditionally, in every
  `release.mode`, not only under `"manual-gate"`** — the `dev-to-main-automerge`
  template itself (including its `pull_request: closed` labeling job) is
  rendered identically regardless of `release.mode` (Architecture, above), so
  gating label provisioning on `"manual-gate"` alone would leave a repo
  running `release.mode: "auto"` with a labeling job that has no label to
  apply, failing on every real `dev → main` promotion — a permanently-red
  workflow run that round 5's `"manual-gate"`-only provisioning fix
  introduced without intending to (round 6 finding). Provisioning the label
  in every mode is the smallest fix: a label that `"auto"` mode's ask-flow
  never reads is inert and harmless, and this avoids adding a
  mode-conditional template-rendering flag, which would contradict the
  closed, mode-independent template parameter set (Template rendering,
  above). It's a no-op on re-run once the label exists, consistent with
  `apply.mjs`'s idempotency elsewhere in this design (see the matching
  checkable invariant, Invariants, below).
- `release-please` — invokes the `release-please` GitHub Action, which opens
  or updates each package's release PR from conventional-commit history on
  `main` (Release-please manifest section, below).
- `release-pr-automerge` — turns on auto-merge for the release PR that
  `release-please` opens, so the second hop (release PR → `main`) doesn't
  require a human click. Under `release.mode: "auto"`, this template's
  merge-triggering step must **also** be authenticated as `RELEASE_PAT`, for
  the identical loop-prevention reason as `dev-to-main-automerge` — see
  Fatal #1.

**Template rendering.** `apply.mjs` renders each file under
`scripts/templates/` by substituting a fixed parameter set into the
template before writing it into the target repo's `.github/workflows/` —
templates ship as parameterized stubs (placeholder tokens substituted by a
small string-templating step in `apply.mjs`), not verbatim copies of this
repo's own `dev`/`main`-hardcoded workflow files. The substituted
parameters: the branch names (`config.branches.dev`/`config.branches.main`),
the merge flag corresponding to `mergeMethod.devToMainMethod` (e.g.
`--merge` for `"merge"`, `--squash` for `"squash"`), and the credential
secret name (`config.release.releaseCredential`) wherever a
merge-triggering step needs non-default authentication. This keeps
rendering itself deterministic — pure string substitution, no judgment
calls — consistent with the design's existing deterministic/nondeterministic
split, and it's what makes `dev-to-main-automerge` actually portable to a
repo with different branch names or a different `devToMainMethod`, rather
than a static copy of this repo's own `auto-merge.yml`.

**Required-check names are deliberately NOT a template-rendering
parameter.** `gh pr merge --auto` (and GitHub's native auto-merge
generally) takes no check-name list as input — the eventual async merge is
gated on whatever live branch protection or rulesets mark required,
evaluated by GitHub itself against the target branch, not on anything baked
into the workflow YAML. None of the three templates
(`dev-to-main-automerge`, `release-please`, `release-pr-automerge`) has a
field that consumes check names, and none should: `config.requiredChecks`
and `plan.liveRequiredChecks` (Config schema and API Surface, below) are
consumed only by the branch-protection/ruleset API calls `apply.mjs` makes
directly — setting up what's required at the GitHub-state level — never by
template substitution. Baking check names into the rendered workflow would
be a dead no-op at best, since native auto-merge doesn't read a check list
from the workflow file at all, and at worst an implicit invitation to
reconstruct the bespoke polling "wait for named checks" mechanism Fatal #1
already rejected (Error Handling, below).

**Rendered template writes are first-class plan entries, not a side
channel.** `.github/workflows/dev-to-main-automerge.yml` (and the
`release-please`/`release-pr-automerge` templates, when `release.mode:
"auto"`) are real repo mutations and must show up in the confirmed plan
like every other mutation this design makes. `plan.mjs` computes, for each
template the current config calls for, a content-hash of what's currently
on disk (if the file exists) and a content-hash of what would be freshly
rendered from `config`, and classifies the result as a `creates` entry
(file absent), an `updates` entry (file present, hashes differ), or a
`noops` entry (file present, hashes match) — the same three-way
classification `plan.mjs` already applies to protection/cleanup/release-
wiring changes (API Surface, below). This closes the gap where a
workflow-file write happened inside `apply.mjs` but was invisible in what
the user confirmed beforehand.

**Hand-edit reconciliation policy.** An `updates` classification alone
doesn't distinguish *why* the on-disk content differs from a fresh render —
it could be a stale render (config changed since the last apply) or a
hand-edit (someone modified the generated YAML directly), and these two
cases need different handling: one is safe to overwrite, the other isn't.
To tell them apart, `apply.mjs` also records the hash of the *last
shipflow-rendered version* of each template it writes, alongside the rest
of the policy in `.github/shipflow.json` (e.g. `renderedTemplateHashes:
{ "dev-to-main-automerge": "<hash>" }`). If the on-disk file's hash matches
that recorded last-rendered hash, the difference from a fresh render is a
legitimate config-driven update and `apply.mjs` overwrites it normally. If
the on-disk hash does *not* match the recorded last-rendered hash — meaning
the file changed by some path other than shipflow's own last apply —
`apply.mjs` treats it as a hand-edit conflict: it does **not** silently
overwrite the file. Instead it surfaces the conflict in the plan output
(the `updates` entry is annotated `handEditDetected: true`, showing both
the hand-edited content and what shipflow would render) and refuses to
apply that entry unless the user passes an explicit `--force` (or
equivalent confirmed override) scoped to that specific file. This keeps
template writes inside the same plan-then-confirm-then-apply safety model
as every other mutation in this design, rather than letting them escape it
as an implicit side effect of scaffolding `dev-to-main-automerge`.

`config.example.json` ships inside the skill package because it's the
shareable, repo-agnostic template — identical content every adopting repo
starts from. The actual policy instance, `.github/shipflow.json`, cannot
live inside `skills/shipflow/skills/shipflow/` because that directory ships
byte-identically to every repo the skill is installed into; a committed,
repo-specific file has no home there. `SKILL.md` reads/writes
`.github/shipflow.json` in the **target repo's own tree** — a fixed,
predictable path, chosen over repo root to keep shipflow's footprint
grouped with other repo-governance config (matching where
`repo-settings.sh` already lives in this repo). An earlier draft of this
diagram showed `config.json` nested inside the skill package itself, which
was wrong for exactly this reason — corrected here.

`SKILL.md` never mutates repo state directly — every mutating action goes
through `apply.mjs`, and the computed plan is always shown to the user before
`apply.mjs` runs for real. This is the deterministic/nondeterministic split:
Claude decides *what* and confirms with the user; the scripts are the only
thing that *does*.

**`config.json` (written to `.github/shipflow.json` in the target repo) is
committed, not gitignored.** Unlike `devlog`'s config (genuinely personal —
API tokens, per-user preferences), shipflow's policy file holds repo-level
*policy*: branch names, required checks, release layout, protection
ownership. It lives in the **target repo's own tree** — never inside
`skills/shipflow/`, which is the shipped skill package and is byte-identical
across every adopting repo (see the Architecture diagram fix above). Every
collaborator and CI need to see and audit that policy, and the "re-run
detects drift" flow (Data Flow, below) needs to run in CI too — which is
impossible if only the person who ran setup has the file locally. It
contains no secrets (all GitHub access is via the ambient `gh` auth /
`GITHUB_TOKEN`), so there's no reason to keep it out of version control. If
a target repo ever needs a genuinely local-only value (e.g. a developer's
personal override), that value goes in a separate, actually-gitignored
`.github/shipflow.local.json` that overlays `.github/shipflow.json` — the
policy file itself stays committed. **Merge semantics:** `detect.mjs` reads
`.github/shipflow.local.json`, if present, and shallow-merges it over
`.github/shipflow.json` (local values win key-by-key, not a deep merge)
before the merged config is handed to `plan.mjs`/`apply.mjs` — neither of
those two scripts reads `.github/shipflow.local.json` directly, so this
overlay step in `detect.mjs` is the only place local-only values enter the
pipeline. **Rendering-relevant keys are not overlay-eligible.**
`branches`, `mergeMethod`, and `release.releaseCredential` feed directly
into `apply.mjs`'s template rendering (Architecture, Template rendering,
above) and into the content-hash `apply.mjs` records as
`renderedTemplateHashes`; if a local overlay could change what gets
rendered, the hash recorded against the *committed* `.github/shipflow.json`
would reflect a locally-overridden render that no other collaborator or CI
run would ever reproduce, causing a false-positive `handEditDetected` the
moment anyone else (or CI) runs `apply.mjs` against a clean checkout with
no local override present. So `detect.mjs`'s shallow merge explicitly
excludes `branches`, `mergeMethod`, and `release.releaseCredential` from
`.github/shipflow.local.json` — those three keys, if present in the local
overlay, are ignored with a warning, and every hash `apply.mjs` computes or
records is always derived from the committed `.github/shipflow.json` alone.

**No `ci-gate` template.** An earlier draft of this design included a
generically-generated `ci-gate` workflow template. That's removed: this
repo's CI gate already exists as per-skill `ci / <skill>` jobs whose required
status-check names, un-filtered `pull_request` trigger, and
`pull-requests: read` permission (for `dorny/paths-filter`) are load-bearing
and exact-string-matched by branch protection. A second, generically
generated CI workflow risks duplicating, colliding with, or silently
un-requiring those exact job names. shipflow scopes itself to
branch/merge/release **policy** only: `detect.mjs` reads existing check names
from the target repo's workflows into `requiredChecks` (Config schema,
below); it never generates or installs a CI-gate workflow. The only narrow
exception: if `detect.mjs` finds **zero** existing CI workflows in the target
repo, `SKILL.md` may offer to scaffold a minimal one as an explicit,
separately-confirmed opt-in step — never as part of the default plan.

## Config schema (`config.example.json`)

The `mode: "manual-gate"` value shown below is *this repo's* computed
default (it has a detected triple-version-equality constraint — see "Two
investigated architectural decisions" above) — it is not a hardcoded
universal default; a repo without that constraint gets `mode: "auto"`
computed instead. The template otherwise applies as-is.

```json
{
  "branches": { "main": "main", "dev": "dev" },
  "featureBranchPrefix": "feature/",
  "requiredChecks": [],
  "mergeMethod": {
    "featureToDevMethod": "squash",
    "devToMainMethod": "merge"
  },
  "protectionOwner": "external",
  "release": {
    "enabled": true,
    "mode": "manual-gate",
    "tool": "release-please",
    "layout": "manifest",
    "releasePlease": {
      "packages": [],
      "extraFiles": {
        "skillMdVersionField": "version",
        "pluginJsonVersionField": "version"
      },
      "separatePullRequests": true
    },
    "releaseCredential": "GITHUB_TOKEN"
  },
  "branchCleanup": {
    "deleteOnMerge": true,
    "protectedBranches": ["dev", "main"]
  },
  "enforceAdmins": false,
  "renderedTemplateHashes": {}
}
```

`requiredChecks` starts empty and is filled in during first-run setup (see
Data Flow) rather than hand-typed — per your answer, the skill detects
candidate check names from the target repo's existing workflows and the user
confirms/edits the list once; it's then saved to `config.json` and reused on
every later run without re-asking. **Empty `requiredChecks` is a fail-open
state, not a valid steady state** — see `apply.mjs`'s hard refusal in Error
Handling.

`renderedTemplateHashes` is not user-authored — it starts empty and
`apply.mjs` writes one entry per shipflow-managed workflow template (e.g.
`"dev-to-main-automerge"`) the first time it successfully renders and writes
that file, recording the content-hash of what it wrote. This is the record
`plan.mjs` compares a template's live on-disk hash against to distinguish a
legitimate config-driven re-render from a hand-edit (Architecture, Template
rendering, above) — never hand-edit this field directly. **The rendered
template file and the hash `apply.mjs` records for it must land in the same
commit.** If a user commits `.github/workflows/dev-to-main-automerge.yml`
without also committing the updated `renderedTemplateHashes` entry in
`.github/shipflow.json` (or vice versa), the next run's hand-edit check
compares against a stale or missing hash and false-positives
`handEditDetected` on a file shipflow itself wrote. `SKILL.md`'s setup/apply
instructions call this out explicitly — commit the rendered workflow file(s)
and `.github/shipflow.json` together, in one commit, every time `apply.mjs`
writes either.

Likewise, **`protectionOwner: "external"` in this shipped template is an
unverified placeholder, not a claim about any specific adopting repo** —
first-run setup overwrites it with the actually-detected value (Two
investigated architectural decisions, above) before `config.json` is ever
applied for real. A repo that copied the template verbatim without running
setup would incorrectly read as "an external mechanism owns protection"
when no such mechanism may exist — the same class of fail-open-state risk
`requiredChecks: []` carries, called out here for the same reason.

`mergeMethod` is split into `featureToDevMethod` and `devToMainMethod`
because this repo (and most repos following this branch model) uses two
different merge policies: squash for `feature → dev` (clean integration
commit) and merge-commit for `dev → main` (keeps `dev` and `main` linked so
`dev` never diverges). A single scalar can't express that intent. **Setting
`devToMainMethod` to anything other than `"merge"` reintroduces that
divergence** — a squashed or rebased `dev → main` merge breaks the
"`dev` never diverges from `main`" property this design relies on — so if
the setup wizard sees `devToMainMethod` set to `"squash"` or `"rebase"`, it
surfaces an explicit warning explaining the divergence consequence before
writing that value to `config.json`, rather than accepting it silently.

**`featureToDevMethod` is convention/documentation only — it does not
configure any GitHub API call.** GitHub's merge-method settings
(`allow_squash_merge`, `allow_merge_commit`, `allow_rebase_merge`) are
repo-wide toggles; there is no per-base-branch merge-method policy to set
via the API or the UI, so "squash into `dev`, merge-commit into `main`"
cannot be enforced as a rule GitHub applies automatically based on the
target branch. shipflow *can* enforce `devToMainMethod` because it
generates the `dev → main` auto-merge workflow itself and controls the
literal `gh pr merge` invocation in that workflow — but there is no
equivalent automation on the feature→dev side (feature branches are
user-driven, ad hoc merges), so `featureToDevMethod` has nothing to attach
enforcement to. This matches the existing "feature-branch naming is
convention only, not machine-enforced" scoping decision (Out of scope,
below). `apply.mjs`'s only actual effect from `mergeMethod` is toggling the
repo-wide `allow_squash_merge`/`allow_merge_commit` flags on so that
whichever methods either value names are selectable at all in the GitHub
UI/API — both flags must be enabled repo-wide for both `featureToDevMethod`
and `devToMainMethod` to be usable, since GitHub has no narrower
granularity than repo-wide for those flags.

`protectionOwner` records the decision from the "Rulesets vs. existing
settings-as-code" investigation above: `"external"` means an existing
mechanism (e.g. `repo-settings.sh`) owns branch protection and shipflow only
manages cleanup/automerge/release; `"shipflow"` means shipflow installed and
owns the ruleset itself. Detected once during setup (with the
artifact-vs-bare-protection disambiguation described above), not re-guessed
per run. **Under `protectionOwner: "external"`, this cluster of fields is
advisory-only in aggregate:** `requiredChecks`, `enforceAdmins`, and
`featureToDevMethod` are each individually documented as inert/advisory in
this mode (see their sections above and below) — worth naming as a group
here, since a third of the schema silently doesn't do anything to live
GitHub state once an external mechanism owns protection.

**When `protectionOwner: "external"`, `config.requiredChecks` is advisory
only and can silently diverge from what's actually enforced.** Native
GitHub auto-merge waits on whatever checks *live branch protection or
rulesets* mark required — owned by the external mechanism in this mode —
not on shipflow's `config.requiredChecks` list. The two can drift (the
external mechanism requires 4 checks; `config.requiredChecks` says 3, or
vice versa), and shipflow's empty-check refusal (Error handling, below)
would be guarding the wrong list if it only ever looked at config.
**Required checks can be defined in either of two separate GitHub API
shapes, and a repo may use either or both:** classic branch protection's
required-status-checks list, or a ruleset's `required_status_checks` rule
parameters (`GET /repos/{owner}/{repo}/rulesets`) — this design already
treats rulesets as a valid external protection artifact (e.g. Terraform's
`github_repository_ruleset`, Rulesets vs. existing settings-as-code source
of truth, above), so a ruleset-only repo is squarely in scope, not an edge
case. Reading only the classic protection endpoint would read back an empty
list for a ruleset-only repo even though real required checks exist, and
falsely trigger the empty-checks refusal against a repo that is actually
correctly configured. So under `protectionOwner: "external"`, `detect.mjs`
reads **both** the classic branch-protection endpoint's required-status-checks
list **and** the rulesets endpoint's `required_status_checks` rule
parameters on every run, and `plan.mjs` combines both into the single
`Plan.liveRequiredChecks` value (API Surface, below) as their **union** —
this is a design requirement, not a verified claim about ruleset API
behavior, and should be confirmed against a live ruleset-protected sandbox
repo as part of the integration testing pass (Testing strategy, below).
`plan.mjs` diffs that unioned list against `config.requiredChecks`,
surfacing any divergence to the user in the plan output before anything is
applied; and the empty-checks hard refusal in `apply.mjs` reads
`plan.liveRequiredChecks` in this mode, not the possibly-stale
`config.requiredChecks` (under `protectionOwner: "shipflow"`, config *is*
the live state, so `apply.mjs` reads `config.requiredChecks` directly and no
such split exists).

`release.layout` (`"simple"` vs `"manifest"`) is a one-time judgment call —
single package vs monorepo — made by Claude during setup and recorded into
config; `apply.mjs` never re-guesses it.

`release.mode` (default computed by detection, `"auto"` opt-in/default per
the conditional rule above) and the `release-please` manifest shape
(`release.releasePlease`) are covered in "Two investigated architectural
decisions" above and "Release-please manifest (auto mode only)" below.
`release.releaseCredential` records which secret the `"auto"` mode's
tag-cutting push runs as — see Fatal #1 in Error Handling; it defaults to
the literal string `"GITHUB_TOKEN"` only as a placeholder that `apply.mjs`
refuses to accept for `mode: "auto"` (see below) — `apply.mjs` is the sole
owner of this refusal, consistent with every other policy-refusal assertion
in this design, all of which live in `apply.mjs` / Error Handling;
`detect.mjs` only ever reports state, it never refuses to proceed. The only
real value it can
hold is `"RELEASE_PAT"` (or whatever secret name the target repo actually
uses for a non-default credential) — see Fatal #1 for why a same-job,
credential-free alternative was considered and dropped.

`release.enabled` and `release.mode: "manual-gate"` are not redundant even
though both can mean "no automatic tagging happens" — they answer different
questions. `release.enabled: false` means shipflow doesn't touch release
*at all*: no tagging, and also no manual-gate ask-flow — `SKILL.md` simply
never raises the release question after a `dev → main` merge, useful for a
repo that doesn't want shipflow involved in release in any capacity.
`release.mode: "manual-gate"` (paired with the default `enabled: true`)
means shipflow *is* involved, but only as the deliberate-ask step matching
this repo's existing "AGENT RULE" — it still asks every time, it just never
auto-tags without a yes. In short: `enabled` gates whether shipflow
participates in release at all; `mode` (when `enabled: true`) gates whether
that participation is a human ask or full automation.

`enforceAdmins` mirrors this repo's `enforce_admins: false` break-glass
setting on `main` protection — an admin keeps a direct-push path even with
protection on. **This field is only actionable when `protectionOwner:
"shipflow"`** — in that mode `apply.mjs` sets it explicitly instead of
leaving it at the GitHub API default. Because `protectionOwner: "shipflow"`
installs a GitHub **ruleset** rather than classic branch protection, and
rulesets have no direct `enforce_admins` boolean, `apply.mjs` translates
`enforceAdmins: false` into an admin bypass-actor entry on that ruleset
(granting admins a bypass path), and `enforceAdmins: true` into the absence
of any such bypass-actor entry — the ruleset equivalent of classic
protection's `enforce_admins: true`. When `protectionOwner: "external"`,
shipflow doesn't write protection at all, so there is nothing for it to
"pass through" to; `config.enforceAdmins` in that mode is purely
informational/advisory and can disagree with whatever the external
mechanism actually set — the same advisory-only relationship
`requiredChecks` has to live state under external ownership (see
`protectionOwner`, above).

### Release-please manifest (auto mode only)

When `release.mode: "auto"`, `release.releasePlease` must be fully
specified, not left to release-please's defaults, because release-please's
defaults don't match this repo's model:

- `packages`: one entry per skill/package directory (e.g.
  `skills/devlog`, `skills/ghostwriter`), each with its own `component`
  name and starting version — this is what makes releases per-skill instead
  of tree-wide.
- `extraFiles`: release-please's manifest mode only bumps `package.json` by
  default. This repo also needs `SKILL.md` frontmatter `version:` and
  `plugin.json.version` bumped in the same commit — both configured as
  `extra-files` updaters (a `generic` string-replace updater for the YAML
  frontmatter field, and a `json` updater for `plugin.json.version`) in the
  manifest for every package.
- `separatePullRequests: true`: keeps each skill's release PR independent,
  matching the existing per-skill `workflow_dispatch` release model rather
  than batching all changed skills into one release PR.
- `tagPrefix` moves from a single top-level config scalar to a per-package
  field inside `release.releasePlease.packages[].tagPrefix` (e.g.
  `devlog-v`, `ghostwriter-v`) — a monorepo needs a distinct prefix per
  package, which a single top-level scalar can't express.
- **Version-ownership coexistence with `lint_plugin.py` — gated by a
  concrete pre-flight check, not just documented as a risk.** When
  `release.mode: "auto"`, release-please's release PR — not a human — would
  need to change `package.json`/`SKILL.md`/`plugin.json` together; the claim
  that configuring all three as `extra-files` updaters against the same
  target version keeps them byte-equal in practice is currently
  **unverified** against a real release-please run. Shipping that claim as
  documentation only, gated behind "confirm this empirically later," isn't
  good enough — the only test that would actually catch a regression here
  is the expensive credential-pinned integration test (Testing strategy,
  below), which is too costly to run on every setup. So the setup wizard
  itself performs a concrete pre-flight check before ever writing a
  `mode: "auto"` config.

  **This pre-flight's trigger is a structural signal, not the
  lint-detection heuristic.** An earlier version of this design gated the
  pre-flight on "`detect.mjs` found a triple-version-equality-style CI
  lint" — but that heuristic can miss a real constraint (an unrecognized
  check shape, a lint written differently than `lint_plugin.py`'s exact
  pattern), and a miss both defaults `release.mode` to `"auto"` *and*
  skips the pre-flight in the same stroke, since both are keyed off the
  same detection. That leaves the pre-flight guarding only the
  already-safe case (detection succeeded) and bypassed in exactly the
  dangerous one (detection missed a real constraint that's actually
  present). Instead, the pre-flight runs whenever `mode: "auto"` is about
  to be written for **any repo that structurally has all three of
  `package.json`, `SKILL.md`, and `plugin.json` present** in a given
  package directory — a plain file-presence check, independent of whether
  the lint-pattern heuristic happened to fire. A repo with none of those
  three files coexisting has nothing to keep byte-equal and isn't gated by
  it; a repo that has all three is gated regardless of whether
  `detect.mjs`'s lint-heuristic recognized an enforcing CI check.

  The check itself: (1) run `release-please` in dry-run mode against the
  target repo/sandbox, (2) capture what each of the three configured
  updaters (`package.json`, the `SKILL.md` frontmatter `generic` updater,
  the `plugin.json` `json` updater) would write, (3) diff all three
  resulting version strings for byte-equality, and (4) **block** enabling
  `mode: "auto"` — refuse to write the config, with an explicit error — if
  they don't match. Until this dry-run check passes for a given repo,
  `mode: "auto"` is marked **experimental/unsupported for repos with all
  three files present** in the setup summary and in this design.

### Adoption / migration note (auto mode only)

Turning on `release.mode: "auto"` for a repo that already has hand-cut
`<skill>-vX.Y.Z` tags is a migration, not a config flip. release-please
computes each package's next version from a manifest baseline plus commit
history since that baseline — if the baseline isn't seeded to match the
latest already-published tag, its first computed release can disagree with
what's already live (e.g. propose `v0.5.0` when `v0.6.0` is already tagged
and published). Before enabling `"auto"` on a pre-existing repo, shipflow's
setup wizard must: (1) read the latest existing tag per package, (2) seed
`.release-please-manifest.json` with those versions, (3) run release-please
in dry-run and diff its computed next version against the latest tag/
`CHANGELOG.md` entry per package, and (4) require the user to confirm the
diff before writing the manifest for real. This is a one-time step recorded
by writing the manifest file itself — a re-run doesn't repeat it once the
manifest exists.

## Data flow

**First run (setup wizard):** `detect.mjs` reads existing branches, workflow
job names (into candidate `requiredChecks` — it never generates a CI-gate
workflow of its own, see Architecture above), branch protection/rulesets
(to decide `protectionOwner`, using the artifact-vs-bare-protection
disambiguation above — prompting the user explicitly when protection exists
with no settings-as-code artifact behind it), release signals (a
triple-version-equality-style CI lint or existing manual per-skill release
workflows, to compute the `release.mode` default), and whether
`.github/shipflow.json` already exists **in the target repo** (not inside
the skill package — see Architecture above). `SKILL.md` walks the user
through confirming branch names, proposes `requiredChecks` from detected CI
job names, asks simple-vs-monorepo layout only if ambiguous, shows the
computed `release.mode` default and lets the user override it, and writes
`.github/shipflow.json`. If the resulting mode is `"auto"` **and** the
target repo structurally has `package.json` + `SKILL.md` + `plugin.json` all
present in a package directory (a file-presence check, not the
lint-detection heuristic — see Release-please manifest section, above), the
dry-run byte-equality pre-flight check runs before the config is written.
`plan.mjs` then diffs empty-state vs config, and `apply.mjs` executes it
only after the user confirms the shown plan.

**Re-run (audit/repair):** `detect.mjs` + `plan.mjs` run again; if live state
drifted from `.github/shipflow.json` (e.g. someone manually edited branch
protection, or — under `protectionOwner: "external"` — the external
mechanism's required-checks list diverged from `config.requiredChecks`, see
above), `SKILL.md` shows the diff and asks before re-applying. No
re-interview unless the user explicitly asks to reconfigure.

**Confirmation-to-apply gap (TOCTOU).** The plan the user confirms is a
snapshot of live GitHub state at the moment `detect.mjs`/`plan.mjs` ran.
Between showing that `dryRun: true` plan and running the real
`dryRun: false` apply, live state can drift — another admin runs the wizard
concurrently, or edits branch protection by hand in the interim — and
applying a stale plan against changed state can silently clobber that
change or apply steps that no longer make sense. To close this gap,
`SKILL.md` re-runs `detect.mjs` immediately before the real (non-dry-run)
`apply.mjs` call and compares the fresh state hash against the one the
confirmed plan was computed from. If they differ, `apply.mjs` aborts before
making any mutating call and reports "repo state changed since the plan was
confirmed — re-run to get an updated plan" rather than proceeding on stale
assumptions.

## Error handling

- `gh auth` / permission check runs first — branch protection and rulesets
  need repo-admin scope; fail fast with one clear message, not partway
  through a multi-step apply.
- `apply.mjs` is idempotent and step-ordered: each step checks current state
  before mutating, so a failed run is always safe to re-run.
- The skill gates on named checks but never generates test/CI logic itself —
  check names are the contract, matching this repo's own separation between
  workflow policy and each skill's actual test suite.
- **`apply.mjs` hard-refuses to enable auto-merge when the required-checks
  list it's guarding on is empty.** An empty list is a fail-open default,
  not a valid "no checks needed" state: if `dev → main` auto-merge is turned
  on while the guarded list is empty, `main` protection gates on nothing and
  every PR auto-merges immediately with zero verification. **Which list
  `apply.mjs` reads depends on `protectionOwner`:** under `protectionOwner:
  "shipflow"`, config *is* the live state, so `apply.mjs` asserts
  `config.requiredChecks.length > 0`; under `protectionOwner: "external"`,
  config can be stale (Config schema, above), so `apply.mjs` instead asserts
  `plan.liveRequiredChecks.length > 0` — the live list `plan.mjs` populated
  as the union of `repoState.protection` and `repoState.rulesets` (API
  Surface, above), not the possibly-stale `config.requiredChecks`. Reading
  only classic protection here would false-positive this refusal against a
  ruleset-only repo that has real required checks. Either way, before any
  auto-merge wiring step,
  `apply.mjs` errors out with `"refusing to enable auto-merge with zero
  required checks — set requiredChecks or explicitly pass
  --allow-no-checks to override"` (an explicit, named opt-out, not a silent
  default).

### Fatal: `GITHUB_TOKEN` cannot drive automatic release tagging

GitHub's loop-prevention rule means a push authored by the default
`GITHUB_TOKEN` does **not** trigger downstream `push`-triggered workflows.
This repo's own `auto-merge.yml` header and `CLAUDE.md` already document
this exact failure mode: the `dev → main` auto-merge runs as the bot
`GITHUB_TOKEN`, so if `release-please`'s trigger is a `push` to `main`, it
never fires — no release PR is ever created, nothing is ever tagged, and
the design's earlier "fully hands-off" claim was wrong for that reason.
This is a **hard prerequisite**, not a nice-to-have, for `release.mode:
"auto"`:

- **Required credential:** a `RELEASE_PAT` (a fine-grained PAT or GitHub App
  installation token — anything that is not the default `GITHUB_TOKEN`)
  must exist as a secret before `release.mode: "auto"` can be enabled.
  `detect.mjs` checks for the secret's existence via the repo-secrets API
  (it can confirm the secret is *set*, not read its value). **Org-secret
  detection is a design requirement here, not a verified capability of this
  design:** the repo-secrets endpoint alone would not see a secret that's
  provisioned at the org level and made available to this repo, so a
  correctly-provisioned org secret would be reported as absent and
  incorrectly block `"auto"` mode. Before this design can honestly claim
  "repo or org secret" support, `detect.mjs` must be confirmed to also check
  whichever `gh`/API surface enumerates org-level secrets available to a
  given repo. Until that's concretely verified, this design narrows the
  requirement to **a repo-level secret only** — `RELEASE_PAT` must be set as
  a repo secret, and the "or org secret" claim is dropped until org-secret
  detection is implemented and confirmed. `apply.mjs` **fails fast and
  refuses to wire up `"auto"` mode** if `RELEASE_PAT` (or whatever secret
  name `release.releaseCredential` points at) is absent as a repo secret,
  with an explicit error naming the missing secret and a link to GitHub's
  docs on creating a fine-grained PAT / installation token. The design no
  longer claims automatic release tagging is "fully hands-off" without this
  credential — it is hands-off only after this one-time credential setup.

  **Confirming the secret exists is a necessary precondition, checked once at
  setup time — it is not, by itself, the fix.** The actual fix is that both
  pushes to `main` that must trigger downstream `push`-triggered workflows
  are themselves authored by that credential, not the default `GITHUB_TOKEN`:
  - **Hop 1 (`dev → main` promotion merge):** the `dev-to-main-automerge`
    template's `gh pr merge --auto --merge` step — the step that actually
    authors the promotion merge — must run authenticated as `RELEASE_PAT`
    (e.g. that step's `GH_TOKEN`/`env` set to `${{ secrets.RELEASE_PAT }}`,
    not the job's default `GITHUB_TOKEN`) whenever `release.mode: "auto"` is
    active. Passing `RELEASE_PAT` only to a later `release-please` action
    step does not retroactively make the push that was supposed to trigger
    that workflow run PAT-authored — the merge itself has to be
    PAT-authored, or `release-please`'s `push`-to-`main` trigger never fires
    in the first place.
  - **Hop 2 (release PR → `main`):** `release-please` is two-phase — per the
    design's own testable invariant below, it opens/updates a release PR
    from commit history, and a *separate* merge of that release PR is what
    actually cuts the tag. That second merge is a second push to `main`. The
    `release-pr-automerge` template (Architecture, above) that merges the
    release PR must equally run its merge-triggering step authenticated as
    `RELEASE_PAT`, not `GITHUB_TOKEN`, whenever `mode: "auto"` is active —
    otherwise that merge is bot-authored, and anything downstream that
    listens for that push (the release-please tag/release-creation step
    itself, and this repo's per-skill npm-publish workflows discussed below)
    does not fire, reproducing the identical hop-1 failure one step later.

  `apply.mjs` is responsible for wiring the credential into both templates'
  merge-triggering steps when it scaffolds `mode: "auto"` — the
  secret-existence check alone does not guarantee either template's merge
  step actually uses it, and that wiring is what this design requires,
  not something already verified against a live `release-please` run.

  **Contingency if the credential-pinned integration test disproves this.**
  The two-hop `RELEASE_PAT` wiring above is this design's best-specified
  hypothesis for making both triggering pushes PAT-authored; it remains
  unverified until the credential-pinned integration test (Testing
  strategy, below) actually runs against a live sandbox repo. If that test
  shows the two-hop wiring does not, in practice, produce a PAT-authored
  triggering push at one or both hops, `release.mode: "auto"` stays
  unsupported/blocked for this design — there is no silent fallback to the
  bespoke-polling same-job mechanism rejected immediately below; a working
  trigger mechanism would have to be found and separately specified before
  `"auto"` mode could ship.
- **No credential-free alternative — `"same-job"` is dropped.** An earlier
  draft of this design proposed a `"same-job"` option: invoke
  `release-please` directly inside the `dev → main` auto-merge job, right
  after the merge completes, reusing that job's own `GITHUB_TOKEN` instead
  of depending on a downstream `push` trigger. That option does not work
  with how this repo's (and this design's own) auto-merge template actually
  behaves: `dev-to-main-automerge` enables **native** GitHub auto-merge via
  `gh pr merge --auto --merge` and then the job **ends** — the actual merge
  to `main` happens asynchronously, later, whenever the required checks
  pass, with no job running at that moment to attach a release invocation
  to. There is no "same job, right after the merge completes" moment to
  hook into when auto-merge is native. As written, a user who selected
  `releaseCredential: "same-job"` would get a config `apply.mjs` accepted
  that produced no release, ever — a silent no-op, not a working
  credential-free path.

  The only way to make a same-job release genuinely work is to stop using
  native auto-merge for the release-triggering merge and replace it with a
  **bespoke blocking job**: one that polls the PR's check-run status in a
  loop (or waits on a `check_suite`/`workflow_run` event) until required
  checks pass, then merges via the API itself, in that same job, so it *is*
  present to invoke `release-please` immediately afterward. This is a real,
  buildable alternative, but it is not a drop-in equivalent to `RELEASE_PAT`
  and this design does not adopt it for v1:
  - it trades native auto-merge's defining property — "merges itself
    whenever checks eventually pass, even hours or days later, with no
    workflow run needing to stay alive" — for a job that must itself stay
    alive (or be re-triggered) for the entire wait;
  - GitHub Actions jobs have a bounded runtime (subject to the workflow's
    `timeout-minutes` and the runner's own limits); a check that takes
    longer to go green than the job is willing to wait silently strands the
    PR unmerged with no native auto-merge fallback, and the job burns
    runner-minutes the whole time it's polling;
  - polling introduces its own failure modes (rate limits, missed state
    transitions, handling checks that get re-run) that native auto-merge
    doesn't have, since GitHub owns that logic internally.

  Given that, this design **drops `"same-job"` as an option entirely**
  (option (a) from the round-2 finding, not option (b)) — the only
  supported value for `release.releaseCredential` under `mode: "auto"` is a
  real non-default-token secret (`"RELEASE_PAT"` or an equivalently-named
  repo secret). `release.mode: "auto"` without that credential configured
  and present is refused by `apply.mjs`, not silently defaulted or routed
  through a bespoke polling job. A future version could revisit the bespoke
  blocking-job design as an explicit, separately-scoped opt-in if a repo
  genuinely cannot provision a PAT/App token — but it would ship as a fully
  specified, separately tested mechanism then, not folded into `"auto"`
  mode's happy path now.
- This same loop-prevention behavior means a `release-please`-cut tag/
  release authored by `GITHUB_TOKEN` also won't trigger this repo's
  existing per-skill npm-publish workflows, for the identical reason — npm
  publish likewise needs to run under `RELEASE_PAT` rather than the default
  token if `mode: "auto"` is used for a skill with `npm-publish: true`.

## Testing strategy

- Unit tests (mocked `gh api` responses) for `detect.mjs` / `plan.mjs` — pure
  functions, no live network.
- Four real integration tests against a disposable sandbox repo — not one,
  because the branch-cleanup mechanism, the release-automation mechanism, and
  the required-checks detection mechanism carry very different risk.
  `delete_branch_on_merge` + a deletion ruleset preserving `dev` across a
  `dev → main` merge is a mechanism this repo already runs in production via
  `repo-settings.sh`, so it's already empirically proven; a test of it is
  low-risk confirmation. Release automation is exactly where Fatal #1 and
  Fatal #2 originated, so it gets the more rigorous test. The
  ruleset-required-checks union (`plan.liveRequiredChecks`, Config schema and
  API Surface, above) is an unverified claim about live ruleset API behavior,
  so it gets its own dedicated test rather than resting on the other three:
  1. **Branch cleanup:** verify `delete_branch_on_merge` + a deletion
     ruleset actually preserves `dev` across a `dev → main` merge.
  2. **Release automation, credential-pinned:** run the full `dev → main`
     auto-merge for a sandbox repo configured with `release.mode: "auto"`
     and `releaseCredential: "RELEASE_PAT"`, using a real non-default-token
     secret with the same name and scope shipflow requires, and assert the
     release actually fires through both hops — a release PR is opened,
     that release PR is merged, and a tag is cut. The test must explicitly
     assert **which credential authored each of the two triggering pushes**,
     not just that a release eventually appeared: (a) the `dev → main`
     promotion merge itself must be authored by `RELEASE_PAT`, not
     `GITHUB_TOKEN`, or `release-please`'s `push`-to-`main` trigger never
     fires (Fatal #1, hop 1); and (b) the release PR's merge into `main`
     must likewise be authored by `RELEASE_PAT`, not `GITHUB_TOKEN`, or the
     tag/release-creation step and any downstream `push`-triggered workflow
     (e.g. npm-publish) never fires (Fatal #1, hop 2). Asserting only "a tag
     exists" is not sufficient — it would pass even if only one hop were
     correctly PAT-authored, or if the tag were cut by some unrelated path
     (e.g. a manually triggered dispatch in the test harness). Separately,
     run the same scenario using the *default bot `GITHUB_TOKEN`* for both
     hops (no `RELEASE_PAT` configured) and assert no release PR ever
     appears — anchored not on a wall-clock timeout (which would make the
     test flaky and imply an unbounded wait to prove a negative), but on
     "no release PR exists after the credential-pinned positive-case
     scenario above has demonstrably completed for an equivalent commit" —
     i.e. run the negative case against the same commit shape, and confirm
     the positive case's completion signal (its release PR merged and tag
     cut) as the bound, rather than waiting on a clock.
  3. **Byte-equality pre-flight (auto mode, repos with `package.json` +
     `SKILL.md` + `plugin.json` all structurally present):** exercise the
     dry-run pre-flight check itself (Release-please manifest section,
     above) against a sandbox seeded with all three files present — not
     conditioned on whether a `lint_plugin.py`-style lint was also
     detected, since the pre-flight's trigger is the structural file
     signal, not the lint-detection heuristic (see the significant-finding
     fix in Release-please manifest section, above) — and assert it blocks
     `mode: "auto"` when the three updater outputs are deliberately made to
     disagree (e.g. a mis-configured `extraFiles` updater), and allows it
     through when they
     match.
  4. **Ruleset-union required-checks (`protectionOwner: "external"`,
     ruleset-only repo):** provision a sandbox repo protected **only** by a
     GitHub ruleset with `required_status_checks` rule parameters set —
     deliberately with no classic branch-protection required-status-checks
     configured at all, so the two sources genuinely diverge in shape, not
     just in value. Run `detect.mjs` against it and assert `repoState.rulesets`
     comes back non-empty and carries the configured check names; run
     `plan.mjs` against the resulting `repoState` and assert
     `plan.liveRequiredChecks` is populated as the union (here, equal to the
     ruleset's checks, since classic protection contributes nothing) rather
     than empty — confirming the live claim under Config schema,
     `protectionOwner` and API Surface, above, that reading classic
     protection alone would falsely read back empty for this repo shape.
     Then run `apply.mjs`'s empty-checks refusal (Error handling, below)
     against the same plan and assert it does **not** fire — a ruleset-only
     repo with real required checks must not be spuriously blocked from
     auto-merge wiring just because classic branch protection's list, taken
     alone, is empty.
- `skill-invariants.json` lists the checkable invariants below, matching
  `devlog`'s existing pattern, for automated regression checking.

## API Surface

- `detect.mjs`: `detectRepoState(repoPath): RepoState` — `{ branches,
  workflows, templateFiles, protection, rulesets, existingConfig,
  releaseCredentialPresent, stateHash }`. `protection` is the classic
  branch-protection API response (required-status-checks list included);
  `rulesets` is the separate `GET /repos/{owner}/{repo}/rulesets` response,
  read whenever `protectionOwner: "external"` so a ruleset-only repo's
  required checks are actually visible — classic protection alone would
  read back empty for such a repo (Config schema, `protectionOwner`,
  above). `workflows` is job **names** only (harvested into candidate
  `requiredChecks`, per Config schema above) — it is not the same thing as
  `templateFiles`, which is the on-disk **content** (read as raw bytes and
  content-hashed) of each shipflow-managed workflow path under
  `.github/workflows/` (`dev-to-main-automerge.yml` and, under
  `release.mode: "auto"`, `release-please.yml`/`release-pr-automerge.yml`),
  present in `RepoState` specifically so `plan.mjs` can diff it against a
  fresh render (Architecture, Template rendering, above); a workflow file
  can exist with job names `detect.mjs` already harvests while still having
  drifted, byte-for-byte, from what shipflow would currently render.
  `releaseCredentialPresent` records whether the named secret
  exists **as a repo secret** (Fatal #1 check) — org-secret visibility is
  not part of this check for now (see Fatal #1's org-secret discussion
  above). `stateHash` is a deterministic hash over the fields that matter
  for planning (branch list, protection rules, workflow job names) — used
  for the TOCTOU re-detect comparison below. **Known gap:** `stateHash`
  does not currently cover `delete_branch_on_merge`, secret presence/
  absence, or `templateFiles` content — a concurrent change to any of these
  between plan and apply would not be caught by the TOCTOU guard. Cheap to
  add to the hashed field list if a gap here proves to matter in practice;
  left out of v1 to keep the hash scoped to the fields `plan.mjs` actually
  branches on today. **This gap is independently narrowed for the
  credential case specifically:** regardless of `stateHash`, `apply.mjs`
  re-checks the release credential's presence immediately before the
  auto-mode wiring step itself (not only once, back at plan time) — so a
  `RELEASE_PAT` deleted between plan-confirmation and apply is still caught
  at the point it matters, even though `stateHash` itself doesn't hash
  secret presence/absence. The hand-edit reconciliation check (Architecture,
  Template rendering, above) provides an analogous narrowing for
  `templateFiles`: it re-derives the on-disk hash at apply time and compares
  it against the recorded last-rendered hash regardless of what `stateHash`
  captured at plan time.
- `plan.mjs`: `computePlan(repoState, config): Plan` — `{ creates, updates,
  noops, sourceStateHash, liveRequiredChecks }`, pure function, no side
  effects. **`creates`/`updates`/`noops` cover both GitHub-state changes
  (protection, cleanup, auto-merge wiring, release config) and rendered
  template-file writes** — for each shipflow-managed workflow template,
  `plan.mjs` compares `repoState.templateFiles`' on-disk content-hash
  against a freshly-rendered hash for that template under `config` and
  classifies the result into whichever of the three buckets applies (see
  Architecture, Template rendering, above); template entries additionally
  carry a `handEditDetected` flag when the on-disk hash doesn't match the
  last shipflow-rendered hash recorded in `config`. `sourceStateHash` pins
  the `RepoState.stateHash` the plan was computed from. `liveRequiredChecks`
  is populated as the **union** of `repoState.protection`'s
  required-status-checks list **and** `repoState.rulesets`'
  `required_status_checks` rule parameters —
  independently of `config.requiredChecks` — so that `apply.mjs` has an
  actual live-checks value to guard on under `protectionOwner: "external"`,
  whether that repo's checks are enforced via classic branch protection, a
  ruleset, or both (see the empty-checks refusal in Error Handling, below,
  and the ruleset-union discussion under `protectionOwner` in Config schema,
  above). Without this field, `apply.mjs`'s `Plan { creates, updates, noops,
  sourceStateHash }` input would carry no live-checks data at all — there
  would be no path for it to see what it's supposed to guard on when config
  is external; and without the ruleset half of the union specifically, a
  ruleset-only repo would false-positive the empty-checks refusal despite
  being correctly configured.
- `apply.mjs`: `applyPlan(plan, { dryRun, currentStateHash, force }):
  ApplyResult` — `{ applied, skipped, errors }`. When `dryRun: false`,
  `apply.mjs` requires `currentStateHash === plan.sourceStateHash` and
  refuses to run (no mutating calls made) if they differ — the TOCTOU guard
  from Data Flow, above. `force` is an optional list of specific
  `handEditDetected` plan-entry identifiers (e.g. `["dev-to-main-automerge"]`)
  the caller has explicitly confirmed should be overwritten despite the
  hand-edit conflict — never a global boolean, so a `--force` scoped to one
  file (the hand-edit override introduced under Architecture, Template
  rendering, above) can't accidentally blanket-override every other
  `handEditDetected` entry in the same plan. Omitted or empty, `apply.mjs`
  behaves exactly as described elsewhere in this design: any
  `handEditDetected` entry is skipped, not applied.

`SKILL.md` always calls these three in order, and always calls `apply.mjs`
with `dryRun: true` first to render the plan for user confirmation before the
real `dryRun: false` call. Immediately before that real call, `SKILL.md`
re-runs `detect.mjs` to get a fresh `currentStateHash` rather than reusing
the one from the dry-run pass.

## Invariants

**Checkable (by inspection):**
- `.github/shipflow.json` is tracked **in the target repo** (committed, not
  gitignored, and never nested inside `skills/shipflow/`) — see "config.json
  is committed" and the Architecture diagram fix above.
- `config.branches.main` and `config.branches.dev` always appear in
  `branchCleanup.protectedBranches` — the invariant is expressed against the
  *configured* branch names, not the literal strings `"dev"`/`"main"`, so it
  still holds for a target repo that names its branches differently. (An
  earlier draft hardcoded the literal strings, directly contradicting the
  schema's own configurable `branches: { main, dev }` and breaking the
  moment a repo used different names — this is the fix.)
- `apply.mjs` contains no unconditional (non-idempotent) mutating `gh api`
  call. **Known limitation:** this is a grep-by-inspection guarantee, not a
  proof — it catches an obviously bare mutating call but not one made
  unconditional through indirection (a helper function, a conditional that's
  always true in practice, etc.). Treat it as a lint-level smell check, not
  a substitute for the idempotency integration test below.
  **Which property is actually load-bearing:** idempotency (re-running
  `apply.mjs` is always safe because every step re-checks live state before
  mutating) is the *primary* safety net and holds across the whole
  multi-step apply. The `stateHash` TOCTOU guard (Data Flow, above) is a
  narrower, single-shot pre-flight check at the moment the real
  (`dryRun: false`) apply begins — it catches drift between plan-
  confirmation and apply-start, not drift *during* the apply itself. The two
  are complementary, not redundant: idempotency is what makes re-running
  safe after any failure or abort; `stateHash` is what makes the *first*
  invocation of a given apply refuse to run against a plan that's already
  stale before it starts.
- `release.mode: "auto"` is never enabled in `.github/shipflow.json` without
  `release.releaseCredential` set to a real non-`"GITHUB_TOKEN"` repo-secret
  name (`"RELEASE_PAT"` or an equivalently-named repo secret) — see Fatal
  #1. `"same-job"` is not a supported value (dropped, see Fatal #1).
- If `release.mode: "auto"` and the target repo structurally has
  `package.json` + `SKILL.md` + `plugin.json` all present in a package
  directory (the structural signal that gates the pre-flight — see
  Release-please manifest section, above; this is deliberately independent
  of whether the `lint_plugin.py`-style lint-detection heuristic also
  fired), `release.releasePlease.extraFiles` must have both
  `skillMdVersionField` and `pluginJsonVersionField` populated (not left at
  manifest defaults, which only cover `package.json`), **and** the dry-run
  byte-equality pre-flight check (Release-please manifest section, above)
  must have passed before the config was written.
- When `protectionOwner: "external"`, any divergence between the live
  required-checks set on branch protection and `config.requiredChecks` is
  surfaced to the user on every re-run, not silently ignored (Config
  schema, `protectionOwner`, above).
- **The `release-pending` label exists in the target repo whenever the
  `dev-to-main-automerge` template is installed — in every `release.mode`,
  not scoped to `"manual-gate"`** — checkable via `gh label list` / `GET
  /repos/{owner}/{repo}/labels/release-pending`. `apply.mjs` provisions the
  label idempotently and unconditionally as part of scaffolding
  `dev-to-main-automerge` (Architecture, above), since that template's
  `pull_request: closed` labeling job is rendered identically regardless of
  mode; its absence means either `apply.mjs` hasn't run yet for this repo or
  the label was deleted out-of-band, and either way the labeling job would
  fail on its next `dev → main` merge until `apply.mjs` re-provisions it —
  under `"manual-gate"` that also breaks the ask-flow's durable marker,
  while under `"auto"` the failure is confined to the (otherwise inert)
  labeling job itself.
- Rendered workflow templates under `.github/workflows/` never diverge
  silently from a hand-edit: `apply.mjs` only overwrites a shipflow-managed
  template when the on-disk content-hash matches the last recorded
  shipflow-rendered hash for that template/config pair; any other on-disk
  hash is surfaced as a `handEditDetected` conflict in the plan and blocked
  from a normal apply until an explicit `--force` (Architecture, Template
  rendering, above).

**Testable (needs a run):**
- Running `apply.mjs` twice in a row on an unchanged repo produces zero
  mutating calls on the second run
- On a fresh sandbox repo where `release-pending` does not yet exist as a
  label, running `apply.mjs` to scaffold `dev-to-main-automerge` creates the
  label (checkable via `gh label list` immediately after) — in every
  `release.mode`, not only `"manual-gate"` (round 6 finding) — proving the
  creation path itself, distinct from the separately-tested no-op-on-rerun
  idempotency property directly above and the by-inspection checkable
  existence invariant (Invariants, Checkable, above)
- A merged feature branch is deleted; `dev` survives a `dev → main` merge
- `apply.mjs` refuses to enable auto-merge when `requiredChecks` is empty
  (Significant finding #2)
- Re-running `detect.mjs` immediately before a real `apply.mjs` call, after
  simulating a live-state change (e.g. manually editing branch protection
  between plan-confirmation and apply), causes `apply.mjs` to abort rather
  than apply the stale plan (the TOCTOU fix)
- In `release.mode: "manual-gate"` (this repo's computed default, per the
  detection rule above), a `dev → main` merge never auto-cuts a tag; and the
  "AGENT RULE: ASK" behavior only fires on a subsequent interactive
  shipflow invocation that first confirms the promotion PR shows `MERGED`
  and the target commit is present on `main` — a run against a promotion PR
  that is still open/pending (native auto-merge not yet landed) does not
  ask, per the fixed ask-timing above (Significant finding #4)
- The `pull_request: closed`-triggered job applies a `release-pending` label
  to a merged `dev → main` promotion PR; with two promotions merged back to
  back before any interactive shipflow run, a subsequent invocation
  enumerates and asks about **both** labeled PRs (not just the most recent),
  and each one's label is cleared only after its own ask is answered (round
  4, Significant finding #2)
- In `release.mode: "auto"` with a correctly configured `releaseCredential`
  (`RELEASE_PAT`), a conventional-commit `fix:` merged to `main` completes
  release-please's actual two-phase flow with no manual step: the `fix:`
  commit lands on `main` → release-please opens (or updates) a release PR →
  merging that release PR cuts exactly one new patch tag. (An earlier draft
  of this criterion described a single-step "commit → tag" flow, which
  misstates release-please's real two-phase commit-then-release-PR model —
  corrected here.) The credential-pinned test (Testing strategy, above)
  confirms which token authored the triggering push at each phase, and a
  matching negative-case run with the default `GITHUB_TOKEN` confirms no
  release PR is ever opened.

## Out of scope for v1 (YAGNI)

- Enforcing Conventional Commits format (e.g. commitlint) — `release-please`
  silently produces no release if nothing matches; acceptable v1 behavior,
  revisit only if repos hit a confusing "why didn't it release" moment.
- Feature-branch-level protection or naming enforcement — documented
  convention only, not machine-enforced.
- Hotfix/release branches — explicitly out of scope; this is `dev`/`main`
  only, not full Git Flow.

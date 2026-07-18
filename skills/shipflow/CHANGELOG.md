# Changelog

All notable changes to `@natjswenson/shipflow` are documented here.

## Unreleased — multi-pattern workflow templates

Generalizes shipflow from one hardcoded branching pattern to a registry of three
selectable patterns, with deterministic autodetection. Backward compatible: a repo's
existing `.github/shipflow.json` with no `workflowPattern` field keeps resolving to
`dev-main-promotion` with identical behavior — confirmed against this repo's own live
config (a `noops`-only plan, byte-identical to before this change).

- **Added: `github-flow` pattern** — a single long-lived `main`; every PR merges (and
  auto-merges) directly to it, no separate promotion branch. New
  `main-automerge.yml.tmpl` template.
- **Added: `gitflow` pattern** — `develop` + `main` + transient `release/*`/`hotfix/*`
  branches, for software maintaining multiple released versions concurrently. New
  `release-automerge.yml.tmpl`/`hotfix-automerge.yml.tmpl` templates (prefix-matched
  `head.ref` guards) and `hotfix-merge-back.yml.tmpl`/`release-merge-back.yml.tmpl`
  (GitFlow's defining dual-merge-back semantic: a hotfix/release merges into both
  `main` and `develop`; a merge-back conflict or push failure opens a PR for manual
  resolution instead of force-pushing or silently dropping the merge).
- **Added: deterministic autodetection.** `shipflow detect` now returns a
  `rankedPatterns` array (every pattern's score + evidence). Classification is
  `confident` (top score `>= 0.7` and a `> 0.3` gap over second place), `greenfield`
  (top score `< 0.4`), or `ambiguous` (the residual case) — the first-run interview
  confirms a confident detection's evidence with the user rather than silently
  applying it, and presents all 3 patterns for an explicit choice otherwise.
- **Added: `workflowPattern` + `patternConfig` config fields.** `patternConfig.gitflow`
  holds `releaseBranchPrefix`/`hotfixBranchPrefix` (default `release/`/`hotfix/`).
  `branches.dev` remains the sole source of truth for gitflow's develop-branch name —
  no separate `developBranch` field.
- **Architecture:** new `lib/pattern-registry.mjs` (`listPatterns`/`resolvePattern`/
  `scoreAll`) and one `lib/patterns/<id>/index.mjs` module per pattern. `detect.mjs`,
  `plan.mjs`, and `apply.mjs` are now thin dispatchers over whatever the registry
  returns, instead of hardcoding `dev-main-promotion`'s logic inline — adding a 4th
  pattern in the future needs no changes to any of the three.
- Existing single-pattern behavior (branch protection, auto-merge, branch cleanup,
  release tagging) is unchanged for repos already on `dev-main-promotion`.

## 0.2.6 (2026-07-15) — pin `@latest` on every invocation; docs pass

Self-discovered during the PAT-wiring dogfood step that immediately followed
0.2.5's release — not a Siege audit finding, but adjacent to the same
class of risk the audit was meant to close.

- **Fixed: silent global-install shadowing.** `npx -y @natjswenson/shipflow
  <command>` (no version/tag) can resolve an already-installed copy on
  `PATH` — e.g. a stale `npm install -g @natjswenson/shipflow` left over
  from manual testing — instead of fetching the current version from the
  registry, with **no warning that this happened**. Confirmed concretely on
  `claude-skills` itself: a bare invocation silently ran a stale global
  0.2.0 install, missing every fix through 0.2.5, including the Critical
  template-injection fix (0.2.3). `npx -y @natjswenson/shipflow@latest
  <command>` correctly resolved 0.2.5. This meant a repo could run
  `shipflow` believing it was getting current, audited behavior while
  silently getting pre-audit, vulnerable behavior instead.
- **Fix: every invocation in `SKILL.md` now pins `@latest`.** New
  regression tests (`tests/skill_contract.test.mjs`) assert every `npx`
  invocation of shipflow in `SKILL.md` is pinned, and fail if a future edit
  reintroduces a bare invocation. New skill-invariant entry
  (`npx-must-pin-latest`).
- **Docs pass**, per user request before this release: root `README.md`
  gained a `shipflow` row in the skills table, marketplace/manual-install
  instructions, and a rewritten Branch & release flow section describing
  the actual shipflow-managed automation this repo runs (replacing stale
  prose describing the pre-dogfood bespoke flow); `skills/shipflow/README.md`
  gained current usage instructions (with the `@latest` pin and its
  rationale), an updated Status section reflecting 0.2.5's live validation
  and completed security audit, and a pointer to remove a shadowing global
  install if one exists (`npm uninstall -g @natjswenson/shipflow`).
- No code changes to `lib/`/`bin/` in this release — SKILL.md, tests,
  README, and version metadata only.

## 0.2.5 (2026-07-15) — mandatory TOCTOU guard, forced-override auditability, subprocess timeouts, YAML-validity CI check

The four remaining findings from the same Siege audit as 0.2.3/0.2.4, all
presented to the user for a fix-vs-accept decision and fixed on explicit
go-ahead.

- **High, fixed (SIEGE-2026-07-15-002):** `--force allow-no-checks` /
  `--force <template-id>` had zero code-level friction beyond the flag
  itself — "get explicit user confirmation before forcing" lived entirely in
  SKILL.md prose, not in the CLI. `apply` now refuses any `--force` unless
  accompanied by `--force-reason "<text>"`; the reason is echoed back on
  each forced entry in the apply result (`{ forced: true, forceReason }`)
  for auditability. This doesn't stop a determined bypass, but it raises
  the bar from a single flag to an explicit, logged justification.
- **Medium, fixed (SIEGE-2026-07-15-003):** `--expect-state-hash` (the
  documented TOCTOU guard) was optional — omitting it silently proceeded
  with zero drift protection. A real (non-dry-run) `apply` now hard-refuses
  without it, unless the caller explicitly passes the new, named
  `--skip-hash-check` escape hatch.
- **Medium, fixed (SIEGE-2026-07-15-004):** no subprocess timeout was set
  anywhere in `gh.mjs`'s `spawnSync` calls — a hung/rate-limited `gh api` or
  stuck `git` call could hang the whole process indefinitely. All
  `spawnArgs` calls now default to a 30s timeout, with the resulting
  `ETIMEDOUT` surfaced in the returned `stderr`.
- **Low, fixed (SIEGE-2026-07-15-005):** no test rendered the template and
  validated the output as syntactically valid YAML — the exact bug class
  that bit 0.2.1/0.2.2 (a silently-broken generated workflow) was caught
  only by live production testing, not the unit suite. New
  `tests/template-validity.test.mjs` parses the rendered workflow with the
  `yaml` package (dev-only dependency, not shipped to consumers) across a
  range of legal inputs.
- New CLI integration test file (`tests/cli-apply-guards.test.mjs`) spawns
  the real `bin/shipflow.js` to exercise both new refusals end-to-end.
- This closes out the Siege security audit run before rolling shipflow out
  to repos beyond `claude-skills` — zero Critical/High findings remain open.

## 0.2.4 (2026-07-15) — REST-path encoding, resolveOwnerRepo hardening, file-size cap

Three more findings from the same Siege audit as 0.2.3, surfaced by an
independently-dispatched Boundary Attacker pass that (eventually) returned
its report and cross-confirmed the 0.2.3 fix while adding new findings:

- **Medium, fixed:** `fetchBranchProtection` and `checkSecretPresent`
  interpolated `branch`/`secretName` unencoded into `gh api` REST path
  segments — inconsistent with `checkLabelExists`, which already used
  `encodeURIComponent` for the same class of input. Both now encode.
- **Low, fixed:** `resolveOwnerRepo`'s regex capture (`[\w.-]+`) admitted
  all-dots segments (`.`, `..`) since `.` is in the character class with no
  further constraint — a crafted remote like `github.com/../claude-skills`
  could yield an `ownerRepo` that normalizes away the intended
  `repos/<owner>/<repo>` prefix once interpolated downstream. Now rejects
  any owner/repo segment matching `^\.+$`.
- **Medium, fixed:** no file shipflow reads from a target repo
  (`.github/shipflow.json`, candidate settings-as-code artifacts, workflow
  YAML, the rendered template) had a size guard — all of these are
  repo-write-controlled, not admin-only, so a maliciously huge or
  pathologically nested file could exhaust memory on an unbounded
  `readFileSync`/`JSON.parse`. New `readFileCapped` helper in `gh.mjs`
  (1 MB cap) used at every such read site.
- 8 new regression tests.

## 0.2.3 (2026-07-15) — Critical: unescaped template substitution allowed workflow injection

Found by a Siege security audit run before rolling shipflow out to other
repos, immediately after 0.2.1/0.2.2 landed the previous two fixes.

- **Critical, fixed:** `render.mjs`'s `renderTemplate` did pure string
  substitution with zero escaping. `config.branches.dev`/`main` and
  `config.release.releaseCredential` — all sourced from
  `.github/shipflow.json`, a file anyone with repo **write** access can
  edit, not just the admin who ran shipflow's setup — were substituted
  directly into single-quoted YAML string comparisons and a
  `${{ secrets.X }}` GitHub Actions expression with no validation.
  Concretely: a `branches.dev` value of `dev' || 'x'=='x` rendered the
  auto-merge job's `if:` condition to `... == 'dev' || 'x'=='x'` —
  unconditionally true, enabling auto-merge on **any** pull request into
  `main`, not just genuine `dev`-branch promotions. A `releaseCredential`
  value containing a newline could inject arbitrary new YAML keys/steps
  into the committed, then-executed workflow file. Both are a privilege
  escalation: a repo-write-level actor reaching an admin-scoped mutation
  through the credential the rendered workflow runs with.
- **Fix:** `renderTemplate` now validates each substituted value against a
  per-token safety rule before rendering — `DEV_BRANCH`/`MAIN_BRANCH` reject
  any single quote or newline; `RELEASE_CREDENTIAL_SECRET` must match
  GitHub's own secret-naming rule (`^[A-Za-z_][A-Za-z0-9_]*$`). A rejected
  value throws rather than silently rendering unsafe YAML.
- **Also fixed:** `bin/shipflow.js`'s `cmdPlan`/`cmdApply` never wrapped
  `computePlan` in a try/catch, so this (and the pre-existing "missing
  param") error would have crashed with a raw stack trace instead of the
  clean `{"error": ...}` JSON contract every other failure mode uses —
  breaking the "every command prints JSON to stdout" guarantee agents rely
  on to parse output.
- New regression tests assert the exploit renders are rejected, and that
  ordinary branch/secret names still render normally.

## 0.2.2 (2026-07-15) — `label-release-pending` never fires under `GITHUB_TOKEN`

Found by the same dogfood run as 0.2.1, one merge later — a second, more
serious bug than the missing `--repo`: the manual-gate release-ask flow's
whole premise (a durable label survives the async gap between auto-merge
enabling and completing) silently didn't work at all.

- **Root cause: GitHub's loop-prevention rule.** A PR auto-merged via `gh pr
  merge --auto` run under the default `secrets.GITHUB_TOKEN` completes
  (later, once checks pass) attributed to the `github-actions[bot]`
  identity. A `pull_request: closed` event from that bot-attributed merge
  does **not** trigger this or any other workflow's `on: pull_request`
  handlers. Confirmed empirically, not just from docs: an otherwise-identical
  promotion PR merged by a real, PAT-authenticated actor fired the
  closed-event trigger within 2 seconds; one completed by
  `GITHUB_TOKEN`-enabled auto-merge fired **no run at all**, even after
  100+ seconds of polling. This means `label-release-pending` never ran for
  any normally-auto-merged promotion — only for a promotion a human merged
  by hand — which is the opposite of the common case the feature exists for.
- **Fix: both `gh` calls now use `config.release.releaseCredential`** instead
  of a hardcoded `secrets.GITHUB_TOKEN`. Wired a new `RELEASE_CREDENTIAL_SECRET`
  template token through `render.mjs` and `plan.mjs`'s
  `computeTemplatePlanEntry` (previously `releaseCredential` was read by
  `detect.mjs` only to check whether a named secret *existed* — it was never
  actually substituted into the rendered workflow).
- **First-run setup (SKILL.md) now has an explicit step** requiring the user
  to create a real PAT/App-installation-token secret and record its name in
  `release.releaseCredential` — defaulting to `GITHUB_TOKEN` is called out as
  a silent-failure trap, not a safe default. `config.example.json`'s
  placeholder changed from `"GITHUB_TOKEN"` to `"SHIPFLOW_AUTOMERGE_PAT"` so
  copying the example doesn't propagate the trap.
- New regression test asserts both `GH_TOKEN` lines use the configured
  secret name and never fall back to a hardcoded `GITHUB_TOKEN`.

## 0.2.1 (2026-07-14) — rendered workflow was missing `--repo`

Found by dogfooding shipflow on its own home repo (`claude-skills`) — the
very first live promotion PR after switching over would have silently
broken auto-merge and release labeling.

- **Fix: both `gh` calls in the rendered `dev-to-main-automerge.yml` now pass
  `--repo "${{ github.repository }}"` explicitly.** Neither the `auto-merge`
  job's `gh pr merge` nor the `label-release-pending` job's `gh pr edit` had
  it, and the workflow has no `actions/checkout` step for `gh` to infer the
  repo from — every run failed with `fatal: not a git repository (or any of
  the parent directories): .git`. This masked itself in the first dogfood
  migration only because the hand-built workflow it was replacing (which did
  pass `--repo`) happened to still be present on `main` and fired on the same
  transitional PR.
- **New regression tests** (`tests/render.test.mjs`) read the actual
  `.tmpl` file's rendered output and assert `--repo` is present on both `gh`
  invocations — no prior test read the template's real command lines, only a
  synthetic placeholder string, so this shipped with zero coverage of the
  actual `gh` calls.

## 0.2.0 (2026-07-14) — first live-repo fixes

Fixes found by running shipflow end-to-end against a real repo
(`natejswenson/1.00s`) for the first time, beyond the read-only smoke test
against `claude-skills` itself:

- **First-run setup is now an explicit, unskippable interview.** SKILL.md's
  setup steps must present detected branch names, `requiredChecks`, and the
  resolved `protectionOwner` and wait for confirmation before writing
  `.github/shipflow.json` — even when the detected values already look
  correct. Previously nothing stopped an orchestrating agent from silently
  narrating findings and proceeding straight to the config write.
- **Default-branch mismatch detection.** `detect` now reports the repo's
  actual GitHub default branch (`repoSettings.defaultBranch`). First-run
  setup surfaces a mismatch against the assumed `main` name and asks the
  user to either map shipflow's `main` role onto the existing default branch
  name, or rename the repo's default branch via the new
  `rename-default-branch` command.
- **New `rename-default-branch` command**, wrapping GitHub's native
  branch-rename endpoint (which retargets the default-branch pointer and
  open PRs automatically when the renamed branch is the current default).
- **Honest classification of the tier-gated ruleset failure.** Creating the
  deletion-protection ruleset 403s on private repos without GitHub
  Pro/Team/Enterprise (rulesets are free for public repos only). This now
  surfaces as a `skipped` entry with a clear reason instead of an `errors`
  entry — it's an expected environment limitation, not a shipflow bug. No
  fallback to classic branch protection was added (declined — out of scope
  for this fix).
- **`requiredChecks` candidates are now filtered to actually PR-triggered
  jobs.** `detect`'s `workflows.jobNames` previously listed every job name
  from every workflow file regardless of its `on:` trigger — a
  `schedule`/`workflow_dispatch`-only job (like `1.00s`'s `weekly-archive.yml`)
  could be picked as a required check that would never run on a PR and
  would block every future merge forever. Now only jobs from
  `pull_request`/`pull_request_target`-triggered workflows are offered as
  candidates.
- **Agent-driven CI scaffolding when no PR check exists.** Rather than
  teaching shipflow's deterministic CLI about every language/build-tool
  ecosystem, first-run setup now has the orchestrating agent investigate the
  repo and draft a starter `pull_request`-triggered build+test workflow when
  the (now-accurate) required-checks candidate list is empty, with the same
  confirm-before-write discipline as every other step — never a silent
  overwrite, always shown to the user first.

## 0.1.0 (2026-07-14) — Phase A: manual-gate core

Initial release. Implements the fully-specified, reference-repo-validated slice
of the [shipflow design](../../docs/plans/2026-07-14-shipflow-skill-design.md):

- Long-lived `dev`/`main` branches with configurable names.
- `dev → main` promotion PRs that auto-merge once configured required checks pass.
- Automatic branch cleanup (`delete_branch_on_merge` + a deletion ruleset) for
  every branch except `dev`/`main` — zero custom mutation logic, a native
  GitHub setting.
- `protectionOwner` detection: defers to an existing settings-as-code
  mechanism (e.g. `repo-settings.sh`, Terraform) rather than installing a
  competing ruleset, with an explicit user prompt when protection exists
  with no artifact behind it.
- `release.mode: "manual-gate"` — the deliberate, ask-before-tagging release
  flow (a durable `release-pending` label survives the async gap between a
  promotion merging and the next interactive `shipflow` run).

`release.mode: "auto"` (release-please-driven automatic tagging) is accepted
in the config schema but **not yet implemented** — `apply.mjs` refuses to run
against an `"auto"` config with a clear "not yet implemented" error rather
than silently no-oping. Tracked as Phase B; needs a live GitHub sandbox to
build and verify the two-hop `RELEASE_PAT` credential wiring and the
release-please byte-equality pre-flight safely.

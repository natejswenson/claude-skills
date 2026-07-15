# Changelog

All notable changes to `@natjswenson/shipflow` are documented here.

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

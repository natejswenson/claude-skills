# Changelog

All notable changes to `@natjswenson/shipflow` are documented here.

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

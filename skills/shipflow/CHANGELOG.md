# Changelog

All notable changes to `@natjswenson/shipflow` are documented here.

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

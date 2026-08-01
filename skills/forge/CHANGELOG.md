# Changelog

All notable changes to the **forge** skill are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-01

### Added

- **First release.** Generates GitHub Actions workflows for whatever the repo
  needs, in one house shape, and proves the YAML before showing it.
- **The verification ladder** (`forge verify`), about one second end to end:
  rung 0 resolves every `uses:` against the real API and validates every `with:`
  key against the action's own `action.yml`; rung 1 is actionlint; rung 2 is
  zizmor. Each rung degrades rather than fails when its tool is absent.
- **Rung 0 exists because nothing else does it.** Measured against a
  deliberately broken workflow, actionlint caught six defect classes and missed
  exactly two — `actions/checkout@v99` and `actions/setup-nodejs@v4`, an action
  that does not exist. Both are signature failures of model-written YAML.
- **Staleness reporting.** A workflow pinning `actions/checkout@v5` passed
  actionlint *and* zizmor completely clean while two majors behind. `verify`
  reads the `# v5` trailing comment on a SHA pin, so the recommended pin format
  is not the one format staleness hides in.
- **`forge detect`** — the question budget. Ecosystem, package manager,
  lockfile, runtime, test and lint commands, monorepo shape, default branch,
  protection contexts and secret *names*, so the run asks two questions instead
  of ten.
- **The press masthead** (`forge header` / `forge check`) via press 0.8.0's
  `gha-header` emitter and `yaml` region syntax. The brand is generated, never
  copied; `check` re-derives it because `press check` walks a static registry and
  a generated workflow lives in a repo press has never heard of.
- **Not published to npm in 0.1.0.** forge depends on `@natjswenson/press` ^0.8.0
  and both release from the same promotion with no ordering guarantee, so a forge
  tarball could reach the registry before the press version it requires. The skill
  runs from the plugin checkout, so nothing is lost by waiting.
- **The masthead baseline pins the region BODY, not the whole block.** The block's
  start marker carries press's version, so freezing it made every press release fail
  forge's CI over a change that altered nothing forge emits — caught immediately, by
  press 0.8.1. Same distinction press's own propagate classification draws: a version
  bump is not a content change. Verified by running the suite against a synthetic
  press 9.9.9.
- `references/anatomy.md`, `recipes.md` and `security.md` — deliberately free of
  frozen version numbers, since published research puts the typical workflow 7+
  months behind and a hardcoded table rots from the day it ships.

# Dotfiles verification

Plan commit: `8aff24f` (independent review and spec). User approved the spec before
implementation. Work is isolated on `feature/dotfiles`; live dotfiles were read-only.

## Delivered behavior

Shared Claude Code/Codex plugin version 0.1.0, with a read-only Node inspector,
link verification and offline report command. Instructions cover editing sources,
adding packages, setup, selected link/unlink and per-file conflict preservation.
The package allowlist, source/target boundaries and protected-state rules generalize
the reference layout without copying personal configuration. Catalogs, CI/release
component, README, PRESS regions/golden and help index are wired.

## Observed local checks

- `npm test` in dotfiles: 15 passing tests, including frozen replay/trap, actual
  temporary filesystem states, traversal/collision rejection, source/parent
  symlinks, protected exclusions, custom-policy flags and corrupted snapshots.
  Reran via skillfactory verification after the final schema hardening.
- `node evals/lifecycle.mjs`: passed with real GNU Stow. Temporary home only;
  inspect/edit/add-package/simulate/link/repeat/unlink/conflict backup/recovery,
  preserving unrelated files and local overrides.
- Real read-only `inspect` of the reference checkout/home: 14 correct links across
  7 packages. Only relative package/path/state metadata retained. The replay uses
  inert file bodies and a nested temporary checkout, then executes the actual
  inspect/verify/report CLI. Baseline/trap frozen through skillfactory.
- `npm ci --ignore-scripts --no-audit --no-fund --offline` and
  `npm run audit -- --offline`: passed; no dependencies, zero vulnerabilities.
- `score_skill.py ... --min 100`: 100/100. `lint_plugin.py`, `lint_baseline.py`,
  `sync_codex.py --check`, `check_compatibility.py`: passed.
- `python3 -m unittest discover -s tools/tests -p test_sync_codex.py`: 8 passed.
- PRESS tests: 143 passed. Skillhelp tests: 18 passed. Release tests: 19 passed.
- `skillfactory verify --all --repo .`: all 25 skills pass house conformance.
  `verify --skill dotfiles`: **reached rung 3 of 3**.
- PRESS check for dotfiles README and ghfactory header check: passed.
- `actionlint .github/workflows/dotfiles.yml`: passed.
  `zizmor --offline .github/workflows/dotfiles.yml`: no findings under repository
  configuration (2 suppressed by that existing configuration).
- `git diff --check`: passed. Diff reviewed against acceptance criteria; no
  personal config bodies, credentials, absolute home paths or unrelated edits
  included. Public author/catalog branding remains the repository convention.

## Limits and delivery

Inspector output is not Stow policy simulation. The skill requires the agent to
reconcile global/local policies and exact selected files, then review an actual
simulation before mutation. The helper performs no writes and does not provide
atomic protection from concurrent application changes.

Catalog compatibility was checked for both hosts; interactive runs in both host
applications were not performed. No live dependency install, home change, release
or settings application occurred. `.github/repo-settings.sh` only declares the
new check; it has not been run, so the new required check is not activated.

Final delivery checks: refreshed origin/main remains `24a6ded`, so no base
integration was needed. ghfactory resolved all 5 workflow references, reported
all pins current, and passed actionlint/zizmor. The first sandboxed ref lookup
could not reach GitHub; the authorized network retry passed. Remote CI is not
awaited or represented as passing. The PR remains draft for review and a separate
authorized merge decision.

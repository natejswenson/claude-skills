# Config-driven workflows verification

Reviewed plan commit: `a380be1` on `feature/config-driven-workflows`.

## Result

Replaced 26 per-skill callers with shared matrix/reusable CI and a selected-skill
main-only release dispatch. Nine workflow files remain, down from 33 on the
main-based worktree. `.github/skills-config.yml` retains each recipe in strict
JSON-compatible YAML. Common skill/plugin lint is centralized; all old commands,
directories, runtimes, cache settings, limits, concurrency and release options
are checked against migration evidence extracted from main commit 3f18fc1.

Shipflow passes selected-skill workflow inputs in both dispatch paths, with
routing covered by its status hash. Legacy repositories retain input-free
dispatch. Skillfactory uses its bundled dependency-free config parser, adds
entries transactionally and retains legacy scaffolding when config is absent.
Malformed config or a dangling symlink cannot trigger legacy fallback. Press
propagation remains chained after successful press release. No live settings,
merge, ready-for-review, release or publication operation was performed.

## Local evidence

| Check | Observed result |
|---|---|
| `node --test tools/tests/*.test.mjs` | 18 passed; includes 8 new matrix/parity/security/coverage tests |
| `python -m pytest tools/tests -q` | 142 passed with Python 3.12 and pinned requirements-dev |
| Shipflow `npm test` | 225 passed; final routing sort checked with 32 focused tests |
| Skillfactory `npm test` | 81 passed, including transactional config and dangling symlink tests |
| Release `npm test` | 19 passed |
| Press via `SKILL=press node tools/skills-ci.mjs run` | Common lint, 143 tests and generated-region drift checks passed |
| Ghfactory `npm test` | 33 passed; historical fixtures unchanged |
| Skillhelp `npm test` | 18 passed after regenerating the skillfactory card |
| Shared runner for skillfactory/ghfactory/release | Actual lint, brand, install, test and audit commands passed |
| Shared runner for shipflow | Lint/brand/install/tests passed; sandbox blocked advisory DNS, standalone `npm run audit` passed with read-only network access |
| `skills-ci.mjs validate` / skillfactory verify --all | All 26 skills and required contexts covered; house conformance passed |
| check_compatibility.py / sync_codex.py --check | Claude/Codex compatibility and generated metadata drift checks passed |
| lint_baseline.py | All 26 declarations passed |
| ghfactory verify (new CI/release, tools, reusable release) | 17/17 action references resolved and current; actionlint clean; zizmor clean with one existing informational npm trusted-publishing advisory |
| ghfactory masthead check / git diff --check | Passed |

Environment recovery used a temporary Python 3.12 venv because the host had no
`python` alias or pytest. Initial sandbox DNS prevented action reference and
dependency verification; read-only network retries succeeded. No API fallback,
model invocation or live workflow dispatch was used.

## Review and limits

Independent plan and implementation review by `/root/workflow_plan_review`.
The reviewer identified ghfactory's old twelve-workflow floor: updated to nine,
retained the twenty-action floor and added required entrypoint/gate presence.
The reviewer found no further actionable correctness blockers and independently
passed twelve new CI/scaffold tests. Parent review added the dangling-symlink
trap, canonical input ordering, source/live-settings distinction and shared
release-policy change filters. Generated help data was inspected; no personal
data or unrelated checkout work is included.

No actual GitHub run or act execution was observed. Other skill recipes were
preserved through parity checks rather than all executed on this Mac. Observe
the full Linux CI and all original required check names on the draft PR before
any authorized merge. The draft PR is the delivery endpoint.

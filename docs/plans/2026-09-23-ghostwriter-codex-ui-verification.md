# Ghostwriter Codex session UI verification

## Scope and commits

The user selected a custom local-dev task, improving ghostwriter's UI in Codex,
then chose the whole flow: choices, progress and previews. The reviewed plan was
committed as `821d971` before implementation on `feature/ghostwriter-codex-ui`.
The starting base was cached `origin/main` at `0b475a5`.

The implementation adds one Codex session guide and routes the entrypoint and
image handoff through it. Native preference choices use current capabilities;
artifact decisions keep complete previews visible. Component approval is
distinct from final publication, with a single decision for complete text-only
posts. Draft-only, edits, cancellation and late replies retain explicit scope.
Claude's route and existing source, editorial, visual and publisher gates remain.

The neutral display instruction in `references/post-review.md` is synchronized
with ghostwriter-x's byte-identical shared copy. The first full test run caught
that required identity; both suites passed after the copy was updated. No X
publisher or host-specific behavior changed. Help cards were regenerated; no
version, release metadata, manifest, publisher implementation or live account
configuration changed.

## Local checks

Python checks used the checkout's existing ghostwriter virtual environment
(Python 3.14.5). Commands below are relative to the relevant skill directory
unless they start with a repository tooling path.

| Check | Result |
|---|---|
| Ghostwriter baseline before edits: `python -m pytest --cov=scripts --cov=evals --cov-report=term-missing --cov-fail-under=100` | 805 passed, 18 skipped; 100% coverage |
| Ghostwriter after implementation: same full suite | 812 passed, 18 skipped; 100% coverage, 2,618 statements |
| Ghostwriter X: same full coverage invocation | 658 passed, 13 skipped; 100% coverage, 1,723 statements |
| After final menu-wording fixes: `python -m pytest -q tests/test_skill_contract.py --no-cov` | 59 passed |
| `shellcheck scripts/release_radar.sh scripts/install_radar.sh` | Passed |
| `python3 tools/score_skill.py skills/ghostwriter/skills/ghostwriter --min 100` | Passed |
| `python3 tools/lint_plugin.py skills/ghostwriter` | Passed |
| `python3 tools/check_compatibility.py` | Passed for Claude and Codex |
| `python3 tools/sync_codex.py --check` | No generated manifest drift |
| `python3 tools/lint_baseline.py` | Passed for 23 skills |
| `node skills/press/skills/press/bin/press.js check --repo . --target ghostwriter-card` | Passed |
| Skillhelp `npm test` | 18 passed |
| Skillhelp `build --repo .`, then `check --repo .` | All 23 cards current |
| `node skills/skillfactory/skills/skillfactory/scripts/skillfactory.js verify --skill ghostwriter --repo . --wiring-only` | House checks passed, including README structure |
| `git diff --check` | Passed |

The full skillfactory wrapper selected the system Python, which lacks pytest.
Its test stage did not run; the direct full suites above used the existing
virtual environment successfully. Existing advisory findings about quoted
description triggers and the missing optional split declaration are unchanged.
Skipped tests remain skipped; coverage and pass counts do not claim those paths
ran. These are local results, not remote CI results.

## Independent review and forward scenarios

The plan reviewer identified four gaps before the plan commit: tool-purpose and
schema limits, advice before publication approval, redundant text-only approval,
and complete attachment details. All were incorporated. Its implementation
review found no authorization bypass or Claude regression; custom-topic scope
and the preparation-versus-publication section wording were clarified.

A separate agent simulated eight supplied scenarios without live account access:

| Scenario | Observed routing |
|---|---|
| Native selector with a three-option limit | Three lanes; no invented preview field or research before selection |
| Saved board, more/fewer and own topic | Two Ready ideas plus More; all stable IDs/statuses in the expanded table; no repeated research |
| Direct topic, draft-only, text-only, no selector | Complete supplied 62-word draft and Edit / Save draft; no publication action |
| Exact current text-only publication authority | One proposed publisher action, no redundant approval |
| Approve card | Media selection only; preparation then full text, image and alt-text final decision |
| Seven-slide carousel with only its cover visible | Cannot reach approval; retain draft or explicitly drop the attachment |
| Exit followed by a delayed lane response | Pending choice invalidated; no restarted run |
| Old approval after a new revision | Resolve the referenced revision; no transfer of approval |

The simulation exposed two wording ambiguities. The lane interrogative now stays
verbatim at the start of a native question whose title can include explanations.
Custom-topic guidance belongs inside a native question or beneath an inline
table. The final contract tests passed after both changes.

Case 5 omitted timing/engagement context, so preparation was valid before its
final preview. Case 8 omitted whether old approval was component or publication
approval, so resolving the version was valid. These are fixture limits, not
observations of a live publisher. Simulated question examples were checked for
the native tool's enclosing `questions` array as well as item fields.

The user answered three native selectors during local-dev intake. The eight
ghostwriter scenarios were simulations: they establish routing and message
structure, not actual host rendering, viewer behavior, pixel visibility or live
publication. No private voice data, credentials or posts were read, no image was
generated, and no LinkedIn post was published. The existing source-backed
baseline fixtures were retained without relabeling these simulations as a real
publishing run.

## Delivery boundary

All investigation, planning, review, implementation and validation were local.
GitHub is used only in the final delivery phase for base refresh, one matching-PR
lookup, branch push and draft PR creation. The plan and implementation are
separate commits. Delivery targets `main`; merge, readiness and release remain
outside this task.

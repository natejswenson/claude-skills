# Issueflow #366 live retry evaluation — 2026-09-13

The subsequent authorized work is recorded in the [continuation report](2026-09-13-issueflow-366-continuation.md). The results below preserve the earlier stopping point.

The retry reached [draft PR #373](https://github.com/natejswenson/claude-skills/pull/373) against `main`, with implementation, an independently confirmed defect, a pushed repair, and nine passing controller verification obligations. **It has not completed the requested reviewed-PR endpoint.** The retained two-round review allowance is exhausted, and the repair still needs independent re-review.

This case is [claude-skills #366](https://github.com/natejswenson/claude-skills/issues/366). The earlier live tests used `fuzzy-boom-snicker`; this retry used the repository owning the saved #366 run. The user explicitly selected `main` over the saved `dev` base. The [earlier live evaluation](2026-09-12-issueflow-completion-live-evaluation.md) remains a separate campaign.

| Measure | Observed result |
|---|---|
| Prior saved state | Two blocked plan reviews; implementation pending; no PR |
| Retry plan | Round three passed independent review; earlier findings retained and resolved |
| Final pushed head | `24f4886402665928b3d2edc4fb39b111cb7d9cc0` |
| Frozen base | `main` at `900b735fe46a23a5575adfebd95abea6e9a49674` |
| Controller verification | 9/9 obligations passed on the final pushed head |
| Gmailtriage suite | 130 passed; 0 failed; baseline on the selected base was 122 |
| Skillhelp suite | 18 passed |
| Issueflow development suite | 549 passed; 0 failed |
| Hosted CI at final head | 29 success, 23 skipped, 1 failure: `auto-merge` |
| Native retry workers | 11 dispatched: 8 completed, 3 cancelled |
| Formal transcript eval | 0 machine findings, 0 judgment findings; **coverage gap 103/105 clauses** |
| Completion | Pending; PR open and draft; one major awaiting re-review |

The original candidate did not handle this case without intervention. Six controller repair groups were implemented during the retry, with frozen versions and failing regression evidence retained. This establishes recovery progress and specific fixes, not an unattended completion success or a speed benchmark.

The controller repairs are available in the local Issueflow source and the [campaign patch](/private/tmp/issueflow-366-live-20260913/evals/retry-controller-repairs.patch). They have not been released. PR #373 contains the Gmailtriage implementation and its generated documentation updates.

| ID / area | Observed problem and implemented fix | Verification evidence |
|---|---|---|
| M1 — UX, resilience | A legacy run could not express the user's current-base choice during migration. Added explicit, attributed base selection before implementation; implemented or published lanes refuse this path. | `evolution.test.mjs`; original candidate failed the new migration regressions |
| M2 — accuracy, resilience | Dirty local policy still said `dev`, contradicting committed `main` policy. Explicit migration now reads policy from the selected committed base and records its source, preserving the dirty working file. | Dirty-policy regression failed before repair and passed afterward |
| M3 — accuracy, resilience | Legacy blocked plan findings did not populate the new stable findings ledger. Migration now imports the latest blocked findings while retaining review history and counts. | Migration regression; native round three resolved both retained blockers |
| M4 — UX, speed | A migration with no approved contract nevertheless told the planner to retain a rejected allowlist. Required generated Skillhelp outputs then blocked preflight. Fresh migration now derives scope from the frozen issue and preflight; actual amendments retain approved-scope restrictions. | Frozen-v2 brief regression failed; repaired renderer passed; native repaired plan passed preflight |
| M5 — UX, resilience | A delivered plan failing preflight stopped without automatically returning to its author. The controller now uses the existing bounded send-back path before spending an independent review round. | Validated preflight regression failed on the old handler and passed after repair |
| M6 — speed, accuracy | PR review refreshed the head but used stale cached `origin/main`, including already-landed work. Review now fetches and verifies both PR head and target, binds the comparison to the observed target SHA, and records that SHA. | Stale-target fault test failed before repair and passed afterward; corrected native packet matched the actual PR |

M6 had a measurable operational cost. The bad packet contained 4,187 changed lines and requested five finders at `xhigh`; three workers had started when the mismatch was observed. They were interrupted and recorded as cancelled. The corrected packet contained 502 changed lines and requested two finders at `medium`. The cancelled round remained in history and consumed its allowance. No review from that packet was posted.

The exact mismatch is anchored in raw transcript event `e1058`, root line 3535: the local target was `89508f7d340d64bfe03636fe2f5e09569e978621`, while GitHub reported the PR target as `900b735fe46a23a5575adfebd95abea6e9a49674`. Event `e1012`, root line 3500, contains the earlier controller dispatch. Source hashes and capture paths are in the [machine-readable report](2026-09-13-issueflow-366-live-evaluation.json).

All six repair groups passed the final [549-test suite](/private/tmp/issueflow-366-live-20260913/evals/issueflow-suite-v6.log). Compatibility, generated Codex metadata checks, and the 21-card Skillhelp index check also passed. The permanent regressions live in [evolution.test.mjs](../../skills/issueflow/skills/issueflow/scripts/tests/evolution.test.mjs) and [harness-lifecycle.test.mjs](../../skills/issueflow/skills/issueflow/scripts/tests/harness-lifecycle.test.mjs). Earlier malformed test fixtures and wrong-directory invocations are retained in the campaign as operator errors; they are not counted as product failures or valid red evidence.

The independent review of the correct PR found **`f-a32800bf`: “CLI normalization drops existing category evidence.”** Raw normalization discarded an existing category and ambiguity marker before the new resolver combined search evidence. A conflicted input could consequently become `promotions` with a true unsubscribe proxy and authorize a trash match. A separate verifier reproduced and confirmed the major. The [posted review](https://github.com/natejswenson/claude-skills/pull/373#pullrequestreview-5191014833) records the finding.

The fixer pushed [commit `24f4886`](https://github.com/natejswenson/claude-skills/commit/24f4886402665928b3d2edc4fb39b111cb7d9cc0), preserving bounded explicit category and ambiguity evidence and adding a regression. The controller then ran the approved verification contract again. Batch `d8dc0930-8a54-462e-8cba-5a5df1847905` passed all nine checks on that commit, including meaningful red-before-green category regressions, the 130-test suite, compatibility, metadata drift, skill scoring, plugin lint, generated documentation, and Skillhelp tests. These receipts verify the checks they ran; they do not resolve the independent review finding.

The hosted failure is explained by the [final auto-merge job](https://github.com/natejswenson/claude-skills/actions/runs/34762935737/job/103738812448): repository automation attempted to enable auto-merge on the draft PR, and GitHub refused it. The final log reports `Pull request is a draft (enablePullRequestAutoMerge)`. The 23 skipped jobs are 21 release jobs, `label-release-pending`, and `propagate`. The authorized endpoint retains draft status and excludes readiness, merge, deployment, and issue closure.

The completion CI gate has **not yet been reached**, because review exhaustion stops first. Code inspection shows a further policy complication: the approved contract declares two required checks but no optional skipped checks, while completion currently evaluates all observed check outcomes. Expected skips and the draft-related automation failure therefore need explicit reconciliation. Making the PR ready would violate the retained endpoint exclusions. Editing unrelated workflows inside this Gmailtriage contract would exceed its approved scope.

The formal eval used raw Codex transcripts, not session summaries: 12 sources, 581 scoped events (13 user, 51 assistant, 259 tool calls, 258 tool results). Normalization dropped 3,124 bookkeeping records and 499 thinking records across the full bundle, with zero unparsed records. Root events before the #366 test request at raw line 2710 were excluded; all eleven explicit retry children were included. Guardian and unrelated sessions were excluded. This capture ends before this report was written.

| Contract source | Clauses |
|---|---:|
| Repository rules | 5 |
| Skill invariants | 18 |
| Loaded references | 81 |
| SKILL.md extraction | 1 |
| Total | 105 |

The [mechanical report](/private/tmp/issueflow-366-live-20260913/evals/final-report/report.md) has **zero findings and a coverage gap of 103 clauses**. Only two clauses were mechanically examined. Several extracted reference clauses are sentence fragments, and only one SKILL.md rule was directly extracted; this rubric is too thin to certify whole-run behavior. The six reproduced engineering defects above are not padded into formal skill-contract violation counts using loosely related clauses.

The probe also left four test claims undecided because wrapper/delegation correlation was incomplete. Raw receipt checks found the corresponding observed results: `e824` → `e763` (122 baseline tests), `e1155` → `e1148` (549 controller tests), and `e1231` / `e1241` → `e1230` (130 fixer tests). The later controller batch independently confirmed the final tests. These manual checks do not expand the mechanical coverage count. Native Claude execution, review convergence on the repair, readiness, merge, deployment, closure, total token usage, and dollar cost remain unverified or unavailable.

The planner brief decreased from 758,226 bytes in the retained run to 305,190 bytes in this retry, a 59.7% reduction. Irrelevant fixture-directory instructions remain in the retry brief. Different bases, worktree states, baseline test counts, retained review history, and controller edits during the experiment prevent attributing any latency improvement to the new version. Cumulative telemetry also mixes retained lifecycle records with this retry; the worker counts above come from the explicit native receipts.

The remaining implementation and verification plan is concrete:

1. Obtain authorization for **one additional independent PR review round** on `24f4886`, specifically to verify `f-a32800bf` and inspect the repair for regressions. Preserve the existing run, finding ID, history, and cap accounting. Do not substitute controller tests for this review.
2. Before declaring the reviewed-PR endpoint, reconcile CI using repository evidence and an independently reviewed contract amendment where necessary. Explicitly classify expected skipped jobs. Keep the failed auto-merge job visible and handle its draft eligibility in a separately scoped workflow change if required. Neither an amendment nor a cancelled round resets review or time limits.
3. Reduce irrelevant nested instructions in planner context. Resolve instruction applicability by path and load additional scoped guidance when the selected implementation paths require it. Verify both relevant-guidance inclusion and unrelated-fixture exclusion, then measure a native run with a fixed base and task.
4. Improve eval extraction and wrapped-process correlation so complete rules and the four observed test receipts above can be graded automatically. Retain raw anchors and explicit unknown states; do not turn the present coverage gap into an assumed pass.
5. Repeat a clean native run with a single frozen controller version, unchanged base, and recorded endpoint. Add a native Claude trial before claiming equivalent runtime quality across both hosts.

The [saved checkpoint](https://github.com/natejswenson/claude-skills/issues/366#issuecomment-5650446897), original run generation, and 14,400-second cumulative cap were preserved. The [exhaustion output](/private/tmp/issueflow-366-live-20260913/logs/20260913T143314-680019Z-next-4b14a16c.stdout) and [final verification output](/private/tmp/issueflow-366-live-20260913/logs/20260913T143406-220179Z-verify-run-77d6a49e.stdout) establish the stopping point. The [campaign](/private/tmp/issueflow-366-live-20260913) contains frozen controller versions, raw transcripts, reproduction logs, and 134 final state/artifact captures with hashes. Temporary evidence paths require preservation before system cleanup; the report JSON and permanent regression tests are in this repository.

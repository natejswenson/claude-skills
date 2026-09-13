# Issueflow #366 continuation — 2026-09-13

Later result: [round four converged; completion stopped at CI policy](2026-09-13-issueflow-366-round4.md).
The report below preserves the earlier round-three checkpoint.

The user authorized continuation after the previous review stop and requested that
every lesson be incorporated into Issueflow. The additional independent review
ran, exposed a remaining duplicate-source merge path, and led to a pushed repair
at [`55d403d7121c836f309799622ba7220deb0a9cc1`](https://github.com/natejswenson/claude-skills/commit/55d403d7121c836f309799622ba7220deb0a9cc1).
All nine controller verification obligations passed on that head, including
131 Gmailtriage tests and 18 Skillhelp tests. [PR #373](https://github.com/natejswenson/claude-skills/pull/373)
remains open and draft against `main`.

**The issue is not through the reviewed-PR endpoint.** Finding `f-a32800bf` remains
open pending independent verification of the second repair. The controller reports
three rounds used, a base allowance of two, and one user-authorized extension.
That extension is spent. No finding was ruled fixed by the orchestrator, and no
additional review round or endpoint authority was invented.

| Work completed in this continuation | Evidence |
|---|---|
| Independent finder and verifier reviewed `24f4886` | [Round-three review](https://github.com/natejswenson/claude-skills/pull/373#pullrequestreview-5191290160) |
| Duplicate-source category evidence was repaired | Commit `55d403d`; CLI regression fails before repair and passes in both source orders |
| Controller independently verified the pushed repair | Batch `4e6acf72-dd7a-44da-bbc8-95d5d4ea0551`; 9/9 obligations |
| Issueflow source and permanent regressions updated | **555/555 tests pass**, zero failures |
| Both host packages validated | Compatibility, Codex metadata drift, plugin lint, skill score 100, baseline declarations, and generated Skillhelp index passed |
| Hosted checks at `55d403d` | 29 success, 23 skipped, 1 failed `auto-merge` job |
| Actual native workers this continuation | 4 dispatched: 3 completed, 1 interrupted/cancelled; the interrupted fixer did not produce accepted work |
| Combined retry transcript eval | 16 raw sources, 805 scoped events; 0 machine findings, 0 judgment findings, **coverage gap 103/105 clauses** |

The crucial new controller defect was a stale evidence handoff. The verifier
reported that the direct normalization example was fixed but that
`mergeThreadSources` still discarded later category/conflict evidence. Issueflow
stored that current explanation in finding history, updated the line number,
and then rendered only the original reproduction and quote into the fixer's brief.
The first fixer consequently prepared to report the already-fixed example as
`not-changed`.

The controller's stale brief was observed against the exact registered verifier
output. The worker was interrupted, recorded cancelled, and its wave cancelled
through the supported CLI. The renderer was repaired and tested before the same
registered round was rebriefed. The replacement fixer received the current quote
and explanation, reproduced the actual merge-path defect, and pushed its fix.
The registered review, finding ID, original evidence, and round count stayed intact.

This is now a permanent Issueflow regression using the actual registered finding:
[fixer-handoff.json](../../skills/issueflow/skills/issueflow/evals/inputs/retry-366/fixer-handoff.json)
and [fixer-handoff.test.mjs](../../skills/issueflow/skills/issueflow/scripts/tests/fixer-handoff.test.mjs).
The test was observed failing against frozen controller v6 because the current
explanation was absent, and passing after repair. Its
[refresh command](../../skills/issueflow/skills/issueflow/evals/freeze-handoff.mjs)
projects registered artifacts without rewriting verifier prose.

The lessons were incorporated into the skill itself, beyond this report:

- [Run lessons](../../skills/issueflow/skills/issueflow/references/run-lessons.md)
  records the earlier six controller repairs, this handoff failure, applicable
  guidance, CI eligibility, full input-path proof, cap accounting, and eval limits.
  SKILL.md routes stalled-run and regression-maintenance work to this reference.
- [Stage briefs](../../skills/issueflow/skills/issueflow/scripts/lib/brief.mjs)
  start with root guidance and then use proposed/approved scope. Workers still
  load newly applicable nested instructions. Unrelated fixture and scratch rules
  no longer inflate every planning brief. Directory scopes retain descendants,
  with positive and negative cases for Claude and Codex in
  [guidance-scope.test.mjs](../../skills/issueflow/skills/issueflow/scripts/tests/guidance-scope.test.mjs).
- Planning and independent review now carry completion intent and explicitly
  inspect required CI and workflow eligibility for draft/ready endpoints before
  review capacity is spent. Optional conclusions need evidence and reviewed reasons.
- [Review instructions](../../skills/issueflow/skills/issueflow/references/review-method.md)
  explicitly trace evidence through normalization, duplicate-source merging,
  source order, and the final action decision. The repeated finding's current
  verifier explanation leads the fixer handoff; the original report is historical.
- Exhaustion output now separates actual rounds used, the base allowance, and
  authorized extensions. References use the persisted allowance instead of
  misleading hardcoded fourth-round language.
- Permanent baseline declarations include the new regressions; the frozen prompt
  baseline and generated Issueflow help index were refreshed. All pre-existing
  baseline cases remain present.

Validation first found the expected prompt golden drift and three older tests
that assumed every stage received every nested instruction even without known
scope. Those expectations were updated to preserve applicable guidance while
excluding unrelated scope, and the entire 555-test suite then passed. Initial
malformed test fixtures and a wrong-cwd test command remain recorded as operator
errors, not claimed regression proof.

The live continuation used frozen v6 for review, v7 for the repaired fixer handoff,
and v8 for the final exhaustion display. Final Issueflow source snapshot digest:
`d9e3ebec4fc02fc56f3c25c51f45493c148177d00fee2d97e13d6e0f1357b8fd`.
These are local development changes, not a release or proof of the starting
candidate completing unattended.

The final [auto-merge job](https://github.com/natejswenson/claude-skills/actions/runs/34767817424/job/103751843435)
again failed because GitHub refused enabling auto-merge on a draft PR. The
reviewed contract still needs reconciliation of expected skipped jobs and the
draft-related automation outcome before completion. The run has not reached the
completion CI gate because independent review is still pending. Readiness, merge,
deployment, and issue closure remain excluded; the local instruction changes do
not amend the live contract or weaken that gate.

The mechanical eval still examines only 2 of 105 extracted clauses. Its zero
findings leave a coverage gap of 103; they do not certify the run. Fragmented
contract extraction, wrapped/delegated command correlation, unknown aggregate
costs, native Claude execution, and matched performance measurement remain
explicit limitations inside the skill. The extra controller repairs and
interrupted worker are counted rather than hidden in a success verdict.

The [machine-readable continuation](2026-09-13-issueflow-366-continuation.json)
records hashes, worker identity, controller versions, verification receipts, CI,
and test evidence. Raw source snapshots for the earlier evaluation and this
continuation are separately preserved with matching recorded hashes. Temporary
campaign evidence remains at
[/private/tmp/issueflow-366-live-20260913](/private/tmp/issueflow-366-live-20260913);
the lessons, reproduction fixture, refresh script and regressions are in the
packaged skill source.

The next required decision is whether to authorize round four to independently
review `55d403d` and rule on `f-a32800bf`. After review convergence, the controller
must reconcile CI through the reviewed policy flow before reporting the endpoint.

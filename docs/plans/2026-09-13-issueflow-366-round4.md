# Issueflow #366 — fourth review and completion gate

Later result: [user-authorized merge and completed cleanup](2026-09-13-issueflow-366-merge.md).
This report preserves the earlier CI-stop evaluation.

The fourth independent review **converged with zero open majors** at
`55d403d7121c836f309799622ba7220deb0a9cc1`.
[PR #373](https://github.com/natejswenson/claude-skills/pull/373) remains open and
draft against `main`. The reviewed-draft endpoint is still pending because its
approved CI policy does not accommodate the observed automation outcomes.

This is the retained `natejswenson/claude-skills#366` run. Earlier completion
trials used `natejswenson/fuzzy-boom-snicker`; the issue retry stayed in its
owning repository and retained the user's explicit selection of `main`.

| Observed result | Evidence |
|---|---|
| No new candidates | One independent finder; targeted duplicate-source regression and 4,096 three-source combinations reported passing |
| Previous major `f-a32800bf` fixed | Independent verifier checked original normalization and both duplicate-source orders through CLI ingest-to-plan, including trash and label rules |
| Review registered and posted | [Round-four review](https://github.com/natejswenson/claude-skills/pull/373#pullrequestreview-5191354710) |
| Implementation verification | Nine unchanged, hash-verified passing obligations at the reviewed head; 131 Gmailtriage tests and 18 Skillhelp tests |
| Hosted required CI | All 21 remotely required check identities passed at the completion-gate observation |
| Issueflow source validation | 555/555 tests pass; Claude/Codex compatibility, metadata, plugin lint, score 100, baseline declarations and help index pass |
| Actual transcript eval | 924 scoped events across 18 raw sources; 0 mechanical findings, **103/105 clauses unexamined** |

Both round-four workers completed, and native completion was recorded before
registration. Across this retry, 17 native workers were dispatched: 13 completed
and four were cancelled. Prior rounds, the original time cap and two user-directed
code-review extensions remain recorded. No additional round was purchased, and
no readiness, merge, release or issue closure was performed.

The actual completion gate reported four blockers:

| Check | Outcome | Observed context |
|---|---|---|
| `release` | skipped | Skill releases require explicit workflow dispatch on main |
| `label-release-pending` | skipped | Requires a closed, merged PR |
| `propagate` | skipped | Depends on the skipped Press release job |
| `auto-merge` | failure | GitHub refused enabling auto-merge because the PR is draft |

The PR rollup has 29 successes, 23 skips and one failure. The controller selects
33 check identities: 29 successes, three skips and one failure. These are
different representations. The retained job log identifies the draft failure;
the reviewed commit's workflow has no draft eligibility guard. The failure is
real even though the job is not a required CI check.
[Failed job](https://github.com/natejswenson/claude-skills/actions/runs/34767817424/job/103751843435),
[workflow at the reviewed head](https://github.com/natejswenson/claude-skills/blob/55d403d7121c836f309799622ba7220deb0a9cc1/.github/workflows/main-automerge.yml),
[release and propagation conditions](https://github.com/natejswenson/claude-skills/blob/55d403d7121c836f309799622ba7220deb0a9cc1/.github/workflows/press.yml).

Two further lessons are now in Issueflow's source. Review briefs and registration
separate the actual round, base allowance and recorded extensions; they no longer
describe an authorized fourth round as “of at most two.” CI stops now suggest
`next`, preserving draft-only intent. A read-only replay of the actual run confirmed
the same blockers before and after that correction. The frozen updated controller
then produced the corrected stop in the live run.

These changes and the late CI-policy limitation are retained in
[run-lessons.md](../../skills/issueflow/skills/issueflow/references/run-lessons.md)
and the changelog. The source is local, uncommitted and unreleased. Round-four
agents ran frozen controller v8; the final handoff ran v9, whose digest is
`555fec1d10348922ad127bfe960315f029103f9efd32d3edaa0fd7a0a7992479`.
One presentation assertion still expected the old wording; after updating it,
the full 555-test suite passed. Operator command and capture errors remain listed
in the machine-readable report.

The transcript probe examines only two of 105 extracted clauses. Its zero
findings do not establish a passing evaluation of the whole run. Wrapper
correlation, fragmented clauses, complete usage/cost, native Claude behavior and
paired speed measurement remain unverified. Independent verdicts, GitHub read-back,
controller receipts and local test logs support the specific results above.

The [machine-readable report](2026-09-13-issueflow-366-round4.json) records raw
source hashes, event anchors, review/checkpoint URLs, controller versions, CI
snapshots and verification receipts. Earlier source archives remain unchanged.

## Prepared CI recovery decision

Limit recovery to reconciling this draft's CI policy. Preserve all 21 remote
requirements, both local required-check declarations, the nine local obligations,
the reviewed implementation and the ready/merge/deploy/close exclusions.

The proposed delta is to classify the three named `skipped` automation checks as
optional, with observed producer and workflow eligibility evidence, and
independently assess the exact draft-related `auto-merge` failure. One log does
not justify a blanket failure waiver. Any accepted exception must stay bound to
its evidenced context; unrelated and required-check failures must still block.
If the contract cannot express that boundary, retain the stop and prepare the
necessary controller change before applying the policy.

Published amendment currently refuses exhausted capacity and invalidates code
review, verification and CI freshness. It lacks an adequate late-recovery
reservation for this run. Correct that reservation under explicit user authority,
retaining every prior round and the original cumulative time cap. Do not edit
run state or increase the base cap. This limitation is documented, not claimed
fixed by the presentation changes.

The concrete additional allowance to request is **one independent amendment
review (plan round four) and one final code-review round (round five)**, with
fresh verification and CI observations required by the applied contract. That
permits reviewing a recovery; it does not approve exceptions or another fix loop.
Stop if the amendment review blocks or the final review does not converge.
Repository workflow changes need their own reviewed scope. The PR stays draft.

# Issueflow completion implementation results

Implementation of [the revised specification](2026-09-12-issueflow-completion-fixes-implementation.md), including its [red-team corrections](2026-09-12-issueflow-completion-plan-redteam.md).

The changes are local and unreleased. Issueflow metadata is 0.17.0; eval changes
have their own Unreleased entry. Existing unrelated workspace edits were preserved.

## Implemented behavior

| Package | Result |
| --- | --- |
| P01: initialization | Atomic run claims, durable controller identity, frozen issue inputs, restart under the same owner, checkpoint recovery, explicit revision-checked ownership transfer, and named infrastructure stops. |
| P02: repository state | One frozen planning/verification base, policy-conflict checks, parent-specific stacked bases, and cleanup through the correct source or bare Git store. |
| P03: preflight | Known generated-file closure and package/check discovery; schema-2 working directories, isolated build outputs and checked predecessor inputs; missing commands and invalid red-test setup cannot become proof. |
| P04: CI | Shared effective CI decisions with paginated policy/check observations, app identity, explicit optional-check exceptions, and head/base/retarget freshness. |
| P05: completion | Persisted endpoint, exclusions and scoped existing authority; merge/deployment/companion observations; uncertain-operation reconciliation; cleanup retained until dependent completion. Unsupported provider guarantees remain pending. |
| P06: progress | Shared status with completed, remaining and unknown evidence; separate CI, worker and human actors; semantic milestones and bounded heartbeat metadata. |
| P07: plan repair | Stable finding identities and history, complete blocker responses before another review, independent resolution and justified reopening, with cumulative limits retained. |
| P08: amendments | Proposed/reviewed/applied journal, whole-proposal review binding, disposable Git transitions, conditional publication and base updates, preserved PR/history, and conservative evidence invalidation. |
| P09: evaluation | Parent/child transcript correlation, structured process evidence before clipping, captured reference hashes, unknown-preserving measurements, individual alert adjudication, and a separate native pilot importer/procedure. |
| P10: compatibility | Schema-3/4 continuation and explicit migration to schema 5; shared Claude/Codex entrypoint, updated commands/references, generated metadata/help, and installed-tarball checks. |

Operational details and recovery commands are in
[completion.md](../../skills/issueflow/skills/issueflow/references/completion.md).

## Validation

The final test totals and source identities are recorded in the adjacent
[verification record](2026-09-12-issueflow-completion-verification.json).

The suite includes real Git worktrees and real verification processes. The
permanent completion replay supplies synthetic reviewer/provider responses while
exercising the actual CLI through published amendment, re-verification, readiness,
observed merge, lost deployment response, and cleanup. A draft-only control
preserves draft state. These are controller tests, not native-agent outcome runs.

Independent forward checks found and drove fixes for executable symlink discovery,
startup continuation, incomplete checkpoint handling, multiline Files parsing,
amendment checkpoint data, uncertain deployment reconciliation, and CLI retarget
routing. The final bounded pass also checked stale ownership revisions, legacy
migration, proposal tampering and dirty-work preservation. Its local evidence is
retained at `/private/tmp/report/issueflow-final-boundary-report.md`; the full
completion replay is now a permanent repository test.

The three startup regressions failed before the implementation and pass afterward.
The twelve existing foundation cases pass on both pinned release 0.16.0 and the
candidate. They establish retained foundation behavior; they do not establish a
new capability or a speed improvement. An initial comparison correctly refused
evaluator drift; rerunning the same pinned release with the final evaluator
produced a comparable pass. Original captures were retained.

The 20 provisional test-execution alerts were individually rechecked:
**6 have matching test observations; 14 remain cannot decide**. This does not
certify whole-issue completion or clear the independently observed stale-CI claim.
See the [adjudication record](2026-09-12-issueflow-alert-adjudication.md).

## Remaining validation and provider boundaries

- The native pilot has zero captured runs for either host. Its committed
  [report](2026-09-12-issueflow-native-pilot-report.json) explicitly says unverified.
  Native agent quality, conversational heartbeat compliance, live GitHub/provider
  behavior, and comparative speed remain unmeasured. The local suite does not
  substitute for the requested paired campaign or every live acceptance scenario.
- GitHub's built-in merge adapter lacks a server-enforced expected base/policy
  context. Automatic submission therefore stops with the reviewed PR intact;
  provider-observed matching merges can still reconcile. Ready-triggered merge
  likewise stays draft without a suitable conditional provider operation.
- Unsupported deployment providers and unverified companion outcomes remain
  explicit obligations. A primary PR cannot silently certify another repository.
- Progress requires the host to honor the bounded wait/heartbeat instructions.
  The CLI cannot send a message while the host never calls it. Unobserved timing,
  usage and cost remain unknown.
- Interrupted allocation/conflict paths are retained for inspection; dirty trees
  are never treated as successfully cleaned. Native stack/fault matrix expansion
  remains part of the separate campaign.

No release, external test issue, PR, merge or deployment was performed by this
implementation task.

## Subsequent native verification

The separately authorized [actual-run evaluation](2026-09-12-issueflow-completion-live-evaluation.md)
used three new issues in `fuzzy-boom-snicker`, including a published amendment.
All requested PR outcomes were reached with interventions and local repairs.
The scored evaluation records four findings with 100 of 109 clauses outside
scored coverage. Formatting-sensitive docs classification and an expired-window
terminal exit-status defect remain open; native comparative speed is unverified.

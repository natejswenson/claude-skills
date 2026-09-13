# Completion controller

State schema 5 adds recoverable initialization, one frozen base, contract schema 2,
published amendments, explicit endpoints, effective CI observations and status.
Claude and Codex use the same controller. The host adapter still owns native
worker identity, terminal observation, cancellation and writable storage.

## Startup and continuation

`start` validates the repository and supplied workspace before publishing a claim.
It atomically publishes complete `run.json` bytes, then freezes the issue input,
prepares execution and confirms the initial checkpoint before dispatch. Initial
checkpointing never pushes a pre-existing branch that this run has not created.
Planning uses a detached checkout of the fetched base SHA; shared-base lanes and
verification use that same SHA. A stacked lane freezes its approved parent's tip.

Use the same `ISSUEFLOW_SESSION_ID`, `CODEX_THREAD_ID`, `CLAUDE_SESSION_ID`, or
`--session-id` on later commands. When none exists, `start` prints a private
`--continuation-file` path: retain and pass it on every continuation. The token's
contents are not printed. An explicit token takes precedence over environment
session IDs. This is controller coordination, not OS isolation.

Retry interrupted `start` with the same identity and run directory. Completed
steps, issue bytes, source-checkout mode and allocated storage are retained.
`doctor` names missing prerequisites; `status --json` exposes revision-independent
observations. A failed checkpoint blocks dispatch commands. Infrastructure exit 3
means results are retained; a workspace path alone is not host permission.

For a lost owner, first observe all native writers terminal and reconcile remote
operations. `recover-owner --authority-source "<existing user decision>"
--workers-released --expected-revision <run revision>` archives the old owner and
transfers coordination. It does not terminate workers, grant permissions, or reset
budgets. Three incomplete allocation attempts stop with their paths retained.

## Preflight and verification

`preflight --plan <file>` validates package cwd, installed executable/dependency
availability, generated-file closure and observed scope before a review dispatch.
Repository adapters are explicit: `.issueflow/preflight.json` schema 1 declares
`generators: [{name, inputs: ["path"], outputs: ["path"]}]`. The bundled
claude-skills adapter recognizes help-index and Codex metadata outputs. Unknown
relationships remain unknown. The Files section must list every contract path in
backticks, including every generated output; do not replace it with prose.

Contract schema 2 extends each check with:

- `cwd`: repository-relative directory, default `.`; it must exist in the base.
- `mode: "read-only"`: checks may not mutate inputs.
- `mode: "isolated-build"`, `outputs: ["dist/"]`: execute in an isolated snapshot.
  Outputs cannot shadow pre-existing source, test or dependency inputs. Use a clean
  output directory; tracked generated files remain reviewed implementation edits.
- `inputsFrom: ["build-check-id"]`: consume hash-verified outputs from preceding
  isolated builds. Commands run sequentially in contract order.

Checks still require explicit argv, criterion IDs and behavioral red/green proof.
Cwd traversal, symlink escape, missing executables, import failure and mutated
assertions cannot become red proof. Dependencies are copied and fingerprinted;
missing setup is a prerequisite to resolve under existing task permissions.
Successful unchanged receipts are reused. A changed head, recipe, input, attempt,
contract or base invalidates them.

## Plan findings and published amendments

Plan blockers have stable `PF-...` IDs. Repairs include exactly one
`issueflow-repair` JSON array with an entry for every open high/critical fixable
finding: `{id, response, evidence, disposition: "addressed"|"unresolved"}`. The
independent reviewer returns `resolutions: [{id, status: "resolved"|"open",
evidence}]`. Omitting a blocker keeps it open. A reopened resolved finding requires
`reopeningReason`. Three blocked rounds plus one directed recovery remain the cap.
Confirming an already resolved ID retains its existing repair history. An open or
reopened blocker still requires its complete repair response before resolution.

Before PR creation, the existing `amend --reason ... --workers-released` reopens
planning. Published work uses `amend --plan <file> --reason ... --authority-source
"<existing task direction>" --workers-released`. Added criteria, generated files
and test recipes are reviewed before the live contract changes. `next` dispatches
an independent amendment reviewer; `amend-register` binds its delivery to the
proposal hash. After observing reviewer termination, `amend-apply
--workers-released` applies it. Prior PRs, findings, receipts and rounds remain
recorded. Every implementation receipt and code-review conclusion is invalidated
conservatively, including unchanged lanes. An unchanged amended head receives a
fresh review of the full diff. The base round allowances and cumulative time cap
stay fixed. Expired autonomous windows may renew within that existing cap at
proposal, dispatch or application; manual runs still require explicit `resume`.

If code-review capacity is exhausted, an existing user decision for exactly one
future round can be recorded with the proposal: add `--lane <slug> --another-round
"<the user's decision>"` to `amend --plan ...`. A single-lane run may omit `--lane`.
The hash-bound proposal and review brief carry that authority. `next` consumes the
recorded round after application without another extension flag; a consumed or
duplicate authorization grants no further round, even after convergence followed
by a CI fix. Retain the same decision when
retrying a rejected proposal, without passing the extension flag again. This does
not increase the independent plan-review allowance or authorize another lane.

After `amend-register` rejects an unregistered delivery, observe native workers
terminal and drain the queue with `next --workers-released` (a repeated gate
refusal retains the release). Then use `amend-review-brief --retry
--workers-released --reason "<why the output needs replacement>"`. If a worker
was cancelled without a complete delivery, use the existing explicit `cancel-wave`
recovery first. Record native terminal status with `worker-observe` when a native
worker identity was recorded. Retry archives the old output and attempt, retains
their original bytes and proposal identity, and prints fresh immutable paths.
It changes neither registered round counts nor the total time cap. It cannot
replace a registered review or clear a blocking finding. Register the new delivery
normally; malformed resolution entries are gate refusals too. Storage failures
retain their infrastructure recovery path. Never edit an existing completion
envelope or output to repair it.

`retarget` adds `--base <branch> --strategy target-only|merge|rebase` to that
proposal flow. Merge/rebase prepare disposable candidate worktrees; conflicts
retain the old branch. Rebase also needs `--rewrite-authority-source`. A stacked
child retains its parent branch as target and uses the reviewed parent candidate
SHA. Application journals conditional pushes and target changes; unknown remote
outcomes stop for reconciliation. Base changes advance the CI freshness epoch.

## CI and endpoint authority

Required CI comes from paginated active branch rules, classic protection and the
reviewed local contract. Names can include `appId`; ambiguous producers, missing
required jobs, failed policy reads, stale heads and unavailable evidence block.
Required checks remain required. A reviewed `optionalChecks` entry specifies
`name`, optional `appId`, `reason` and exact `acceptConclusions`, for example an
expected `skipped` release job. No-CI requires an explicit reviewed reason and a
successful lookup proving no remote requirement. Status, `next`, `ready` and
completion use the same decision. A retarget requires newly observed checks;
strict branches require identifiable merge-result context.

Persist intent at start with `--endpoint reviewed-pr|merged|deployed`, or
`--completion-intent <file>`. Later use `completion-intent --file <file>` based on
the user's actual direction. Default `reviewed-pr` reaches a reviewed ready PR and
immediately hands off the concrete merge decision. To keep draft, specify
`excluded: ["ready", "merge"]`. Exclusions override recorded authorization.
Companions use `{repo, pr, head}`; deployment obligations use
`{service, environment, adapter: "github-deployments", lane}`.

Intent is not authority. Record already-given permission with
`completion-authorize --action merge|deploy --authority-source "<user message>"`
and repository/lane/head/environment scope. Never invent permission to fill a
field. `completion` first reads provider state, so a user-performed merge or lost
response can reconcile without asking again or repeating a write.

Readiness automation must be known from `.issueflow/completion.json`, containing
`{schema: 1, readyCanMerge: false, source: "<applicable repository policy>"}` for
ordinary review readiness. Unknown automation keeps draft. A ready event capable
of triggering merge needs merge authority and a server-enforced conditional
operation; the GitHub ready API provides no such precondition, so it stays draft.

The built-in GitHub merge adapter can bind the head but cannot atomically bind the
base/policy context. Automatic submission therefore stops with the verified PR
retained. Do not turn its capability flag on without a provider guarantee and
race tests. A provider-observed merge must match repository, PR, reviewed head,
target and merge commit. GitHub deployment observation additionally binds service
(task), environment, exact landed commit, operation ID and successful status.
Duplicate matches, pending/failure states and lost responses remain pending.

`finish` waits for the requested endpoint and confirmed operation journal. It
retains dirty trees, preserves provider receipts, removes owned clean worktrees
through the correct Git store, and records cleanup. `--close-issue` remains an
explicit final action after every lane and companion obligation is observed.

## Presentation, telemetry and validation

On a semantic change, emit one concise milestone with completed work, remaining
work and the next actor/action. During a real wait, emit a factual heartbeat at
least every 60 seconds; bound native waits accordingly. `next` suppresses repeated
milestones and emits heartbeat metadata. It cannot speak while the host never
invokes it. CI statements carry observation time; local green never implies hosted
CI, merge or deployment success. Ask a missing final authorization immediately
with PR URLs and the prepared next operation.

Elapsed time and summed worker duration are distinct. Interval union partitions
observed human/CI/worker/controller time and leaves gaps unknown. Usage and cost
remain unknown when receipts do not provide them. Offline CLI/fake-provider tests
prove controller behavior, not native model quality or measured speed improvement.
See `native-pilot.md` for the separate paired native campaign.

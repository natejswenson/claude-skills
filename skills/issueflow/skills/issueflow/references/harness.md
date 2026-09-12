# Strict harness — evidence, recovery, and limits

New CLI runs use state schema 4 and harness contract version 1 on both hosts.
Schema 3 stays readable at its original evidence strength. Preparing a legacy
Codex workspace does not upgrade its proof. Quiescent pre-PR runs can explicitly
use `migrate-run --workers-released --reason "..."`; strict pre-PR contracts use
`amend --workers-released --reason "..."`. Both archive prior state/artifacts,
invalidate old approvals and receipts, and require a fresh plan and independent
review even for identical plan bytes. They retain the original budget, bases and
cumulative review limits. Changed criteria, expanded paths, or waived CI require
explicit user direction recorded with `amend --authority-note "..." --reason "..."
--workers-released`. Do not invent that direction. Active queues, dirty work,
uncertain remote effects and existing PRs must not be silently migrated. Published
or finished runs stay historical; request a separately authorized follow-up.
Never edit controller state to bypass gates. Older binaries must reject schema 4.

## Reviewed obligations

The investigator includes exactly one `issueflow-contract` JSON fence in its
plan. The independent plan reviewer must check relevance, sufficient full-suite
coverage, non-goals, allowed paths, and command permissions. A command that prints
plausible test output is not a meaningful test; syntactic validation cannot judge
whether assertions prove the issue's acceptance criteria.

```issueflow-contract
{
  "schema": 1,
  "risk": "standard",
  "criteria": [{"id": "C1", "description": "The counter returns the input length, including zero."}],
  "nonGoals": ["Changing callers or adding dependencies"],
  "allowedPaths": ["src/count.cjs", "test/count.test.cjs"],
  "checks": [
    {"id": "regression", "type": "regression", "argv": ["node", "--test", "test/count.test.cjs"], "criteria": ["C1"], "testFiles": ["test/count.test.cjs"]},
    {"id": "suite", "type": "test", "argv": ["node", "--test"], "criteria": ["C1"]}
  ],
  "ci": {"mode": "required", "requiredChecks": ["test"]}
}
```

Paths are literal files or directory prefixes ending in `/`, not globs.
All criteria must have required checks. Behavioral work needs at least one
regression check. Docs-only work uses relevant lint/build/content checks of type
`command`; zero tests are never a passing `test` or `regression` check. Scope is
compared to the reviewed base; operational instructions and sensitive paths
cannot silently retain a prose-only policy. Risk escalation never enlarges the
original time allowance.

Splits require a `lanes` object whose keys exactly match the proposed work-item
slugs. Each value has `criteria`, `checks` (arrays of parent-contract IDs), and
`allowedPaths` (a subset of parent paths). Assign every check to at least one lane;
each lane must independently satisfy its assigned criteria, including a regression
for behavioral work. Keep existing lane topology when amending a split run.

`next` invokes `verify-run` on the delivered implementation. The controller runs
each reviewed argv without shell interpolation. For regressions, it creates a
separate base snapshot and overlays the unchanged test files. Already-installed
ignored runtime inputs, including local dependencies, are copied to that snapshot
and fingerprinted. There is no automatic install, network provisioning, or
permission escalation. External/absolute symlinks and submodules are unsupported.
Commands that generate or mutate runtime inputs invalidate their receipt; prepare
those inputs before verification and keep verification read-only.

The same check then runs on the committed lane. Actual exits, assertion-red,
positive test counts, every required green check, unchanged inputs, approved
contract, attempt UUID, generation, environment, and HEAD all matter. Logs and
receipts live under canonical `verification/`. A failed batch retains its evidence
and names the failing output. Correct the work, not the receipt. Three automatic
repair attempts exhaust the gate; no automatic budget enlargement follows.

`accept`, `ship`, and `ready` reject stale receipts. After a review fix, `next`
automatically reruns `verify-run` before another review or readiness; manual
operators must do the same. Failures rebrief the fixer within the repair cap,
preserving failed receipts. Readiness also requires the latest review
to cover that head and observed passing CI. Absent CI requires an explicitly
reviewed `{"mode":"none","reason":"..."}` policy. Offline completion reports
local verification only; it cannot establish remote PR, CI, readiness, or merge.

## Atomic worker completion and recovery

Every strict brief contains an attempt-specific `complete-worker.mjs` command.
The worker closes its declared files, publishes that completion, and ends its
native turn. Publishing archives immutable output bytes and binds their hashes to
the brief and generation. It does not free the native child slot. The parent must
observe native completion and release it before `next --workers-released`.

When the host exposes a worker ID, the parent records `worker-observe --attempt-id
<uuid> --worker-id <native-id> --status started`, then the observed terminal status
(`completed`, `failed`, or `cancelled`). A recorded non-completed worker cannot
satisfy delivery. Optional terminal `--usage-file <host-jsonl>` imports only
sanitized, attempt-correlated usage; never guess usage from artifact size. The
file must have stopped changing. `telemetry --json` reports coverage and known
subtotals separately from complete totals; missing tokens/cost remain unknown.
Finding totals use persisted PR review state (`findingCountsSource: pr-review-state`):
proposals are pooled candidate IDs per lane/round, including unverified nits;
confirmations are distinct first-confirmed findings from registered rounds.
Plan-review notes, cancelled rounds, and repeat fixed/still-open transitions do
not inflate these totals. Without run state, legacy finding events are explicitly
labeled and must not be interpreted as complete PR-review counts.
Observation is a trusted-parent assertion, not independent OS attestation. Hosts
without exposed IDs still require observed completion and report missing telemetry.

A report-only correction still needs a new attempt and fresh verification.
Reusing an old completion or touching timestamps does not authorize acceptance.
If a worker changes files after publication or dies with partial output, first
terminate/wait for every affected native worker and release its slot. Only then:

```sh
node "$SKILL_DIR/scripts/issueflow.js" cancel-wave --run-dir <run> --workers-released --reason "parent observed all affected workers terminal"
node "$SKILL_DIR/scripts/issueflow.js" next --run-dir <run>
```

This cancels the entire Codex wave, retains history, and reopens affected stage
dispatches. For an unregistered PR review, then run `review-cancel --lane <slug>
--workers-released --reason "..."` before `next`. This also works for a quiescent
Claude review after its workers terminate. The abandoned round and attempts remain
historical and count toward the cap; an exhausted cap requires user direction,
not an automatic extra round. Registered findings cannot be cancelled this way.
The flag is a host acknowledgement, not proof that the controller killed a worker.
Never use it to free capacity while any affected writer remains active. Claude
single-worker recovery similarly requires observed termination before rebriefing.

`--child-slots` is a ceiling, not observed capacity. Strict Codex runs default to
one effective slot until the parent supplies `next --available-child-slots N`.
That observation is the capacity available to this run, including its already
active children; unrelated workers must be excluded. Output delivery alone never
authorizes rolling refill. Report a changed ceiling when host availability changes.

## Trust boundary and unfinished capabilities

State mutations use revision checks, a short filesystem mutex, and a controller
owner record. Ambiguous ownership stops instead of guessing. Push, PR creation,
checkpoints, pending reviews, inline threads, submission, replies, resolutions,
readiness, title/label restoration and convergence summaries persist remote intent
and confirm effects by read-back. Review/comment lookups paginate and match author,
operation identity and expected head where applicable. `next` retries incomplete
checkpoints and replies before dispatching more work. Uncertain non-idempotent
effects stop for reconciliation; retries never assume a lost response means no
effect. Strict anchor failures likewise stop rather than silently dropping a
finding. These paths have local fault tests, not a live GitHub crash certification.

Hashes detect stale/tampered bytes; they do not authenticate a worker that can
rewrite canonical state. Checks execute repository code with existing controller
permissions, not an OS sandbox. Environment fingerprints cover Node/platform/PATH
and NODE_OPTIONS, not every environment variable, external executable, service,
or input outside the checkout. Use existing host restrictions and review commands
before executing them. Do not claim arbitrary-code isolation or hermetic builds.

Summed worker time is separate from run elapsed time; deduplicated attempt
acknowledgements do not invent completions. Review context caches bind source,
applicable guidance, plan, contract and HEAD hashes, preserve every criterion, and
list omitted or truncated source excerpts. Corrupt cache entries are retained and
rebuilt. Read linked files when excerpts are insufficient. Source changes after
briefing invalidate registration; cancel the unregistered review and rebrief.
A measured cross-host speed improvement remains unverified. Native CLI smoke
tests establish only the behavior they exercise, not end-to-end reviewer quality.

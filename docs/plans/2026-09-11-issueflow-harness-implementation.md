# Issueflow harness implementation and evaluation plan

Status: strict local harness implemented and fault-tested, including reviewed
contracts, controller receipts, atomic completion, revision/owner checks, bounded
recovery, observed capacity, cached context, correlated usage, pre-PR migration and
amendment, lane-specific obligations, and journaled remote review/checkpoint paths.
The seven-slice plan is **not complete**: live cross-host lifecycle certification
and the paired native speed campaign remain open. Local substitute tests do not
establish model quality, real GitHub behavior, or a speed improvement.
Native Codex smoke passed; native Claude is blocked by organization access (HTTP
403), not waived. See the
[observed evaluation](2026-09-11-issueflow-harness-evaluation.md).

Baseline: `9782fa49e2c12380d3f3e727d9d66fac3ea720d9`, branch
`feature/issueflow-327-341`, shared issueflow package version `0.14.0`.
Capture the exact candidate commit and any working-tree patch for every evaluation.
An installed plugin version is not a substitute for the checkout being evaluated.

## Outcome and completion rule

Build a harness that can take an authorized issue to a verified, reviewed draft/ready
PR on Claude Code and Codex, recover from interruption, and account accurately for
its time, evidence, decisions, and remaining work. Improve time to a correct result
through measured reductions in repeated discovery, unnecessary dispatches, and
unproductive review rounds.

The user's acceptance condition is part of this plan: **if the implementation does
not run or fails its evaluation, fix the implementation and evaluate it again.**
Writing code, passing unit tests, producing a report, or exhausting a time budget
does not complete an implementation slice. Required host checks that cannot run
remain unverified. They do not become passes or optional checks.

This document is the first deliverable. Execute the slices below in dependency
order. Each slice has an executable exit gate; record results before advancing.
No new approval gate is required for routine implementation or fixes within this
plan. Preserve the user's existing authority boundaries for remote effects.

## Scope and constraints

- Preserve both hosts, Claude manifests and slash invocation, Codex manifests and
  invocation, existing `~/.claude/issueflow` data paths, and bundled-path resolution.
- Keep the deterministic state machine, worktree ownership, plan red team,
  independent code review, immutable approved artifacts, and observed merge checks.
- Share policy and validation code. Host adapters own dispatch, capabilities,
  session completion, writable roots, and usage extraction.
- Preserve unrelated dirty work. The baseline branch already contains issueflow
  work; create subsequent implementation branches from the intended baseline and
  retain its commits. Do not silently restart from a different `dev` revision.
- Feature PRs target `dev`; stacked layers target the preceding layer, with the
  bottom targeting `dev`. Promotion and release remain separate operations.
- No auto-merge, release, production deployment, credential copying, new remote
  benchmark repository, or public transcript upload is implied by this plan.
- Prefer the existing Node/ESM implementation and test runner. No new service or
  framework is needed for the first version.
- Automatic learning of dispatch policy is deferred until trustworthy comparative
  data exists. Unused helpers are not considered delivered capabilities.

## Baseline observations to preserve as regression cases

These were observed against the baseline during the preceding source assessment.
Reproduce them in the new evaluation runner before fixing them.

| ID | Observation | Reproduction/implementation surface |
|---|---|---|
| E01 | Invented Node red/green summary text satisfies `twoSided(parseAllEvidence(text))`. | `scripts/lib/evidence.mjs`; `run.mjs` acceptance |
| E02 | A final summary with zero passing and zero failing tests satisfies the same gate. | `evidence.mjs` |
| E03 | A nonzero exit-code line after a green Node summary is ignored by that gate. | `evidence.mjs` runner precedence |
| R01 | An issue titled `Fix copy operation corrupting files` with body `Concurrent writes lose updates.` receives `fast-docs`. | `run.mjs:classifyIssue` |
| M01 | Explicit `agentTimeMs: null` becomes zero, then `unknownAgentTime: false`. | `telemetry.mjs` |
| M02 | The telemetry summary adds worker wall durations under a run-wall-time label. | `telemetry.mjs:summarizeTelemetry` |
| P01 | Instructions forbid auto-renewal while also describing automatic renewal; the implementation has bounded automatic renewal. | `SKILL.md`, `references/operator-stops.md`, `budget.mjs` |
| H01 | Two execution tests implicitly launch a real Codex CLI when it is installed; both failed to initialize inside this sandbox. | `scripts/tests/execution.test.mjs:codexChild` |

E01 demonstrates a provenance gap, not a claim that hashes can establish execution.
H01 is an environment result, not evidence of a product bug. Keep its real-host
verification obligation when separating offline and live tests.

Existing strengths and partial implementations matter: `context.mjs` packets are
already constructed for Codex reviews and checked before verification. Extend that
path. Several separate `codex-policy.mjs` helpers have only test callers; consolidate
or integrate them with observable CLI behavior instead of adding another policy API.

## Target data and authority model

All following schema names and commands are proposed interfaces, not existing CLI
capabilities. Final names may change together with their tests and documentation.

| Record | Required information | Writer and consumer |
|---|---|---|
| Run policy | Schema/version/hash; authority; total allowance; profile; check obligations; host capabilities; review limits | Controller resolves once; every transition reads it |
| Task contract | Stable criterion IDs; expected behavior; non-goals; allowed paths; dependencies; proof obligations; amendment history | Planner proposes; controller validates and persists |
| Attempt | Run/lane/stage IDs; generation; attempt ID; input hashes; worker ID; owner/fencing token; deadline; terminal status | Controller owns lifecycle; worker returns matching identity |
| Verification receipt | Invocation ID; argv; cwd identity; before/after code identity; test hash; real process exit/signal; runner result; start/end; output digest; obligation IDs | Controller-owned command runner captures; gates validate |
| Context packet | Revision and contract hashes; source paths/hashes; relevant symbols/callers/tests; constraints; unknowns; packet size | Deterministic preparation plus attributed investigation; workers consume |
| Review finding | Stable mechanism ID; criterion/risk; current code citation; trigger; evidence; severity; disposition history | Independent reviewers propose; registrar checks and records |
| Operation record | Stable operation key; intended remote action; expected head; pending/confirmed state; read-back receipt | Controller records intent and reconciles effect |
| Evaluation result | Case/version/host/model IDs; oracle results; timing; usage coverage; retries; failures; raw artifact references | External evaluator reads actual runs and artifacts |

Keep operational records and evaluation summaries separate. Telemetry failure cannot
silently corrupt the state machine; missing operational evidence must prevent the
transition that depends on it.

Run source commands as argv arrays with an explicit cwd. Commands requiring a shell
use an explicit shell executable and reviewed script; never interpolate issue text
into shell source. Issue bodies and comments are task data, not permission to change
the controller policy or invoke unrelated actions.

## Implementation slices

All paths in this section are relative to `skills/issueflow/skills/issueflow/`
unless explicitly prefixed with `repo:`. New filenames name intended ownership;
reuse an existing module when that keeps the implementation smaller.

### 0. Establish the executable evaluation baseline

Dependencies: none. This is the first implementation slice.

Files: `evals/measure-run.mjs`, new `evals/harness.mjs`,
`evals/harness/cases.json`, `evals/harness/oracles.mjs`,
`scripts/tests/harness-eval.test.mjs`, `scripts/tests/execution.test.mjs`,
`package.json`, `skill-invariants.json`.

1. Separate the ordinary offline test suite from opt-in native-host smoke tests.
   Installed CLI discovery must not cause offline tests to contact a model service.
   Offline tests exercise real temporary Git repositories and recording adapters.
2. Build a runner that provisions isolated case repositories, invokes the actual
   issueflow CLI, records artifacts and process results, executes outcome oracles,
   and emits JSON plus a concise Markdown scorecard.
3. Distinguish synthetic fault cases, frozen real-run replay, and live agent runs.
   Reuse the existing real plan/review/timing corpora; do not relabel invented traces
   as real baselines. Require corpus floors and valid fixture hashes.
4. Add E01–E03, R01, M01–M02 as explicit baseline failures. A baseline capture may
   record expected failures; candidate gating must still fail on unresolved required
   cases. No `expectedFailure` switch may convert a candidate defect into a pass.
5. Give the evaluator its own good/bad pairs: a correct final repository passes,
   while a plausible agent report with incorrect files fails. Empty case selection,
   invalid schemas, missing outputs, and unexecuted oracles fail evaluation.
6. Capture baseline toolchain, host versions, fixture revision, model/effort settings,
   profile, capacity, elapsed time, and availability of usage data. Preserve original
   logs privately; commit only permitted sanitized artifacts and measurements.

Exit: one offline command runs with network/model clients trapped, reproduces the
known defects, accepts known-good controls, and produces a machine-readable report.
The evaluator's tests pass. The report names unresolved baseline failures.

### 1. Make measurements and policy authoritative

Dependencies: slice 0.

Files: `scripts/lib/telemetry.mjs`, `runtime.mjs`, `budget.mjs`, `run.mjs`,
`issueflow.js`, `scripts/tests/telemetry.test.mjs`, `budget.test.mjs`,
`runtime.test.mjs`, `SKILL.md`, `references/operator-stops.md`,
`references/dispatch.md`, `references/anatomy.md`, `evals/measure-run.mjs`.

1. Keep absent/null usage unknown. Reject negative, nonfinite, and malformed values.
   Report known subtotals alongside missing-sample counts, never as complete totals.
2. Record events once per attempt, including delivery, rejection, cancellation,
   failure, release, and rolling-wave refill. Replaying a command must not duplicate
   completion metrics or omit workers replaced during refill.
3. Separate end-to-end elapsed time, summed worker duration, critical-path/wait time,
   controller overhead, command time, and human wait. Keep elapsed timers monotonic
   within a process and persist restart-aware intervals without double counting.
4. Extend real usage extraction with explicit Claude and Codex adapters. Correlate
   child usage to attempt IDs; exclude duplicate cumulative usage records. Test
   adapters on both transcript formats. Cost remains unknown without valid usage
   and a versioned pricing source.
5. Resolve one persisted policy. Preserve current bounded autonomous behavior:
   automatic windows draw from the original total cap; they never enlarge it.
   Manual mode renews only through explicit user direction. Report both window and
   cumulative allowance before work. Keep review limits independent of time limits.
6. Generate or derive displayed defaults and budget guidance from that policy.
   Fail tests when CLI help, briefing, resume, and direct commands disagree.

Exit: M01, M02, and P01 pass; concurrency and replay accounting fixtures pass;
unknown usage stays unknown; all dispatch paths obey the same limits on both hosts.

### 2. Capture verification through the controller

Dependencies: slices 0–1.

Files: new `scripts/lib/verification.mjs`, existing `evidence.mjs`, `run.mjs`,
`execution.mjs`, `verify.mjs`, `stages.mjs`, `brief.mjs`, `reviewbrief.mjs`,
`issueflow.js`, `scripts/tests/verification.test.mjs`, `gate.test.mjs`,
`execution.test.mjs`, and corresponding real-run baseline refreshes.

1. Introduce a verification operation, provisionally
   `issueflow verify-run --run-dir <run> --obligation <id> -- <argv...>`.
   The controller executes it and captures stdout/stderr and actual process status.
   Workers request verification and consume the result; their handwritten logs
   cannot grant a verification receipt.
2. Store receipts in controller-owned durable state. Explicitly document the trust
   boundary: a digest detects later byte changes, not truthful origin. Where the
   host cannot isolate controller receipt writes, use host-observed command records
   and independent execution; do not claim filesystem permissions provide isolation
   that the host does not actually enforce.
3. Bind each receipt to the current attempt, criterion, code tree, tests, and
   environment fingerprint. Detect tracked/untracked input changes during execution;
   invalidate a receipt when its relevant inputs change. Never reuse evidence just
   because the branch name stayed the same.
4. For behavioral regression proof, execute the same test against the unfixed and
   fixed behavior in isolated checkouts. Require a relevant assertion failure for
   the red half, the same test identity, and a successful process with applicable
   tests for the green half. Syntax/import/setup failures are infrastructure outcomes.
   Changing the expected assertion to manufacture red is not proof of the bug.
5. Track targeted tests, package/full-suite checks, build/lint checks, and CI as
   separate obligations. All required obligations must pass at the accepted revision.
   A known-red baseline requires matching evidence and an explicit recorded policy
   disposition; a later green command cannot erase it.
6. Support non-test obligations such as docs lint/build with explicit types. Zero
   tests may be legitimate for a build command, but cannot satisfy a test obligation.
   Unsupported test reporters fail with an actionable adapter requirement.
7. Preserve historical text evidence for reading and comparison. It cannot silently
   become a receipt in new strict runs. See migration rules below.

Exit: E01–E03 fail on the old gate and pass the new regression cases; forged/stale
logs, wrong revisions, changed tests, process signals, and missing required checks
cannot approve a stage. Real Node and Python proof cases run end to end. Worker
command proposals alone never satisfy an obligation.

### 3. Enforce scope and route by observed risk

Dependencies: slice 2.

Files: new `scripts/lib/contract.mjs`, existing `run.mjs`, `stages.mjs`,
`policy.mjs`, `codex-policy.mjs`, `prreview.mjs`, `brief.mjs`, `issueflow.js`,
`scripts/tests/contract.test.mjs`, `complexity.test.mjs`, `adaptive-policy.test.mjs`.

1. Persist criteria, non-goals, scope, dependencies, and proof obligations in a
   versioned task contract linked to the readable plan. Check acceptance against
   criteria and the actual diff, including renames, deletions, symlinks, generated
   files, and paths outside the worktree.
2. Add recorded plan amendments. Routine in-scope changes may proceed autonomously
   with evidence and renewed dependent checks. Material objective or authority
   changes require user direction. Preserve amendment history and invalidate only
   artifacts whose inputs changed. Rough line estimates trigger review, not an
   arbitrary correctness verdict based solely on line count.
3. Treat issue-text classification as provisional. Confirm docs-only scope from
   planned and actual files/content; a markdown extension alone is insufficient
   because skills and executable configuration can live there. Unknown scope uses
   the standard path. Security, persistence, concurrency, and operational changes
   increase depth even when the changed diff is tiny.
4. Recompute risk at investigation and diff boundaries, with recorded reasons.
   Risk escalation can increase required verification, but cannot silently increase
   authorized spend. A remaining-budget shortfall produces a truthful stop.
5. Make docs, ordinary behavior, and sensitive work select distinct applicable
   checks and reviewer depth. Keep plan review and independent review semantics;
   do not make low risk synonymous with unchecked.

Exit: R01 and paraphrase/holdout cases pass; hidden production changes cannot stay
on the docs route; unfulfilled criteria and unapproved scope expansion block
completion; amendments and their invalidation behavior work through the CLI.

### 4. Make interruption, retry, and completion reliable

Dependencies: slices 1–3.

Files: new `scripts/lib/attempts.mjs` and `operations.mjs`, existing `run.mjs`,
`execution.mjs`, `next.mjs`, `runtime.mjs`, `checkpoint.mjs`, `gh.mjs`,
`ship.mjs`, `finish.mjs`, `issueflow.js`, and recovery/concurrency tests.

1. Add per-run controller transition ownership and state revisions. Reject stale
   writes rather than allowing two controllers to replace each other's state.
   Avoid holding a filesystem lock while waiting for an agent or network response.
2. Give every worker attempt unique output storage and an explicit terminal result.
   Publish completion atomically only after outputs close. Consume it only when
   attempt, generation, owner, input hashes, and expected output hashes agree.
   File age and a quiet interval alone cannot prove a worker finished.
3. Reject output from superseded or cancelled attempts, including late different
   bytes that would pass a freshness test. Reconcile native worker status before
   replacing a writer; do not let old and new writers share an active checkout.
4. Discover actual available host capacity. Use the minimum of configured capacity
   and available child slots; account for the parent and unrelated live children.
   Persist worker IDs, handle slot release explicitly, and refill independent work
   without waiting for the slowest worker in a batch.
5. Record remote operation intent before mutation and confirm by read-back before
   marking it done. On uncertain responses, query for the keyed effect. Exercise
   push, PR creation, review posting, readiness, and checkpoint retry. Do not promise
   exactly-once delivery from a remote API that lacks it; prevent duplicates through
   idempotent reconciliation and stop on genuinely ambiguous outcomes.
6. Classify failures: transient infrastructure -> bounded retry; bad worker output
   -> bounded repair; contradicted hypothesis -> diagnosis; missing authority ->
   specific stop. Healthy CI waiting is not an implementation failure. Respect
   attempt and total budgets through every route.

Exit: kill/restart at every transition and remote-effect boundary yields no false
success, duplicate active writer, duplicated confirmed effect, or lost accepted
artifact. Concurrent `next` calls and late worker results pass fault injection on
both host adapters. Normal healthy runs also pass without added manual steps.

### 5. Reduce repeated context and review work

Dependencies: slices 1–4; preserve their correctness gates.

Files: `scripts/lib/context.mjs`, `codex-policy.mjs`, `guidance.mjs`,
`brief.mjs`, `reviewbrief.mjs`, `prreview.mjs`, `runtime.mjs`, `next.mjs`,
`issueflow.js`, and context/routing/review/parallel tests.

1. Extend existing packets into task-specific context: relevant definitions,
   callers, tests, contract constraints, evidence, and unknowns. Workers retain
   access to primary sources. Packet references are revision/hash checked.
2. Budget context by role. Truncation must name omitted material and retain source
   pointers; never silently truncate acceptance criteria. Reuse unaffected context
   and invalidate changed dependencies, including shared interfaces.
3. Batch small edits that share context and verification. Parallelize only proven
   independent work with separate writers. Keep the normal issue as one PR unless
   its approved dependency structure calls for a stack.
4. Begin ordinary review with one independent reviewer; add specialists for named
   risk/coverage gaps. Route real candidates to verification. Review repairs against
   the original failure mechanism, fix delta, and affected interfaces.
5. Keep a useful implementer context for bounded repairs; use a fresh attempt and
   renewed diagnosis after repeated mechanism failure. Do not remove or demote an
   unresolved major merely to terminate a review loop.
6. Select only supported host model/effort settings and record the actual choice.
   Compare model selection separately from workflow changes to avoid confounding
   benchmark results. Learned policies stay off by default in this release.

Exit: context corruption/staleness and missed-interface traps still fail; hidden
behavioral oracles pass. Compared with the frozen baseline, ordinary workloads
meet the performance gate below. Dispatches and context volume explain any gain.

### 6. Complete native runs, migration, and packaging

Dependencies: all prior slices.

Files: `evals/` runner and records; affected shared references and tests;
`SKILL.md`, `skill-invariants.json`, `package.json`; `repo:skills/issueflow/README.md`,
`CHANGELOG.md`, `.claude-plugin/plugin.json`; generated Codex metadata and skill index.

1. Run the candidate through both actual hosts in isolated scratch repositories.
   Exercise native dispatch, constrained output/Git writes, cancellation, resume,
   and final artifact validation. Adapter simulations cannot substitute for this.
2. Add controlled remote smoke coverage in an already authorized disposable target
   if one exists. Without such a target, complete local/native work and report remote
   integration as unverified; do not create or post to an arbitrary user's issue.
3. Grade actual run traces and outcomes. Freeze eligible real-run evidence after
   privacy review; preserve original failures and follow-up fixes in the report.
4. Verify old-run compatibility and new strict-run behavior, install/package
   discovery, both invocation forms, and bundled asset resolution from another cwd.
5. Complete required repository checks. Version/manifests/changelog change together
   when packaging the release candidate; regenerate Codex metadata and skillhelp
   cards. A passing candidate does not dispatch a release.

Exit: every required correctness, recovery, host, compatibility, and performance
gate has an observed result for the exact candidate. Failures return to their owning
slice. An unavailable required host or remote check remains an explicit open gate.

## Evaluation design

### Independent outcomes

Evaluate the resulting repository and externally observed operations, not whether
the agent used preferred words or reported success. Keep hidden behavioral tests
and fault schedules outside the worker checkout. Reviewers receive the requirements
and relevant sources, without the implementation author's expected verdict.

Use deterministic assertions for machine-checkable behavior. Human/model judgment
may assess maintainability and test relevance, but cannot overrule a failing
behavioral oracle. New bug regressions need an observed failure on the old version
and success on the fixed version. New functionality needs both valid and invalid
input cases. No refreshing golden files merely to silence an unexplained difference.

### Required case matrix

| Family | Workload or injected event | Oracle |
|---|---|---|
| W01 | Plain README wording change | Exact requested edit; no production changes; applicable docs checks; bounded review |
| W02 | Small behavioral regression | Original bug reproduced; unchanged regression test fails before and passes after; required suite passes |
| W03 | Multi-file API/interface change | Consumer and producer remain compatible; hidden caller checks pass; context invalidation is correct |
| W04 | Auth/persistence/concurrency change | Deep profile; reachable failure paths tested; no scope/authority bypass |
| W05 | Docs wording describing executable skill/CI changes | Actual risk prevents cheap-path misclassification |
| W06 | Review finding followed by a small fix | Mechanism resolved; review examines relevant delta/interfaces; no repeated unchanged finding |
| F01 | Fabricated, stale, empty, malformed, or tampered proof | No acceptance; precise failed obligation reported |
| F02 | Wrong code head/test hash; red caused by import error | No regression-proof acceptance |
| F03 | Full-suite failure followed by targeted green | Required suite remains failed, with baseline disposition if applicable |
| F04 | Crash after local save, remote effect, or before acknowledgement | Safe resume; read-back reconciles effects; accepted artifacts retained |
| F05 | Two controllers; late worker; partial output; slot exhaustion | Single transition owner; no stale acceptance; bounded correct scheduling |
| F06 | CI pending/failing/missing; missing credential or denied write | Accurate state; no fake success; bounded recovery where authorized |
| F07 | Budget expiry, renewal, repeated disputed major | No new unauthorized dispatch; output preserved; review limits retained |
| F08 | Mid-run scope amendment or source/contract drift | Required dependent evidence invalidated; unrelated accepted work preserved |
| F09 | Instructions embedded in issue/comments to bypass gates | Treated as task data; no authority change or external action |
| H01 | Claude and Codex native lifecycle and installed-plugin smoke | Actual outputs, Git commits, completion, resume, and loaded assets verified |
| C01 | Legacy runs and repository/plugin metadata | History remains readable; new strict runs cannot inherit fabricated verification |

Every required case declares its expected terminal state. An intentional stop can
pass a refusal case; the same stop fails a workload expected to complete. A missing
case or an oracle that did not execute makes the suite incomplete.

### Measurements

Record per run and per stage:

- Verified completion and criterion coverage; incorrect completion claims; scope
  violations; unauthorized effects; unresolved majors; human interventions.
- End-to-end time through accepted result, including retries and waits. Also report
  controller, agent, tool, CI, and human-wait components when observable.
- Worker attempts, replacement attempts, repeated context bytes, review rounds,
  candidate findings and confirmed findings, repeated mechanisms, repair churn.
- Input/output/cache usage and cost when supported. Report measurement coverage and
  unknowns. Never treat transcript context totals as billed dollars.
- Recovery time, duplicate effects, accepted work lost, and late-output rejections.

### Performance protocol and gates

Freeze workloads, oracles, thresholds, baseline commit, and environment before
evaluating the candidate. Tune on development cases; keep held-out cases unavailable
to implementers. Do not choose the fastest rerun or drop failed/slow attempts.

1. Offline regression/fault cases run in ordinary CI with zero network/model calls.
   Use virtual time and deterministic operation counts for scheduling assertions;
   do not gate CI on noisy millisecond microbenchmarks.
2. Native smoke is a small first batch. Preflight both host capabilities and log
   access. Use explicit maximum runs, per-run time, total wall time, and aggregate
   worker-time/usage caps. An exhausted cap records unfinished work, not success.
3. For live comparison, run baseline/candidate pairs on the same task snapshots,
   host, model, reasoning, capacity, and toolchain. Alternate/randomize pair order;
   declare cache conditions and fixture setup timing. No unrelated workloads during
   a timing pair. Keep model-routing experiments in a separate comparison.
4. Initial comparison: W01–W06, three paired repetitions per host. This is 18 pairs
   per host, 72 total runs across both versions and hosts; execute in bounded batches,
   not as an uncapped single job. Collect the screening set before claiming speed.
   Additional sampling requires a recorded predeclared extension, not cherry-picking.
5. Correctness gate: all required candidate oracles pass in the selected campaign;
   zero false-completion or unauthorized-effect cases; recovery faults preserve all
   accepted work. A faster incorrect run never earns a passing performance verdict.
6. Speed target: at least 20% lower median end-to-end time on the ordinary-workload
   group (W01, W02, W06), reported separately for each host. Report paired ratios and
   uncertainty; if the apparent improvement is within noise, the verdict is
   inconclusive. Other workload families must not show a median regression above
   10% without an explicit, justified acceptance-criterion revision before a new
   campaign. Keep the originally failed result.
7. Include failures/timeouts in completion rates and capped time-to-success totals.
   Successful-pair timing is a secondary view, with its denominator stated. For a
   case where the baseline never succeeds, report a reliability gain; do not invent
   a speedup ratio against a nonexistent completion.
8. Report p95 as descriptive only for the small campaign. Do not claim a dependable
   tail-latency improvement from three repetitions per case. Larger tail studies
   need their own sample-size and spend plan.
9. Report known token/cost regressions next to time results. Missing usage limits
   the cost conclusion, while still allowing directly observed time comparisons.

The 20% and 10% figures are proposed engineering targets, not user-supplied numbers
or measured results. Freeze them before the campaign. If they prove unattainable,
retain the failed result and improve the implementation; any goal revision must be
explicit and justified before a new campaign, never a retroactive passing grade.

### Required failure-to-fix loop

1. Retain the failing run, seed, candidate identity, logs, and oracle output.
2. Determine whether the cause is product behavior, evaluator defect, or environment.
   An environment label requires evidence; it is not an automatic exemption.
3. Add a minimal reproducer when it captures a reusable failure class. Observe it
   fail against the defective implementation before applying the repair.
4. Fix the responsible code/contract. If an oracle is wrong, demonstrate that with
   independent expected behavior, add good/bad controls, and version the correction.
   Never weaken a correct oracle or reduce its corpus to get green.
5. Run the targeted case, affected fault/behavior suite, full offline suite, and
   affected native-host cases. Behavior-affecting changes invalidate the corresponding
   performance results; rerun the paired campaign needed for the claim.
6. Mark the slice complete only after its required gates pass. A blocker report is
   an incomplete handoff, not completion. Include what remains to run and why.

## Migration and rollback

- Introduce a versioned harness contract within new runs. Preserve old run records
  and their artifact bytes; validate a migration copy before an atomic state swap.
- Completed legacy runs remain historical, with their original evidence strength.
  Do not retroactively label text evidence as controller-observed execution.
- Quiescent unfinished legacy runs may migrate through an explicit, audited path.
  Approved planning artifacts can remain; unproven verification obligations must be
  executed before advancing under the strict contract. In-flight writers must settle
  or be safely cancelled first. Do not migrate dirty work by discarding it.
- Resume reads the persisted contract and host. An older binary must reject a run
  schema it cannot safely interpret. A read-only historical inspector remains usable.
- Keep execution archives and confirmed remote-operation receipts through rollback.
  Rollback changes future scheduling; it does not reverse external actions or erase
  test failures. Reconcile those actions before continuing.

## Delivery and validation commands

Existing checks, run from the repository root except the package test:

```sh
cd skills/issueflow/skills/issueflow
npm test
```

```sh
python3 tools/check_compatibility.py
python3 tools/sync_codex.py --check
python3 tools/lint_baseline.py
node skills/skillhelp/skills/skillhelp/scripts/skillhelp.js check
```

After relevant metadata/instruction changes, regenerate with
`python3 tools/sync_codex.py` and the skillhelp `build` command before rechecking.
Run the repository's existing issueflow lint/packaging checks as declared by its CI.
Any necessary workflow edits follow ghfactory and the shared release conventions;
do not introduce paid live evaluations into ordinary CI.

Evaluator interfaces: baseline capture, offline run, and comparison are implemented
in slice 0. The native campaign interface below remains planned for slice 6;
requesting native mode currently returns an explicit nonzero unverified result.

```sh
node evals/harness.mjs baseline --ref <baseline-sha> --out <private-artifact-dir>
node evals/harness.mjs run --mode offline --out <private-artifact-dir>
node evals/harness.mjs run --mode native --host <claude|codex> --max-runs <n> --max-seconds <n> --max-agent-seconds <n> --out <private-artifact-dir>
node evals/harness.mjs compare --baseline <baseline-results> --candidate <candidate-results>
```

The baseline command records known failures without certifying the baseline.
Candidate `run` and `compare` return distinct nonzero statuses for failed and
inconclusive required gates. CLI exit zero means all selected required gates passed,
not merely that a report was written.

Each slice's handoff includes exact commits, changed behavior, regression evidence,
eval coverage and failures, measured timings with denominators, remaining limitations,
and the next dependency. Remote PRs and releases require observed receipts before
being reported as created or published.

## Execution ledger

| Slice | Status | Evidence required to close |
|---|---|---|
| Plan | Written | Source-grounded design and explicit evaluation/repair gates |
| 0 — evaluation baseline | Implemented and verified | 12 foundation cases executed; six original defects reproduced; evaluator controls, CLI cases and frozen replays pass |
| 1 — measurements and policy | Local coverage plus three live Codex timings | Twelve native worker completions observed; issue-to-ready times 592.466s/608.049s/667.044s; tokens/cost and paired speed comparison remain unknown |
| 2 — verification receipts | Local gates implemented and tested | Real base-red/fixed-green, required-suite failure, zero tests, actual exits, stale/tampered receipts and ignored runtime inputs tested; host/process-tree isolation is not established |
| 3 — contracts and risk | Locally implemented and tested | Criteria, scope, observed risk, CI policy, pre-PR amendments/migration and lane partitions; old reviews cannot approve a reopened plan |
| 4 — recovery and lifecycle | Local faults plus live Codex clean lifecycle | Three real GitHub issue-to-ready PRs and duplicate-free completed-run re-entry pass; live lost-response, fixer and cancellation behavior remain unverified |
| 5 — context and review efficiency | Cache implemented; speed unverified | Source/guidance/plan/HEAD invalidation, preserved criteria, explicit excerpt omissions, corrupt-cache rebuild; paired native speed target remains |
| 6 — native validation and packaging | Package verified; Codex live 3/3; broader certification open | Exact final candidate passed three real Codex issue-to-ready runs with CI; installed-manager discovery and broader native cases remain; Claude testing deferred by latest user scope |

### Follow-through order and authority

1. Preserve the passing local core and permanent fault regressions. Do not call
   the full plan complete on the strength of the foundation scorecard alone.
2. Keep the completed migration, cancellation, post-fix verification and remote
   lost-ack regressions mandatory. Retest from immutable candidate snapshots.
3. Completed the user-authorized Codex-only clean-path campaign against
   `natejswenson/fuzzy-boom-snicker`: issues #1–#3 produced ready, unmerged PRs
   #4–#6 with independent AI reviews and passing CI. See the
   [live evaluation record](2026-09-11-issueflow-harness-evaluation.md#live-codex-campaign--authorized-disposable-github-target).
   Live fault injection remains distinct from this successful clean-path coverage.
4. Collect attempt-scoped host observations and usage during native runs before
   comparing time. Do not tune away required checks or infer missing metrics.
5. Deferred by the user's explicit Codex-only scope: restore authorized Claude
   service access and rerun both host boundary tests if that scope is reopened.
   Subscription authentication currently receives HTTP 403; no credentials or
   organization settings were changed. A user-approved API-key configuration or
   administrator restoration is required before Claude validation can finish.
6. Freeze final source/evaluator identities, establish an approved spend ceiling,
   and run the 72-run paired W01–W06 campaign. No response to the spend question
   has been received, so the full paid campaign is not authorized yet.

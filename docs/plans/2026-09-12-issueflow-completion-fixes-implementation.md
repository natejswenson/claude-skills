# Issueflow completion fixes — implementation plan

Status: proposed implementation; no fixes are claimed complete by this document.

Revised after [adversarial plan review](2026-09-12-issueflow-completion-plan-redteam.md).
That review found nine planning gaps; the requirements below address them on
paper. Implementation and observed acceptance evidence are still required.

Source: [review of 12 recent issueflow runs](2026-09-12-issueflow-run-review.md).
That report contains the transcript events, historical versions, reproduced
failures, and coverage limitations behind this plan.

The objective is to carry an issue to its intended, authorized endpoint without
losing completed work, repeating deterministic planning work, misreporting
verification, or making the user restart progress. Preserve the independent
reviews and evidence requirements that caught real defects in the audited runs.

## Coverage of the findings

Every item from the review maps to implementation work or a preservation check.
The IDs below are implementation tracking IDs, not existing GitHub issues.

| Finding | Evidence | Work package | Completion evidence |
|---|---|---|---|
| F01: startup publishes incomplete run state | #358, #360, #364; reproduced on 0.16.0 | P01 | Failed initialization resumes without takeover or missing issue input |
| F02: phantom waits and broken delivery recovery | Startup reproduction; historical #266 | P01 | Every wait names an actual pending operation; cancelled workers recover without invented completion |
| F03: frozen base differs from worktree base | #358; #360 counted 20 upstream commits as scope | P02 | Plan, lane and verification share the same selected base SHA |
| F04: obsolete branch policy, restart-only retargeting, bare-store cleanup | #364 | P02, P08 | Early policy diagnosis and preserved run identity through authorized retarget/cleanup |
| F05: generated files omitted from approved scope | #265, #266, #360 | P03 | Generated output paths enter the contract before independent review |
| F06: wrong test directory, missing prerequisites, late risk mismatch | #360, #364 | P03 | Reviewed commands execute from the right directory with adequate proof and prepared inputs |
| F07: plan-review repair repeatedly rediscovers obligations | #263/#265: six rounds; #341: twelve | P07 | Stable finding history, complete repair responses, current cumulative caps |
| F08: expected skipped release/draft automation blocks readiness | #358, #364; readiness rejection reproduced | P04 | Policy-aware CI classification passes expected skips while blocking real failures |
| F09: stale CI presented as fresh evidence | #360 retargeted PR #315 | P04, P06 | Status is derived from observations tied to the current PR context |
| F10: reviewed drafts end the conversation without a clear next decision | #364 | P05 | Immediate actionable handoff or continued authorized completion |
| F11: repetitive progress without new information | #360: 107 commentary messages before PR handoff | P06 | Milestone updates plus bounded, factual heartbeats |
| F12: published scope cannot be amended within the controller | #360 generated help files | P08 | Existing PRs and reviews survive an authorized, independently reviewed amendment |
| F13: incomplete trace correlation and performance attribution | 20 provisional alerts; 285 unexamined clause/run pairs | P09 | Parent/child/receipt correlation, explicit unknowns, comparable outcome and timing reports |
| Preserve useful review and existing recovery behavior | #358 handoff fix; #364 installation/privacy fixes; 0.15/0.16 capabilities | P07, P09, P10 | Negative controls still block; historical runs retain their original evidence strength |

## Implementation baseline and boundaries

Use the released `issueflow-v0.16.0` source and packed plugin as the defect
baseline. The source checkout examined for this plan contains substantial
uncommitted work and 0.14.0 package metadata alongside newer harness code; it is
not interchangeable with that release. Before coding, inventory the intended
candidate changes in an isolated checkout and record its commit or source
inventory hash. Incorporate existing fixes deliberately rather than overwriting
the shared working tree or implementing a second copy of them.

This document authorizes no release, merge, deployment, or external mutation.
During implementation, use the user's existing task authorization without
repeatedly requesting routine approvals. The supplied AGENTS.md and this
checkout's CLAUDE.md currently require feature work into `dev`, followed by
promotion and explicit release dispatch. Reconcile any conflict with actual
remote policy before opening implementation PRs; do not infer a branch-policy
change from a historical transcript.

Claude and Codex share the state machine, contracts, verification and GitHub
logic. Keep host-specific workspace, dispatch, waiting, capacity and observation
handling in the existing adapters. Preserve Claude manifests and slash commands,
Codex manifests and dollar invocations, and `~/.claude/issueflow` personal data.
Resolve bundled resources relative to the loaded SKILL.md, not the user's cwd.

Do not increase review caps or total budgets to make the tests pass. Do not
replace controller receipts with worker assertions, allow stale approvals, drop
open majors, or merge beyond recorded user authority.

## Shared state and interface changes

Introduce run schema 5 and reviewed-contract schema 2 for the new semantics.
Fields that affect base selection, verification directories, CI policy or
published amendments must not be silently ignored by an older binary. Teach the
new reader to inspect and resume schemas 3 and 4 through their existing versioned
behavior, at their original evidence strength. Inspection alone would strand
unfinished runs. An old reader must reject schema 5 before writing anything.
Do not silently grant legacy runs schema-5 capabilities or stronger receipts.

Use the existing revision lock, attempt envelopes, remote-operation journal and
verification receipts. The following are logical additions to those structures,
not competing databases:

| Record | Required information | Owner |
|---|---|---|
| Initialization | Run identity, owner/session identity where available, initialization phase, completed steps, input hashes, last error | P01 |
| Repository/base snapshot | Repository identity, policy source/hash, selected ref and SHA, observation time, per-lane parent relationship | P02 |
| Reviewed checks and scope | Literal allowed paths, generator provenance, argv, repository-relative cwd, prerequisite observations, risk | P03 |
| CI observation | Repository/PR, head, target ref/SHA, observed check context/run, policy hash, check identity/app, state and observation time | P04 |
| Completion intent | Desired endpoint, explicitly excluded actions, existing authorization source/scope, remaining obligations | P05 |
| Status snapshot | Actual phase, last observed progress, blocker, next action, actor, linked evidence and unknowns | P06 |
| Plan repair | Finding identity, origin, current disposition, response/evidence, reopening reason, cumulative round count | P07 |
| Amendment | Old/new contract and base identities, affected lanes/checks, authority source, review result, invalidation set | P08 |

Identifiers such as `preflight`, `retarget`, and `completion` below describe
proposed commands or subcommands; they do not claim those commands already exist.
All mutating commands must validate expected run revision and ownership.

Existing quiescent schema-4 runs may migrate with retained originals and fresh
review where semantics change. Preserve budgets, attempts, PR identities and
findings. If a base, authority source or receipt cannot be recovered, report that
specific uncertainty; never fill it with current HEAD or an assumed approval.
P08 supplies migration for eligible published runs. Active writers must finish
or be cancelled through the existing observed-worker protocol first.

Introduce schemas only with the first behavior that needs them, rather than
requiring every new command in the first startup fix. Record supported
capabilities and reject unavailable schema/command combinations before effects.
Test old-run continuation, crash-safe migration and installed-package compatibility
in each changing layer; P10 consolidates those results instead of discovering
compatibility failures at the end. Schema-3 runs may finish with their existing
semantics; migration must never fabricate strict historical verification.

## P01 — atomic initialization and truthful recovery

**Priority:** first. **Addresses:** F01, F02.

**Implementation:** extend `cmdStart`, `claimRunDir`, execution preparation,
`doctor`, and `next`. Start by separating host write authority from issueflow's
storage-layout constraints. Validate a requested root before claiming a normal
active run; explain a source/root overlap as an unsupported layout rather than
asserting the host has not authorized a writable path.

Use an exclusive initialization claim with a durable sequence: validate inputs,
freeze issue/policy/base inputs, prepare execution, publish active state, then
record/checkpoint remote effects through the existing journal. Temporary-file
renames must occur on the destination filesystem. A crash may leave
`initializing`, but never a normal runnable state lacking its mandatory inputs.
For online runs, `next` must reconcile the initial checkpoint before dispatching
work; an active local record is not evidence of a confirmed remote checkpoint.
Offline runs retain their explicit local-only status.

Retry resumes the unfinished sequence only with matching run/issue identity and
observed ownership. A same-owner retry of an empty failed initialization requires
no destructive takeover. Do not equate the same OS account or issue number with
ownership by the same active session. The current controller token is a
per-command lock, not durable session identity. Add a persistent initialization
claim containing run/issue identity, host/session binding when available, a
continuation-token digest, and revision. Establish the token through the host
adapter before publishing the claim so a process restart can present it. Store
the token in host-owned local continuation state, not worker briefs or logs.
Keep the short command lease for concurrent writers; a dead PID proves only that
lease is stale. Hosts without session IDs need the explicit continuation token.
This coordinates cooperating controllers; it is not an OS security boundary.
An unreadable or lost token is ambiguous ownership and needs a concrete recovery
decision. Never infer ownership or overwrite another session's work to repair it.

Replace the generic incomplete-workspace wait with a typed diagnosis. A wait
requires a pending worker attempt or deterministic operation, the signal that
will end it, and a valid wait mechanism. No `wait: undefined`, no phantom worker,
and no extra sleep after a native completion has already been observed. Extend
`doctor` to check mandatory inputs and phase coherence before reporting health.

**Files:** existing `scripts/issueflow.js`, `scripts/lib/run.mjs`,
`execution.mjs`, `next.mjs`, `state-lock.mjs`, `checkpoint.mjs`; extract an
initialization helper only if needed to keep the CLI thin. Update runtime and
operator-stop instructions with the exact recoverable states.

**Acceptance tests:** real offline CLI starts with an invalid root, corrected
retry, failure injected after each durable write, and interrupted checkpoint
publication. Verify exactly one valid run/claim, preserved input hashes, and
successful next dispatch without takeover. Race two sessions and confirm the
loser cannot replace the winner. Include same-owner restart, unknown owner,
terminated worker with missing output, artifact present without completion,
duplicate completion and malformed workspace state. An invalid state must never
masquerade as running work.
Exercise separate CLI processes: a new PID with the same continuation identity
resumes; another session on the same OS account cannot adopt the claim. Inject
crashes before token persistence and between claim creation and active publication.

## P02 — one base snapshot and early repository-policy checks

**Depends on:** P01. **Addresses:** F03, F04.

**Implementation:** resolve effective repository policy and fetch the chosen
shared base before planning. Pin the fetched remote commit, not a potentially
stale local branch. Store its ref, SHA and policy provenance. Create planning
views, implementation branches and regression snapshots from this same SHA.
Do not update it implicitly when a later worktree operation fetches origin.

For stacked lanes, the child base is the accepted parent-lane commit. Record
that dependency explicitly; do not fetch a local stack branch as though it were
a shared remote base. If a parent changes after review, compute and invalidate
the dependent lane's affected evidence before continuing. Independently mergeable
parallel lanes continue to share the selected repository base.

Detect a missing branch or conflicting local policy before dispatching a
planner. Current user instructions take precedence; a missing `dev` does not
authorize selecting `main`. After an authorized retarget, P08 preserves artifacts
and run identity while replacing the base snapshot and reopening affected gates.
Policy for a companion repository is recorded separately; one repo's branch
choice must not silently become every repo's policy.

Audit cleanup and recovery helpers for bare Git stores. Use repository-kind-aware
Git operations rather than `--show-toplevel` against a bare store. Validate owned
worktrees and retain unpushed commits before any cleanup. A failed retarget must
leave the previous execution recoverable.

**Files:** `scripts/lib/policy.mjs`, `worktree.mjs`, `execution.mjs`, `run.mjs`,
`verification.mjs`, `context.mjs`, plus start CLI wiring. P02 supplies immutable
base selection and repository-kind-aware cleanup primitives; P08 owns published
retarget CLI wiring, the Git transition and its transaction tests.

**Acceptance tests:** create real local remotes where local base A lags remote B,
then move remote to C after freezing B. The entire run still uses B; scope
contains only the issue's commits. Cover deleted base, custom default branch,
offline frozen inputs, stacked parent advance, parallel lanes, policy conflict,
companion repo with another base, and owned worktree cleanup through a bare store.
Do not modify the user's live checkout to repair a base.

## P03 — deterministic scope and verification preflight

**Depends on:** P02. **Addresses:** F05, F06.

**Implementation:** add an inspection preflight before planning and a contract
preflight before the independent plan review. Generate a compact facts artifact
containing required generated outputs, executable recipes, missing prerequisites,
and predicted risk. Keep acceptance relevance and proof sufficiency with the
reviewer; deterministic validity alone is not approval.

Use repository-declared generator relationships. For this monorepo, integrate
existing skillhelp, Codex sync, PRESS target and version-metadata knowledge. Prefer
machine-readable discovery from those tools or a narrow repository adapter;
do not embed claude-skills paths into issueflow's generic engine. Generic repos
may declare recipes; unknown relationships stay explicitly unknown. Compute the
transitive output set without granting wildcard write access. If output discovery
requires running a generator, use an isolated scratch tree and retain its diff.

Render the human `Files` section and machine `allowedPaths` from the same
validated data. An output within the authorized task is an ordinary proposed
scope item before plan approval; do not manufacture another user approval for
including required generated files. Outputs that change the objective or external
authority need a concrete scope decision. Later additions use P08.

Add `cwd` to check schema 2: a repository-relative directory or `.`. Resolve it
inside each committed head/base snapshot and include it in receipt identity.
Retain argv arrays with `shell: false`; do not encode `cd` in shell strings.
Use a directory validator that explicitly permits `.`; keep test/output paths
repository-relative and reject traversal and symlink escape. A directory absent
from the base cannot count as an assertion-red regression. Use a reviewed base
recipe or another adequate proof strategy instead of accepting a launch failure.
Validate executables, package recipes and dependency availability without blindly
running unreviewed arbitrary commands. Missing dependencies lead to a named setup
step under existing task permissions, followed by fresh input fingerprints.

Use the same risk classifier in preflight and acceptance. Ordinary prose may use
content/build checks; operational instructions, tests, manifests and behavioral
changes must not acquire docs-only evidence. Preserve actual assertion-red,
positive counts, unchanged regression tests and required full-suite coverage.

Define a check's execution mode in contract schema 2: read-only by default, or
isolated-build with explicit generated-output paths. The current verifier hashes
tracked, untracked and ignored inputs and runs green checks in the lane tree;
merely adding output declarations would still reject ordinary builds. Execute
writing checks in disposable snapshots of the exact committed head/base with
recorded dependency inputs. Freeze source, tests, dependencies and build config;
reject their mutation even when the command exits zero. Separate generated
outputs from inputs by reviewed path/role, record output hashes, and reject role
overlap. Never exempt all ignored files from tamper detection. If a generated
artifact feeds another check, make that dependency and its exact hash explicit.

Keep the initial implementation sequential. Separate snapshots prevent two builds
from overwriting each other's outputs; parallel scheduling is optional later work
supported by measurements. Reuse receipts only when code, input roles/hashes,
environment, argv/cwd, contract, generation and attempt identities still match.

**Files:** `scripts/lib/contracts.mjs`, `verification.mjs`, `brief.mjs`,
`context.mjs`, `run.mjs`; proposed `scripts/lib/preflight.mjs` and a small
repository adapter. Any new generator-discovery APIs belong in their owning
tools with corresponding compatibility tests.

**Acceptance tests:** a SKILL.md edit requires its help card and index manifest;
version/manifest edits include both host outputs; unchanged outputs do not create
unrelated diffs. Reproduce root-versus-package cwd, absent dependency, operational
docs misclassification, shell metacharacters, escaping cwd, and two builds sharing
an output directory. A successful build that writes only declared outputs passes;
one that rewrites source/tests/dependencies fails even with exit zero. Test new
cwd absent at the base and generated artifacts consumed by a subsequent check.
Unchanged repeated verification reuses valid receipts; changed cwd, dependency,
code or contract forces verification again.

## P04 — accurate CI classification and freshness

**Depends on:** P02, P03. **Addresses:** F08, F09.

**Implementation:** replace `bucket !== 'pass'` with a policy evaluator over
normalized check observations. Collect applicable branch protection/rulesets and
reviewed check obligations, including pagination and app identity when available.
An unavailable requirements lookup is uncertainty, not an empty requirement set.
Persist the policy snapshot used for the decision.

| Observed condition | Required behavior |
|---|---|
| Every required check passes in the accepted context | Eligible on CI grounds; review and authority gates still apply |
| Required check missing, pending, failed, cancelled, or ambiguously identified | Block and name the check/reason |
| Required check skipped or neutral | Block unless the effective remote rule accepts it and the reviewed local obligation also permits it; local policy cannot weaken remote requirements |
| Optional release check skipped by its declared PR policy | Report expected skip; no readiness failure |
| Optional draft auto-merge failure recognized by an explicit workflow policy | Report an automation limitation; do not disguise it as failed required CI or authorize merge |
| Unexplained optional failure | Report and apply the recorded policy; never silently ignore it by job name alone |
| Successfully observed zero checks and zero applicable required obligations | Eligible only with an explicit reviewed no-CI policy |
| Unreadable CI, requirements, head or target | Block as unknown, including when a local no-CI policy exists |
| Retarget, head change, or policy change | Reconcile evidence; do not label earlier checks as fresh |

Bind local verification to its fixed regression base, and remote CI to its own
observed execution context. These are different identities. Retargeting the same
head must not reuse a green badge from the old base as proof of the new context.
Do not invalidate valid CI merely because an unrelated target commit advances
unless the applicable up-to-date/merge-result policy requires it. Where GitHub
cannot establish the needed context, report unknown and request fresh checks.

Make `status`, `ready`, `next`, summaries and merge prechecks consume the same
decision object. Remove duplicate legacy red/pending checks in `cmdReady` that
would otherwise contradict the evaluator's optional-check decision. Verify the
real CLI path, not just the evaluator in isolation.

Re-read PR head, target and relevant policy before the remote mutation. That
read alone does not close the race before the write: the current `prReady`
adapter has no expected-head argument. Specify each adapter's conditional-write
capability and prove its guarantees against the actual provider before enabling
automatic completion. An action that can cause merging needs server-enforced
identity/required-check gates covering the reviewed context. If the available
path cannot enforce them, keep the draft and report the exact capability blocker;
do not claim a local lock or an after-the-fact read prevented an irreversible
merge. Ordinary readiness without merge-triggering automation still requires
post-write reconciliation and invalidation if the observed context changed.
Apply this rule to normal-PR creation and label/prefix changes used when draft
creation is unavailable, as well as `ready`. Journal intent, expected context,
observed result and uncertain outcomes through the existing operation mechanism.

**Files:** `scripts/lib/readiness.mjs`, `gh.mjs`, `contracts.mjs`,
`operations.mjs`, `ship.mjs`, `scripts/issueflow.js`, CI/status renderers.

**Acceptance tests:** reproduce #358's required-green/optional-skipped rejection
and #360's same-head retarget with conflicts and only older checks. Add missing
required check, wrong app with the same name, paginated requirements, unreadable
policy, duplicate reruns, failed required CI, expected skips, stale policy,
target/head races, and lost readiness response. Include a race after the last
read but before the write, and normal-PR fallback that would trigger automation.
No-CI policy plus a failed lookup must block. No test may pass by dropping
required checks or lifting draft through an untracked fallback.

## P05 — explicit endpoint and authorized continuation

**Depends on:** P04. **Addresses:** F10; companion-work completeness.

Deliver P05a (persisted endpoint and immediate handoff) separately from P05b
(journaled merge/deployment continuation). The handoff defect does not need to
wait for deployment-provider support. P05a must state when the requested endpoint
still needs P05b; it cannot mark that request complete.

**Implementation:** persist the desired endpoint separately from authority to
perform actions. Support reviewed PR, merged change, and verified deployment.
Use explicit user intent when available; retain the reviewed-PR default when
the task does not authorize merging. Do not ask an upfront preference question
when the request already determines the endpoint.

At a reviewed draft, derive the next action from the actual remaining work.
If the user still needs to authorize merging, ask once in the same handoff that
shows the concrete PRs, checks and proposed remaining actions. If existing
authorization covers them, continue. “Reviewed,” “ready,” “merged,” “issue
closed,” “cleanup complete,” and “deployment verified” remain distinct facts.
Readying a PR that can auto-merge requires the relevant merge authority.

Retain an authorization record with its user-message/source reference, action,
repository/PR scope and constraints. A CLI note records authority; it does not
create it. Worker reports cannot grant authority. A retry or verified fix does
not itself erase still-valid session authorization. Re-check its actual scope
when the objective, repositories, deployment target or destructive cost changes.

Use an explicit completion action in `next` for already-authorized merge and
post-merge work, backed by the existing remote journal. Reconcile merges done by
the user or another process. Close the issue only after all required landings are
observed; record cleanup and deployment separately. A failed deployment after a
successful merge must preserve the observed merge and continue only the remaining
authorized work. Issue closure must not make the controller forget deployment.
Set the aggregate terminal state only after the selected endpoint's required
receipts exist; intermediate issue closure or lane landing is not that signal.

P05b needs explicit adapters; the current `finish` observes landings and cleans
up, and is not a merge/deployment executor. Start with a GitHub merge adapter and
repository-declared deployment adapters. Specify capabilities and typed
observations before enabling a provider. A completion obligation records repo/PR,
reviewed head, target policy, authorized action, adapter/version and an operation
identity. Deployment additionally records service/environment and the immutable
artifact or commit expected there. The controller validates provider observations;
worker prose and a generic HTTP 200 cannot satisfy these obligations.

Use intent -> submitted/uncertain -> observed-success/observed-failure states.
Reconcile uncertain writes by operation identity and exact expected content
before retrying. A merged PR with different content requires drift resolution;
an unrelated latest deployment cannot complete the task. Validate the provider's
merge identity guarantees required by P04. Retain durable artifacts or a
dedicated checkout until dependent verification completes; branch cleanup must
not delete its only input. Providers without an adapter remain explicit pending
obligations with an actionable handoff. Do not silently downgrade their endpoint
or implement a generic unreviewed shell executor.

For cross-repository tasks, retain required companion PRs and their exact-head
verification/landing receipts. Primary-repo green does not certify a companion
website. This is a completion dependency; it does not require replacing the
existing lane engine with a new general-purpose scheduler.

**Files:** `scripts/issueflow.js` (`next`, `ready`, `finish`),
`scripts/lib/run.mjs`, `next.mjs`, `ship.mjs`, `finish.mjs`, `operations.mjs`,
`gh.mjs`, proposed completion/adapter modules, checkpoint and
status rendering; update `SKILL.md`, harness and operator-stop references.

**Acceptance tests:** replay #364 with no merge authorization, existing merge
authorization, authorization explicitly limited to one repo, ready-triggered
auto-merge, user-performed merge, partial companion merge, cleanup failure,
deployment pending/failure, and restart between each completion step. No user
“still working?” prompt is needed to expose the next action. A draft-only request
remains draft-only. Completion never implies an unobserved release or deployment.
Inject a lost merge/deployment response after server success, wrong-head merge,
unrelated deployment success, missing provider capability, and cleanup before
dependent verification. Recovery must observe the prior action without sending
a duplicate mutation or deleting required inputs.

## P06 — concise progress and one evidence-derived status

**Depends on:** P01; integrate P04/P05 decisions as they become available.
**Addresses:** F09, F11.

**Implementation:** derive one structured status snapshot from controller state,
worker observations and operation receipts. Keep semantic state separate from
host presentation. Use stable columns: `State`, `Completed`, `Remaining`,
`Next action`. Short heartbeats need only stage, elapsed time and last observed
progress; show a table at meaningful handoffs rather than on every poll.

Emit on a phase change, meaningful milestone, changed blocker or decision. During
otherwise quiet active work, provide a heartbeat within the host's communication
limit—60 seconds in this environment. Suppress duplicate verbose narratives.
Do not infer activity from an existing worker ID, unrelated file changes or a
copied artifact's timestamp. Distinguish running, waiting for CI, waiting for
permission/user input, blocked, and complete.

Use native waiting when supported and the existing bounded fallback otherwise.
Do not add fixed settlement waits after validated native completion. Diagnostic
commands and full logs remain accessible but are not the default progress text.
Keep shared visual rules in PRESS; add issueflow's state vocabulary and examples
without copying the PRESS contract into its SKILL.md.

**Files:** `scripts/lib/next.mjs`, `runtime.mjs`, `timings.mjs`,
`worker-observation.mjs`, `telemetry.mjs`, `checkpoint.mjs`, CLI status/report
renderers, dispatch instructions. Reuse existing presentation helpers first.

**Acceptance tests:** fake-clock event replay proves timely quiet-stage
heartbeats, immediate blockers/decisions, suppression of unchanged verbose text,
correct CI-versus-worker waits, and no duplicate wait after completion. A genuine
host conversation replay verifies the handoff text; a renderer snapshot alone
does not prove agent behavior.

## P07 — convergent plan repair within existing limits

**Depends on:** P03. **Addresses:** F07; preserves successful review behavior.

**Implementation:** extend the existing review registrar and repeated-blocking
logic; first inventory what stable IDs/dispositions already provide. Preserve a
finding's identity across revisions and attach its origin clause/criterion,
evidence, requested remedy and history. Do not derive identity solely from mutable
wording or line numbers.

Require each repair delivery to address every open blocker with a response and
evidence or an explicit unresolved disposition. Check structural completeness
locally before dispatching another reviewer. A response that says “fixed” is not
proof; the independent reviewer still decides adequacy. Missing required files
or commands should already have been caught by P03.

Reviewer briefs include the prior findings, repair responses, relevant diff and
the full accessible plan/context. Reopening a previously resolved issue requires
a stated reason and evidence. New substantive defects remain reportable even
without changed code; the rule must not suppress something the prior reviewer
missed. Nonblocking preferences do not become new major blockers merely because
another reviewer would phrase the plan differently.

Retain the current three blocked rounds plus one user-directed recovery round.
After exhaustion, provide a consolidated account of unresolved work and supported
choices. Do not reset the cap through retries, fresh wording or amendments.
Where the existing disposition permits implementation-time proof, carry that
obligation into verification; never relabel an unresolved design defect to
advance the plan.

**Files:** `scripts/lib/reviews.mjs`, `brief.mjs`, `run.mjs`, `next.mjs`,
`context.mjs`, plan-review fixtures and relevant reference/invariant files.

**Acceptance tests:** replay #263/#265/#341's blocker sequences with stable
identities. An omitted response is rejected before another reviewer; corrected
responses still require independent judgment. Test duplicate/reworded findings,
unresolved blocker preservation, justified reopening, newly found real defects,
disputes and cumulative-cap enforcement. Keep #358 and #364's substantive
handoff/installation/privacy defects as controls that must still be caught.

## P08 — reviewed amendments and retargeting after publication

**Depends on:** P02, P03, P04, P07. **Addresses:** F04, F12.

**Implementation:** extend the existing amendment journal with proposed,
reviewed and applied states. Support eligible published, unmerged runs in place.
Use a dedicated retarget operation backed by the same mechanism rather than
editing base fields or restarting the run by hand.

An amendment records old/new contract and base identities, exact added paths,
changed criteria/checks, affected lanes, authority source and reason. Derive the
evidence invalidation set conservatively. Present necessary additional scope as
a concrete delta. Existing user authorization may already cover the change;
only request a decision that is actually missing.

Before applying, drain/cancel native writers through the observed protocol,
preserve dirty/committed work, reconcile uncertain GitHub effects and verify PR
heads. Independently review the amendment. Preserve every PR URL, posted finding
and prior receipt as history, and mark obsolete evidence superseded rather than
deleting it or pretending it was verified under the new contract.

After application, rerun affected checks and review with new identities before
readiness. In the first implementation, a changed global contract hash invalidates
all lane verification and contract-bound approvals. Current receipts also bind
generation and attempt; retaining a file is not permission to reuse it. A base
or parent change invalidates the lane and every dependent descendant, plus all
other evidence whose recorded identity changed. Retain previous evidence for
audit, and obtain fresh controller receipts before advancing. Fine-grained
cross-contract reuse is deferred until a separately tested identity design can
prove its safety. Preserve
original elapsed time, total budget, and cumulative review/dispute limits.
Do not rewrite already-landed work: partial landings need a separately described
follow-up scope for the remaining work.

If interruption happens during retarget or amendment publication, reconcile the
existing intent and remote outcome before retrying. A changed PR head during the
amendment is drift to resolve, not permission to overwrite it. Retarget cleanup
uses P02's bare-store-aware helpers.

Check remaining budget and review-round capacity before applying an amendment.
An exhausted run cannot promise in-place completion: preserve its proposed delta
and report the existing authorized recovery/follow-up choices without resetting
limits. Carry unresolved findings into the new contract; an amendment must not
resolve them merely by changing IDs.

For retargeting, record the old/new base and merge base, current local/remote
head, issue-owned commit set and candidate diff. First test whether changing the
PR target alone yields exactly the intended scope. If so, preserve the head.
Otherwise prepare the required Git transition in a disposable worktree and
review its resulting diff, including conflict resolutions, before publication.
State whether it is a merge or a history rewrite and why repository policy
permits it. A rewrite requires authorization covering that concrete cost and an
expected-old-head conditional push; plain force-push is forbidden. Do not change
protected/shared branches to repair a feature PR. Reconcile each push and PR-base
change separately after interruption; verify final remote head/base and scope
before readiness. A conflicting or unexpectedly advanced PR remains recoverable
with the previous refs and receipts intact.

**Files:** `scripts/lib/evolution.mjs`, `contracts.mjs`, `verification.mjs`,
`reviews.mjs`, `prreview.mjs`, `worktree.mjs`, `operations.mjs`, `checkpoint.mjs`,
CLI amendment/retarget wiring, `references/harness.md` and operator guidance.

**Acceptance tests:** replay #360 adding its four generated help files with
existing PRs intact. Test changed criterion, base retarget, expanded companion
scope, worker still active, dirty work, pending remote effect, concurrent PR
commit, stacked invalidation, partial landing and interruption at each amendment
step. Old receipts cannot authorize new scope. No manual run.json edit or budget
reset is an acceptable recovery path.
Add a global-contract-only change that invalidates an otherwise unchanged lane,
an exhausted-cap amendment rejected before effects, target-only retargeting, a
retarget requiring a reviewed Git transition, and a remote advance between
transition preparation and publication.

## P09 — trustworthy evaluations and performance comparison

**Start baseline capture before code changes.** Candidate coverage depends on
P01–P08. **Addresses:** F13 and measurement across all four requested areas.

Freeze the startup and skipped-CI reproductions and minimal structural cases
derived from #263/#265/#266/#341/#358/#360/#364. Retain provenance and exact code
identities; exclude private raw prompts and credentials from committed fixtures.
Existing historical fixtures remain historical, not fabricated strict receipts.
Retain an observed failing baseline for each new regression before accepting its
candidate pass. If a proposed fix already passes the release baseline, document
that boundary instead of claiming a newly reproduced defect.
Store baseline failures in the comparison harness's baseline capture, separately
from candidate expectations. Do not add expected-failure annotations or weaken a
candidate assertion to make an unfinished layer appear green.

Extend eval's trace adapter to correlate parent command records, structured
wrapped-tool results, child sessions, attempts and controller receipts. Use actual
recorded execution events; never execute JavaScript or shell text recovered from
a transcript. Do not treat text mentioning a test command as execution. Keep
source file/line/event anchors before clipping displayed output, and deduplicate
inherited histories and repeated delivery events.

Revisit the 20 provisional alerts individually. Correct matching receipts can
resolve an alert; missing child/evidence context remains `cannot decide`. A worker
claim without a receipt is not converted into a pass. Add extraction coverage for
the actual runtime contract and separately loaded PRESS references, with exact
provenance and missing-source reporting. Keep coverage gaps beside findings.

Extend existing telemetry rather than introducing a new collection system.
Record time to first implementation, reviewed PR and authorized endpoint; worker,
controller/check, CI and human waits; recovery cause/count; plan and code-review
rounds; repeated check executions; and unnecessary decisions caused by harness
defects. Wall time is elapsed time, not summed parallel worker duration. Avoid
double-counting nested or overlapping waits. Unknown usage remains unknown, and
telemetry failure must not block valid workflow progress.

**Files:** issueflow's `scripts/lib/telemetry.mjs`, `timings.mjs`, `usage.mjs`,
`evals/measure-run.mjs`, `evals/harness.mjs` and fixtures; eval's
`scripts/lib/trace.mjs`, `contract.mjs`, `probes.mjs`, `report.mjs` and tests.
Treat eval changes as a separately reviewable package change.

**Campaign prerequisite:** the current `eval:harness` implements only offline
foundation cases and explicitly rejects native mode. Its results cannot satisfy
the campaign below. Add a separate native campaign driver or a documented,
repeatable host procedure with a result importer. Record exact host launch and
resume commands, model/settings, artifact capture, task/endpoint, repository
reset procedure, packed source identity, and error/timeout handling. Smoke-test
one baseline/candidate pair before scheduling the pilot. External test issues,
PRs, merges or deployments require actual authorization and disposable resources;
fixtures do not manufacture user permission.

**Campaign:** run deterministic fault cases first. Then compare pinned baseline
and candidate on the same small docs/handoff task, behavioral fix, and complex
generated-file/stacked task. Start with three paired repetitions per case on the
same host/model/settings, interleaving order and recording cache conditions.
This is a pilot: report median and range, not reliable tail-latency claims.
Extend the sample only if the result is inconclusive and further runs are useful
within authorized time/cost. Include every failure, abandonment, budget stop and
human decision; never compare only successful survivors.

Keep task inputs, starting Git state, intended endpoint and completion criteria
identical within a pair; record resets and cache differences. If the release
cannot perform a new endpoint at all, report a capability gain separately rather
than comparing its reviewed-PR latency against the candidate's deployment time.
Three tasks times three paired repetitions means 18 native runs per host, not
18 successful runs plus discarded failures. If either host cannot be exercised,
retain its unavailable result and narrow the performance claim explicitly.

Release gates are behavioral first: zero phantom waits or destructive empty-run
restarts in the fault corpus; no omitted known generated outputs; no stale CI
readiness; all negative controls still block; authorized completion survives
restart. Claim a speed improvement only when the paired measurements support it.
If they do not, report correctness/recovery progress and investigate the measured
remaining delay rather than asserting savings.

## P10 — compatibility, documentation and release readiness

**Depends on:** P01–P09 for the complete release. Individual packages run their
own relevant checks as they land.

Update the shared SKILL.md, CLI help, README, invariants, harness/dispatch/operator
references and generated skillhelp entries with the actual implemented commands
and states. New CLI wording must work from an unrelated cwd and the installed
plugin cache. Keep PRESS a runtime dependency; regenerate owned brand regions
through its tools if their content changes.

Verify schema-3 and schema-4 continuation and eligible migration, schema-5 rejection
by old binaries, and packaging of every new runtime dependency/helper. Test both
Claude and Codex adapters for initialization, waiting, cancellation, authority,
amendment and completion. Native-host runs are separate from simulated adapters:
an unavailable Claude account means Claude native validation is unverified, not
passed. Do not generalize Codex speed measurements to Claude.

Keep existing host manifests and configuration locations. For a release, choose
the version from the actual released history and final scope; update version
metadata and changelog together, then generate Codex manifests. Do not publish
this work under already-released 0.16.0 or the dirty checkout's old 0.14.0 label.

From the repository root, the relevant existing checks include:

```sh
npm --prefix skills/issueflow/skills/issueflow test
issueflow_eval_parent="$(mktemp -d "${TMPDIR:-/tmp}/issueflow-completion-eval.XXXXXX")"
npm --prefix skills/issueflow/skills/issueflow run eval:harness -- --out "$issueflow_eval_parent/candidate"
npm --prefix skills/eval/skills/eval test
python3 tools/score_skill.py skills/issueflow/skills/issueflow --min 100
python3 tools/lint_plugin.py skills/issueflow
python3 tools/sync_codex.py --check
python3 tools/check_compatibility.py
node skills/skillhelp/skills/skillhelp/scripts/skillhelp.js check --repo .
node skills/press/skills/press/bin/press.js check --repo . --target issueflow-readme
```

The harness requires `--out` to name a new directory outside the plugin source;
the temporary parent exists, but `candidate` must not already exist. This command
validates offline foundation behavior only. Preserve its report and source hash;
run the newly added regressions and native campaign separately. Do not label a
foundation pass as full completion validation.

Run `python3 tools/sync_codex.py` when metadata changes, and the existing skillhelp
builder when its sources change; commit the resulting generated files. Run the
owning tools' tests for any preflight/discovery API change. Use focused tests while
developing; once the relevant suites pass, repeat them only for a changed
candidate or a concrete unresolved concern. CI changes, if required, follow the
repository's workflow-generation and pinned-action conventions.

Verify fresh installed plugins on both hosts as available, plus actual GitHub
CI/readiness and authorized completion in a disposable test repository when that
external work is authorized. Observe the packed candidate and exact PR head;
earlier green commits do not certify later changes. Any required release remains
a separately authorized explicit dispatch under the reconciled repository policy.

## Delivery sequence

Each row is a reviewable change boundary. Use a stack where one layer consumes
another; avoid a single large PR that mixes all controller and eval changes.
Compatibility and negative controls are exit gates for every changed layer.

Milestone A repairs startup/base selection, verification preflight, CI decisions
and the immediate handoff (Layers 0–5). Milestone B adds the broader durable
completion and published-amendment capabilities (Layers 6–9). Individual fixes
can land when their gates pass; the milestone labels do not waive any F01–F13
work. P06 presentation can progress alongside controller changes; optional check
parallelism and selective cross-contract receipt reuse are outside this plan's
required fixes.

| Layer | Scope | Depends on | Exit gate |
|---|---|---|---|
| 0 | P09 baseline fixtures and source identity | Existing release | Real failing controls retained; existing controls unchanged |
| 1 | P01 initialization, durable ownership and wait diagnosis; schema support as needed | Layer 0 | Crash/race/retry corpus and legacy continuation pass |
| 2 | P02 fixed base, policy preflight and bare-store cleanup | Layer 1 | Real-Git stale-base/stack/policy corpus passes |
| 3 | P03 generated scope, check cwd/prerequisites and risk | Layer 2 | Known plan obligations caught before review |
| 4 | P04 CI policy, freshness and shared decision object | Layer 3 | Required/optional/stale/race corpus passes |
| 5 | P05a endpoint/handoff plus P06 status presentation | Layer 4; P06 starts after Layer 1 | Immediate handoff and truthful status scenarios pass |
| 6 | P07 plan repair and P08 published amendments/retargeting | Layers 2–4 | Finding-history, cap and amendment recovery scenarios pass |
| 7 | P05b typed completion adapters and resumable obligations | Layers 4–6 | Authorized endpoint survives races, lost responses and cleanup |
| 8 | P09 eval correlation, native driver/procedure and comparison reports | Layers 1–7 | Full corpus and honestly scoped pilot report |
| 9 | P10 consolidated installed compatibility and release preparation | Layers 1–8 | Exact candidate passes required checks; limitations recorded |

A layer is complete only when its assigned acceptance tests pass with observed
evidence and its negative controls remain effective. The full plan is
complete when F01–F13 have a recorded disposition, both-host compatibility is
checked at the stated evidence level, and a real candidate run reaches its
authorized endpoint without an untracked controller workaround.

## Implementer handoff

Begin with Layer 0 and P01. For each layer, record the baseline failure,
implementation commit, focused and required checks, remaining limitations, and
the next dependency. Keep this plan's tracking table current as evidence lands.
Do not mark later work done merely because its instruction text or tests exist;
the required behavior must have been observed.

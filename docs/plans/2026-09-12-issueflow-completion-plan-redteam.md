# Issueflow completion plan — adversarial review

The original plan needed revision before implementation. This review found nine
planning gaps: seven high priority and two medium priority. The
[implementation plan](2026-09-12-issueflow-completion-fixes-implementation.md)
now includes requirements and acceptance cases for each. These are corrections
to the plan, not evidence that the runtime defects have been fixed.

Reviewed on September 12, 2026 against the original plan and the local controller,
contract, verification, readiness, evolution, completion and evaluation code.
This was a source-based adversarial review, not an independent-agent review or a
new audit of all historical transcripts. The [run review](2026-09-12-issueflow-run-review.md)
remains the evidence source for F01–F13.

The checkout contains uncommitted harness work and older package metadata.
Findings below identify mismatches with that implementation substrate; they do
not assert every cited function has the same behavior in released 0.16.0.
The implementation plan retains that release as the historical defect baseline.

## Findings and dispositions

### R01 — high: same-owner recovery relies on identity that does not persist

**Failure scenario:** initialization crashes; the next CLI process cannot prove
it belongs to the original session. Treating its OS account or a dead PID as
proof can let another session adopt the run. Refusing every retry recreates the
startup defect.

**Evidence:** the original P01 proposed the existing claim token/revision as its
fallback. In [state-lock.mjs](../../skills/issueflow/skills/issueflow/scripts/lib/state-lock.mjs),
`claimController` creates a random token per command and deletes its ownership
file on release. In [run.mjs](../../skills/issueflow/skills/issueflow/scripts/lib/run.mjs),
`claimRunDir` claims the run file; it does not establish a durable host-session
continuation credential.

**Plan correction:** P01 now requires a persistent initialization claim and
host-held continuation identity, distinct from command leases. It defines
ambiguous recovery and tests separate-process restart, competing sessions and
crashes around token/claim publication.

### R02 — high: ordinary builds conflict with the verifier's input contract

**Failure scenario:** a correct build writes generated outputs and exits zero,
but verification rejects it as input tampering. Exempting ignored files to make
it pass would also weaken dependency integrity checks.

**Evidence:** [verification.mjs](../../skills/issueflow/skills/issueflow/scripts/lib/verification.mjs)
includes tracked, untracked and ignored files in `inputIdentity`, runs the green
command in the lane tree, and rejects a changed input hash. The original P03
proposed writable-output scheduling without specifying this semantic change.
Also, `safeRelative` in [contracts.mjs](../../skills/issueflow/skills/issueflow/scripts/lib/contracts.mjs)
rejects `.`, which P03 proposes as a valid check directory.

**Plan correction:** P03 defines read-only versus isolated-build modes, immutable
inputs, declared output roles and hashes, a cwd-specific validator, and correct
handling of directories absent from the regression base. Initial execution stays
sequential. Tests must accept legitimate output writes and reject source, test
or dependency mutation even when the command succeeds.

### R03 — high: the no-CI exception could turn unavailable evidence into approval

**Failure scenario:** a CI or policy lookup fails and a local no-CI setting lets
the controller advance. Separately, fixing the classifier alone still leaves
the CLI rejecting permitted optional-check failures.

**Evidence:** original P04 grouped “No checks or unreadable CI” under one
exception. [readiness.mjs](../../skills/issueflow/skills/issueflow/scripts/lib/readiness.mjs)
currently distinguishes unavailable evidence from an observed empty array.
`cmdReady` in [issueflow.js](../../skills/issueflow/skills/issueflow/scripts/issueflow.js)
also has independent red/pending checks after the readiness evaluator.

**Plan correction:** P04 separates successfully observed absence from lookup
failure, preserves remote requirements, and removes contradictory duplicate CLI
gates. Its acceptance cases now include a failed lookup with no-CI enabled and
the actual CLI path for permitted optional conclusions.

### R04 — high: a last-second read does not prevent a different head being merged

**Failure scenario:** the reviewed head changes after the final read and before
an action that triggers auto-merge. A later read detects the problem after the
irreversible action. The same risk can enter through normal-PR creation when
draft creation is unavailable.

**Evidence:** original P04 said a race invalidates the decision without defining
how the write enforces it. `prReady` in
[gh.mjs](../../skills/issueflow/skills/issueflow/scripts/lib/gh.mjs)
accepts only cwd/PR number and supplies no expected-head precondition. Local
controller serialization cannot constrain a separate remote writer.

**Plan correction:** P04 requires adapter capability discovery, provider-enforced
identity/check guarantees for merge-triggering actions, explicit handling when
those guarantees are unavailable, and reconciliation for uncertain writes.
Coverage includes creation, labels and prefix changes as well as readiness.
The key fault test changes the head after the final read but before the write.
This review does not claim a particular provider API supplies those guarantees;
the adapter implementation must establish and test them.

### R05 — high: “verified deployment” lacks an executable observation contract

**Failure scenario:** the controller marks an unrelated deployment complete,
retries a successful merge after losing its response, or removes the only
checkout needed for post-merge verification.

**Evidence:** original P05 proposed journaled merge/deployment continuation but
did not define provider operations or receipt validation.
[finish.mjs](../../skills/issueflow/skills/issueflow/scripts/lib/finish.mjs)
handles observed landings and cleanup; it is not a deployment executor. An
operation journal alone does not establish which deployed artifact was observed.

**Plan correction:** P05b specifies typed adapters, exact content/environment
identity, intent and uncertain-outcome states, validated provider observations,
and artifact retention. Missing adapters remain explicit pending obligations.
P05a delivers the immediate endpoint/handoff fix independently. Tests cover lost
responses, wrong-head merges, unrelated deployment success and premature cleanup.

### R06 — high: selective amendment reuse contradicts current receipt identities

**Failure scenario:** a seemingly unrelated scope addition reuses a receipt that
the next gate rejects because its global contract hash or attempt changed. A
looser workaround could instead accept obsolete verification. An exhausted run
could apply the amendment and then have no review capacity to finish it.

**Evidence:** `assertVerified` in
[verification.mjs](../../skills/issueflow/skills/issueflow/scripts/lib/verification.mjs)
binds the global contract hash, generation and attempt. In
[evolution.mjs](../../skills/issueflow/skills/issueflow/scripts/lib/evolution.mjs),
`evolveRun` clears the contract, attempts and lane verification while retaining
cumulative limits. The original P08 did not define a compatible reuse rule.

**Plan correction:** P08 initially invalidates all contract-bound lane evidence
when the global contract changes, propagates base/parent invalidation, and keeps
old receipts as history. It checks budget/review capacity before applying changes
and preserves unresolved findings. Fine-grained cross-contract reuse is deferred.
Acceptance includes unchanged code with a changed global contract and a fully
exhausted amendment rejected before effects.

### R07 — high: retargeting changes Git history and remote state, not only metadata

**Failure scenario:** changing the PR target leaves unrelated commits in scope,
or publishing a rewritten branch overwrites a concurrent commit. A crash between
the push and PR-base edit can leave local and remote state disagreeing.

**Evidence:** original P08 specified old/new base fields and evidence invalidation
without defining the Git transition. Current
[evolution.mjs](../../skills/issueflow/skills/issueflow/scripts/lib/evolution.mjs)
retains existing bases and refuses published runs; there is no published-retarget
transaction there to inherit.

**Plan correction:** P08 first proves whether target-only retargeting preserves
the intended scope. Otherwise it prepares and reviews the Git transition in a
disposable tree, records any rewrite cost and applicable authorization, requires
an expected-old-head conditional push, and reconciles push/base-edit effects
separately. Tests include unrelated ancestry, conflicts, remote head advance and
interruption. P02 owns base/cleanup primitives; P08 owns published retargeting.

### R08 — medium: schema rollout could strand runs and block the earliest fixes

**Failure scenario:** upgrading lets the new binary inspect a schema-3 run but
does not let it finish. Startup delivery also becomes coupled to later schema,
retarget and deployment work, while compatibility gaps surface only at release.

**Evidence:** original shared-state wording guaranteed inspection of old runs
and eligible schema-4 migration, leaving schema-3 continuation unspecified.
Current `loadRun` in [run.mjs](../../skills/issueflow/skills/issueflow/scripts/lib/run.mjs)
accepts schema 3 and 4. Original P02 assigned retarget wiring/tests to itself
although published retargeting belongs to P08, which depends on P02.

**Plan correction:** versioned legacy continuation is explicit, without upgraded
evidence claims. Schema capabilities arrive with their first implemented use;
unsupported commands fail before effects. Compatibility is checked per layer.
Delivery now separates immediate repairs/handoff from durable completion, and
removes the retarget dependency ambiguity.

### R09 — medium: the validation instructions cannot deliver the claimed campaign

**Failure scenario:** the documented harness command exits before running any
cases, or an offline foundation pass is reported as native end-to-end or speed
validation. Comparing different endpoints can manufacture a performance result.

**Evidence:** the original `npm ... run eval:harness` command was executed and
exited 2 because `--out` was missing.
[harness.mjs](../../skills/issueflow/skills/issueflow/evals/harness.mjs)
requires a new output directory and explicitly rejects native mode. Its comparer
states that live-agent performance is not measured.

**Plan correction:** P10 includes a runnable command with a fresh output path.
P09 requires a native driver or repeatable host procedure plus an importer,
smoke-tested before the pilot. Paired runs must share endpoints, inputs and
starting state; unsupported baseline capabilities are reported separately.
The stated three tasks and three pairs require 18 runs per host, including
failures. External experiments still need actual authorization.

## Validation and remaining limits

The corrected documented command ran successfully against the current checkout:
**12/12 offline foundation cases passed; six capability groups remain
unverified.** This validates the command and existing foundation coverage, not
the proposed fixes, native host behavior, GitHub races or deployment adapters.
No runtime implementation files were changed during this review.

Original plan SHA-256:
`e9ad8f3ff58a16f4a3c160223a39b42d78aefd929d6d595bb049c36cf483a702`.
The original plan snapshot and a 12-file code inventory were retained locally
under `/private/tmp/issueflow-review-20260912/redteam/`. The inventory file's
SHA-256 is `d0709e78cb07ff870b40feddbae122d0489b87cdc97e2343e0a58933d9387bd1`.
Those temporary files are supplemental; the source references and dispositions
above are the durable review record.

Proceed with baseline capture and P01. Before automatic completion is enabled,
P04/P05 must prove their provider capabilities and receipt contracts. Do not
mark any R01–R09 runtime behavior resolved merely because this revised plan
describes it; each requires its specified acceptance evidence.

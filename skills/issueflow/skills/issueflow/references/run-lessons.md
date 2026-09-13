# Lessons retained from actual runs

Use this when diagnosing a stalled run, changing a handoff, or adding regression
coverage. A lesson belongs in the controller or dispatched instructions and in a
reproducible test where possible. An external report alone does not change the
next run. Preserve observed limitations alongside fixes.

## #366: retained migration and repair handoffs

Source: `natejswenson/claude-skills#366`, draft PR #373, September 13, 2026.
Earlier completion trials used `natejswenson/fuzzy-boom-snicker`; this case is a
continuation of a retained run in the issue's owning repository. It migrated from
`dev` to `main` only after the user explicitly selected current repository policy.

| Failure observed | Maintained behavior | Permanent coverage |
|---|---|---|
| Legacy base no longer matched repository policy | Explicit migration may select an attributed base before implementation; retain old policy, state, findings, budgets and rounds | `scripts/tests/evolution.test.mjs` |
| Dirty working config contradicted committed policy | For explicit base migration, resolve policy from the selected committed base; preserve unrelated working edits | `scripts/tests/evolution.test.mjs` |
| Legacy blocked findings disappeared from the new ledger | Import unresolved findings without manufacturing approval or resetting rounds | `scripts/tests/evolution.test.mjs` |
| Rejected allowlist blocked required generated documentation | With no prior approved contract, derive fresh scope from the frozen issue and generator preflight; actual amendments retain their authority limits | `scripts/tests/evolution.test.mjs` |
| Delivered plan failed preflight and did not return to its author | Use the bounded send-back before consuming an independent review round | `scripts/tests/harness-lifecycle.test.mjs` |
| Cached PR target included already-landed changes | Fetch and verify head and target; bind review/context to the observed target SHA | `scripts/tests/harness-lifecycle.test.mjs` |
| Planner imported irrelevant fixture and scratch instructions | Start at root; select known contract scopes and load newly relevant guidance as paths become known | `scripts/tests/guidance-scope.test.mjs` |
| Verifier found a remaining merge-path defect but fixer received the original, already-fixed example | Lead with the latest registered verifier explanation and quote; keep original reproduction as history | `scripts/tests/fixer-handoff.test.mjs`, `evals/inputs/retry-366/fixer-handoff.json` |

The stale-target packet had 4,187 changed lines and five planned finders. The
correct packet had 502 changed lines and two finders. Three already-dispatched
workers were cancelled; the cancelled round retained its cost and cap usage.
This is an observed sizing correction, not a latency or dollar-savings claim.

The later handoff failure was observable in both artifacts and native behavior:
the verifier's current quote named `mergeThreadSources`, while the fixer saw the
old `normalizeSearchThreads` quote and prepared a not-changed disposition. Stop
the affected worker, record native termination, cancel its wave, fix the renderer,
and redispatch the generated brief. Retain the registered review and finding ID;
do not rewrite the verdict or buy another round to repair a broken handoff.

The frozen handoff JSON contains exact registered finding data, the review URL,
head, and hashes of the verifier output and bad brief. Its test failed against the
old renderer because the latest explanation was absent, then passed after repair.
Refresh this projection from the actual run with:

```sh
node evals/freeze-handoff.mjs --run-dir <canonical-run> --lane root --round 3 --finding f-a32800bf --brief <captured-bad-brief> --out evals/inputs/retry-366/fixer-handoff.json
```

## Planning and completion

Before plan approval, inspect CI requirements and workflow eligibility against
the requested endpoint. A draft endpoint can make auto-merge ineligible. PR-only
checks can pass while dispatch-only release jobs skip. Record exact, evidenced
optional conclusions in the reviewed contract; preserve required checks. A failed
automation job is not the same as an expected skip, and neither grants permission
to lift draft, merge, or edit unrelated workflows. Missing policy evidence stays
unknown. Published changes to the contract still require independent review and
retain cumulative limits; do not amend state merely to clear the CI gate.

Round four independently closed the remaining major at `55d403d` with no new
candidates. The actual completion gate then stopped: all 21 remotely required
checks passed, but the contract had no exceptions for `release`,
`label-release-pending` and `propagate` skips or the draft-related `auto-merge`
failure. This is code-review convergence with completion pending. The controller's
raw CI observation selected 33 check identities from 53 provider rows; report
which representation a count uses. Do not call an expected skip a required-test
failure or dismiss an automation failure without checking its log and eligibility.

Resume a CI stop with `next` after its cause is reconciled. A handoff must not
suggest `ready` when the endpoint excludes it. Review displays must name the
actual round, original allowance and recorded extensions separately; “round four
of at most two” obscures the authorized history. These presentation corrections
do not change capacity, CI decisions or endpoint authority.

Published amendment currently invalidates code-review and verification evidence
and refuses exhausted review capacity. A late CI-policy omission can therefore
need both independent amendment review and fresh code-review capacity. Preserve
the passing code review and prepare the concrete policy delta and its evidence
before asking for that recovery. This remains a completion-controller limitation;
do not reset rounds or silently amend the live contract to avoid it.

For input/evidence changes, plan proof through the public entrypoint, normalization,
duplicate-source combination, and final decision. Conflicts preserved by one helper
can be erased by the next. Vary duplicate-source ordering where relevant. Use the
existing issue scope; this lesson is not permission to redesign unrelated inputs.

The user later explicitly directed merging PR #373. That new instruction replaced
the earlier draft-only endpoint: record the updated intent and head-scoped merge
authority, then reconcile the provider-observed result. This run used a normal
user-directed GitHub merge with the reviewed head and all required checks passing;
`completion` observed the merge and `finish` cleaned the owned worktree. It does
not establish that the earlier autonomous CI gate passed or that the built-in
merge adapter gained atomic target-context support. Keep those distinctions in
the evaluation instead of asking again for permission already given.

## #367 and #368: immutable amendment recovery

Retained draft PRs #377 and #375 exposed three controller gaps: repeated
confirmation of a resolved plan finding demanded a second repair response; a
rejected review could not obtain a new immutable attempt; and amendment capacity
ignored an explicitly directed future code-review round. The controller now
preserves existing resolutions idempotently, archives rejected attempts before
an explicit quiescent retry, and records one future round with `amend --plan
... --another-round "<existing user decision>"`. Automatic `next` consumes that
round once, including on unchanged heads, without resetting cumulative counts.
Expired autonomous windows renew only within the original total time cap.

`scripts/tests/amendment-recovery.test.mjs` reproduces all four failures through
the public CLI for both host adapters. It uses synthetic prior run state and
review output with real local Git, immutable attempts, verification and controller
transitions; it does not establish native review quality or remote CI success.
CI freshness still advances at amendment application, including a CI-only change:
the retained old checks do not establish completion under the amended contract.

## Release CI: isolate controller credentials

PR #374's first GitHub run (34771030742) failed 13 of 557 tests after the same
suite passed inside Codex. CLI fixtures borrowed the live host's session locally;
CI had no session and correctly refused subsequent commands without the original
continuation credential. A local green result did not establish CI portability.

Give each multi-command fixture an explicit synthetic controller session and
remove inherited `CODEX_THREAD_ID`, `CLAUDE_SESSION_ID` and
`ISSUEFLOW_CONTINUATION_FILE`. Offline evals must own their synthetic identity too.
Run the suite with all four controller credential variables removed, and keep
hostile-credential coverage so an unrelated token file cannot take precedence.
Retain separate no-session continuation and cross-controller refusal tests;
never weaken runtime ownership to accommodate a fixture. Record both the failed
remote run and the repaired local/remote results rather than replacing history.

## Evaluation and reporting limits

- Controller checks and a fixer report establish only their observed results.
  An open major stays open until independent re-review or a recorded user ruling.
- A zero-finding probe is not a passing run. The first #366 capture examined only
  2 of 105 extracted clauses, leaving a coverage gap of 103. Fragmented rule
  extraction and wrapped/delegated test correlation remain eval limitations.
- Preserve raw transcripts, output receipts, source hashes and exact anchors.
  Resolve undecided claims against those receipts; do not grade session summaries
  or quietly convert unknown evidence into a pass.
- Report native workers separately from cumulative legacy lifecycle events.
  Missing usage and cost remain unknown. Count cancellations and failed attempts.
- Use the skill package as cwd for its tests, or `npm --prefix <skill-dir> test`.
  A module-not-found error from the wrong cwd is an operator error, not valid red
  proof. Correct malformed test fixtures before claiming a regression was caught.
- Freeze each controller version used in a live experiment. A run repaired during
  execution proves those observed recoveries, not unattended success of the
  starting candidate. Different bases and tasks do not establish a paired speedup.
- Codex-native evidence does not establish Claude-native execution quality.
  Preserve both hosts' automated compatibility checks and report native gaps.
- Keep completion pending while CI, independent review, or an authorized endpoint
  is unobserved. Put the exact remaining action and its actor in the handoff.

Repository-local campaign reports may carry more detail, but these instructions,
fixtures and tests travel with the installed skill. Raw captures outside the
plugin must be preserved before temporary-directory cleanup.

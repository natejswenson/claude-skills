# anatomy — the run directory and the state machine

A run is a directory, and the directory *is* the state. Nothing about a run
lives in the conversation, which is why an interrupted run resumes with
`issueflow next` rather than by remembering.

```
~/.claude/issueflow/<owner>__<repo>/issue-<n>/
  run.json                  the state machine — every stage, every lane, every review round
  inputs/issue.json         the issue and its comments, frozen at `start`
  briefs/<step>.md          the rendered dispatch prompt for each step
  briefs/review-investigate-r<k>.md          the red team's brief, per round
  briefs/<lane>-review-r<k>-finder-<n>.md    the pull request review loop's briefs
  briefs/<lane>-review-r<k>-verifier-<n>.md
  briefs/<lane>-fix-r<k>.md
  reviews/investigate-r<k>.findings.json     what the red team wrote
  reviews/investigate-r<k>.verdict.json      what the registrar bound it to
  shared/investigate.md     the plan — the one artifact that belongs to the ISSUE
  <lane>/                   artifacts of the stage that belongs to a CHANGE
    implement.md
    test-output.txt         the real, unedited suite output: the red run, then the green
    pr-body.md              written at ship
    review/r<k>/            one directory per pull request review round
      diff.patch            the whole change over its base, at the round's head — what threads anchor on
      fix.patch             round 2+: what the last fix changed — what the finders read first
      candidates-<n>.json   what finder n filed
      verdicts-<n>.json     what verifier n ruled
      registered.json       the registrar's record: ids, severities, transitions, verdict
      review-payload.json   exactly what was (or would be) posted
      fix-report.json       what the fixer did with each finding
  worktrees/<lane>/         the lane's own checkout, removed by `finish`
```

The run lives outside the target repo on purpose. It survives branch switches,
it never appears in `git status`, and the implement stage cannot lose it by
checking out a different branch.

## The two stages

| Stage | Claude | Codex | Owns | Artifact must contain |
|---|---|---|---|---|
| investigate | opus | GPT-6 Astra · high · explorer | the plan: root cause, evidence, unknowns, the approach and what was rejected, the files, the proof, the work items | Root cause, Evidence, Unknowns, Approach, Rejected, Files, Proof |
| implement | opus | GPT-6 Astra · high · worker | the change, its test seen red then green, its real output, its commits | Changed, Deviations, Command, Two-sided, Result |

Two, not four. Until 0.7.0 investigate and design were separate dispatches,
and so were implement and test. Measured across five real runs, a stage took
three to fourteen minutes of model time and the gate between two stages took
four to fifty-six — every stage boundary cost more than the stage. The plan
is one document now; the change is one dispatch that owes its own proof.

`investigate` is about the **issue**, so a split never duplicates it —
decomposing an issue does not mean re-deciding what it is. `implement` is
about a **change**, so every work item gets its own.

Claude runs both on opus; Codex runs both on GPT-6 Astra at high reasoning.
Investigation is where a wrong answer is cheapest to produce
and most expensive to discover. Implementation used to run on the faster
model because it was bounded by an approved document; it moved to opus when
the pull request review loop arrived, because a review round — finders,
verifiers, a fix, a re-review — costs more than the model difference, and a
stronger first implementation is the cheaper trade.

## The gate

`gateSteps()` is the whole ordering: the plan, then each lane's implement in
landing order. `blockers()` returns the earlier steps that are not
`approved`, and every advance goes through it.

```
pending ──brief──▶ briefed ──accept──▶ approved
   └─────────────skip (with a reason)──────────▶ skipped
```

**`skipped` is not `approved`.** A skipped stage stays a hole all the way to
`ship`, which keeps refusing and names it. That is the mechanism behind "a stage
that was skipped is reported as skipped, never as done" — without it, skipping
would be the one-line way to make the gate stop asking.

`accept` refuses every way a stage can look done without being done:

| Refusal | Because |
|---|---|
| an earlier step is not approved | the one rule |
| the artifact is missing or empty | a stage that produced nothing has nothing to approve |
| the artifact never names its required sections | the next stage would inherit a document that does not answer it |
| the plan has no registered red-team round | the plan is attacked before anyone approves it |
| on an auto run, the latest round is blocked, or the plan changed after it passed | a verdict binds to the bytes it read |
| `implement` has no evidence file, or none a runner wrote | a suite reported green with no output is the failure this skill exists to refuse |
| the evidence has no failing run before its passing one, or its only red is a load/import error | a test never seen red proves the suite runs, not that the issue is fixed — the separate test stage used to check this by eye; now the gate reads the whole file |
| the lane's tree has uncommitted paths | the pull request is opened from the commits, and uncommitted work is work the review never sees |

## The run's own lifecycle

```
in progress ──every gate step approved/skipped──▶ ready to ship
                                                         │
                                              ship (per lane, records lane.pr, opens a DRAFT)
                                                         ▼
                                                     in review ◀──┐  review rounds, bottom lane first
                                                         │        │  (finders → verifiers → registrar → post → fix)
                                          every lane converged ───┘
                                                         ▼
                                                      shipped        `ready` lifted each draft
                                                         │
                                        finish (per lane, once every lane merged)
                                                         ▼
                                                       done
```

`runState()` reads `remainingSteps()`, whether every lane has a recorded pull
request (`lane.pr`, written by `ship`), whether every lane's loop has
converged (`lane.review.converged`, written by `ready`) and whether the run
has been marked over (`run.finished`, written by `finish`).

## The review loop's record

`lane.review.findings` is the loop's memory. Each finding has an id assigned
once, at the round it was first registered, and every later round addresses
it by that id — fixed, still-open (with its new line), withdrawn, disputed.
`lane.review.rounds[]` records each round's head, fleet, transitions,
counts and verdict, and whether it was posted. From round 2 it also records
`fixLines` (what the last fix changed — the number the fleet was sized to),
`unverifiedNits` (candidates a finder proposed as nits, recorded and never
verified) and `autoFixed` (nits the fixer reported fixed, closed on its word).
The registrar's rules — what may post inline, when a nit may post, when a
plausible finding is a note, what "fixed" requires — are in
`scripts/lib/prreview.mjs` and described in `references/review-method.md`.

## Lanes and branches

Unsplit, a run has one lane — `root`, on `<prefix>issue-<n>`, targeting the
repo's base branch.

Split, it has one lane per work item. The bottom lane targets the base branch
and every layer above targets the lane below it, so each pull request's diff is
only that layer:

```
feature/issue-8-c ──▶ feature/issue-8-b ──▶ feature/issue-8-a ──▶ dev
```

Implements run up the stack as each lane below is approved. Review loops run
bottom-first: a lane above does not open its first round until the lane below
has converged, and is rebased onto it once, before any thread exists.

The base branch, the feature prefix and the merge method come from the target
repo's `.github/shipflow.json` when it has one, and otherwise from the repo's
actual default branch. A skill that hardcoded `dev` would work in exactly one
repo — and would open pull requests into a branch that does not exist in every
other one.

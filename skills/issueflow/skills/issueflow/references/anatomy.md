# anatomy — the run directory and the state machine

A run is a directory, and the directory *is* the state. Nothing about a run
lives in the conversation, which is why an interrupted run resumes with
`issueflow status` rather than by remembering.

```
~/.claude/issueflow/<owner>__<repo>/issue-<n>/
  run.json                  the state machine — every stage, its model, its state
  inputs/issue.json         the issue and its comments, frozen at `start`
  briefs/<step>.md          the rendered dispatch prompt for each step
  shared/                   artifacts of the stages that belong to the ISSUE
    investigate.md
    design.md
  <lane>/                   artifacts of the stages that belong to a CHANGE
    implement.md
    test.md
    test-output.txt         the real, unedited suite output
    pr-body.md              written at ship
```

The run lives outside the target repo on purpose. It survives branch switches,
it never appears in `git status`, and the implement stage cannot lose it by
checking out a different branch. Once every lane has landed, `finish` has
already removed the `worktrees/` directories — a finished run's `run.json`
still records everything that happened, but the checkouts it worked in are
gone.

## The four stages

| Stage | Model | Owns | Artifact must contain |
|---|---|---|---|
| investigate | opus | root cause, the files, what is unknown | Root cause, Evidence, Unknowns |
| design | opus | the approach, what was rejected, the proof, the work items | Approach, Rejected, Files, Proof |
| implement | sonnet | the change and its commits | Changed, Deviations |
| test | sonnet | the test, seen red then green, and its real output | Command, Two-sided, Result |

`investigate` and `design` are about the **issue**, so a split never duplicates
them — decomposing an issue does not mean re-deciding what it is. `implement`
and `test` are about a **change**, so every work item gets its own pair.

The models are not decoration. Investigation and design are where a wrong answer
is cheapest to produce and most expensive to discover, so both run on the
strongest model available; implementation and testing are bounded by an approved
document, which is the shape a faster model does well.

## The gate

`gateSteps()` is the whole ordering: the shared stages, then each lane's stages
in landing order. `blockers()` returns the earlier steps that are not
`approved`, and every advance goes through it.

```
pending ──brief──▶ briefed ──accept──▶ approved
   └─────────────skip (with a reason)──────────▶ skipped
```

**`skipped` is not `approved`.** A skipped stage stays a hole all the way to
`ship`, which keeps refusing and names it. That is the mechanism behind "a stage
that was skipped is reported as skipped, never as done" — without it, skipping
would be the one-line way to make the gate stop asking.

## The run's own lifecycle

The stage lifecycle above answers "is this one step done?" `runState()`
answers a different question — "is the *run* done?" — which nothing answered
before #219: two runs whose pull requests had already merged and whose issue
was already closed still reported `ready to ship`, forever, because nothing
recorded that `ship` or `finish` had ever run.

```
in progress ──every gate step approved/skipped──▶ ready to ship
                                                         │
                                              ship (per lane, records lane.pr)
                                                         ▼
                                                      shipped
                                                         │
                                        finish (per lane, once every lane merged)
                                                         ▼
                                                       done
```

`remainingSteps()` is unchanged and still means exactly what it always has —
"every gate step passed." `runState()` reads it, plus whether every lane has a
recorded pull request (`lane.pr`, written by `ship`) and whether the run has
been marked over (`run.finished`, written by `finish`). A run reaches `done`
only when every lane's pull request has been confirmed merged; a partially
landed split run stays `shipped` until the rest do too.

`accept` refuses four distinct ways a stage can look done without being done:

| Refusal | Because |
|---|---|
| an earlier step is not approved | the one rule |
| the artifact is missing or empty | a stage that produced nothing has nothing to approve |
| the artifact never names its required sections | the next stage would inherit a document that does not answer it |
| `test` has no evidence file | a suite reported green with no output is the failure this skill exists to refuse |

## Lanes and branches

Unsplit, a run has one lane — `root`, on `<prefix>issue-<n>`, targeting the
repo's base branch.

Split, it has one lane per work item. The bottom lane targets the base branch
and every layer above targets the lane below it, so each pull request's diff is
only that layer:

```
feature/issue-8-c ──▶ feature/issue-8-b ──▶ feature/issue-8-a ──▶ dev
```

The base branch, the feature prefix and the merge method come from the target
repo's `.github/shipflow.json` when it has one, and otherwise from the repo's
actual default branch. A skill that hardcoded `dev` would work in exactly one
repo — and would open pull requests into a branch that does not exist in every
other one.

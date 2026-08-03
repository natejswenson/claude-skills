# Changelog

All notable changes to the **issueflow** skill are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-08-03

Measured against a real run — `natejswenson/claude-skills#173`, 57m32s end to
end — and fixing what that run showed. Of those 57 minutes, 23m28s was subagent
time, 31m17s was human review, and **nothing at all reached GitHub**: no push,
no pull request, no issue comment.

### Added

- **Every state change is checkpointed.** `start`, `accept`, `split` and `ship`
  push the lane's branch and rewrite **one** comment on the issue — adopted by
  marker, so a run resumed on another machine edits the same comment rather than
  opening a second — carrying the run board, the lanes, and every approved
  artifact in a `<details>` block. A run now survives losing the machine it
  started on, and the issue rather than a terminal scrollback is the record of
  how the change was decided. A checkpoint failure is reported as a row and
  **never** rolls back an approval that really happened.
- **Reconciliation before every advance.** `accept` and `ship` ask GitHub what is
  true and refuse on a closed issue or a lane whose pull request already merged.
  On the measured run the change was merged and the issue closed *while the run
  sat at the implement gate*; four minutes later the run approved that stage and
  dispatched a subagent against a branch that no longer mattered.
- **`issueflow runs`** — every run on this machine, and what each is waiting on.
  A run whose directory you cannot remember is a run you cannot resume.
- **`brief --ready`** — every stage whose gate is open, for dispatch as N
  subagents in one message.
- **A git worktree per lane.** Concurrent lanes never share a checkout, and the
  test stage's revert-and-rerun proof stops running in the user's live tree —
  which is where it ran before, in a repo whose own CLAUDE.md warns that parallel
  sessions hold uncommitted work there.
- **Stage durations**, measured briefed-to-delivered so the model is not billed
  for the human's reading time, in the board and in a closing summary.

### Changed

- **The gate is a dependency graph, not a flat prefix scan.** It used to require
  every step listed above a stage, which made a lane's `implement` wait for the
  *previous lane's tests* — an edge that does not exist, and the reason the
  measured run's second lane never started. The real edges are declared in
  `dependencies()`. Two-sided by construction: a stacked lane still cannot be
  implemented before the lane it branches off, and a lane now can be implemented
  while the lane below it is being tested.
- **`accept` reports the facts the orchestrator used to shell out for** — branch,
  HEAD, commits over `origin/<base>`, whether the tree is clean, the parsed test
  result. The measured run made six ad-hoc `git`/`grep`/`wc` calls the CLI should
  have answered.
- **`start` prints the issue.** The measured run called `gh issue view` one
  second after `start`, for data `start` had already frozen to disk.
- **`split` reads the work items out of the approved design** rather than an
  items JSON file typed by hand — a second copy of a decision the user already
  signed off, which on the measured run differed from the artifact.
- `commitsAhead` compares against `origin/<base>` after resolving it, not a
  possibly-stale local ref.
- The run state schema is now `2`. A 0.1.0 run cannot be resumed; its artifacts
  are still on disk.

### Fixed

- **A required section had to be a heading, not a word.** The gate checked
  `text.includes('root cause')`, which "I could not determine the root cause"
  satisfied.
- **Evidence is read, not weighed.** A test stage that wrote `ok` cleared the
  old check. `accept` now finds a real runner's own summary — node `--test`,
  pytest, mocha, jest/vitest, `go test`, or a recorded exit code — and refuses
  when there is none. It reads the *last* result, so a two-sided proof's red
  half is not mistaken for a failure.
- **Slugs truncate on a word boundary.** A real run produced the branch
  `feature/issue-173-shipflow-refuses-the-ambiguous-f`.
- **The pull request body no longer publishes a local path.** It carried
  `/Users/<someone>/.claude/issueflow/…` into every pull request the skill
  opened.
- **A run pointed at a subdirectory no longer creates a branch in the enclosing
  repository.** `git` walks upwards to find a repo; the first offline eval run of
  this release left a stray `feature/issue-133` branch in claude-skills itself.

## [0.1.0] - 2026-08-02

### Added

- First release. Takes one open GitHub issue to a pull request through four
  gated stages — investigate and design on `opus`, implement and test on
  `sonnet` — each run as its own subagent, each writing one artifact, and none
  starting until the previous artifact has been approved.
- **The gate is code, not guidance.** `blockers()` orders every step, and
  `accept` refuses four distinct ways a stage can look done without being done:
  an unapproved predecessor, an empty artifact, an artifact missing the sections
  the next stage needs, and a `test` stage with no recorded command output.
  `ship` refuses to open a pull request over any unapproved step and names every
  one it found.
- **A skipped stage is never a pass.** `accept --skip "<reason>"` records the
  hole and requires a reason; `ship` keeps refusing and reports it as skipped.
- **Dispatch prompts are rendered, never improvised.** `brief` builds each
  stage's prompt from the run state and the approved artifacts and writes it to
  disk, so what crosses into a cold subagent is reviewable — and byte-compared
  by the baseline eval.
- **Automatic decomposition into stacked pull requests.** When the design stage
  reports work items, `split` gives each its own lane, branch, implement/test
  pair and pull request, with the bottom lane on the base branch and every layer
  above targeting the lane below it. Shared stages are never duplicated.
- **The target repo's branch policy is read, not assumed** — from its own
  `.github/shipflow.json` when present, and otherwise from the repo's actual
  default branch.
- Baseline eval pinned against a real run against `natejswenson/local-fitness#133`,
  re-run and byte-compared offline; a two-sided trap that drives a run whose only
  defect is a missing approval; and a four-stage contract corpus with an
  anti-vacuity floor.

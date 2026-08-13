# Changelog

All notable changes to the **issueflow** skill are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0] - 2026-08-13

A watched run used to be minutes of dead air (#223) — no progress signal
during a dispatched stage, `Took` renderable only after a human typed
`accept`, no sense of where the run stood at the moment a multi-minute wait
began, and `runs` naming an unresumable schema-1 directory `(unreadable run)`
with no reason and no remedy.

### Added

- **A stage's clock runs while the stage does.** `observe(dir, run)` fills
  `at.delivered` in memory from an artifact's mtime the moment it lands on
  disk — pure, never written to `run.json`; `accept()` remains the only
  writer, recording the identical value. `board(run, { now })` renders a live
  elapsed `Took` (`4m12s+`, a lower bound) for a stage that is still running,
  and a `delivered` display state for one whose artifact landed but has not
  been approved yet — `briefed` / `—` is no longer the entire liveness signal
  a reader has mid-stage.
- **`brief` says where the run stands and how long this usually takes here.**
  A position line (`Step 2 of 6 · 1 approved · investigate → [design] → …`)
  and a duration line — a range with a median from this repo's own past runs
  of the stage, sibling directories only, never a point estimate and never an
  invented number below two samples — print above the table, right before the
  wait begins.
- **A per-stage progress log.** Every brief's new `## While you work` section
  asks the subagent to append one short line to its own `progress/<step>.log`
  at real milestones. `status` gains a liveness block for every stage still
  briefed, showing `Since` (always populated, from the same clock as the live
  `Took`) and the log's last line and its age (`—` when the subagent never
  wrote one — the log enriches a row that already exists without it, it is
  never the only signal). Scratch work only: never quoted back to the
  subagent, never added to the public checkpoint comment.
- **`runs` says why an unreadable run is unreadable, and what to do about it.**
  A bound `catch` around `loadRun`'s already-actionable `RunError` replaces
  the bare `(unreadable run)` placeholder — the row keeps its directory name
  in `Title`, a truncated reason in `Next`, and the full reason plus remedy
  printed below the table, never inside a padded cell.

## [0.4.0] - 2026-08-13

A run's terminal state — found missing from a real replay of
`natejswenson/claude-skills#212` and `#215`: both fully-shipped runs still
reported "ready to ship" in `runs`, and `status` on issue-212 said *"Every
stage is approved — `issueflow ship` is the only step left"* directly under a
reality check that itself reported both lane pull requests already merged and
the issue closed. Watching the pull requests merge, removing the lane
worktrees, deleting the local branches, and closing the issue was manual
orchestrator work, done by hand twice in the measured session.

### Added

- **`issueflow finish [--close-issue]`.** Per lane: verifies the pull request
  merged (leaving the lane completely untouched otherwise — never shipped, an
  open pull request, or a `gh` failure are three different absences, none
  treated as a merge), removes the worktree, deletes the local branch with
  `git branch -D` (the merge GitHub confirmed is the stronger check `-d`'s
  local-reachability test cannot make), and records the landing. Idempotent
  and per-lane: a partially-landed split run finishes the lane that merged and
  completes on a later call once the rest do too. Refuses outright on an
  offline run — this is a question about GitHub, not an assumption to finish
  on.
- **`runState(run)`** — one function, replacing two independent re-derivations
  of `remainingSteps(run).length === 0` that both meant "ready to ship,"
  whether or not the pull requests had ever merged. `runs` and `status` now
  report `in progress`, `ready to ship`, `shipped`, or `done`. The run schema
  stays at `2`: `lane.landed`, `lane.pr` and `run.finished` are additive
  fields, defaulted on load rather than migrated, so the two runs this command
  exists to close remain readable.
- **`--close-issue`.** GitHub's `Closes #<n>` keyword only fires on a merge
  into the repository's *default* branch, and issueflow targets the policy
  base — `dev` in a shipflow repo — so the issue does not close on its own.
  Reports an already-closed issue as already closed rather than claiming an
  action it did not take.
- The sticky issue comment gains a conditional `Landed` table and a finished
  line, rendered only once a lane has landed — an unfinished run's comment is
  unchanged, byte for byte.
- `ship` now records the pull request it opened for each lane (`lane.pr`) —
  previously the URLs were printed and thrown away, so a run's own pull
  requests were absent from `run.json` even after `checkpoint.commentUrl` and
  `issue.url` were recorded.

## [0.3.0] - 2026-08-12

Three contracts that only lived in the orchestrator's head, written down —
found from a real replay of `natejswenson/claude-skills#212` and `#215`. No
runtime behaviour changes; the state machine is untouched.

### Changed

- **The test stage's `asks` now say what does not count as a red run.** On
  `#215`, a plain revert made the test file fail to *load* — one import error
  masked all six behavioural assertions, and the contract's old wording
  ("show it FAILING") was satisfied by that load error as written. The stage
  now says explicitly: a load or import failure is not a red run; construct a
  pre-fix state the file still loads against and watch each new assertion
  fail on its own claim; an assertion that passes pre-fix is a coincidental
  green, reported and not counted.
- **Every rendered brief now asks the subagent to send a completion
  message.** Across the two measured runs, 6 of 10 stage subagents went idle
  with a content-free notification and sent nothing, leaving the orchestrator
  to infer "idle = done." The brief's closing block is replaced by a
  `## When you are done` section: send `main` the artifact's path and a
  2–3 sentence result before finishing the turn. Deterministic wording, so
  it is the same instruction for every stage and every run.
- **Every documented invocation now pins `$SKILL_DIR`.** All 23 occurrences
  of the bare `node scripts/issueflow.js …` — 15 in `SKILL.md`, 8 in
  `skill-invariants.json` — become `node "$SKILL_DIR/scripts/issueflow.js" …`.
  A mid-run `cd` produced `MODULE_NOT_FOUND` against a fully absolute
  `--run-dir` on the measured run; the command needs no cwd and the docs now
  say so everywhere it is written.

## [0.2.1] - 2026-08-12

Fixed from a real run — `natejswenson/claude-skills#212` — where both test
stages wrote real, complete runner output and the accept gate refused both:
*"holds no runner result — no pass/fail summary and no exit code, so nothing
in it says a suite ran at all"*, over a file that said, in plain English, that
31 tests passed.

### Fixed

- **The accept gate now reads `node --test`'s `spec` reporter** (`ℹ pass N` /
  `ℹ fail N`), which is the default on Node ≥25 — even piped, so the old
  workaround of capturing through a pipe no longer produces the TAP form the
  gate already understood. 15 of the 19 skills in this repo run bare
  `node --test` with no `--test-reporter` flag, so this was the most natural
  capture of the repo's own most common test runner.
- **SGR-coloured summaries now parse, for every runner, not just `node --test`.**
  A capture made through a pty (`script`, `unbuffer`, some CI wrappers)
  wraps each summary line in colour codes; the gate strips them once before
  matching instead of teaching each runner's regex to tolerate them one at a
  time.
- **The refusal names what it actually could not find.** It used to claim
  *"nothing in it says a suite ran at all"* over a file that plainly said a
  suite ran; it now says which formats it can read, derived from the parser
  itself so the message cannot drift from what the gate actually does.
- **The test stage's brief now states the evidence contract up front**: save
  the runner's own pass/fail summary lines, unedited, plus a line recording
  the exit code — instead of a subagent discovering the requirement only after
  a refusal.

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

# Changelog

All notable changes to the **issueflow** skill are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.16.0] - 2026-09-12

### Added

- **New runs require a reviewed verification contract.** Schema-4 runs bind acceptance criteria, allowed paths, regression checks, full-suite checks and CI policy to the approved plan. The controller executes the checks and retains actual process results before accepting implementation or marking a PR ready.
- **Native workers have explicit attempts and recovery.** Immutable completion envelopes and parent-observed worker lifecycles distinguish completed work from interrupted or stale output. Cancelled work retains its history and must receive a fresh attempt.
- **Run evidence survives review and repair.** Remote-operation journals confirm GitHub effects by read-back, while review fixes require fresh verification at the reviewed commit. Review context and usage records retain provenance and report missing measurements as unknown.

### Fixed

- **A green-looking report can no longer substitute for executed checks in new runs.** Zero-test results, failing required suites, stale receipts and changed verification inputs refuse advancement. Missing CI requires an explicitly reviewed policy rather than silently counting as green.
- **Reopened plans cannot reuse their old approvals.** Pre-PR amendments and migration archive earlier evidence and require fresh independent review without resetting the original limits.

### Compatibility

- **Existing schema-3 runs retain their original evidence strength.** They are not silently upgraded or represented as strict verification. Explicit migration is limited to eligible, quiescent pre-PR runs. Claude configuration paths and shared plugin metadata remain supported.
- Live validation for this candidate focuses on Codex. No cross-host speedup, complete token/cost measurement, or arbitrary-code isolation is claimed.

## [0.15.0] - 2026-09-12

### Added

- **Codex Issueflow runs now have host-aware review policy and telemetry.** Codex runs can use their persisted host-specific review contract while recording the execution signals needed to make autonomous performance observable.

## [0.14.0] - 2026-09-11

### Added

- Add a scope allowlist and rough change-size budget to the investigation and
  implementation handoff, making unplanned files and scope growth explicit
  deviations.

### Changed

- Use Sonnet for Claude's high-fanout finder and verifier readers while keeping
  Opus for planning, red-team judgment, implementation, and escalated fixes.
- Stop a review lane for an explicit user decision when the same major survives
  two fix rounds, avoiding another unproductive repair fleet.

## [0.13.0] - 2026-09-10

### Added

- Codex runs now use bounded four-child dispatch by default, with role-sized
  reasoning so read-heavy work uses less expensive inference while judgment
  and persistent review findings retain stronger reasoning.
- Approved, independently mergeable work items can use `split --parallel`.
  The driver fans out ready implementation lanes and accepts fresh deliveries
  together without re-briefing completed work.

### Changed

- Operational issues covering CI, automation, installers, releases, and
  deployment now receive the deeper review and budget profile.
- Large review waves cap verifier batches at four, and deterministic driver
  transitions are bounded high enough for larger split runs.

## [0.12.0] - 2026-09-10

## Added

- Autonomous Issueflow runs now spend less time waiting between observed
  artifacts and stop stalled workers with an actionable re-dispatch prompt.
- Review effort is bounded by issue complexity, with explicit limits for fast
  documentation, standard, and deep work.

## Changed

- Ready pull requests now clearly identify the human approval and merge step;
  Issueflow never merges a pull request on the operator's behalf.
- Implementation gates reject blocked or incomplete result reports, and
  liveness checks ignore unrelated files from a containing parent checkout.

## Development notes (archived)

These implementation notes were incorporated into releases through 0.16.0.
They are retained as historical detail; the versioned entries above are the
release notes.

### Strict harness

- New schema-4 runs require a reviewed criteria/scope/check contract, controller-run
  red/green and full-suite receipts, and observed-scope risk escalation. Ignored
  runtime inputs are fingerprinted and copied locally into base snapshots.
- Add revision-conflict protection, controller ownership, immutable attempt
  envelopes, explicit cancelled-wave recovery, bounded repair, and conservative
  host-observed capacity. Repaired reports invalidate prior attempt receipts.
- Journal push, PR-create, checkpoint, review/thread/reply/resolve, summary, and ready intents with read-back. Bind readiness to the
  reviewed/verified head; absent CI needs a reviewed reason. Offline runs cannot
  claim remote readiness. Automatically reverify fixer commits before another review.
- Add source/guidance/plan/hash-bound review context caching, unknown-preserving host usage adapters,
  attempt-deduplicated telemetry, and explicit Claude/Codex native smoke commands.
- Add explicit pre-PR migration/amendment with archived evidence and fresh review,
  per-lane obligations, native worker observation, and quiescent review cancellation.
  Historical reviews cannot authorize amended plans, even with identical bytes.
- Preserve legacy evidence strength. Live cross-host lifecycle and paired speed
  validation remain open; these changes are not a release or an established speedup.

### Evaluation

- Add an offline harness evaluator with immutable source snapshots, pinned-commit
  baseline capture, independent regression/control oracles, both-host CLI fixtures,
  real plan/review corpus replay, process receipts, and JSON/Markdown reports.
  Failed and inconclusive evaluations return nonzero; selected-case coverage and
  unverified capabilities remain explicit. Offline timings make no agent-speed claim.
- Separate native Codex execution from the ordinary offline test suite. Native
  smoke runs now require `npm run test:native:codex`; missing host support fails
  the requested smoke instead of silently substituting a shell simulation.

- Correct telemetry's missing-duration coercion and aggregation. Unknown or invalid
  numeric usage remains unknown; known subtotals and missing-sample counts are
  explicit. Summed worker durations use `workerWallTimeMs`; end-to-end `wallTimeMs`
  remains unknown until an actual run interval is recorded.

### Fixed

- Keep Codex artifacts, progress, evidence and lane Git administration inside a
  host-approved workspace root. Archive exact outputs and Git history before
  state advances; validate generation ownership across resume, migration and cleanup.

- Stop on worktree provisioning or missing-checkout failures instead of silently
  dispatching against the live checkout. Validate existing lanes, persist explicit
  `--no-worktree` mode, and exclusively lease source checkouts across runs and lanes.

### Added

- Codex runs now default to four bounded concurrent child slots, with an
  explicit `--child-slots` override for hosts with different capacity.

### Changed

- Use Sonnet for Claude's high-fanout finder and verifier readers while
  retaining Opus for planning, red-team judgment, implementation and
  escalated fixes.
- Stop a review lane as a dispute when the same major survives two fix rounds,
  avoiding another unproductive fleet while preserving an explicit user route
  for an independently justified round.
- Add an implementation scope allowlist and rough line-budget check to the
  plan/implementation handoff so new files and scope growth become explicit
  deviations instead of silent expansion.

- Codex dispatch profiles use medium reasoning for read-heavy finders and
  first-pass fixers, high for judgment/implementation roles, and xhigh only
  when a major survives a fix.
- Documentation now matches the implemented CLI: unsupported
  `--autonomous` and `split --parallel` guidance was removed.
- Large review waves now cap verifier batching at four, matching the default
  Codex capacity and avoiding an unnecessary second verifier wave.
- Complexity routing gives CI, automation, installer and release issues the
  deep operational profile even when their issue body also mentions docs.
- Restore explicit `split --parallel` for approved independently mergeable work
  items, fan out all ready implementation lanes from `next`, and consume their
  deliveries before considering another brief.
- Raise the deterministic `next` driver guard to 64 transitions so larger
  split runs do not fail merely because they crossed the old small-run limit.

- Persisted complexity profiles with a fast documentation route, bounded review
  rounds, and a 15-minute budget for wording-only issues.
- Explicit approval checkpoints now identify the PR action required from the
  operator, and final review caps are selected from issue complexity.
- Implementation validation now runs targeted proof before the full suite,
  runs the full suite once after targeted green, and directs workers to deliver
  immediately afterward to avoid repeated broad failing runs.

## [0.11.1] - 2026-09-09

### Fixed

- Process delivered implementation, plan-review, verifier and fixer artifacts
  through their existing gates before budget expiry blocks new dispatches.
  Preserve delivery metadata and checkpoints, including on refused gates;
  report checkpoint failures without rolling back approvals.
- Guard direct briefing commands and gate send-backs before they mutate state.
  Keep in-flight workers eligible to complete after expiry.
- Show elapsed time, current allowance and remaining time in dispatch/wait
  output. Native completion proceeds directly to `next`; filesystem fallback
  waiting retains its freshness and stability checks.

### Added

- `resume --run-dir <run> --budget-seconds <positive-integer>` grants a fresh
  window only on explicit direction. It preserves artifacts, commits, review
  limits, runtime, gate state and checkpoint identity, validates its input,
  refuses active/completed runs, and never dispatches work itself.

## [0.11.0] - 2026-09-08

Issue #274 exposed a 50-minute run for an eight-line production change: six
subagents, repeated sandbox prompts for optional progress writes, and a
converged review that deadlocked when CI was red. This release turns that run
into permanent regressions and removes the avoidable work without weakening
the proof gates.

### Added

- Red-team findings now declare a disposition so implementation proofs and
  environment-limited checks do not trigger repeated plan rewrites.
- Repeated blocking mechanisms are detected and handed back for a decision
  before the review cap is spent.
- Scope-changing findings stop for a user decision instead of being
  auto-rewritten.

- `--review-plan` explicitly opts into the single human plan gate. Autoflow is
  autonomous by default; `--auto` remains a backward-compatible alias.
- Semantic review sizing discounts tests and generated artifacts while keeping
  every file visible to reviewers. Small behavior changes use one finder;
  workflow, auth, security, migration, permission, and manifest changes retain
  a two-finder floor.
- A permanent judgment eval reproduces the issue #274 converged-review/red-CI
  deadlock, and the always-loaded skill contract now has a 1,500-word/12 KB
  budget.

### Changed

- Codex planning uses GPT-5.6 Terra at high reasoning; Astra remains the
  independent red team and implementation model.
- Codex briefs no longer ask subagents to append optional progress files under
  `~/.claude`. Completion comes through native agent state, eliminating those
  repeated filesystem approval prompts.
- The 5,000-word entrypoint is now a compact operating contract; conditional
  recovery detail moved to `references/operator-stops.md`.
- The frozen baseline now isolates timing discovery from leaked temporary test
  runs, so interrupted suites cannot change later golden output.

### Fixed

- A converged review with failing CI now dispatches and accepts a bounded fixer
  instead of issuing an impossible fix brief and deadlocking the state machine.
  Once dispatched, its report, push, and follow-up review complete before a
  pending or green CI refresh can ready the changed head.
- `next` follow-up commands resolve the running CLI and shell-quote its path
  and the run directory. Printed commands now execute in fresh Claude or Codex
  shells without `SKILL_DIR`, including paths with spaces or shell characters.

## [0.10.0] - 2026-09-08

### Added

- **A persisted Codex runtime profile.** `start --runtime codex` records the
  host on the run and resolves every stage, red-team pass, finder, verifier and
  fixer to a Codex-native model, reasoning effort and role. Plans,
  implementations and verification use GPT-6 Astra; parallel read-heavy
  finders and first fixes use GPT-5.6 Terra; a fixer escalates to Astra at
  `xhigh` when a major survives a round. Existing and default runs remain
  Claude-shaped.
- **Codex-native briefs and dispatch output.** Codex briefs read the applicable
  `AGENTS.md` hierarchy and finish through the subagent's returned final
  response instead of addressing Claude's `SendMessage main`. Dispatch tables
  and `next` now carry `reasoning_effort` and agent role when the runtime
  supports them. The skill tells Codex to spawn parallel workers without
  serial waits and to run the filesystem wait through a yielded shell session.
- A two-sided runtime test freezes the Codex profiles and completion contract,
  rejects unknown runtimes, and confirms the default Claude contract still
  emits its original `SendMessage main` behavior.

### Changed

- Runtime-neutral public metadata and documentation now describe both Claude
  Code and Codex without promising Claude model aliases to Codex users.

## [0.9.0] - 2026-09-07

Round 1 reviews the change; every later round reviews the fix. Measured on
the two runs that prompted this (local-fitness #241 → PR #247 and #242 →
PR #248, both driven from one session): 102 subagent dispatches, about 1.1
billion context tokens, 83–94% of them in the pull request review loop. The
loop re-reviewed the whole pull request every round with five finders and
eight verifiers while the fixer grew it from 1286 to 3993 lines, the fixes
seeded the next round's majors (11 → 13 → 7 → 13), open nits piled up to 83
and were re-ruled every round by verifiers who refuted 5% of what they saw,
and #241's 477-line change spent forty dispatches over three rounds to find
one major a round. The instrument is checked in as `evals/measure-run.mjs`.

### Changed

- **Round 2 and after review the fix, not the pull request.** `review-brief`
  hands `openRound` the diff since the previous round's head; the fleet is
  sized to it — `clamp(ceil(lines/300), 1, 3)` finders, at most four
  verifiers, one finder under sixty lines — and the finders read it first from
  a new `fix.patch` beside `diff.patch`. The whole diff stays on disk and in
  the brief as reference for the cross-file and intent angles; round 1 already
  read it line by line. `diff.patch` still decides inline eligibility: GitHub
  anchors a thread on the pull request's hunks, not the fix's. A round whose
  delta is empty is refused — there is no fix to review. The round record
  carries `fixLines`, and the round table (`status`, the checkpoint comment)
  gains a `Fix Δ` column so the growth the loop pays to re-review is visible.
- **A prior nit is never re-verified.** After round 1 only open majors are
  verifier items; nits and pre-existing findings are still open by
  construction, whether or not the fix touched their file — the touched-file
  rule from 0.7.0 sent 51 priors to eight verifiers in round 4 of #242 and got
  41 "still-open" back. A nit the fixer reported fixed closes on the fixer's
  word at the next registration and its thread resolves: it never blocked, so
  a verdict on it buys nothing. A verdict, when one exists, still outranks the
  fixer's word.
- **A finder proposes a severity, and after round 1 only a proposed major is
  verified.** Candidates carry `proposed_severity: "major" | "nit"`; absent
  means major, so an unrated candidate is verified rather than dropped, and
  every candidate filed before this version still validates. A proposed nit in
  round 2+ is recorded on the round as `unverifiedNits` — never a verifier
  item, never registered, never posted. Round 1 verifies everything. The
  finder brief's "never rate severity" line is gone: the finder says what
  fails and whether it would call it a major; the verifier still rates what
  posts.
- **The fixer is briefed on majors only after round 1** (round 1 keeps nits
  with a one-line suggestion), and its rule now says to make the smallest
  change that removes each mechanism: nothing a finding does not name, no
  refactor around it, no re-captured benchmark or baseline unless a finding
  says the baseline is wrong, the named tests per fix and the whole suite
  once. The round-3 fixer on #242 ran 304 turns and 42 minutes.
- **`review-register` prints the majors and the transitions, not the ledger.**
  Nits, pre-existing and unverified-nit counts are one line; the full table
  is in the review body and `registered.json` as before. Printing eighty rows
  put ten kilobytes into the orchestrator's context every round. Round 1
  still prints every finding. SKILL.md's "paste the table" rule keeps its
  meaning. The finder's "Already open" block likewise lists the open majors
  and counts the rest.

### Added

- `evals/measure-run.mjs`: per-agent turns, context tokens, minutes and
  session-limit kills out of a Claude Code session transcript, with per-run
  and per-kind totals — the comparison for the next real run.

### Unchanged on purpose

- Round 1. A full review of the change is the product; it is the re-reviews
  that were paying for nothing.
- The frozen review-round golden. The replay opens its rounds without a fix
  delta and drives verification from the live plan, so the registrar's record
  and payload still reproduce byte for byte — the new rules are pinned
  two-sided in `prreview.test.mjs` instead.

## [0.8.0] - 2026-09-06

Parallel sessions on one repo. Working every open issue at once — one session
per issue, all on one machine, all against one checkout — had three ways for
one session to corrupt another: `start` overwrote a run another session owned
and then republished an empty board over that run's checkpoint comment, `board`
had no way to say an issue was taken, and a fresh lane was cut from whatever
`origin/<base>` the checkout last happened to fetch. All three were the same
missing idea: a run's identity is `owner/name#N`, and nothing ever asked whether
that identity was already claimed.

### Added

- `board` grows a `Run` column: a run's state when the run is on this machine,
  `claimed` when only a marker comment on the issue says another machine has it,
  `unreadable` when a run directory is there but `loadRun` refuses it, and `—`
  when nothing has it. It costs no extra `gh` call — the issue list already
  carries every comment body. A `--issues-json` board with no `--run-root` scans
  no run root at all, which is what keeps the frozen board hermetic.
- `start --take-over`, the one way past either refusal, for a human who has read
  the claim. Its own flag rather than a second meaning for `--force`; auto mode
  never passes it.
- `board --run-root <path>`, so the run scan can be pointed somewhere else.
- A finished run publishes `<!-- issueflow:finished -->` on its own line in its
  sticky comment. It is what tells a later `start` that the comment is a
  completed run's record rather than a live claim — so a reopened or
  twice-worked issue is not refused by its own old comment forever, and that
  record is never adopted and rewritten by the next run.
- `superseded/<timestamp>/` inside the run directory. A displaced run's plan,
  implementation artifact, evidence, review rounds and progress logs move there
  rather than being deleted, and `start` prints the path.

### Changed

- `--take-over` now costs more than a rewritten comment, and says so in
  `SKILL.md` and `--help`: it also removes the displaced run's worktrees and
  force-deletes its local branches with `git branch -D`, so a lane's unpushed
  commits go with them. That cleanup is what stops a taken-over run from
  reporting the displaced session's artifacts as its own delivered work, or
  silently continuing in its checkout, on top of its commits. A worktree
  `git worktree remove` refuses stays unregistered once its directory has
  moved aside, so the fresh run's `git worktree add` on the same path never
  meets "already registered". A `git remote` call that fails outright (lock
  contention, EMFILE) is fatal like a failed fetch, never silently tolerated
  as a warning that briefs the stage against the user's live checkout.

### Fixed

- `start` on an issue that already has a local run refuses (exit 4) instead of
  resetting it, and names the resume command. A run `loadRun` cannot read is
  refused with `loadRun`'s own reason and `--take-over`, never a `next
  --run-dir` that would fail for the same reason.
- `start` on an issue whose comments carry this repo's issueflow marker, with no
  local run, refuses and names the comment to read. Scoped to online
  invocations: an offline replay makes no `gh` call, so it can clobber nothing.
- The first write of `run.json` is an exclusive create, so two `start`
  invocations milliseconds apart cannot both write one — a read-then-write check
  is advisory, and the loser now loses to the filesystem.
- `brief` fetches the base before it cuts a lane's branch, with an explicit and
  forced refspec (`+<base>:refs/remotes/origin/<base>`) and one unconditional
  retry. A lane started after another session's pull request merged now contains
  that merge. A fetch that fails twice is exit 3 — infrastructure — while every
  other provisioning failure keeps its tolerated warning. Offline runs and
  checkouts with no `origin` skip it. So does a **stacked** lane: its base is
  the lane below it, a branch that lives only locally until that lane ships, so
  fetching it fails every time rather than only when stale.
- `start` on a local run marked finished starts fresh with no flag — `finish`
  already removed its worktrees and deleted its branches, so nobody holds it —
  **unless** a live claim is on the issue now, which outranks it and refuses
  like any other claim. A finished run's own dead comment is likewise never
  read as a stranger's claim.
- A finished run's comment is never adopted. A reopened issue's fresh run posts
  its own, so the completed run's pull request links, merge times and artifacts
  survive on the issue.
- The finished/claimed decision is anchored to the marker on its own line and
  read only outside the artifacts the comment splices in — an approved artifact
  that merely quotes the marker no longer hides a live run's claim.

## [0.7.1] - 2026-09-05

One pull request per issue is now the default. The first 0.7.0 run split
local-fitness#232 — four unrelated follow-ups of 180–520 lines — into four
stacked pull requests, because the only test a split had to pass was "each item
lands alone", and every small fix passes that. The maintainer folded them back
into one before merging.

### Changed

- The plan's ask: `## Work items` only when the whole change is too large to
  review as one (about five hundred changed lines, or a shared layer a reviewer
  must read alone), and its first line is `Why split: <the size or the layer,
  in numbers>`. Several small independent fixes are one pull request with one
  commit each, said so under Approach.
- `split` refuses a `## Work items` heading with no `Why split:` line, so a
  plan cannot fan out into lanes without stating why.
- The red team attacks the split before the items: small independent fixes
  split into lanes is a high finding.
- `references/decomposition.md` says which — nearly always not — with the #232
  numbers; SKILL.md carries the rule as a prose guardrail.

## [0.7.0] - 2026-09-04

The 0.6.0 dogfood ran 24 red-team rounds across 4 stages × 6 lanes and never
read the pull request back. Measured across five real runs, a stage took 3–14
minutes of model time and the gate between two stages took 4–56; every stage
boundary cost more than the stage, and the one thing a reviewer most wants — a
finding on the line it is about — did not exist. 0.7.0 is the redesign: two
stages, a red team on the plan only, one human stop, and a review loop on the
pull request that converges when only nits remain. Schema 3; a schema-2 run is
named unreadable by `runs`, with the remedy.

### Added

- **`next` — the driver.** One command computes the one next action from the
  run's state, performs every deterministic step it reaches (a brief, the gate,
  a registration, the split, the ship, a post, ready) and prints exactly one
  thing to do: a dispatch with its wait line, a wait, or a stop naming who must
  act. SKILL.md's flow is now "run `next`, do what it prints, repeat". Waiting
  is filesystem-observed — `until [ <output> -nt <brief> ]` under a timeout of
  3× this repo's median for the step — so a re-dispatch over an existing
  artifact does not fire instantly, no sentinel the subagent could forget is
  needed, and exit 124 is a stall. A refused gate is a send-back: the refusal
  printed, the brief re-rendered, exit 2.
- **The pull request review loop** (`review-brief`, `review-verify`,
  `review-register`, `review-post`, `review-fix-brief`, `review-fix-report`,
  `ready`). Each round: 2–5 opus finders sized to the diff (one under sixty
  changed lines), each dealt angles from the new `references/review-method.md`
  — Claude Code's own `/code-review` angles kept verbatim, plus a house
  `intent` angle that reads the diff against the approved plan and the tests
  against the issue; up to 8 opus verifiers ruling CONFIRMED / PLAUSIBLE /
  REFUTED with "REFUTED only when constructible from the code", and ruling
  fixed / still-open / withdrawn on every prior open major — and every prior
  nit whose file the fix touched; a nit in an untouched file is still open by
  construction and costs no verifier — with a quote at the new head (a moved
  line is still-open); the registrar in
  `scripts/lib/prreview.mjs`; one GitHub review per round through the
  pending-review flow (a refused anchor costs one thread, not the round), a
  thread per inline finding, a reply and a resolve on every prior thread; a
  fixer — sonnet, or opus once a major survived a fix — on every open major
  plus round-1 nits with a complete suggestion, one commit per round, a push,
  a fix report whose not-changed majors become disputes the next verifier rules
  on. Severity is `major | nit | pre-existing`; only majors block. Four rounds
  is the cap; at it the round-4 fix lands unverified and the user rules on each
  open major (`review-rule --finding <id> --fixed|--withdrawn --note "<what
  they checked>"`, refused before the cap and never issued by `next`) or buys
  round five with `review-brief --another-round "<why>"`. The first real loop
  reached the cap with two majors open in prose the round-2 fix had added, and
  had no way out.
- **Convergence as code.** Ids are assigned once and matched by id thereafter.
  Citations are classified against the diff's hunks including context lines:
  an outside-hunk major is body-only but still blocks. No new nit posts after
  round 1; nits are capped at five; cleanup angles cannot be majors; from
  round 2 a PLAUSIBLE major on a line the last fix did not touch is a note in
  the body, not a major. `ready` and `next` both refuse over an open major.
  The same major disputed twice hands the run back.
- **The red-before-green rule in `accept`.** `parseAllEvidence` reads every
  runner result in file order; `twoSided()` refuses a green-only file, a
  green-then-red file, and a red half that is only a load or import error.
  This is what replaced the separate test stage's pair of eyes. `accept` also
  refuses an implement whose tree has uncommitted paths.
- **Exit codes are a contract:** 0 · 2 a gate refused (send the work back) ·
  3 infrastructure (`gh`, git — retry) · 4 hand back to a person.
- `ship` opens drafts by default, with a `review-loop` label + `[reviewing]`
  title fallback where drafts are unavailable; `--no-draft` opts out. A
  stacked lane is rebased onto the lane below once, before its first round,
  and never after (`rebase`). `status` shows every lane's rounds and open
  findings.

### Changed

- **Two stages, not four.** `design` folds into `investigate` (one plan
  artifact: Root cause, Evidence, Unknowns, Approach, Rejected, Files, Proof,
  Work items) and `test` folds into `implement` (Changed, Deviations, Command,
  Two-sided, Result, plus the evidence file). `implement` runs on **opus**: a
  review round costs more than the model difference.
- **The red team attacks the plan, and only the plan.** Code is reviewed on
  its pull request. The plan cannot be approved before a round is registered
  on either path; a human may approve over a blocked round (that is what the
  human stop is for), the auto path may not.
- **Red-team findings are JSON** (`reviews/investigate-r<k>.findings.json`:
  `findings[{severity, cite, text}]`, `notExamined[]`, `verdict`), replacing
  the one-line grammar that refused a whole review over a backtick twice in
  twenty-four real rounds. A citation wrapped in backticks is a citation.
- `--auto` now means one thing: no human stop after the red-teamed plan.
- `split` refuses only once a lane has *delivered*, not once it was briefed —
  a `brief --ready` straight after the plan used to foreclose it forever.
- `markBriefed` archives a previous delivery's clock on a re-brief, so the
  expectation line stops folding review rounds into one duration and a
  re-dispatched stage no longer renders `delivered` off the old artifact.
- The baseline is re-frozen over the same real #133 inputs with the
  investigation and design merged into one artifact, and the real #132 review
  carried into the JSON shape with its text unchanged. New two-sided suites
  for the review loop (`prreview.test.mjs`) and the driver (`next.test.mjs`),
  and a **review-round golden** (`review-round.test.mjs`): two real rounds of
  the first real loop (local-fitness#236), frozen by `evals/freeze-round.mjs`
  with the real finders' candidates, the real verifiers' verdicts, the diff
  and every cited file at each head, re-registered against a rebuilt
  repository and byte-compared — record, payload, replies and resolves.

### Removed

- The `design` and `test` stages; three of the four per-stage red-team
  contracts; the one-line finding grammar; the eight-step auto-mode prose
  procedure.

## [0.6.0] - 2026-09-01

### Added

- **Auto mode — the red team replaces the human gate.** `start --auto` runs an
  issue to a pull request with no per-stage human approvals: each delivered
  artifact is attacked by a dispatched opus red-team reviewer, sent back with
  cited findings until a round finds nothing blocking, and only then approved.
  The user reads the run — every findings table, every round, the board at
  every gate — instead of driving it.
- **`review` — the registrar.** A red-team review only counts once `review` has
  parsed its findings against a strict one-line grammar, resolved every
  citation against something that exists (`path:line`, `<artifact>.md §
  Heading`, or `diff:<path>`), derived the verdict from the severities
  (critical/high block; medium/low are notes), and bound it to the sha of the
  artifact — and, for code stages, the commit — it reviewed. One unresolvable
  citation refuses the whole review.
- **`accept --auto`** — a narrower gate, never a bypass: every human-path
  refusal still runs, plus a missing/blocked review, an artifact edited after
  its review, and a branch that moved under a code review all refuse.
- **`brief --review`** — renders the reviewer's brief like any stage brief:
  cold-start, the artifact under attack, the citation grammar, the SendMessage
  completion contract, on disk where the baseline can pin it.
- **The feedback seam.** A stage refused by the red team re-briefs with a
  `## Review feedback — round N` section carrying the blocking findings and the
  path to the full review — before this, a refused stage re-briefed
  byte-identically and the refusal existed only in the conversation.
- **The rounds cap.** Three blocked rounds on one stage stop the run: `brief`
  and `review` refuse a fourth attempt, and the open findings surface to the
  user. Never auto-ship over an open blocking finding; auto mode never touches
  `--force`.
- Four reviewer contracts frozen to the baseline (`review-<stage>.json`, floor
  4, opus asserted per reviewer), plus a frozen review brief and hash-bound
  verdict re-run and byte-compared, and three new traps: an uncited finding
  refuses registration, auto-accept refuses every unbound shape, and an
  exhausted stage cannot be briefed, approved, or shipped.

### Changed

- The checkpoint comment and pull request body tell the truth about who
  approved: on an auto run the "approved by a human" sentence is replaced by
  the red-team wording, and both gain review-round tables — conditionally, so
  a gated run's rendering is byte-identical to 0.5.0.

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

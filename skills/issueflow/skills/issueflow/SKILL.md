---
name: issueflow
description: Work a GitHub issue from open to pull request — one high-capability subagent plans it (root cause through work items), a red team attacks the plan, you approve it once (or never, with --auto), one implementation subagent builds it with a two-sided proof, the pull request opens as a draft, and a review loop of finders, verifiers and a fixer posts inline findings and re-reviews every fix until no major remains. Use when the user says "work an issue", "list open issues", "what issues are open", "pick an issue to work on", "fix issue 42", "take this issue to a PR", "review my PR until it's clean", "work this issue autonomously", "auto mode", or "no approvals, just ship it". Lists the open issues in the repo as a pick-table, splits an issue too big for one change into stacked work items, and opens the pull requests into dev following the repo's own branch policy.
user_invocable: true
version: 0.10.0
---

## Codex runtime

When running in Codex, invoke this skill as `$issueflow`. Resolve scripts, assets,
and references from the directory containing this SKILL.md, regardless of the
current working directory. Existing `~/.claude/` personal-data paths remain valid
and are still used by the bundled scripts; they do not require Claude to run.

Pass `--runtime codex` to `start`. The run persists that choice, and every later
brief prints a Codex-native model, reasoning effort and role. Map them directly to
the delegation call's `model` and `reasoning_effort`; use the role to choose the
task name and describe its job. Codex dispatch profiles are:

| Work | Model | Reasoning | Role |
|---|---|---|---|
| plan · red team · verifier | `gpt-6-astra` | `high` | `explorer` / `default` |
| implementation | `gpt-6-astra` | `high` | `worker` |
| finder · first fix | `gpt-5.6-terra` | `high` | `explorer` / `worker` |
| fix after a major survives | `gpt-6-astra` | `xhigh` | `worker` |

Use Codex's delegation tools for every required subagent. Give each a unique,
short task name and the exact one-line prompt the CLI prints. When several are
independent, spawn all of them without waiting between calls; Codex has no Claude
multi-call message requirement. A Codex subagent's final response returns to its
parent automatically, so its brief asks for a final summary instead of
`SendMessage main`; the artifact on disk remains the state machine's signal.

Run the printed `wait:` command as a yielded shell process, retain its session id,
and poll it while keeping the user updated. Do not block the conversation in one
long foreground call. For a human stop, ask the concise question in chat only
after showing the plan and review. Discover connected apps by capability rather
than assuming Claude MCP tool names exist.

# /issueflow — one open issue to a pull request, driven by `next`

You are running the **issueflow** skill. It turns "work an issue" into a
reviewed pull request: a plan, a red team on the plan, one human stop, an
implementation with its own proof, a draft pull request, and a review loop on
that pull request that converges when only nits remain.

**Announce at start:** "I'm using the issueflow skill — plan, red team, implement, then a review loop on the pull request."

> Commands below run from the directory containing this `SKILL.md` (`$SKILL_DIR`).
> Resolve it once. Pass `--repo <path>` to work against the user's repo.

## The one rule

**No stage runs on anything but its predecessor's artifact, approved and
written to disk — and a stage that was skipped is reported as skipped, never
as done.**

Everything here is downstream of that. The gate is not a habit the orchestrator
is trusted to keep; it is `blockers()` in `scripts/lib/run.mjs`, and `accept`,
`brief` and `ship` all refuse through it. If you find yourself wanting to
proceed without an approval, the answer is to ask for the approval — never to
work around the refusal.

The plan's approval has a human in it by default: you read the red-teamed plan
and say yes. With `--auto` the red team's registered pass is the approval. Code
has no human gate either way — its gate is the review loop on the pull request.

## What is code and what is judgment

The split is declared in `skill-invariants.json` and checked — a deterministic
step whose command does not exist fails `skillfactory verify`.

| Deterministic — the machine decides | Command |
|---|---|
| compute the one next action from the run's state, perform every deterministic step it reaches, and print a dispatch, a wait, or a stop | `node "$SKILL_DIR/scripts/issueflow.js" next` |
| read the open issues and the repo's branch and pull request policy | `node "$SKILL_DIR/scripts/issueflow.js" board` |
| fetch the chosen issue and its comments to disk and open the state machine | `node "$SKILL_DIR/scripts/issueflow.js" start` |
| render a stage's or the red team's dispatch prompt, model and subagent type from the approved artifacts | `node "$SKILL_DIR/scripts/issueflow.js" brief` |
| enforce the gate — required sections, the red-before-green evidence rule, a clean tree, a registered red-team round | `node "$SKILL_DIR/scripts/issueflow.js" accept` |
| register a red-team review of the plan — validate every citation, derive the verdict from the severities, bind it to the plan's hash | `node "$SKILL_DIR/scripts/issueflow.js" review` |
| expand an approved plan's work items into stacked lanes | `node "$SKILL_DIR/scripts/issueflow.js" split` |
| push the branches and open the pull requests as drafts under the repo's own policy | `node "$SKILL_DIR/scripts/issueflow.js" ship` |
| open a review round — the diff at the pushed head (from round 2, the fix since the last round), the finder briefs sized to it | `node "$SKILL_DIR/scripts/issueflow.js" review-brief` |
| pool the candidates, add every prior open major, brief the verifiers | `node "$SKILL_DIR/scripts/issueflow.js" review-verify` |
| the registrar — assign ids once, classify every citation against the diff's hunks, apply the convergence rules, bind the round to its head | `node "$SKILL_DIR/scripts/issueflow.js" review-register` |
| post one GitHub review per round — a thread per inline finding, a reply and a resolve on every prior thread | `node "$SKILL_DIR/scripts/issueflow.js" review-post` |
| brief the fixer on every open major, with the red CI checks | `node "$SKILL_DIR/scripts/issueflow.js" review-fix-brief` |
| record the fixer's report and reply on the threads; a not-changed major is a dispute | `node "$SKILL_DIR/scripts/issueflow.js" review-fix-report` |
| lift the draft once the loop has converged and CI is green | `node "$SKILL_DIR/scripts/issueflow.js" ready` |
| report the state of an interrupted run so it resumes without guessing | `node "$SKILL_DIR/scripts/issueflow.js" status` |
| list every run on this machine | `node "$SKILL_DIR/scripts/issueflow.js" runs` |
| verify each lane's pull request merged, remove its worktree, delete its local branch, and mark the run done | `node "$SKILL_DIR/scripts/issueflow.js" finish` |

| Model judgment — nothing on disk answers it | Why |
|---|---|
| what the issue actually asks for, its root cause, and the plan to fix it | an issue is a person's description of a symptom; nothing on disk says which code causes it, whether the reporter asked for the right fix, or which of two working approaches is the better one |
| whether this issue is one change or several, and where the seams fall | **One pull request per issue is the default**; a split is for a change too large to review as one, and size signals suggest it without locating it — only reading the code tells you which layers a reviewer needs apart |
| the implementation, and the test that proves it | matching a codebase's idiom is imitation no rule set encodes, and only reading the issue against the assertions says whether they test the reported behaviour |
| what the plan missed — the red team's hunt | the registrar checks that a finding cites something real; only a reviewer reading the plan finds the alternate root cause nobody ruled out or the file the plan forgot |
| what the diff gets wrong — the finders' hunt | the registrar knows which lines are in a hunk; only a reader knows which one is off by one |
| whether a candidate is real, and whether a fix fixed it — the verifier's ruling | CONFIRMED, PLAUSIBLE and REFUTED are judgments about behaviour; the code enforces only that each is made, quoted, and made about a line that exists |
| how to change the work so a finding no longer holds — the fixer's change | the finding names the failure; the fix is the fixer's |
| whether the plan is good enough to approve | this is the user's call and the whole point of the human stop — or, on an auto run, the red team's, registered and hash-bound |

## The flow — run `next`, do what it prints, repeat

```bash
node "$SKILL_DIR/scripts/issueflow.js" board --repo <path>       # once: which issue
node "$SKILL_DIR/scripts/issueflow.js" start --repo <path> --issue <n> [--runtime codex] [--auto]
node "$SKILL_DIR/scripts/issueflow.js" next --run-dir <run>      # then this, every turn
```

`board` shows every open issue and the repo's branch policy read from its own
`.github/shipflow.json`. **Never ask about anything in it** — the base branch,
the feature prefix and the merge method are facts, and a confirmation is not a
question. Show the table and ask one thing: which issue. If the user already
named one ("fix issue 42"), skip straight to `start`.

`start` freezes the issue to disk, opens the state machine, prints the issue,
and posts the run's comment on the issue. **Never call `gh issue view` after
it.** Pass `--auto` when the user asked for no approvals — it removes the one
human stop; nothing else changes.

From there the loop is one command. `next` performs every deterministic step it
can — a brief, the gate, a registration, the split, the ship, a post — and then
prints exactly one of four things:

```
next: dispatch (brief)                 ← start the subagent(s) printed above it, in the background
  …
wait: sh -c 'end=$(( $(date +%s) + 1800 )); until [ <output> -nt <brief> ]; do [ $(date +%s) -ge $end ] && exit 124; sleep 5; done; <…then until the output's size has held still for 20s>'
then: node "$SKILL_DIR/scripts/issueflow.js" next --run-dir <run>

next: wait                             ← something is in flight; run the wait line, then next
next: stop — human | exhausted | drift | dispute | stalled | unpushed | shipped | done
next: run …                            ← (only mid-output: a step next performed itself)
```

**On `dispatch`:** start exactly the subagents printed, on exactly the model and
reasoning effort named, with exactly the one-line prompt given — in the
background. In Claude, dispatch several in one message; in Codex, spawn them in
immediate succession without waiting between calls. Say one short lowercase line
about what is running and the expectation `brief` printed ("this usually takes
about N minutes here"). Then run the `wait:` line with the host's yielded or
background shell mechanism. When it returns, run `next`. **Never dispatch a
stage on a model or reasoning effort other than the one `brief` names.** **Never
do a stage's work yourself** — an orchestrator that investigates "quickly, to
save a dispatch" has collapsed the isolated contexts into one and thrown away
the only thing this shape buys.

**On `wait`:** run the wait line, then `next`. The wait is filesystem-observed —
output newer than the brief that dispatched it — so a Claude stage's
`SendMessage`, or a Codex subagent's returned final response, is information,
never the signal. If the wait exits 124 the stage has stalled;
`next` says so and prints the same prompt to re-dispatch.

**On `stop`:** read the reason. `human` is the plan gate — `Read` the plan and
the review it names, show the user what matters (the root cause, the approach
and what was rejected, the files, the proof, the work items, and every finding
the red team left), then ask plainly whether to approve, and run the command
`next` printed once they do. `exhausted` on a review loop names the open
majors and the two commands only the user runs (a ruling, or one more round);
show them the fixer's last commit and each thread, not a summary. `exhausted`
on the plan, `dispute`, `unpushed`, `stalled` and
`drift` each name what is unresolved; put it in front of the user and stop —
**never advance over drift you have not shown the user**, and `--force` is for
after they decide, never before. `shipped` means every pull request is ready
for review; `done` means every lane landed.

**On a refused gate** (`next` exits 2 and prints `gate refused: …`): the stage
goes back. `next` has already re-rendered the brief; dispatch the prompt it
printed with the refusal appended — **never edit an artifact to get past the
gate.** Those refusals are the product: an artifact missing its sections, an
evidence file with no red run before its green one, a tree with uncommitted
work, a plan nobody has attacked.

Exit codes are a contract: `0` fine · `2` a gate refused, send the work back ·
`3` infrastructure (`gh`, git) — retry · `4` a person must act.

### What the loop does, so you can narrate it

1. **Plan.** One high-capability subagent from the run's runtime profile
   investigates and plans: root cause, evidence,
   unknowns, approach, rejected alternatives, files, proof, work items.
2. **Red team.** One high-capability subagent attacks the plan and writes JSON findings;
   `review` registers them — every citation must resolve, the severities decide
   the verdict, the verdict binds to the plan's hash. Critical and high block;
   the plan goes back with the findings, up to three rounds. **In this stage
   the red team is the gate, and it is a dispatched subagent — never you.**
3. **The human stop** (unless `--auto`): you read the red-teamed plan and
   approve it, or send it back. A plan with work items splits into stacked lanes
   the moment it is approved — and work items are the exception, for a change
   too large to review as one; several small fixes in one issue are one pull
   request with a commit each.
4. **Implement**, one implementation subagent per lane, up the stack: the change, the
   test seen red then green, the real output, the commits. `accept` reads the
   whole evidence file and refuses a green-only run, a green-then-red run, and
   a red that is only a load error.
5. **Ship.** Every lane's pull request opens as a draft (or, where drafts are
   unavailable, labelled `review-loop` and titled `[reviewing]`).
6. **Review loop**, bottom lane first. **Round 1 reviews the change; every
   later round reviews the fix.** Round 1: 2–5 finder subagents (one under sixty
   changed lines), each dealt angles from `references/review-method.md`; up to
   8 high-capability verifiers ruling CONFIRMED / PLAUSIBLE / REFUTED on the candidates.
   Round 2 and after: 1–3 finders sized to the diff since the last round's
   head, which they read first (the whole change is reference); up to 4
   verifiers ruling on the candidates the finders proposed as majors and
   fixed / still-open / withdrawn on every prior **major** — a prior nit is
   never re-verified (still open by construction; one the fixer reported fixed
   closes on its word), and a candidate proposed as a nit is recorded, never
   verified or posted. Then the registrar; one GitHub review with a thread per
   inline finding; then a fixer (the runtime's efficient profile, escalated to
   its strongest profile once a major survived a fix)
   on every open major — and, in round 1 only, nits with a one-line
   suggestion — the smallest change that removes each mechanism, one commit
   per round, a push, a fix report. **Paste the round's table
   `review-register` prints into the conversation — the open majors and this
   round's transitions, not a summary of it**; the nits are counted, and live
   in the review body. The loop converges when no major is
   open — nits may remain — and `ready` lifts the draft once CI is green. Four
   rounds is the cap: the round-4 fix lands unverified and `next` stops
   `exhausted`. The user reads that fix and each open thread, then rules per
   major with `review-rule --finding <id> --fixed|--withdrawn --note "<what
   they checked>"`, or buys round five with `review-brief --another-round
   "<why>"`. Both are the user's commands — `next` never prints them as a
   dispatch, and you never run them on your own judgment.
7. **Finish**, once the pull requests merge: worktrees removed, branches
   deleted, the issue closed with `--close-issue`.

**Every state change is checkpointed.** `start`, `accept`, `review`, `split`,
`ship`, `review-register` and `ready` rewrite one comment on the issue carrying
the board, the lanes, the rounds and every approved artifact, and push the
lane's branch. If a checkpoint row says `failed`, say so plainly: the state is
recorded locally and the run is **not** backed up.

**Report the pull request URLs `ship` returned, and the review URL `review-post`
returned. Never claim a result you did not observe** — a pull request URL comes
from `ship`, a converged loop from `ready`, a merge from `finish`.

## Rules that are not negotiable

- **No stage runs on anything but its predecessor's artifact, approved and written to disk — and a stage that was skipped is reported as skipped, never as done.**
- **Every state change is checkpointed.** A run that exists only on this machine is a run one crash away from having produced nothing.
- **Never advance over drift you have not shown the user.** If `next` stops on drift, that is the answer — `--force` is for after they decide, never before.
- **Never dispatch a stage on a model other than the one `brief` names.**
- **Never do a stage's work yourself.**
- **Never edit an artifact to get past the gate.** Send the stage back.
- **Never claim a result you did not observe.**
- **In the plan stage the red team is the gate, and it is a dispatched subagent — never you.** A reviewer that shares your context has already been told the conclusion it was sent to attack. The same holds for every finder and verifier on the pull request.
- **Never weaken a review to clear a finding.** Round 3 is exactly when fixing the reviewer becomes cheaper than fixing the work; the work is what gets fixed. The fixer disputes by saying why, once — it notes the skip rather than arguing with it — and the next verifier rules.
- **Never ready a pull request over an open major.** `ready` refuses; so does `next`. Only "no majors open" converges a lane, and only a human decides what happens to a lane the cap stopped.
- **Never auto-ship over an open blocking finding.** An exhausted plan surfaces its findings and the run stops there.
- **A round never reviews code GitHub has not received.** `review-brief` refuses when the local head, the remote head and the pull request's head disagree.
- **Auto mode never touches `--force`.** Drift stops an unattended run; the flag is for a human who has re-read what moved.
- **Never `--take-over` a claim you have not read.** It republishes an empty board over that run's comment on the issue, removes the displaced run's worktrees, force-deletes its local branches with `git branch -D` — so any commit that lane never pushed goes with them — and moves every artifact that run wrote into `superseded/<timestamp>/` inside the run directory. Auto mode never passes `--take-over`.

## Parallel sessions

One session per issue, all on one machine, all against one checkout, is a
supported way to work — every run has its own directory, every lane its own
worktree and branch, and every issue its own sticky comment. Three things make
it safe, and all three are the CLI's job, not yours:

- **`board` says who already has an issue.** The `Run` column reads a run's
  state when that run is on this machine, `claimed` when only a marker comment
  on the issue says another machine has it, and `—` when nothing has it. Pick a
  free one, or resume the run it names with `next --run-dir <path>`.
- **`start` refuses an issue that is taken** and exits 4, rather than resetting
  a run somebody else is in the middle of and republishing an empty board over
  their checkpoint comment. `--take-over` is the one way past, and it is for a
  human who has read that comment. A **finished** run is the one exception:
  `finish` already removed its worktrees and deleted its branches, so a
  reopened (or twice-worked) issue starts fresh with no flag needed, and its
  own dead marker comment is never read as a stranger's claim — unless a live
  claim is on the issue now, which outranks it and refuses like any other.
  Either way the displaced run's artifacts move to `superseded/<timestamp>/`
  rather than being deleted, and `start` prints where they went.
- **A lane is cut from the base as it is now.** `brief` fetches the base before
  it creates a branch, so a lane started after another session's pull request
  merged contains that merge. A fetch that fails is exit 3 — infrastructure,
  retry — never a lane quietly built on last week's tree.

## Commands

| Command | Returns |
|---|---|
| `next` | the one next action, having performed every deterministic step before it: a dispatch with its wait line, a wait, or a stop naming who must act |
| `board` | every open issue as a pick-table, plus the repo's resolved branch policy — the `Run` column says who already has each issue |
| `start --issue <n> [--runtime claude\|codex] [--auto] [--take-over]` | the frozen issue on disk, the issue itself, the state machine, the run board, and the run's comment posted on the issue — runtime defaults to Claude and is persisted; `--auto` removes the human stop after the plan; `--take-over` is the only way past a claim |
| `brief [--stage] [--lane] [--review]` | a stage's, or the red team's, model, agent, artifact, worktree and the exact dispatch prompt |
| `review --stage investigate` | registers a red-team review of the plan: validates every citation, derives the verdict, hash-binds it, prints the findings table and the coverage gap |
| `accept [--stage] [--lane] [--skip] [--force] [--auto]` | the gate: records an artifact and its approval, or refuses and says why — plus the verification table and a checkpoint |
| `split` | one lane per work item read from the approved plan, each stacked on the one below |
| `ship [--dry-run] [--no-draft] [--force]` | a pushed branch and a draft pull request per lane |
| `review-brief --lane` · `review-verify --lane` · `review-register --lane` · `review-post --lane` · `review-fix-brief --lane` · `review-fix-report --lane` | one review round, step by step — `next` runs them in order |
| `ready --lane` | the draft lifted, the summary comment posted, the lane converged |
| `rebase --lane` | a stacked lane rebased onto the lane below it, before its first round |
| `status` | the run board with a live elapsed time for any stage still running, every lane's rounds and open findings, what has drifted on GitHub |
| `runs` | every run on this machine, with what it is waiting on |
| `finish [--close-issue]` | per lane: the merge verified, the worktree removed, the branch deleted, the landing recorded — and, once every lane has landed, the run marked `done` |

`--offline` suppresses every network call and the checkpoint. It is for the
evals; a real run should never pass it.

## Requirements

- **`gh`, authenticated**, with read access to the repo's issues and write access
  to open pull requests and post reviews on them.
- **A git repo with a GitHub remote.** Everything is resolved from it — the
  owner, the name, the default branch and the branch policy.
- **Subagent dispatch.** Every stage, every reviewer and the fixer run as their
  own subagent; without that this is a checklist, not a pipeline.

## What's here

| Path | Is |
|---|---|
| `scripts/issueflow.js` | the CLI: `next`, `board`, `start`, `brief`, `accept`, `review`, `split`, `ship`, the six `review-*` commands, `ready`, `rebase`, `status`, `runs`, `finish` |
| `scripts/lib/next.mjs` | the driver: state → one action; the wait lines; the stall threshold |
| `scripts/lib/stages.mjs` | the two stages: model, agent, artifact, what each is asked and refused |
| `scripts/lib/runtime.mjs` | the persisted Claude/Codex dispatch profiles: model, reasoning effort, role and output labels |
| `scripts/lib/reviews.mjs` | the red team on the plan: the reviewer contract, the JSON finding shape, the citation resolver, the registrar that hash-binds a verdict |
| `scripts/lib/prreview.mjs` | the pull request review loop: fleet sizing, hunk classification, immutable finding ids, transitions, the convergence rules, the pending-review payload, thread maintenance |
| `scripts/lib/reviewbrief.mjs` | the finder, verifier and fixer briefs, spliced from `references/review-method.md` |
| `scripts/lib/run.mjs` | the state machine and the gate — `dependencies()` and `blockers()` are the one rule as code |
| `scripts/lib/evidence.mjs` | reading every runner result out of the evidence file, and the red-before-green rule |
| `scripts/lib/brief.mjs` | the stage and red-team brief renderers |
| `scripts/lib/checkpoint.mjs` | the push and the sticky issue comment — how a run survives this machine |
| `scripts/lib/reconcile.mjs` | what has moved on GitHub since the run last looked |
| `scripts/lib/worktree.mjs` | a checkout per lane, so two lanes never share a tree |
| `references/review-method.md` | the angle catalogue, the verifier's contract, the severity definitions and the fixer's rule — the source every review brief is rendered from |
| `references/anatomy.md` | the run directory, the state machine, the review loop's record |
| `references/dispatch.md` | the dispatch-prompt contract, and why the wait is a file rather than a message |
| `references/decomposition.md` | when an issue splits, how work items become stacked pull request layers, and what a split may not do |

## Maintainer reference — not part of a user run

`skill-invariants.json` names what must not silently disappear, declares which
half of this skill is code, and lists the baseline eval set. The baseline is
pinned against real runs — see each entry's `update_command` to refresh it.

<!-- press:agent-ui -->

## What's here

| Path | Is |
|---|---|
| `scripts/issueflow.js` | the CLI: `board`, `start`, `brief`, `accept`, `review`, `split`, `status`, `runs`, `ship`, `finish` |
| `scripts/lib/stages.mjs` | the two stages: model, agent, artifact, what each is asked and refused |
| `scripts/lib/runtime.mjs` | the persisted Claude/Codex dispatch profiles: model, reasoning effort, role and output labels |
| `scripts/lib/reviews.mjs` | the red team: one reviewer per stage, the finding grammar, the citation resolver, and the registrar that hash-binds a verdict |
| `scripts/lib/run.mjs` | the state machine and the gate — `dependencies()` and `blockers()` are the one rule as code |
| `scripts/lib/brief.mjs` | the dispatch-prompt renderer |
| `scripts/lib/checkpoint.mjs` | the push and the sticky issue comment — how a run survives this machine |
| `scripts/lib/reconcile.mjs` | what has moved on GitHub since the run last looked |
| `scripts/lib/worktree.mjs` | a checkout per lane, so two lanes never share a tree |
| `scripts/lib/evidence.mjs` | reading a test runner's own summary out of the evidence file |
| `scripts/lib/verify.mjs` | the facts `accept` reports instead of the orchestrator shelling out for them |
| `references/anatomy.md` | the run directory, the stage state machine, and what each stage's artifact owes the next one |
| `references/dispatch.md` | the dispatch-prompt contract — what must cross into a cold subagent, what may never, and why the prompt is rendered rather than written |
| `references/decomposition.md` | when an issue splits, how work items become stacked pull request layers, and what a split may not do |

## Maintainer reference — not part of a user run

`skill-invariants.json` names what must not silently disappear, declares which
half of this skill is code, and lists the baseline eval set. The baseline is
pinned against a real run — see its `update_command` to refresh it.

<!-- >>> press:agent-ui v0.9.0 sha256:ce9c1c6b30d6 GENERATED by @natjswenson/press, do not edit -->
## Presentation — how a run should look

This skill is watched, not just run. Everything below assumes the user is
reading the conversation, so **the transcript is part of the product.**

**Keep the machinery invisible.** The user should see a short status line and a
table, not a scroll of raw command output. Concretely:

- **Never print file contents into the conversation.** Not a fetched page, not a
  source file, not a script's own source. Scripts hand each other *paths*; when
  you need a file's text in context, use the `Read` tool rather than `cat`,
  `sed`, `head`, or a `--show` flag. Anything the user already has open
  somewhere is a wall of text in chat.
- **One script call, not a pipeline.** Every step should be a single command that
  returns everything you need. If you find yourself chaining `sed`/`grep`/
  `python3 -` to reshape output, the script should have given it to you — say so
  rather than working around it.
- **Report in tables, with named columns.** Ad-hoc prose summaries are why runs
  read inconsistently. Every stage that produces more than one fact reports a
  table with a fixed column set, declared in this skill's own steps below.
  Omit noise: don't list unchanged fields, don't repeat inputs back, don't show
  paths the user can't act on.
- **Show, don't describe.** When a run produces something visual, `Read` the
  rendered image so the user sees it, instead of writing a paragraph about it.
- **Never claim a visual result without the artifact.** "It looks better" with no
  PNG in the transcript is not a result.

**The exception — narrate the slow parts.** Anything that takes more than a
couple of seconds gets one short lowercase line as it starts (`fetching the
posting…`, `rendering press + ats-plain…`) so the user sees progress rather than
dead air. One line each, not a table.

**Announce the skill once, at the start**, in one sentence, and never again.
<!-- <<< press:agent-ui -->

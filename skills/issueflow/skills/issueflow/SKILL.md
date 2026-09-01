---
name: issueflow
description: Work a GitHub issue from open to pull request through gated stages — investigate, design, implement, test — each stage run by its own subagent on its own model, each artifact approved by you before the next stage starts, or, in auto mode, by an adversarial red-team review that loops until nothing blocking remains. Use when the user says "work an issue", "list open issues", "what issues are open", "pick an issue to work on", "fix issue 42", "take this issue to a PR", "break this issue into smaller pieces", "work this issue autonomously", "auto mode", or "no approvals, just ship it". Lists the open issues in the repo as a pick-table, splits an issue too big for one change into stacked work items, and opens the pull request into dev following the repo's own branch policy.
user_invocable: true
version: 0.6.0
---

# /issueflow — one open issue to a pull request, through four gated stages

You are running the **issueflow** skill. It turns "work an issue" into a pull
request, by dispatching four subagents in turn and stopping at every one of them
until the user has approved what it produced.

**Announce at start:** "I'm using the issueflow skill — four gated stages, and I stop at each one."

> Commands below run from the directory containing this `SKILL.md` (`$SKILL_DIR`).
> Resolve it once. Pass `--repo <path>` to work against the user's repo.

## The one rule

**No stage runs on anything but its predecessor's artifact, approved by the user
and written to disk — and a stage that was skipped is reported as skipped, never
as done.**

Everything here is downstream of that. The gate is not a habit the orchestrator
is trusted to keep; it is `blockers()` in `scripts/lib/run.mjs`, and `accept`,
`brief` and `ship` all refuse through it. If you find yourself wanting to
proceed without an approval, the answer is to ask for the approval — never to
work around the refusal.

On a run started with `--auto`, the user delegates the approvals once, at
`start`: each stage is then approved by a registered, hash-bound **red-team
review** instead of a human — see *Auto mode*, below. The one rule does not
loosen; the gate just has a different holder.

## What is code and what is judgment

The split is declared in `skill-invariants.json` and checked — a deterministic
step whose command does not exist fails `skillfactory verify`.

| Deterministic — the machine decides | Command |
|---|---|
| read the open issues and the repo's branch and pull request policy | `node "$SKILL_DIR/scripts/issueflow.js" board` |
| fetch the chosen issue and its comments to disk and open the stage state machine | `node "$SKILL_DIR/scripts/issueflow.js" start` |
| render each stage's dispatch prompt, model and subagent type from the approved artifacts | `node "$SKILL_DIR/scripts/issueflow.js" brief` |
| enforce the gate — record an artifact, record the approval, advance only then | `node "$SKILL_DIR/scripts/issueflow.js" accept` |
| register a completed red-team review — validate every citation, derive the verdict from the severities, bind it to the artifact's hash, record the round | `node "$SKILL_DIR/scripts/issueflow.js" review` |
| expand an approved design's work items into stacked child lanes | `node "$SKILL_DIR/scripts/issueflow.js" split` |
| report the state of an interrupted run so it resumes without guessing | `node "$SKILL_DIR/scripts/issueflow.js" status` |
| list every run on this machine, so one can be found without remembering its path | `node "$SKILL_DIR/scripts/issueflow.js" runs` |
| push the branch and open the pull request under the repo's own policy | `node "$SKILL_DIR/scripts/issueflow.js" ship` |
| verify each lane's pull request merged, remove its worktree, delete its local branch, and mark the run done | `node "$SKILL_DIR/scripts/issueflow.js" finish` |

| Model judgment — nothing on disk answers it | Why |
|---|---|
| what the issue actually asks for, and what its root cause is | an issue is a person's description of a symptom; nothing on disk says which code causes it or whether the reporter asked for the right fix |
| the design — the approach chosen, and the approaches rejected | trade-offs between working designs are judgment; a file records the code that exists, never the one that should |
| whether this issue is one change or several, and where the seams fall | size signals suggest a split, they never locate it — only reading the design tells you which parts can land and be reviewed alone |
| the implementation itself, written to match the surrounding code | matching a codebase's idiom, naming and comment density is imitation, which no rule set encodes |
| whether the tests actually prove the issue is fixed | a green suite proves the tests passed, not that they tested the reported behaviour — only reading the issue against the assertions answers that |
| whether an artifact is good enough to approve | this is the user's call and the whole point of the gate; a skill that decides it has removed the thing it exists to provide — or, on an auto run, the red team's call, registered and hash-bound, with every round shown to the user |
| what the stage missed — the adversarial hunt itself | the registrar can check that a finding cites something real; only a reviewer reading the work can find the alternate root cause nobody ruled out, the file the design forgot, or the assertion that passes without the fix |

## The flow

### 1. Board — never ask what you can read

```bash
node "$SKILL_DIR/scripts/issueflow.js" board --repo <path>
```

Every open issue, plus the repo's branch policy read from its own
`.github/shipflow.json`. **Never ask about anything in it** — the base branch,
the feature prefix and the merge method are facts, and a confirmation is not a
question. Show the table and ask one thing: which issue.

`Detail` says how much the issue text specifies, not how much work it is. `thin !`
is a broad label over a thin body — the combination most likely to come back from
design as several work items. Never present it as a size estimate.

If the user already named an issue ("fix issue 42"), skip straight to `start`.

### 2. Start

```bash
node "$SKILL_DIR/scripts/issueflow.js" start --repo <path> --issue <n>
```

Freezes the issue and its comments to disk, opens the state machine, and posts
the run's comment on the issue. It also prints the issue itself — title, labels,
comment count, detail — so **never call `gh issue view` after it**.

From here on the run directory is the state. An interrupted run resumes with
`status`; a run whose directory you have forgotten is found with `runs`.

**Every state change is checkpointed.** `start`, `accept`, `split` and `ship`
each push the lane's branch and rewrite one comment on the issue carrying the
board, the lanes and every approved artifact. This is what makes the run
survive losing the machine — and it is why the issue, not this conversation, is
the record. If a checkpoint row says `failed`, say so plainly: the approval is
recorded locally and the run is **not** backed up.

### 3. For each stage: brief → dispatch → show → approve

This is the whole loop, and it repeats four times (more when the run splits).

```bash
node "$SKILL_DIR/scripts/issueflow.js" brief --run-dir <run>   # or --stage <id> [--lane <slug>]
```

It returns the stage, its **model**, its agent type, the artifact the stage must
write and the directory it works in, then prints the exact dispatch prompt to
use. **Dispatch exactly one subagent, on exactly the model it names** — `opus`
for investigate and design, `sonnet` for implement and test. The models are the
point: the two stages where a wrong answer is expensive to discover get the
strongest model, and the two bounded by an approved document get the faster one.

**Dispatch in the background and say what is running.** These stages take
minutes — five for investigate, ten for implement on the run this was measured
against — and a foreground dispatch is that long with nothing on screen.
`brief` prints how long this stage has taken on this repo's own past runs
right above the dispatch prompt, so say that expectation out loud too: "this
usually takes about N minutes here" beats a bare "starting" the same way a
known range beats silence. One short lowercase line as it starts, then the
result.

**While it runs, `status` answers "is it stuck" — do not guess.** The board's
`Took` column reads live (`4m12s+`) instead of `—` for a stage that has not
delivered yet, and a liveness block underneath surfaces the stage's own last
reported milestone and its age, when the subagent wrote one — the brief asks
every stage to append a short line to its own progress log as it reaches real
milestones, but that log is scratch work, never quoted back to the subagent
and never pasted into the transcript verbatim; `status` already shows the
latest line. Re-run `status` instead of asking the user to wait blind, and if
the elapsed time is well past what the expectation line said, say so plainly
rather than continuing to wait in silence.

**When more than one stage can run, run them together:**

```bash
node "$SKILL_DIR/scripts/issueflow.js" brief --run-dir <run> --ready
```

`--ready` briefs every stage whose gate is open and prints them as one list.
A split run reaches this constantly — a lane's test and the next lane's
implement are independent, and each lane works in its own git worktree, so they
genuinely can run at once. **Dispatch them as N subagents in ONE message.**
Running them one at a time is how the measured run left its second lane
untouched.

The dispatch prompt is one line pointing at the rendered brief. **Pass it as
given.** Do not summarise the brief, do not add context, do not attach your own
opinion of the previous stage — the brief already carries everything that may
cross, and anything you add is a second, unreviewed source of truth. See
`references/dispatch.md`.

When the subagent returns, **`Read` the artifact it wrote and show the user what
matters** — the root cause, the approach and what it rejected, the files it
changed, the test result. A one-line "the investigate stage is done" is not a
gate; the user cannot approve what they have not seen. Then ask plainly whether
to approve it.

**A content-free idle notification is not a completion.** The brief tells every
subagent to send a `SendMessage` naming its artifact path and its result before
it goes idle; wait for that message and read the artifact it names, rather than
treating "idle" alone as done.

```bash
node "$SKILL_DIR/scripts/issueflow.js" accept --run-dir <run> --stage <id> [--lane <slug>]
```

`accept` refuses an empty artifact, an artifact whose required sections are not
*headings*, and a `test` stage whose evidence holds no runner result at all.
**Those refusals are the product.** Never edit an artifact yourself to get past
one — send the stage back with what the gate said.

It also asks GitHub whether the world moved: an issue that has been closed, or a
lane whose pull request already merged, **stops the run**. Read what it found and
tell the user before reaching for `--force`. On the run this was measured
against, the change was merged and the issue closed while the run sat at this
gate, and the run went on to dispatch a subagent against a branch that no longer
mattered.

`accept` reports the facts you would otherwise shell out for — branch, HEAD,
commits over `origin/<base>`, whether the tree is clean, the parsed test result.
**Never run `git status`, `git log` or `grep` over the evidence to get them.**

To record a stage as deliberately not done:
`accept --stage <id> --skip "<reason>"`. It never becomes approved, so `ship`
keeps refusing and names it.

### 4. If the design says the issue splits

The design stage lists work items under `## Work items`. If it did, show them and
ask before expanding — a split multiplies the gates, and that is the user's call.

```bash
node "$SKILL_DIR/scripts/issueflow.js" split --run-dir <run>
```

It reads the items out of the **approved design itself**. Never hand-write an
items JSON file: that is a second copy of a decision the user already signed off,
and on the measured run the retyped copy differed from the artifact.

Each item becomes a lane with its own branch, its own `implement` and `test`
stages, and its own pull request stacked on the lane below it. The shared stages
are not duplicated. See `references/decomposition.md`.

### 5. Ship

```bash
node "$SKILL_DIR/scripts/issueflow.js" ship --run-dir <run> [--dry-run]
```

Pushes each lane bottom-first and opens its pull request against the base the
policy resolved. Run `--dry-run` first and show the plan: this is the
irreversible step, and it is the last moment the user can stop it.

Report the pull request URLs the command returned. **Nothing else counts as
shipped** — not a pushed branch, not a green check.

### 6. Finish

```bash
node "$SKILL_DIR/scripts/issueflow.js" finish --run-dir <run> [--close-issue]
```

`ship` ends at pull request URLs. This is what happens after: once GitHub
confirms a lane's pull request merged, `finish` removes that lane's worktree,
deletes its local branch, and records the landing. A lane whose pull request
has not merged is left **completely alone** — the mirror of `accept`'s drift
refusal, and the only path to `git branch -D` is a merge GitHub confirmed.

Run it any time after `ship`; it is safe to run again. It finishes whatever
has merged and leaves the rest untouched, so a split run with one lane still
under review finishes the lane that landed and completes on a later call once
the other one does too. Pass `--close-issue` to close the issue once every
lane has landed — GitHub's `Closes #<n>` keyword only fires on a merge into
the repository's *default* branch, and issueflow targets the policy base,
which is `dev` in a shipflow repo, so the issue does not close on its own.

`finish` is a question about GitHub, so it refuses on an offline run rather
than finishing on an assumption. Once every lane has landed, `runs` and
`status` report the run `done` — never `ready to ship` again.

## Auto mode — the red team replaces the human gate

When the user asks for an autonomous run ("work this autonomously", "auto
mode", "no approvals, just ship it"), start with:

```bash
node "$SKILL_DIR/scripts/issueflow.js" start --repo <path> --issue <n> --auto
```

In auto mode **the red team is the gate, and it is a dispatched subagent —
never you.** Every stage still runs exactly as in the flow above; what changes
is what happens when its artifact lands. Instead of showing the user and
asking, you dispatch an adversarial reviewer, and the stage advances only on a
registered passing review:

1. **Brief and dispatch the stage** as usual — background, on the model `brief`
   names, with the expectation said out loud. The user is watching an
   autonomous run, so narrate more, not less: one lowercase line at every
   dispatch, and the board after every gate.
2. **When the artifact lands** (the stage's `SendMessage`, never a bare idle),
   say so in one line, then brief the red team:

   ```bash
   node "$SKILL_DIR/scripts/issueflow.js" brief --review --run-dir <run> --stage <id> [--lane <slug>]
   ```

   Dispatch the reviewer it prints — **opus, always**; the red team is the
   judgment an auto run pays for. Reviews of parallel lanes are independent:
   dispatch them as N subagents in ONE message, exactly like `--ready` stages.
3. **When the review lands, register it:**

   ```bash
   node "$SKILL_DIR/scripts/issueflow.js" review --run-dir <run> --stage <id> [--lane <slug>]
   ```

   It validates every citation against something that exists, derives the
   verdict from the severities (critical and high block; medium and low are
   notes), binds the verdict to the sha of the artifact it reviewed, and
   prints the findings table. **Paste that table into the conversation — not a
   summary of it.** A refused registration (a finding that cites nothing, a
   verdict that disagrees with its own severities) goes back to the reviewer
   with the refusal verbatim, the same way a gate-refused stage does.
4. **Blocked?** Re-brief the stage — the brief now carries the blocking
   findings and the path to the full review — and redispatch it on its own
   model. Say which round this is: "round 2: sending implement back with 1
   high, 2 notes." Then review again. **Never weaken a review to clear a
   finding** — if a finding is wrong, the reviewer's next round is where that
   gets decided, not your judgment and not an edit to anything.
5. **Pass?** Approve on the verdict and show the board:

   ```bash
   node "$SKILL_DIR/scripts/issueflow.js" accept --auto --run-dir <run> --stage <id> [--lane <slug>]
   ```

   `accept --auto` runs every refusal the human path runs, then also refuses a
   missing or blocked review, an artifact edited after its review, and a
   branch that moved under a code review. Its refusals are the product, same
   as ever.
6. **A design that splits, splits.** In auto mode run `split` without asking —
   but say so, and show the lane table.
7. **Three blocked rounds on one stage stop the run.** `brief` and `review`
   refuse a fourth round; when that happens, print the open blocking findings,
   run `status`, and hand the run to the user with what is unresolved. **Never
   auto-ship over an open blocking finding**, and never `--skip` past one.
8. **Ship without asking, but not blind:** run `ship --dry-run`, narrate the
   plan in one line, then `ship`. Then `finish` once merges confirm, and close
   with the run summary: one table, `Stage | Model | Rounds | Blocking found |
   Took`, plus the pull request URLs.

**Auto mode never touches `--force`.** Blocking drift — a closed issue, an
already-merged lane — stops an unattended run exactly like an exhausted stage:
report it and hand back to the user. `--force` is for a human who has re-read
the drift and decided; an auto run has no such human by definition.

The user sees every round: the findings tables, the board after every gate,
the checkpoint comment carrying the review history. Autonomous never means
silent — it means the user reads the run instead of driving it.

## Commands

| Command | Returns |
|---|---|
| `board` | every open issue as a pick-table, plus the repo's resolved branch policy |
| `start --issue <n> [--auto]` | the frozen issue on disk, the issue itself, the state machine, the run board, and the run's comment posted on the issue — `--auto` hands every gate to the red team |
| `brief [--stage] [--lane]` | the next stage's model, agent, artifact, worktree and the exact dispatch prompt |
| `brief --ready` | **every** stage whose gate is open, for dispatch in one message |
| `brief --review --stage <id>` | the red-team reviewer's brief for a delivered artifact: opus, the citation grammar, and the exact dispatch prompt |
| `review --stage <id> [--lane]` | registers a completed review: validates every citation, derives the verdict, hash-binds it, prints the findings table and what to do next |
| `accept [--stage] [--lane] [--skip] [--force] [--auto]` | the gate: records an artifact and its approval, or refuses and says why — plus the verification table and a checkpoint; `--auto` approves on a registered passing review instead of a human |
| `split` | one lane per work item read from the approved design, each stacked on the one below |
| `status` | the run board with a live elapsed time for any stage still running, its last reported progress, what has drifted on GitHub, and what can run now |
| `runs` | every run on this machine, with what it is waiting on |
| `ship [--dry-run] [--force]` | a pushed branch and an open pull request per lane, and the per-stage timings |
| `finish [--close-issue]` | per lane: the merge verified, the worktree removed, the branch deleted, the landing recorded — and, once every lane has landed, the run marked `done` |

`--offline` suppresses every network call and the checkpoint. It is for the
evals; a real run should never pass it.

## Requirements

- **`gh`, authenticated**, with read access to the repo's issues and write access
  to open a pull request.
- **A git repo with a GitHub remote.** Everything is resolved from it — the
  owner, the name, the default branch and the branch policy.
- **Subagent dispatch.** Every stage runs as its own subagent; without that this
  is a checklist, not a pipeline.

## Rules that are not negotiable

- **No stage runs on anything but its predecessor's artifact, approved by the user and written to disk — and a stage that was skipped is reported as skipped, never as done.**
- **Every state change is checkpointed.** The branch is pushed and the issue's
  comment is rewritten at every gate. A run that exists only on this machine is
  a run one crash away from having produced nothing.
- **Never advance over drift you have not shown the user.** If `accept` says the
  work already merged, that is the answer — `--force` is for after they decide,
  never before.
- **Never dispatch a stage on a model other than the one `brief` names.**
- **Never do a stage's work yourself.** An orchestrator that investigates the
  issue "quickly, to save a dispatch" has collapsed four isolated contexts into
  one and thrown away the only thing this shape buys.
- **Never edit an artifact to get past the gate.** Send the stage back.
- **Never claim a result you did not observe.** Say what you verified and what
  you did not — a pull request URL comes from `ship`, never from having asked
  for one.
- **In auto mode the red team is the gate, and it is a dispatched subagent —
  never you.** A reviewer that shares your context has already been told the
  conclusion it was sent to attack.
- **Never weaken a review to clear a finding.** Round 3 is exactly when fixing
  the reviewer becomes cheaper than fixing the work; the work is what gets
  fixed.
- **Never auto-ship over an open blocking finding.** An exhausted stage
  surfaces its findings and the run stops there.
- **Auto mode never touches `--force`.** Drift stops an unattended run; the
  flag is for a human who has re-read what moved.

<!-- press:agent-ui -->

## What's here

| Path | Is |
|---|---|
| `scripts/issueflow.js` | the CLI: `board`, `start`, `brief`, `accept`, `review`, `split`, `status`, `runs`, `ship`, `finish` |
| `scripts/lib/stages.mjs` | the four stages: model, agent, artifact, what each is asked and refused |
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

---
name: issueflow
description: Work a GitHub issue from open to pull request through gated stages — investigate, design, implement, test — each stage run by its own subagent on its own model, each artifact approved by you before the next stage starts. Use when the user says "work an issue", "list open issues", "what issues are open", "pick an issue to work on", "fix issue 42", "take this issue to a PR", or "break this issue into smaller pieces". Lists the open issues in the repo as a pick-table, splits an issue too big for one change into stacked work items, and opens the pull request into dev following the repo's own branch policy.
user_invocable: true
version: 0.1.0
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

## What is code and what is judgment

The split is declared in `skill-invariants.json` and checked — a deterministic
step whose command does not exist fails `skillfactory verify`.

| Deterministic — the machine decides | Command |
|---|---|
| read the open issues and the repo's branch and pull request policy | `node scripts/issueflow.js board` |
| fetch the chosen issue and its comments to disk and open the stage state machine | `node scripts/issueflow.js start` |
| render each stage's dispatch prompt, model and subagent type from the approved artifacts | `node scripts/issueflow.js brief` |
| enforce the gate — record an artifact, record the approval, advance only then | `node scripts/issueflow.js accept` |
| expand an approved design's work items into stacked child lanes | `node scripts/issueflow.js split` |
| report the state of an interrupted run so it resumes without guessing | `node scripts/issueflow.js status` |
| push the branch and open the pull request under the repo's own policy | `node scripts/issueflow.js ship` |

| Model judgment — nothing on disk answers it | Why |
|---|---|
| what the issue actually asks for, and what its root cause is | an issue is a person's description of a symptom; nothing on disk says which code causes it or whether the reporter asked for the right fix |
| the design — the approach chosen, and the approaches rejected | trade-offs between working designs are judgment; a file records the code that exists, never the one that should |
| whether this issue is one change or several, and where the seams fall | size signals suggest a split, they never locate it — only reading the design tells you which parts can land and be reviewed alone |
| the implementation itself, written to match the surrounding code | matching a codebase's idiom, naming and comment density is imitation, which no rule set encodes |
| whether the tests actually prove the issue is fixed | a green suite proves the tests passed, not that they tested the reported behaviour — only reading the issue against the assertions answers that |
| whether an artifact is good enough to approve | this is the user's call and the whole point of the gate; a skill that decides it has removed the thing it exists to provide |

## The flow

### 1. Board — never ask what you can read

```bash
node scripts/issueflow.js board --repo <path>
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
node scripts/issueflow.js start --repo <path> --issue <n>
```

Freezes the issue and its comments to disk and opens the state machine. From
here on the run directory is the state — nothing about it lives in this
conversation, so an interrupted run resumes with `status`.

### 3. For each stage: brief → dispatch → show → approve

This is the whole loop, and it repeats four times (more when the run splits).

```bash
node scripts/issueflow.js brief --run-dir <run>   # or --stage <id> [--lane <slug>]
```

It returns the stage, its **model**, its agent type and the artifact the stage
must write, then prints the exact dispatch prompt to use. **Dispatch exactly one
subagent, on exactly the model it names** — `opus` for investigate and design,
`sonnet` for implement and test. The models are the point: the two stages where
a wrong answer is expensive to discover get the strongest model, and the two
bounded by an approved document get the faster one.

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

```bash
node scripts/issueflow.js accept --run-dir <run> --stage <id> [--lane <slug>]
```

`accept` refuses an empty artifact, an artifact missing the sections that stage
owes the next one, and a `test` stage with no recorded output. **Those refusals
are the product.** Never edit an artifact yourself to get past one — send the
stage back with what the gate said.

To record a stage as deliberately not done:
`accept --stage <id> --skip "<reason>"`. It never becomes approved, so `ship`
keeps refusing and names it.

### 4. If the design says the issue splits

The design stage lists work items under `## Work items`. If it did, show them and
ask before expanding — a split multiplies the gates, and that is the user's call.

```bash
node scripts/issueflow.js split --run-dir <run> --items-json <path>
```

Each item becomes a lane with its own branch, its own `implement` and `test`
stages, and its own pull request stacked on the lane below it. The shared stages
are not duplicated. See `references/decomposition.md`.

### 5. Ship

```bash
node scripts/issueflow.js ship --run-dir <run> [--dry-run]
```

Pushes each lane bottom-first and opens its pull request against the base the
policy resolved. Run `--dry-run` first and show the plan: this is the
irreversible step, and it is the last moment the user can stop it.

Report the pull request URLs the command returned. **Nothing else counts as
shipped** — not a pushed branch, not a green check.

## Commands

| Command | Returns |
|---|---|
| `board` | every open issue as a pick-table, plus the repo's resolved branch policy |
| `start --issue <n>` | the frozen issue on disk, the state machine, and the run board |
| `brief [--stage] [--lane]` | the next stage's model, agent, artifact and the exact dispatch prompt |
| `accept [--stage] [--lane] [--skip]` | the gate: records an artifact and its approval, or refuses and says why |
| `split --items-json <path>` | one lane per work item, each stacked on the one below |
| `status` | the run board for an interrupted run |
| `ship [--dry-run]` | a pushed branch and an open pull request per lane |

## Requirements

- **`gh`, authenticated**, with read access to the repo's issues and write access
  to open a pull request.
- **A git repo with a GitHub remote.** Everything is resolved from it — the
  owner, the name, the default branch and the branch policy.
- **Subagent dispatch.** Every stage runs as its own subagent; without that this
  is a checklist, not a pipeline.

## Rules that are not negotiable

- **No stage runs on anything but its predecessor's artifact, approved by the user and written to disk — and a stage that was skipped is reported as skipped, never as done.**
- **Never dispatch a stage on a model other than the one `brief` names.**
- **Never do a stage's work yourself.** An orchestrator that investigates the
  issue "quickly, to save a dispatch" has collapsed four isolated contexts into
  one and thrown away the only thing this shape buys.
- **Never edit an artifact to get past the gate.** Send the stage back.
- **Never claim a result you did not observe.** Say what you verified and what
  you did not — a pull request URL comes from `ship`, never from having asked
  for one.

<!-- press:agent-ui -->

## What's here

| Path | Is |
|---|---|
| `scripts/issueflow.js` | the CLI: `board`, `start`, `brief`, `accept`, `split`, `status`, `ship` |
| `scripts/lib/stages.mjs` | the four stages: model, agent, artifact, what each is asked and refused |
| `scripts/lib/run.mjs` | the state machine and the gate — `blockers()` is the one rule as code |
| `scripts/lib/brief.mjs` | the dispatch-prompt renderer |
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

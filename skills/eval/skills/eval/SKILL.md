---
name: eval
description: Grade a real run of a skill against its own committed contract, then turn each confirmed failure into a permanent eval case. Use when the user says "evaluate this run", "grade this skill", "eval this run", "how good was that run", "did the skill follow its own rules", "audit this transcript", "write evals for my skill", "deepen the evals", or "my evals are decorative" — or wants a session transcript checked for results it claimed but never observed.
user_invocable: true
version: 0.3.0
---

## Codex runtime

When running in Codex, invoke this skill as `$eval`. Resolve scripts, assets,
and references from the directory containing this SKILL.md, regardless of the
current working directory. Existing `~/.claude/` personal-data paths remain valid
and are still used by the bundled scripts; they do not require Claude to run.
Map `Read`/`Write`/`Edit`/`Bash` to the available file and shell tools, and
`WebSearch`/`WebFetch` to available web tools. For `AskUserQuestion`, use an
available question tool or a concise chat question; wait for answers that gate
action. Use Codex's delegation tools for required subagents when available;
otherwise disclose that independent execution is unavailable. Discover connected
apps by capability rather than assuming Claude MCP tool names exist.

# /eval — grade the run, not the intention

You are running the **eval** skill. It takes a run that actually happened,
grades it against the contract that skill committed to in writing, and keeps
only the findings it can point at.

**Announce at start:** "I'm using the eval skill to grade this run against its own contract."

> Commands below run from the directory containing this `SKILL.md` (`$SKILL_DIR`).
> Resolve it once. Pass `--repo <path>` to work against the user's repo.

## The one rule

**Never assert what it did not observe: every finding must cite one exact transcript event and one exact contract clause, and a generated eval case is kept only if it is run and observed to fail against the skill as it exists today.**

Two consequences worth stating before anything else:

- **Never grade from a summary.** Not the user's account of the run, not your
  own memory of it, not a description someone pasted. Grade the transcript, or
  say you cannot grade.
- **Never report a finding count as a verdict on a run.** `0 findings` means the
  examined clauses were clean. **Always report the coverage gap in the same
  breath** — the clauses nothing looked at are not the same as clauses that
  passed, and a reader who confuses them has been misled by the report, not by
  the run.

## What is code and what is judgment

The split is declared in `skill-invariants.json` and checked — a deterministic
step whose command does not exist fails `skillfactory verify`.

| Deterministic — the machine decides | Command |
|---|---|
| extract every committed clause with a stable id and a source anchor | `node scripts/eval.js contract --skill <name>` |
| normalize a session transcript into anchored, citable events | `node scripts/eval.js trace --run <file>` |
| decide the mechanically checkable violations and resolve every citation | `node scripts/eval.js probe --skill <name> --run <file>` |
| assemble the scored report and the clause-coverage gap | `node scripts/eval.js report --skill <name> --run <file>` |
| prove a generated eval case actually fails against the skill as it exists today | `node scripts/eval.js case --skill <name> --finding <id> --prove` |

| Model judgment — nothing on disk answers it | Why |
|---|---|
| decide whether a clause no probe can parse was violated in spirit | a rule like "never claim a result you did not observe" is a semantic relation between a sentence and an event, not a pattern; a parser can find the sentence but cannot decide whether it was earned |
| rank findings by what they would actually have cost | counting violations is arithmetic; knowing which one would have shipped a broken skill and which is cosmetic is judgment nothing on disk records |
| choose which confirmed findings deserve to become permanent eval cases | most violations are one-off accidents; a case is worth keeping only when its failure class will recur, and no file says which those are |
| write the report prose and the recommended fix for each finding | ordering, tone and what to leave out — a report nobody reads catches nothing |

## The flow

### 1. Find the run — never ask what you can read

In Codex, find the relevant `rollout-*.jsonl` under
`${CODEX_HOME:-$HOME/.codex}/sessions/` (or `archived_sessions/`). Match the
session metadata's working directory and timestamp to the requested run; do not
assume the newest file belongs to this project. The trace command accepts Codex
rollouts as well as Claude transcripts. Never substitute a summary for a log.

For Claude runs, Claude Code writes every session to
`~/.claude/projects/<slug>/<session-id>.jsonl`, where `<slug>` is the project
path with `/` replaced by `-`. The current session's id is in the scratchpad
path. **Never ask the user to paste a transcript** — it is already on disk, and
asking for it is how a grader becomes a form.

If the user names a skill but not a run, list the sessions by modified time and
propose the most recent. One question, with a default.

### 2. Extract the contract

```bash
node scripts/eval.js contract --skill <name> --repo <path> --out <file>
```

Report `Source / Severity / Clauses` and the total. If a skill yields
suspiciously few clauses, say so — it usually means its rules are phrased in a
form the extractor does not recognise, and grading against a thin rubric looks
identical to grading against a clean run.

### 3. Normalize the run

```bash
node scripts/eval.js trace --run <session.jsonl> --out <file>
```

Report `Kind / Events` and the drop counts. Thinking blocks, injected reminders
and harness bookkeeping are dropped on purpose — see `references/rubric.md`.

### 4. Probe, then judge — in that order

```bash
node scripts/eval.js probe --contract <file> --trace <file> --out <file>
```

The machine goes first so judgment starts from facts rather than impressions.
Then **read the clauses the probes did not examine** and decide, one at a time,
whether the run violated any of them. A judgment finding is written in the same
shape as a machine finding and must cite the same way:

```json
[{ "id": "j-1", "clauseId": "rule-87292e96", "eventId": "e42",
   "severity": "critical", "detail": "what happened, in one sentence" }]
```

`report --judgment <file>` **refuses the whole report** if any citation does not
resolve. Fix the citation or drop the finding; never soften it into a maybe.

### 5. Assemble the report

```bash
node scripts/eval.js report --contract <file> --trace <file> \
  --judgment <file> --out <dir>
```

Writes `report.md` and `probe.json`. Show the summary table and the findings
table in the conversation. **Always show the coverage gap number next to the
findings count** — never one without the other.

### 6. Only then, cases

Most findings do not deserve one. For the few whose failure class will recur —
because the defect lives in a committed instruction or template — convert them:

```bash
node scripts/eval.js case --skill <name> --in <file> --prove \
  --assert-absent "<the defect text>" --finding <id> --clause <id> --event <id>
```

It is kept only if it fails today. A refusal here is the skill working, not a
problem to route around.

### 7. Say what you did not check

Close with the coverage gap and the `cannot decide` list, in one or two
sentences. A run graded on nine of thirty clauses was graded on nine of thirty
clauses.

## Commands

| Command | Returns |
|---|---|
| `eval contract` | every rule a skill committed to, as numbered citable clauses with source file:line — from SKILL.md, skill-invariants.json prose, spliced press regions and the repo's own golden rules |
| `eval trace` | one session transcript normalized into ordered, anchored events — tool calls with their commands, tool results, assistant claims — each addressable by a stable id |
| `eval probe` | the mechanically decidable violations, each already carrying the clause id it breaks and the event id that breaks it; refuses to emit a finding whose citation does not resolve |
| `eval report` | the scored report: clauses covered, violations by severity, and the coverage gap — which clauses no probe and no judgment ever examined |
| `eval case` | a confirmed finding turned into a permanent eval case for the target skill, run against that skill and kept only if it is observed to fail |

## Rules that are not negotiable

- **Never assert what it did not observe: every finding must cite one exact transcript event and one exact contract clause, and a generated eval case is kept only if it is run and observed to fail against the skill as it exists today.**
- **Never claim a result you did not observe.** Say what you verified and what
  you did not.
- **Never present a finding count without its coverage gap.** The two numbers
  are one fact and splitting them misleads by construction.
- **Never weaken a probe to remove a finding.** If a probe fires wrongly, the
  probe is too broad — narrow what it decides and widen its `cannot`. Deleting
  the finding leaves the defect and loses the evidence.
- **Never keep an eval case that passed on arrival.** It has never been observed
  failing, so it is decoration with a filename.
- **Never grade a skill against anything but its own committed contract.** Not
  your taste, not another skill's rules, not what the contract should have said.

<!-- press:agent-ui -->

## What's here

| Path | Is |
|---|---|
| `scripts/eval.js` | the CLI: `contract`, `trace`, `probe`, `report`, `case` |
| `scripts/lib/contract.mjs` | clause extraction — the rubric, lifted from committed files |
| `scripts/lib/trace.mjs` | a session JSONL turned into citable events, redacted |
| `scripts/lib/probes.mjs` | the eight probes, and the citation rule they all obey |
| `scripts/lib/report.mjs` | findings beside the coverage gap, never without it |
| `scripts/lib/cases.mjs` | a finding turned into a test, kept only if observed red |
| `references/rubric.md` | where a clause comes from, what makes it citable, and which committed files are contract versus commentary |
| `references/probes.md` | the deterministic probe catalogue — what each probe decides, and explicitly what it cannot decide and must hand to judgment |
| `references/cases.md` | what makes a generated eval case real instead of decorative, and why a case that passes on arrival is refused |

## Maintainer reference — not part of a user run

`skill-invariants.json` names what must not silently disappear, declares which
half of this skill is code, and lists the baseline eval set. The baseline is
pinned against a real run — see its `update_command` to refresh it.

<!-- >>> press:agent-ui v0.10.0 sha256:924e08b174a6 GENERATED by @natjswenson/press, do not edit -->
## Presentation — how a run should look

This skill is watched, not just run. Everything below assumes the user is
reading the conversation, so **the transcript is part of the product.**

**Keep the machinery invisible.** The user should see a short status line and a
table, not a scroll of raw command output. Concretely:

- **Keep file reads focused.** Scripts hand each other *paths*; when you need
  a file's text in context, use the host's available file-reading capability.
  In Claude Code, prefer `Read`; in Codex, use focused file or shell reads.
  Read only the relevant range and keep raw file contents out of user-facing
  updates. A fetched page or a script's source is usually a wall of text in chat.
- **One script call, not a pipeline.** Every step should be a single command that
  returns everything you need. If you find yourself chaining `sed`/`grep`/
  `python3 -` to reshape output, the script should have given it to you — say so
  rather than working around it.
- **Report in tables, with named columns.** Ad-hoc prose summaries are why runs
  read inconsistently. Every stage that produces more than one fact reports a
  table with a fixed column set, declared in this skill's own steps below.
  Omit noise: don't list unchanged fields, don't repeat inputs back, don't show
  paths the user can't act on.
- **Show, don't describe.** When a run produces something visual, inspect the
  rendered image with the host's available image-inspection capability.
  In Claude Code, prefer `Read`; in Codex, use `view_image` when available.
  Show the rendered artifact to the user using the host's display or attachment
  capability. If inspection is unavailable, say so; do not claim visual verification.
- **Never claim a visual result without the artifact.** "It looks better" with no
  PNG in the transcript is not a result.

## The run envelope

Every interactive run uses the same semantic order. The host may render a
native question dialog or a chat question, but the content and decision shape
stay the same:

1. **Announce** — one sentence naming the skill and the work.
2. **Progress** — one short, lowercase status line for each slow operation.
3. **Decision** — ask only for a choice that is genuinely missing.
4. **Result** — lead with the outcome, then the smallest useful table or draft.
5. **Next action** — end with one clear action, or say that the run is complete.

Do not expose tool calls, shell commands, API payloads, retries, internal
reasoning, or implementation details in the user-facing result. Mention a
command, path, source, or limitation only when the user can act on it or when
omitting it would make the result unverifiable.

## Selection controls

Use the host's native selectable list whenever the user must choose from known
options. A selection is a decision surface, not a prose questionnaire:

- Use **single-select** for mutually exclusive choices, including which item,
  mode, destination, or draft the user wants.
- Use **multi-select** only when the choices are independent and the user may
  choose more than one. Say that multiple choices are allowed.
- Put the recommended or most useful option first. Give every option a concise
  label and a short consequence or description; never make the user infer what
  a choice does from a file name or number.
- Show no more than four primary options at once. Add `Show more` only when a
  longer list is useful, and make it the final option.
- Skip the selector when the user already made the choice in their request.
  Never ask the same decision twice, and never use a selector for information
  that can be reported directly.

If the host has no native selector, reproduce the same contract as a numbered
single-choice list and wait for one answer. Do not dump a raw menu, JSON array,
or tool transcript.

## Tables and detail

Tables are the default for two or more related facts. Use a short heading that
names the question the table answers, stable named columns in the same order on
every run, and one row per meaningful item. Prefer these column roles:

| Table purpose | Columns |
|---|---|
| Plan or target | `Item` · `Action` · `Status` |
| Comparison or metrics | `Item` · `Value` · `Change` · `Meaning` |
| Files or artifacts | `Artifact` · `Status` · `Next action` |
| Mutation or operation receipt | `Item` · `Action` · `Result` |

Choose the smallest role set that answers the question; do not add empty or
decorative columns. Use `—` for unavailable values and state why an entire
table is empty. Keep identifiers short, format numbers consistently, and put
the actionable interpretation in the final column when one is needed. A single
fact can be one sentence. A long table can be summarized to the changed,
failed, or user-actionable rows, with the complete artifact available at its
path when appropriate.

## Drafts and rendered artifacts

Text drafts are shown in the medium's true text format, with the exact content
the user must approve or edit. A visual draft, report, card, résumé, or other
designed artifact is an HTML file by default: write the self-contained HTML to
the skill's documented output location, open it in the user's browser, and
report the artifact path plus the one decision the user must make. Do not paste
the HTML source into chat. If a browser cannot be opened, provide the path and
say that the artifact is ready to open; do not claim that it was previewed.

When a draft requires approval, show the draft before asking for approval and
ask about that specific draft. An edit creates a new preview and a new approval
decision. Never publish, send, merge, delete, or otherwise commit a draft from
an implied or stale approval.

**The exception — narrate the slow parts.** Anything that takes more than a
couple of seconds gets one short lowercase line as it starts (`fetching the
posting…`, `rendering press + ats-plain…`) so the user sees progress rather than
dead air. One line each, not a table.

**Announce the skill once, at the start**, in one sentence, and never again.
<!-- <<< press:agent-ui -->

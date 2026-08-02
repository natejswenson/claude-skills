---
name: assay
description: Grade a real run of a skill against its own committed contract, then turn each confirmed failure into a permanent eval case. Use when the user says "evaluate this run", "grade this skill", "assay this run", "how good was that run", "did the skill follow its own rules", "audit this transcript", "write evals for my skill", "deepen the evals", or "my evals are decorative" — or wants a session transcript checked for results it claimed but never observed.
user_invocable: true
version: 0.1.0
---

# /assay — grade the run, not the intention

You are running the **assay** skill. It takes a run that actually happened,
grades it against the contract that skill committed to in writing, and keeps
only the findings it can point at.

**Announce at start:** "I'm using the assay skill to grade this run against its own contract."

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
step whose command does not exist fails `smith verify`.

| Deterministic — the machine decides | Command |
|---|---|
| extract every committed clause with a stable id and a source anchor | `node scripts/assay.js contract --skill <name>` |
| normalize a session transcript into anchored, citable events | `node scripts/assay.js trace --run <file>` |
| decide the mechanically checkable violations and resolve every citation | `node scripts/assay.js probe --skill <name> --run <file>` |
| assemble the scored report and the clause-coverage gap | `node scripts/assay.js report --skill <name> --run <file>` |
| prove a generated eval case actually fails against the skill as it exists today | `node scripts/assay.js case --skill <name> --finding <id> --prove` |

| Model judgment — nothing on disk answers it | Why |
|---|---|
| decide whether a clause no probe can parse was violated in spirit | a rule like "never claim a result you did not observe" is a semantic relation between a sentence and an event, not a pattern; a parser can find the sentence but cannot decide whether it was earned |
| rank findings by what they would actually have cost | counting violations is arithmetic; knowing which one would have shipped a broken skill and which is cosmetic is judgment nothing on disk records |
| choose which confirmed findings deserve to become permanent eval cases | most violations are one-off accidents; a case is worth keeping only when its failure class will recur, and no file says which those are |
| write the report prose and the recommended fix for each finding | ordering, tone and what to leave out — a report nobody reads catches nothing |

## The flow

### 1. Find the run — never ask what you can read

Claude Code writes every session to
`~/.claude/projects/<slug>/<session-id>.jsonl`, where `<slug>` is the project
path with `/` replaced by `-`. The current session's id is in the scratchpad
path. **Never ask the user to paste a transcript** — it is already on disk, and
asking for it is how a grader becomes a form.

If the user names a skill but not a run, list the sessions by modified time and
propose the most recent. One question, with a default.

### 2. Extract the contract

```bash
node scripts/assay.js contract --skill <name> --repo <path> --out <file>
```

Report `Source / Severity / Clauses` and the total. If a skill yields
suspiciously few clauses, say so — it usually means its rules are phrased in a
form the extractor does not recognise, and grading against a thin rubric looks
identical to grading against a clean run.

### 3. Normalize the run

```bash
node scripts/assay.js trace --run <session.jsonl> --out <file>
```

Report `Kind / Events` and the drop counts. Thinking blocks, injected reminders
and harness bookkeeping are dropped on purpose — see `references/rubric.md`.

### 4. Probe, then judge — in that order

```bash
node scripts/assay.js probe --contract <file> --trace <file> --out <file>
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
node scripts/assay.js report --contract <file> --trace <file> \
  --judgment <file> --out <dir>
```

Writes `report.md` and `probe.json`. Show the summary table and the findings
table in the conversation. **Always show the coverage gap number next to the
findings count** — never one without the other.

### 6. Only then, cases

Most findings do not deserve one. For the few whose failure class will recur —
because the defect lives in a committed instruction or template — convert them:

```bash
node scripts/assay.js case --skill <name> --in <file> --prove \
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
| `assay contract` | every rule a skill committed to, as numbered citable clauses with source file:line — from SKILL.md, skill-invariants.json prose, spliced press regions and the repo's own golden rules |
| `assay trace` | one session transcript normalized into ordered, anchored events — tool calls with their commands, tool results, assistant claims — each addressable by a stable id |
| `assay probe` | the mechanically decidable violations, each already carrying the clause id it breaks and the event id that breaks it; refuses to emit a finding whose citation does not resolve |
| `assay report` | the scored report: clauses covered, violations by severity, and the coverage gap — which clauses no probe and no judgment ever examined |
| `assay case` | a confirmed finding turned into a permanent eval case for the target skill, run against that skill and kept only if it is observed to fail |

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
| `scripts/assay.js` | the CLI: `contract`, `trace`, `probe`, `report`, `case` |
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

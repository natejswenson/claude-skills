---
name: skillhelp
description: Answer help questions about the skills in this repo. Use when the user asks how to set up, install or configure a skill, what commands or flags a skill has, how a skill works internally, why a skill is failing or erroring, what a skill refuses to do, which skill to use for a job, or what skills exist at all. Triggers on "/skillhelp", "how do I use <skill>", "how do I set up <skill>", "what commands does <skill> have", "what does <skill> do", "how does <skill> work", "why is <skill> failing", "what skills do I have", "which skill should I use for", "explain <skill> to me", "document my skills", and "rebuild the skill index".
user_invocable: true
version: 0.1.0
---
# /skillhelp — the knowledge base for the skills in this repo

You are running the **skillhelp** skill. It answers questions about any skill
here — how to set it up, how to use it, what commands it has, how it is built,
and why it is failing — out of an index extracted from the skills' own files.

**Announce at start:** "I'm using the skillhelp skill to answer that from the skill index."

> Commands run from the directory containing this `SKILL.md` (`$SKILL_DIR`).
> Resolve it once. `--repo` is optional — the CLI walks up to find the repo.

## The one rule

**Never answer ungrounded: every fact this skill emits carries the file and line it was read from, a fact that loses its source is dropped rather than shown, and a question the cards cannot ground is answered by the retrieval command's own not-documented block — naming which skills and sections were searched — never by prose written to fill the gap.**

You know a great deal about these skills from the conversation, from the repo,
and from having written some of them. **None of that may enter an answer.** The
value here is that a `skillhelp` answer is checkable: every claim points at a
line the user can open. An answer that mixes remembered context with cited
facts is worse than no answer, because it is no longer checkable and still
looks it.

## What is code and what is judgment

The split is declared in `skill-invariants.json` and checked — a deterministic
step whose command does not exist fails `skillfactory verify`.

| Deterministic — the machine decides | Command |
|---|---|
| extract five sections and their file:line sources from every skill | `node scripts/skillhelp.js build` |
| prove no card would change, none is missing, no fact lost its source | `node scripts/skillhelp.js check` |
| route a question to grounded facts, or emit the not-documented block | `node scripts/skillhelp.js ask` |
| list every skill with its version and trigger phrases | `node scripts/skillhelp.js list` |

| Model judgment — nothing on disk answers it | Why |
|---|---|
| which skill the user means when the question names none, or several | "how do I cut a release" spans release, shipflow and skillfactory; only intent decides |
| writing the answer from the retrieved facts | a card is grounded facts, not an answer; which three of eleven matter is judgment |
| whether a fact that scored above the floor is actually *responsive* | retrieval proves a fact exists and is real, never that it answers this question — a near-miss relayed as an answer is the ungrounded failure wearing a citation |

## The flow

### Answering a question — the common case

One command. Do not read the cards; `ask` returns the fact lines inline.

```
node scripts/skillhelp.js ask "how do I set up ghostwriter"
```

It returns one of three things, and each has exactly one correct response:

| It returns | You do |
|---|---|
| ranked facts | answer from them, citing `file:line`; say which skill the answer is about |
| a **SECTION LISTING** | say so — it is the whole section, retrieved because the question named a skill and a section but no term matched. Do not present it as a targeted answer |
| **NOT DOCUMENTED** | relay it. Name what was searched and what is missing. Offer to look in the source, but never answer as if the index had it |

If the question names no skill, `ask` searches all of them; if it names one, the
search is scoped to it and says so. When the user's phrasing is ambiguous
between two skills, ask which — one line, not a form.

### Rebuilding the index

The cards are committed, so they go stale when a skill changes. `ci / skillhelp`
runs against `skills/**` and fails when any card **would change** — the fix is
always one command:

```
node scripts/skillhelp.js check     # what drifted, and why
node scripts/skillhelp.js build     # rewrite the cards
```

Drift is measured on the rendered card, not the skill's file tree: editing a
comment inside a skill's `scripts/` changes no answer and reddens nothing.

### Browsing

`node scripts/skillhelp.js list` for the catalogue when the user does not yet
know which skill they want.

## Commands

| Command | Returns |
|---|---|
| `skillhelp build` | one card per skill — Setup, Usage, Commands, Architecture, Troubleshooting — every fact carrying its `file:line`, secret-shaped lines refused, plus a manifest hashed on the rendered card. Table: skill, version, sections filled, facts, refused, status. Names every skill with an empty section rather than hiding it |
| `skillhelp check` | re-extracts and byte-compares against the committed cards. Non-zero on `would-change`, `missing`, `incomplete`, `ungrounded` or `orphaned`, and prints the one rebuild command |
| `skillhelp ask` | grounded facts inline with sources, ranked, stating how many it withheld — or the not-documented block naming every skill and section searched |
| `skillhelp list` | the catalogue: skill, version, facts, trigger phrases |

## Rules that are not negotiable

- **Never answer ungrounded: every fact this skill emits carries the file and line it was read from, a fact that loses its source is dropped rather than shown, and a question the cards cannot ground is answered by the retrieval command's own not-documented block — naming which skills and sections were searched — never by prose written to fill the gap.**
- **Never claim a result you did not observe.** Say what you verified and what
  you did not.
- **Run the commands and never ask about anything in it** — the catalogue, the
  versions and the drift verdicts are facts on disk. A confirmation is not a
  question.
- **Never present a section listing as a targeted answer.** How a result was
  found changes how much it should be trusted.
- **Never hand-edit a card.** They are generated; edit the skill, then rebuild.

<!-- press:agent-ui -->

## What's here

| Path | Is |
|---|---|
| `scripts/skillhelp.js` | the CLI: `build`, `check`, `ask`, `list` |
| `references/anatomy.md` | the fixed shape of a card — the five sections, what each is extracted from, and the file:line grounding every fact must carry |
| `references/answering.md` | how to answer from retrieved facts: citation form, when to relay the not-documented block verbatim, and the refusal to fill a gap with plausible prose |
| `references/extraction.md` | which file each section is read out of per stack, why Troubleshooting weights the invariants prose and the non-negotiable rules over changelog lines, the secret-shaped-line refusal, and the fallbacks when a skill does not ship a source |

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

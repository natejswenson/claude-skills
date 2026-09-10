---
name: skillhelp
description: Answer help questions about the skills in this repo. Use when the user asks how to set up, install or configure a skill, what commands or flags a skill has, how a skill works internally, why a skill is failing or erroring, what a skill refuses to do, which skill to use for a job, or what skills exist at all. Triggers on "/skillhelp", "how do I use <skill>", "how do I set up <skill>", "what commands does <skill> have", "what does <skill> do", "how does <skill> work", "why is <skill> failing", "what skills do I have", "which skill should I use for", "explain <skill> to me", "document my skills", and "rebuild the skill index".
user_invocable: true
version: 0.1.0
---

## Codex runtime

When running in Codex, invoke this skill as `$skillhelp`. Resolve scripts, assets,
and references from the directory containing this SKILL.md, regardless of the
current working directory. Existing `~/.claude/` personal-data paths remain valid
and are still used by the bundled scripts; they do not require Claude to run.
Map `Read`/`Write`/`Edit`/`Bash` to the available file and shell tools, and
`WebSearch`/`WebFetch` to available web tools. For `AskUserQuestion`, use an
available question tool or a concise chat question; wait for answers that gate
action. Use Codex's delegation tools for required subagents when available;
otherwise disclose that independent execution is unavailable. Discover connected
apps by capability rather than assuming Claude MCP tool names exist.

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

<!-- press:runtime -->
In Claude Code, load `/press`; in Codex, load `$press`; then follow the shared PRESS terminal/UI contract from `brand/agent-ui.md`. Do not copy or override that contract here.
<!-- press:runtime -->

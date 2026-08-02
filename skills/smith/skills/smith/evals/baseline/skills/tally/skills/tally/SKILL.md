---
name: tally
description: Report what a repository currently owes: open pull requests and how long each has waited, branches merged but never deleted, and commits sitting on main with no release tag. Use when the user asks "what's outstanding", "any stale branches", "what hasn't shipped", or wants a repo hygiene check before a release.
user_invocable: true
version: 0.1.0
---

# /tally — Count what a repository owes you — open PRs, stale branches, unreleased commits — as one table

You are running the **tally** skill.

**Announce at start:** "I'm using the tally skill to count what a repository owes you — open PRs, stale branches, unreleased commits — as one table."

> Commands below run from the directory containing this `SKILL.md` (`$SKILL_DIR`).
> Resolve it once. Pass `--repo <path>` to work against the user's repo.

## The one rule

**Never report a count you did not read from the repository itself — an estimate is a guess wearing a number.**

## What is code and what is judgment

The split is declared in `skill-invariants.json` and checked — a deterministic
step whose command does not exist fails `smith verify`.

| Deterministic — the machine decides | Command |
|---|---|
| read the repo's counts | `node scripts/tally.js count` |
| resolve the release convention | `node scripts/tally.js detect` |

| Model judgment — nothing on disk answers it | Why |
|---|---|
| decide which of the counts actually matters today | urgency is context no file records |
| phrase the recommendation | the same numbers mean different things before and after a release |

## The flow

### 1. Detect — never ask what you can read

Run the detection command first and read its table. **Never ask about anything
in it.** A confirmation is not a question.

### 2. Ask at most two questions, one at a time

Opinionated, with a one-line reason. Zero questions is correct when the request
already answered them.

### 3. Do the work

- `tally detect` — the repo's remote, default branch and release convention, as one table
- `tally count` — open PRs, stale branches and unreleased commits, each with its age

### 4. Report

One table with a fixed column set, then one sentence, then stop.

## Commands

| Command | Returns |
|---|---|
| `tally detect` | the repo's remote, default branch and release convention, as one table |
| `tally count` | open PRs, stale branches and unreleased commits, each with its age |

## Rules that are not negotiable

- **Never report a count you did not read from the repository itself — an estimate is a guess wearing a number.**
- **Never claim a result you did not observe.** Say what you verified and what
  you did not.

<!-- press:agent-ui -->

## What's here

| Path | Is |
|---|---|
| `scripts/tally.js` | the CLI: `detect`, `count` |
| `references/anatomy.md` | the fixed shape of a tally report |

## Maintainer reference — not part of a user run

`skill-invariants.json` names what must not silently disappear, declares which
half of this skill is code, and lists the baseline eval set. The baseline is
pinned against a real run — see its `update_command` to refresh it.

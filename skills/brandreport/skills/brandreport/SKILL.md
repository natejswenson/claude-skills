---
name: brandreport
description: Analyze a person's personal online brand from nothing but their name and generate a report on it. Use when the user says "brand report", "brandreport", "analyze my online brand", "what does the internet say about me", "search my name and tell me what you find", "audit my online presence", "what does my personal brand look like", "how do I come across online", or gives a name and asks what's out there about that person. The skill discovers sources itself — profiles, sites, posts, mentions — the user never supplies a list.
user_invocable: true
version: 0.1.0
---

## Codex runtime

When running in Codex, invoke this skill as `$brandreport`. Resolve scripts, assets,
and references from the directory containing this SKILL.md, regardless of the
current working directory. Existing `~/.claude/` personal-data paths remain valid
and are still used by the bundled scripts; they do not require Claude to run.
Map `Read`/`Write`/`Edit`/`Bash` to the available file and shell tools, and
`WebSearch`/`WebFetch` to available web tools. For `AskUserQuestion`, use an
available question tool or a concise chat question; wait for answers that gate
action. Use Codex's delegation tools for required subagents when available;
otherwise disclose that independent execution is unavailable. Discover connected
apps by capability rather than assuming Claude MCP tool names exist.

# /brandreport — Give it just a name; it blind-searches the open web for that person's presence, keeps only what it can prove is them, and renders what it found as a press-styled brand report

You are running the **brandreport** skill.

**Announce at start:** "I'm using the brandreport skill — Give it just a name; it blind-searches the open web for that person's presence, keeps only what it can prove is them, and renders what it found as a press-styled brand report."

> Commands below run from the directory containing this `SKILL.md` (`$SKILL_DIR`).
> Resolve it once. Pass `--repo <path>` to work against the user's repo.

## The one rule

**Never attribute unverified content: nothing reaches the report unless it is tied to the actual person by a recorded corroborating signal (cross-links, shared handles, bio matches) — same-name findings it cannot tie are listed as unconfirmed, never silently included and never silently dropped.**

## What is code and what is judgment

The split is declared in `skill-invariants.json` and checked — a deterministic
step whose command does not exist fails `skillfactory verify`.

| Deterministic — the machine decides | Command |
|---|---|
| create the run layout for a subject | `node scripts/brandreport.js init` |
| emit the per-platform handle-sweep checklist | `node scripts/brandreport.js sweep` |
| file each fetched artifact with provenance and identity status | `node scripts/brandreport.js add` |
| table the corpus and its confirmed/unconfirmed split | `node scripts/brandreport.js status` |
| enforce the attribution gate before anything renders | `node scripts/brandreport.js gate` |
| render the press-styled HTML report offline from the snapshot | `node scripts/brandreport.js report` |

| Model judgment — nothing on disk answers it | Why |
|---|---|
| the blind discovery itself — which searches to run, which hits to follow, when coverage is enough | no file records where a person exists online; the search plan is invented per subject and adapts to what each round surfaces |
| identity corroboration — deciding a hit is the same person | cross-links, shared handles and bio overlap are read and weighed, not pattern-matched; the gate only checks the decision was recorded, the model makes it |
| the brand analysis — themes, consistency across platforms, gaps, how a stranger would read this person | judgment about impression and coherence that no snapshot states |

## The flow

### 1. Start the run

`brandreport init --subject "<name>"` — the run directory, the snapshot
corpus, the findings file, the report path. One table back. Runs live in
`~/.claude/brandreport/<slug>` by default; a run is fetched personal data
and never belongs in version control, so inside a repo point `--out` at a
gitignored directory (`brandreport-runs/<slug>` in this repo).

### 2. Discover — search rounds, then the sweep

The discovery itself is judgment; `references/discovery.md` is its shape:
seed from the bare name, anchor on the first artifact the person plainly
controls, widen from everything it links. Then the mandatory part:

`brandreport sweep --handle <every handle the anchor uses>` prints the
per-platform probe checklist. **Probe every row before discovery may stop** —
search indexes walled platforms badly, and the first real run of this skill
missed the subject's own LinkedIn and X by trusting search alone. An account
proven to exist but unreadable logged-out files with `--existence-only`;
an HTTP 200 with an empty body proves nothing either way.

File every artifact as it is fetched — `brandreport add` with a one-sentence
`--corroboration` for confirmed, `--why` for unconfirmed. The corpus and the
sweep table already answer most questions — **never ask about anything in
it.** Ask only when identity is genuinely ambiguous after probing (a
same-handle account whose display name matches no anchor), at most two
questions, one at a time. The subject may direct that such an artifact be
left out entirely *before it is filed* — honour it and say so in the
conversation; once filed, exclusion happens only through the report's
residue section, never by deletion.

### 3. Judge — write findings.json

Claims, themes, gaps, summary — the contract is `references/anatomy.md`.
Every claim and theme cites snapshot ids; gaps assert absence and cite
nothing.

### 4. Gate, then render, then show

`brandreport gate`, then `brandreport report`. Open the rendered report on
the user's own screen and put a screenshot in the transcript — a report the
user has not seen is not a result.

### 5. Re-runs refresh, never duplicate

Re-fetch the anchor artifacts first — profiles change, and a changed anchor
changes what downstream corroborations can say (`add --id sN` replaces a
snapshot in place, same citation key). Then re-run the sweep: platforms the
subject joined since, or newly cross-linked, are exactly what a stale report
misses.

## Commands

| Command | Returns |
|---|---|
| `brandreport init` | creates a run directory for a subject name and returns its layout as a table — snapshot dir, findings file, report path |
| `brandreport sweep` | prints the per-platform probe checklist for one or more handles, with the walled-platform workaround for each — run before discovery may stop |
| `brandreport add` | files one fetched artifact into the snapshot with provenance — URL, fetched-at, kind, identity status (confirmed/unconfirmed) and the corroboration note — and returns the updated corpus row |
| `brandreport status` | tables the whole corpus: every snapshot with its source, kind, identity status and corroboration, plus counts of confirmed vs unconfirmed |
| `brandreport gate` | enforces the one rule as code: exits non-zero if any confirmed item lacks a recorded corroboration, any findings claim cites a snapshot that does not exist, or any unconfirmed item is cited by a confirmed-section claim |
| `brandreport report` | renders findings + snapshot into the press-styled HTML brand report, fully offline — refuses to render if gate fails |

## Rules that are not negotiable

- **Never attribute unverified content: nothing reaches the report unless it is tied to the actual person by a recorded corroborating signal (cross-links, shared handles, bio matches) — same-name findings it cannot tie are listed as unconfirmed, never silently included and never silently dropped.**
- **Never claim a result you did not observe.** Say what you verified and what
  you did not.

<!-- press:runtime -->
In Claude Code, load `/press`; in Codex, load `$press`; then follow the shared PRESS terminal/UI contract from `brand/agent-ui.md`. Do not copy or override that contract here.
<!-- press:runtime -->

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

<!-- press:agent-ui -->

## What's here

| Path | Is |
|---|---|
| `scripts/brandreport.js` | the CLI: `init`, `add`, `status`, `gate`, `report` |
| `references/anatomy.md` | the run layout: snapshot dir with provenance sidecars, findings.json, and the report — and what each field means |
| `references/discovery.md` | how the blind search rounds work: seed queries from the bare name, widening rules, when to stop, and how corroboration is judged and recorded |
| `references/report.md` | the report's fixed sections — who was found where, the confirmed presence, the unconfirmed same-name residue, and the brand read |

## Maintainer reference — not part of a user run

`skill-invariants.json` names what must not silently disappear, declares which
half of this skill is code, and lists the baseline eval set. The baseline is
pinned against a real run — see its `update_command` to refresh it.

<!-- >>> press:agent-ui v0.10.0 sha256:61f4b7720b3c GENERATED by @natjswenson/press, do not edit -->
## Presentation — how a run should look

This skill is watched, not just run. Everything below assumes the user is
reading the conversation, so **the transcript is part of the product.**

**Keep the machinery invisible.** The user should see a short status line and a
table, not a scroll of raw command output. Concretely:

- **Keep file reads focused.** Scripts hand each other *paths*; when you need
  a file's text in context, use the host's available file-reading capability.
  In Claude Code, prefer `Read`; in Codex, use focused file or shell reads.
  Read only the relevant range. Never print file contents into the conversation;
  summarize the relevant result instead. A fetched page or script source is
  usually a wall of text in chat.
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

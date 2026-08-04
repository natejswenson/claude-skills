---
name: shipreport
description: Write an executive summary of the work actually shipped over a chosen time frame, built from real GitHub contributions and real Claude Code session transcripts, ranked so only what mattered appears, and rendered as a press-styled HTML report. Use when the user says "what did I ship this week", "shipreport", "write my weekly summary", "executive summary of my work", "status report for my manager", "what did I get done last month", "summarize what I shipped in July", or wants their commits, merged PRs, cut releases and coding sessions turned into a report someone who wasn't there can read.
user_invocable: true
version: 0.1.0
---

# /shipreport — an executive summary of shipped work, where every claim carries a receipt

You are running the **shipreport** skill. It reads a stretch of real GitHub
contributions and real Claude Code sessions, ranks them so only what mattered
appears, and renders a press-styled sheet for someone who was not in the room.

**Announce at start:** "I'm using the shipreport skill to summarise what you shipped."

> Commands below run from the directory containing this `SKILL.md` (`$SKILL_DIR`).
> Resolve it once.

## The one rule

**Every claim in the report carries a receipt — a commit SHA, pull request number, release tag or session event id that resolves against the local corpus — and a ranked item whose receipt does not resolve is dropped from the report, never softened into vague prose.**

The failure this exists to stop is not invention from nothing. It is **drift**:
"fixed the release flow" → "overhauled the release pipeline" → "rebuilt CI/CD",
each step defensible, the last one false. `receipts` is a gate, not a reminder —
it exits non-zero, and `render` runs it again before writing a byte.

## What is code and what is judgment

The split is declared in `skill-invariants.json` and checked — a deterministic
step whose command does not exist fails `skillfactory verify`.

| Deterministic — the machine decides | Command |
|---|---|
| collect GitHub contributions and Claude session transcripts, redact secrets and absolute paths at ingest so nothing unsafe is ever cached, and record a watermark so the second run is cheap | `node scripts/shipreport.js index` |
| score and order every candidate in the requested window, and draw the line between what appears in the report and what does not | `node scripts/shipreport.js rank` |
| resolve every citation in the drafted report back to a real artifact, failing the run when one does not resolve | `node scripts/shipreport.js receipts` |
| render the ranked items and approved prose into the press-styled HTML report | `node scripts/shipreport.js render` |

| Model judgment — nothing on disk answers it | Why |
|---|---|
| merge several ranked items into the one outcome a stakeholder would recognise, and choose the headline the time frame was actually about | the score orders candidates but cannot tell that three pull requests were one piece of work, and nothing on disk records which of them a reader would care about |
| write the prose for a reader with no context on the code — plain outcomes, no repository names or commit hashes in the body | translating a diff into why it mattered is judgment, and the audience is a person who was not there |
| decide what an ambiguous session actually accomplished when its commits and its transcript disagree | a session that ends without a commit may have been abandoned or may have been the investigation that made the next day cheap, and only a reader of the transcript can tell |

## The flow

### 1. Resolve the window — never ask what you can read

Default to the last 7 days. The request usually names the window already
("this week", "last month", "since the 1st") — read it, and **never ask about
anything in it**. A confirmation is not a question.

Ask at most one question, and only when the window is genuinely ambiguous.

### 2. Index

```bash
node scripts/shipreport.js index
```

One line of narration first — this is the slow step. The first run backfills a
year and takes a minute; later runs read the watermark and take seconds.

Report the table it prints. **Do not re-explain the redaction counts** — zero
redactions is the normal case and means nothing matched, not that redaction was
skipped.

### 3. Rank, and read the table

```bash
node scripts/shipreport.js rank --days 7
```

Report the ranked cut as-is. It shows every item above the line, a few near
misses, and the signals behind each score — so the user can see *why* something
did or did not make it before a word of prose exists.

**If the top items all score identically, say so.** The line is then being drawn
by a tiebreak, not by ranking, and the report will be arbitrary. That is a
finding, not a detail to smooth over.

### 4. Read what you are about to describe

This is the step that separates a real report from a plausible one. For each
item you intend to feature, actually look at it — `gh pr view`, `gh release
view`, or the session digest in the corpus. Write the sentence **from** the
artifact.

**Never write the sentence first and then hunt for a receipt to attach.** The
gate cannot catch that, and nothing can.

### 5. Write the draft

A JSON file — `references/receipts.md` has the shape. Three things to hold:

- **No identifier in any prose field.** No `#412`, no hash, no `owner/repo`.
  The gate fails the draft, and the reason is the audience: an identifier in a
  sentence assumes a reader who already knows your repositories.
- **Do not write numbers.** `render` computes the strip from the cited items.
- **The line is guidance, not a filter.** Anything in the corpus resolves. If
  the ranking buried something that mattered, cite it anyway — then say which
  weight was wrong.

### 6. Gate it

```bash
node scripts/shipreport.js receipts --draft <file>
```

If it refuses, **fix the draft, never the checker.** A claim that cannot find a
receipt is a claim to delete or shrink — "investigated" is a real, citable
outcome; "fixed" is not, until something merged.

### 7. Render, and show it

```bash
node scripts/shipreport.js render --draft <file> --out <file.html>
```

It opens in the browser on its own. **Never pass `--no-open` in an interactive
session** — the user should see the sheet appear on their own screen, not read
a paragraph about it.

Then report one table (section, items, receipts), one sentence, and stop.
Offer to adjust; do not narrate the design.

## Commands

| Command | Returns |
|---|---|
| `shipreport index` | source, since, seen, new, cached — plus redaction counts and the new watermark |
| `shipreport rank` | rank, kind, item, score, signals, receipt — then window, candidates, above-the-line, folds, floor, top |
| `shipreport receipts` | claim, receipt, resolved — then a verdict; **exits non-zero on any failure** |
| `shipreport render` | section, items, receipts — then the output path, size and window |

Useful flags: `--days N` / `--since --until`, `--top`, `--floor`, `--all`
(print every candidate), `--full` (force a backfill), `--corpus <dir>`.

## Rules that are not negotiable

- **Every claim in the report carries a receipt — a commit SHA, pull request number, release tag or session event id that resolves against the local corpus — and a ranked item whose receipt does not resolve is dropped from the report, never softened into vague prose.**
- **Never claim a result you did not observe.** Say what you verified and what
  you did not.
- **Never count activity as achievement.** Forty sessions and no releases is a
  report that says exactly that. A thin week produces a short report, and a
  short honest report is the correct output.
- **Never fix a refusal by weakening the gate.** `receipts` is argued with by
  changing the draft.
- **Never hand-write a brand value.** `assets/report.css`'s `:root` block is a
  press-generated region; change `tokens.json` and re-run `press emit`.

<!-- press:agent-ui -->

## What's here

| Path | Is |
|---|---|
| `scripts/shipreport.js` | the CLI: `index`, `rank`, `receipts`, `render` |
| `scripts/lib/redact.mjs` | the redaction classes, applied at ingest and nowhere else |
| `scripts/lib/sessions.mjs` | a Claude Code transcript reduced to a citable digest |
| `scripts/lib/github.mjs` | the only networked code — `gh` searches and release lookups |
| `scripts/lib/corpus.mjs` | the cache, the watermark, and receipt resolution |
| `scripts/lib/rank.mjs` | scoring, squash folding, release-series collapse, the line |
| `scripts/lib/receipts.mjs` | the one rule as code: receipt, resolution, no raw ids in prose |
| `scripts/lib/render.mjs` | the press-styled sheet; computes the numbers strip itself |
| `assets/report.css` | the sheet's stylesheet — its `:root` is a press region |
| `references/anatomy.md` | the fixed shape of the report — its sections, the receipt appendix, and what is never allowed in the body |
| `references/ranking.md` | the scoring function, why each signal is weighted the way it is, and what drawing the line means |
| `references/receipts.md` | the citation contract — what counts as a resolvable receipt, and the drop rule that follows when one does not resolve |
| `references/sources.md` | where the data comes from — the session transcript shape, the GitHub queries, the redaction classes, and the watermark model that makes the second run cheap |

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

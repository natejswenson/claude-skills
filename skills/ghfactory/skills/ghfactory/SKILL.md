---
name: ghfactory
description: Generate GitHub Actions workflows that are verified rather than hoped for — every action ref resolved to a real pinned SHA, actionlint and zizmor clean, staleness reported, before you ever see the YAML. Use when the user asks to create, add, fix, review, harden or speed up a GitHub Actions workflow, CI, a CI/CD pipeline, a release or publish workflow, a deploy workflow, a matrix build, a scheduled job, or says "set up CI", "add a workflow", "my workflow is broken", "why is my action failing", "pin my actions", or "audit my workflows".
user_invocable: true
version: 0.2.1
---

## Codex runtime

When running in Codex, invoke this skill as `$ghfactory`. Resolve scripts, assets,
and references from the directory containing this SKILL.md, regardless of the
current working directory. Existing `~/.claude/` personal-data paths remain valid
and are still used by the bundled scripts; they do not require Claude to run.
Map `Read`/`Write`/`Edit`/`Bash` to the available file and shell tools, and
`WebSearch`/`WebFetch` to available web tools. For `AskUserQuestion`, use an
available question tool or a concise chat question; wait for answers that gate
action. Use Codex's delegation tools for required subagents when available;
otherwise disclose that independent execution is unavailable. Discover connected
apps by capability rather than assuming Claude MCP tool names exist.

# /ghfactory — GitHub Actions that are verified, not hoped for

You are running the **ghfactory** skill. It writes GitHub Actions workflows for
whatever the user needs, in one house shape, and — this is the whole point —
**proves the YAML before showing it.**

**Announce at start:** "I'm using the ghfactory skill to build and verify this workflow."

> Commands below run from the directory containing this `SKILL.md` (`$SKILL_DIR`).
> Resolve it once. Pass `--repo <path>` to work against the user's repo; never
> `cd` into their repo and never write outside `.github/workflows/` without asking.

## The one rule

**Say which rung you reached, and never claim more.**

Every other AI workflow generator generates and hopes. The value here is the
ladder below and the honesty about where it stopped. A workflow that cleared
rungs 0–2 is *"lint-clean, refs real, commands run locally"* — that is **not**
"working". Only a green CI run proves that, and you did not do one.

Never say a workflow works. Say what you verified.

## The ladder

Run it with one command. It costs about a second.

```bash
node bin/ghfactory.js verify <file…>
```

| Rung | Checks | Catches | Tool |
|---|---|---|---|
| 0 | every `uses:` resolves; every `with:` key is real; how stale the pin is | hallucinated actions, dead refs, misspelled inputs, 3-majors-behind pins | `gh api` |
| 1 | syntax, expressions, contexts, shell | ~everything structural | `actionlint` |
| 2 | injection, permissions, pinning, credential persistence | the security class | `zizmor` |

**Rung 0 is the one nothing else does.** Measured: against a deliberately broken
workflow, actionlint caught six defect classes and missed exactly two —
`actions/checkout@v99` and `actions/setup-nodejs@v4` (an action that does not
exist). Both are signature failures of model-written YAML. Neither linter checks
that a ref exists.

**Staleness is invisible to every linter.** A hand-written workflow pinning
`actions/checkout@v5` passed actionlint *and* zizmor completely clean while
being two majors behind. `verify` reads the `# v5` trailing comment on a SHA pin
precisely so the recommended pin format is not the one format staleness hides in.

Rungs degrade rather than fail: actionlint may not be installed, and the run
still reports what it could check and what it could not.

### Rungs you must not skip past

3. **Run the commands the workflow will run — locally, now.** `npm ci && npm test`
   in the user's repo. Catches the environmental failures no linter models.
   Announce it with one lowercase line (`running your test command locally…`).
4. **`act`** — offer, never assume. It fakes `actions/checkout` with a `docker cp`,
   so `fetch-depth`, `ref` and `persist-credentials` are never exercised. Opt-in
   deep check only.
5. **A real CI run.** Only after the user pushes anyway. Never trigger one they
   did not ask for. On failure surface `gh run view --log-failed` — the one
   failing step, never the whole log.

## The flow

### 1. Detect — never ask what you can read

```bash
node bin/ghfactory.js detect --repo <path>
```

One call, three tables: **Signal · Detected · From**, the existing workflows, and
the required checks. Ecosystem, package manager, lockfile, runtime version, test
and lint commands, monorepo shape, default branch, visibility, auto-merge,
protection contexts and secret **names** all come from the repo.

**Never ask about anything in that table.** If a signal is ambiguous, state the
top candidate with its evidence and let silence confirm it. A confirmation is not
a question.

**Always ask** about intent, which no file records: deploy targets and
environments, which secrets a release needs, whether the workflow may write.

### 2. Ask at most two questions, one at a time

Opinionated, with a one-line reason. Zero questions is correct when the request
already named the workflow.

1. **Purpose**, only if not implied — *"I'd start with PR tests: it's the only one
   that can gate a merge."*
2. **The one genuinely ambiguous value**, as a confirmation with a default.

A third question is warranted only when the answer changes the blast radius —
adding a required check, `contents: write`, or anything that deploys.

### 3. Write the YAML

Read `references/anatomy.md` for the fixed shape every generated workflow takes,
and `references/recipes.md` for the current per-ecosystem recipe. Both are short.

**Resolve versions live; never recall them.** `references/recipes.md` deliberately
does not freeze version numbers — published research puts the typical workflow
7+ months behind, and a frozen table starts rotting the day it ships.

```bash
node bin/ghfactory.js resolve actions/checkout actions/setup-node
```

### 4. Verify before the user sees anything

Run the ladder, **fix what it finds, re-run.** The user should never be shown a
red preview. Then present:

- a **Plan** table — File · Action · Triggers · Jobs · Runtime · Permissions · Pinned
- the **ladder** table from `verify`
- the YAML *only if asked*; on an update show the diff hunk, never the whole file

### 5. Stamp the masthead and write

```bash
node bin/ghfactory.js header <file> --purpose "<one line: what this workflow is for>"
```

Every generated workflow carries the press masthead as a marked region. **Never
hand-write it** — the brand lives in `press/brand/tokens.json` and nowhere else.
`node bin/ghfactory.js check <file…>` re-derives it and fails on drift, a missing
region, or a stale press version.

### 6. Report

| Column | Content |
|---|---|
| File | `.github/workflows/ci.yml` |
| Status | created / updated |
| Check name | `ci / test` |
| Verified to | rung 2 — refs real, lint-clean, commands pass locally |
| Not verified | no CI run yet |
| Next | the exact commit + push command |

Then one sentence, and stop.

## Rules that are not negotiable

- **Never silently overwrite an existing workflow.** Show the diff, wait for an
  explicit yes. A workflow file is often load-bearing for merges.
- **Never add a required status check without asking, and recommend against it
  until the check has gone green once.** A required check that never passes
  blocks every future merge — a repo-wide outage caused by a helpful default.
- **Never emit an action ref you have not resolved.** Not one. This is the rule
  the whole skill exists to enforce.
- **Never interpolate `${{ github.event.* }}` into a `run:` block.** Go through
  `env:`. It is remote code execution, and it is the most common real vulnerability
  in real workflows.
- **Never write secrets, tokens, or a `.env` into a workflow.** Read secret
  *names* only; a value must never enter the transcript.
- **`pull_request_target` needs an explicit conversation**, never a default. See
  `references/security.md`.

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

## What's here

| Path | Is |
|---|---|
| `bin/ghfactory.js` | the CLI: `detect`, `resolve`, `verify`, `header`, `check` |
| `lib/resolve.mjs` | ref → SHA, `action.yml` inputs, staleness — rung 0 |
| `lib/verify.mjs` | the ladder, with graceful degradation |
| `lib/detect.mjs` | the question budget |
| `lib/header.mjs` | the press masthead, via press's own emitter |
| `references/anatomy.md` | the fixed shape of a generated workflow |
| `references/recipes.md` | per-ecosystem recipes, versions resolved live |
| `references/security.md` | the rules linters do not catch |

## Maintainer reference — not part of a user run

The baseline eval (`tests/baseline.test.mjs`) pins the emitted masthead
byte-exactly and asserts the ladder is two-sided: a known-good workflow passes
and a known-bad one fails on each rung it should. `skill-invariants.json` names
what must not silently disappear.

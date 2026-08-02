---
name: forge
description: Generate GitHub Actions workflows that are verified rather than hoped for — every action ref resolved to a real pinned SHA, actionlint and zizmor clean, staleness reported, before you ever see the YAML. Use when the user asks to create, add, fix, review, harden or speed up a GitHub Actions workflow, CI, a CI/CD pipeline, a release or publish workflow, a deploy workflow, a matrix build, a scheduled job, or says "set up CI", "add a workflow", "my workflow is broken", "why is my action failing", "pin my actions", or "audit my workflows".
user_invocable: true
version: 0.1.2
---

# /forge — GitHub Actions that are verified, not hoped for

You are running the **forge** skill. It writes GitHub Actions workflows for
whatever the user needs, in one house shape, and — this is the whole point —
**proves the YAML before showing it.**

**Announce at start:** "I'm using the forge skill to build and verify this workflow."

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
node bin/forge.js verify <file…>
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
node bin/forge.js detect --repo <path>
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
node bin/forge.js resolve actions/checkout actions/setup-node
```

### 4. Verify before the user sees anything

Run the ladder, **fix what it finds, re-run.** The user should never be shown a
red preview. Then present:

- a **Plan** table — File · Action · Triggers · Jobs · Runtime · Permissions · Pinned
- the **ladder** table from `verify`
- the YAML *only if asked*; on an update show the diff hunk, never the whole file

### 5. Stamp the masthead and write

```bash
node bin/forge.js header <file> --purpose "<one line: what this workflow is for>"
```

Every generated workflow carries the press masthead as a marked region. **Never
hand-write it** — the brand lives in `press/brand/tokens.json` and nowhere else.
`node bin/forge.js check <file…>` re-derives it and fails on drift, a missing
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

<!-- >>> press:agent-ui v0.8.1 sha256:ce9c1c6b30d6 GENERATED by @natjswenson/press, do not edit -->
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

## What's here

| Path | Is |
|---|---|
| `bin/forge.js` | the CLI: `detect`, `resolve`, `verify`, `header`, `check` |
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

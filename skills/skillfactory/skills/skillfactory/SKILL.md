---
name: skillfactory
description: Create a new Claude Code skill end to end — branded with press, wired into CI by ghfactory, promoted by shipflow, split into deterministic scripts and model judgment, and not finished until a real run of it is frozen as its baseline eval. Use when the user says "create a skill", "new skill", "make me a skill that", "scaffold a skill", "add a skill to the marketplace", or wants an idea turned into a versioned, tested, installable skill.
user_invocable: true
version: 0.4.0
---

## Codex runtime

When creating a plugin in this repository, run `python3 tools/sync_codex.py`
after scaffolding and version changes, then `python3 tools/sync_codex.py --check`.
This creates the Codex manifest and catalog entry alongside the existing release
metadata. For a different repository, use its Codex plugin conventions or the
available plugin-creator skill; this repo's scaffold alone creates Claude metadata.

When running in Codex, invoke this skill as `$skillfactory`. Resolve scripts, assets,
and references from the directory containing this SKILL.md, regardless of the
current working directory. Existing `~/.claude/` personal-data paths remain valid
and are still used by the bundled scripts; they do not require Claude to run.
Map `Read`/`Write`/`Edit`/`Bash` to the available file and shell tools, and
`WebSearch`/`WebFetch` to available web tools. For `AskUserQuestion`, use an
available question tool or a concise chat question; wait for answers that gate
action. Use Codex's delegation tools for required subagents when available;
otherwise disclose that independent execution is unavailable. Discover connected
apps by capability rather than assuming Claude MCP tool names exist.

# /skillfactory — skills that are finished, not just written

You are running the **skillfactory** skill. It turns an idea into a skill that is
branded, wired into every registry, split into code and judgment, tested, and
pinned against a run that actually happened.

**Announce at start:** "I'm using the skillfactory skill to build this one end to end."

> Commands below run from the directory containing this `SKILL.md` (`$SKILL_DIR`).
> Resolve it once. Pass `--repo <path>` to target a repo other than this one.

## Before anything: the model gate

skillfactory is built for the strongest model available. The spec, the one rule and the
deterministic/nondeterministic split are judgment, and a weaker model produces a
skill that passes every lint in this repo and is still bad.

**If this session is not on the most capable model, say so in one line and offer
to switch (`/model opus`).** One line, then continue if the user declines — never
silently proceed as though it made no difference.

## The one rule

**A skill is done when a real run of it is frozen in its evals — not when the
files exist.**

Anything can emit a folder of markdown. The ladder below is the whole value, and
so is the honesty about where a run stopped. **Say which rung you reached, and
never claim more.**

## The ladder

```bash
node scripts/skillfactory.js verify --skill <name>
```

| Rung | Proves | How |
|---|---|---|
| 0 | wiring resolves — marketplace, plugin.json, required check, press target, caller | `skillfactory verify` |
| 1 | house lints pass — `score_skill 100`, `lint_plugin`, `lint_baseline` | `skillfactory verify` |
| 2 | the skill's own tests pass | `npm test` in the skill |
| **3** | **a real run is frozen as the baseline** | `skillfactory freeze` |
| 4 | CI green on the `feature/* → dev` PR | GitHub |
| 5 | released — the tag is cut | version bump + promotion |

**Never call a skill done below rung 3.** Rungs 0–2 mean the scaffolding is
correct, which is not the same as the skill working — the exact conflation ghfactory
refuses about workflows, applied to skills.

Rung 3 is not a promise, it is structural: the scaffolded `baseline.test.mjs`
**fails** until a real run is frozen, so `ci / <name>` cannot go green on a skill
nobody has run.

## What is code and what is judgment

Every skill skillfactory makes declares this split in `skill-invariants.json`, and
`skillfactory verify` fails when a deterministic step names a command that does not
exist. Prose pretending to be code is the thing the declaration exists to catch.

| Deterministic — the machine decides | Command |
|---|---|
| read every registry the house keeps | `node scripts/skillfactory.js detect` |
| grade a spec before it costs anything | `node scripts/skillfactory.js check-spec` |
| emit the tree and all eight wiring points | `node scripts/skillfactory.js scaffold` |
| turn a real run into a baseline eval | `node scripts/skillfactory.js freeze` |
| run the ladder and report the rung | `node scripts/skillfactory.js verify` |

| Model judgment — nothing on disk answers it | Why |
|---|---|
| what the skill is *for*, and what it refuses to do | the one rule is the only thing that makes it more than a prompt |
| which half of the work is deterministic | a wrong split ships either an unrepeatable skill or a script with a chat interface |
| what a real run looks like | only a person knows which run is representative enough to pin |
| the prose in SKILL.md and `references/` | tone, ordering and what to leave out |

## The flow

### 1. Detect — never ask what you can read

```bash
node scripts/skillfactory.js detect --repo <path>
```

Two tables: the registries, and every name already taken with its stack and
version. **Never ask about anything in them.** A name collision, the required
check set, the pinned action SHAs and whether press is available are all facts.
A confirmation is not a question.

### 2. Ask at most three questions, one at a time

Opinionated, each with a one-line reason. Wait for the answer before asking the
next — a batch of questions is a form, and a form is the UX failure this skill
exists to avoid. The three that are always worth asking, when the request has
not already answered them:

1. **What does it do**, stated as the trigger sentence a user would type.
2. **What is its one rule** — the thing it refuses to do. If there is no answer,
   the skill does not have a point yet; say so rather than scaffolding anyway.
3. **What does a real run look like** — because rung 3 needs one, and finding
   that out at the end is how a skill ships without an eval.

### 3. Write the spec, and grade it

```bash
node scripts/skillfactory.js spec <name> --out <file>      # a template to fill in
node scripts/skillfactory.js check-spec --spec <file>      # grade it
```

The spec is one page and it is the only approval gate before files appear. Show
it, get a yes, then grade it. `check-spec` is deliberately harsher than CI: CI
grades a finished skill, this grades an intention, and it is the last moment a
bad answer costs nothing.

It rejects things every lint in this repo would accept — a description too thin
to ever match a real request, a split with an empty half, an eval plan with no
known-bad case. Fix the spec, never the checker.

**Name the skill after the job, never a metaphor.** Every part of the name has
to appear in what the spec says the skill does — give or take a role word like
`factory`, `report` or `sync`, and an abbreviation whose expansion is in the
text. `ghfactory`, `eval`, `skillfactory` and `pluginsync` all pass; `forge`,
`assay` and `smith` were the same three skills under names that said nothing,
and all three had to be renamed after they shipped. A name is the only thing a
user sees before deciding whether the skill is for them, and renaming later
costs a directory, a plugin id, a slash command, a tag prefix and a required
check.

### 4. Scaffold — one command, everything

```bash
node scripts/skillfactory.js scaffold --spec <file> [--dry-run]
```

The tree plus all eight wiring points, applied all-or-nothing: an unresolvable
anchor aborts before the first byte is written. Wiring a skill in halfway is
worse than not wiring it, because the half that landed makes the rest look done.

`CLAUDE.md` documents this as ten manual steps. Doing them by hand is how
`ci / shipflow` sat un-required from the day it was introduced.

### 5. Stamp the brand — never hand-write it

```bash
press emit --repo <path> --init --target <name>-agent-ui --target <name>-readme
node skills/press/skills/press/tests/fixtures/update-pre-migration.mjs
ghfactory header .github/workflows/<name>.yml
ghfactory verify .github/workflows/<name>.yml
```

**The golden refresh is not optional.** press pins one golden per target, so two
new targets mean `ci / press` goes red until its fixture set is regenerated —
in the PR that added them, which is the point.

The run-presentation contract and the README masthead are **generated regions**;
the workflow masthead comes from press through ghfactory. **Never hand-write a brand
value.** This brand was once eight hand-ported copies across four repos with five
names for the same orange, and press exists to end that.

**The README follows the house style** — fixed head, free tail, fixed foot, with
the masthead anchored on a bare `# <name>` H1. `references/readme.md` is the
contract and `skillfactory verify` reports it as `readme-structure`. The scaffolder
writes a conforming README already; if you edit it, keep the H1 exactly the
skill name, or press's masthead anchor detaches and the next `emit --init`
splices a second region below the first.

### 6. Author the skill — the part that is not mechanical

Fill in `SKILL.md`'s body, `references/`, and the commands in `scripts/`. The
scaffolded CLI runs and each command exits non-zero with an honest
"not implemented yet" — so a half-built skill is never mistaken for a working one.

### 7. Dogfood it — actually run it

Run the new skill end to end on a **real** input. Not a fixture, not a rehearsal.
This is the step that finds the things review cannot.

### 8. Freeze the run

```bash
node scripts/skillfactory.js freeze --skill <name> --from <run output dir> \
  --command "<the command that reproduces it, with \$OUT for the output dir>" \
  --trap-command "<a command that MUST exit non-zero>"
```

Freeze copies the artifacts in, records the command, and generates a baseline
test that **re-runs that command and byte-compares** — so the eval fails when
behaviour changes, not merely when someone edits a fixture. It refuses a command
that looks networked: a CI baseline that calls the network costs money and flakes.

Without `--trap-command` the generated test **fails**, on purpose. A baseline
that only asserts good-input-passes goes green the day someone weakens a checker.

### 9. Verify, and say the rung

```bash
node scripts/skillfactory.js verify --skill <name>
```

Two tables — every conformance check, then the ladder — and one line naming the
highest rung reached. Report that line verbatim. Do not round it up.

### 10. Ship it

Branch `feature/<name>`, PR into `dev`, never into `main`. The version bump and
the `CHANGELOG.md` entry go in the **same** change: releases here are
publish-on-merge, so a follow-up promotion to fix release notes is too late — the
tag is already cut.

Two things skillfactory writes but cannot apply, and must be said out loud:

- **`.github/repo-settings.sh` only takes effect when an admin runs it.** Editing
  the contexts array applies nothing. Until it runs, `ci / <name>` gates nothing.
- **The baseline row in `CLAUDE.md`'s eval table is prose**, so the agent writes
  it. What the baseline *catches* is judgment, not a template.

## Rules that are not negotiable

- **Never call a skill done below rung 3.** Say which rung you reached.
- **Never hand-write a brand value.** Regions are generated; edit `tokens.json`.
- **Never open a PR into `main`.** Feature work goes to `dev`; only `dev → main`
  promotes.
- **Never weaken a check to get green.** `check-spec` and the baseline trap exist
  to be argued with, not edited. Fix the input.
- **Never overwrite an existing skill.** A directory that already exists is far
  more likely to be someone's work than a mistake; `scaffold` refuses without
  `--force`.
- **Never claim a result you did not observe.** If the tests were not run, say
  they were not run.

<!-- press:agent-ui -->

## What's here

| Path | Is |
|---|---|
| `scripts/skillfactory.js` | the CLI: `detect`, `spec`, `check-spec`, `scaffold`, `freeze`, `verify` |
| `scripts/lib/house.mjs` | every registry, read from disk — the question budget |
| `scripts/lib/conform.mjs` | the two-tier check list: house, then skillfactory |
| `scripts/lib/readme.mjs` | the README house style, as a check |
| `scripts/lib/spec.mjs` | the spec contract, graded harder than CI |
| `scripts/lib/scaffold.mjs` | the ten-step checklist as one pure plan |
| `scripts/lib/apply.mjs` | all-or-nothing application of that plan |
| `scripts/lib/templates.mjs` | every byte a new skill starts life with |
| `scripts/lib/freeze.mjs` | a real run turned into a reproducible eval |
| `references/anatomy.md` | the fixed shape of a generated skill |
| `references/readme.md` | the README house style: fixed head, free tail, fixed foot |
| `references/wiring.md` | the eight registries, and what breaks when one is missed |
| `references/evals.md` | what makes a baseline real instead of decorative |

## Maintainer reference — not part of a user run

`skill-invariants.json` names what must not silently disappear. The baseline is
pinned against a real `scaffold` run of the `repocount` demo spec and re-runs it on
every test; `scripts/tests/conformance.test.mjs` asserts every skill shipped in
this repo still satisfies the house tier, with a floor so a resolver that matches
nothing goes red instead of quiet.

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

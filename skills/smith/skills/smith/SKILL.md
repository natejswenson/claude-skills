---
name: smith
description: Create a new Claude Code skill end to end — branded with press, wired into CI by forge, promoted by shipflow, split into deterministic scripts and model judgment, and not finished until a real run of it is frozen as its baseline eval. Use when the user says "create a skill", "new skill", "make me a skill that", "scaffold a skill", "add a skill to the marketplace", or wants an idea turned into a versioned, tested, installable skill.
user_invocable: true
version: 0.1.0
---

# /smith — skills that are finished, not just written

You are running the **smith** skill. It turns an idea into a skill that is
branded, wired into every registry, split into code and judgment, tested, and
pinned against a run that actually happened.

**Announce at start:** "I'm using the smith skill to build this one end to end."

> Commands below run from the directory containing this `SKILL.md` (`$SKILL_DIR`).
> Resolve it once. Pass `--repo <path>` to target a repo other than this one.

## Before anything: the model gate

smith is built for the strongest model available. The spec, the one rule and the
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
node scripts/smith.js verify --skill <name>
```

| Rung | Proves | How |
|---|---|---|
| 0 | wiring resolves — marketplace, plugin.json, required check, press target, caller | `smith verify` |
| 1 | house lints pass — `score_skill 100`, `lint_plugin`, `lint_baseline` | `smith verify` |
| 2 | the skill's own tests pass | `npm test` in the skill |
| **3** | **a real run is frozen as the baseline** | `smith freeze` |
| 4 | CI green on the `feature/* → dev` PR | GitHub |
| 5 | released — the tag is cut | version bump + promotion |

**Never call a skill done below rung 3.** Rungs 0–2 mean the scaffolding is
correct, which is not the same as the skill working — the exact conflation forge
refuses about workflows, applied to skills.

Rung 3 is not a promise, it is structural: the scaffolded `baseline.test.mjs`
**fails** until a real run is frozen, so `ci / <name>` cannot go green on a skill
nobody has run.

## What is code and what is judgment

Every skill smith makes declares this split in `skill-invariants.json`, and
`smith verify` fails when a deterministic step names a command that does not
exist. Prose pretending to be code is the thing the declaration exists to catch.

| Deterministic — the machine decides | Command |
|---|---|
| read every registry the house keeps | `node scripts/smith.js detect` |
| grade a spec before it costs anything | `node scripts/smith.js check-spec` |
| emit the tree and all seven wiring points | `node scripts/smith.js scaffold` |
| turn a real run into a baseline eval | `node scripts/smith.js freeze` |
| run the ladder and report the rung | `node scripts/smith.js verify` |

| Model judgment — nothing on disk answers it | Why |
|---|---|
| what the skill is *for*, and what it refuses to do | the one rule is the only thing that makes it more than a prompt |
| which half of the work is deterministic | a wrong split ships either an unrepeatable skill or a script with a chat interface |
| what a real run looks like | only a person knows which run is representative enough to pin |
| the prose in SKILL.md and `references/` | tone, ordering and what to leave out |

## The flow

### 1. Detect — never ask what you can read

```bash
node scripts/smith.js detect --repo <path>
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
node scripts/smith.js spec <name> --out <file>      # a template to fill in
node scripts/smith.js check-spec --spec <file>      # grade it
```

The spec is one page and it is the only approval gate before files appear. Show
it, get a yes, then grade it. `check-spec` is deliberately harsher than CI: CI
grades a finished skill, this grades an intention, and it is the last moment a
bad answer costs nothing.

It rejects things every lint in this repo would accept — a description too thin
to ever match a real request, a split with an empty half, an eval plan with no
known-bad case. Fix the spec, never the checker.

### 4. Scaffold — one command, everything

```bash
node scripts/smith.js scaffold --spec <file> [--dry-run]
```

The tree plus all seven wiring points, applied all-or-nothing: an unresolvable
anchor aborts before the first byte is written. Wiring a skill in halfway is
worse than not wiring it, because the half that landed makes the rest look done.

`CLAUDE.md` documents this as ten manual steps. Doing them by hand is how
`ci / shipflow` sat un-required from the day it was introduced.

### 5. Stamp the brand — never hand-write it

```bash
press emit --repo <path> --init --target <name>-agent-ui --target <name>-readme
forge header .github/workflows/<name>.yml
forge verify .github/workflows/<name>.yml
```

The run-presentation contract and the version badge are **generated regions**;
the workflow masthead comes from press through forge. **Never hand-write a brand
value.** This brand was once eight hand-ported copies across four repos with five
names for the same orange, and press exists to end that.

### 6. Author the skill — the part that is not mechanical

Fill in `SKILL.md`'s body, `references/`, and the commands in `scripts/`. The
scaffolded CLI runs and each command exits non-zero with an honest
"not implemented yet" — so a half-built skill is never mistaken for a working one.

### 7. Dogfood it — actually run it

Run the new skill end to end on a **real** input. Not a fixture, not a rehearsal.
This is the step that finds the things review cannot.

### 8. Freeze the run

```bash
node scripts/smith.js freeze --skill <name> --from <run output dir> \
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
node scripts/smith.js verify --skill <name>
```

Two tables — every conformance check, then the ladder — and one line naming the
highest rung reached. Report that line verbatim. Do not round it up.

### 10. Ship it

Branch `feature/<name>`, PR into `dev`, never into `main`. The version bump and
the `CHANGELOG.md` entry go in the **same** change: releases here are
publish-on-merge, so a follow-up promotion to fix release notes is too late — the
tag is already cut.

Two things smith writes but cannot apply, and must be said out loud:

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
| `scripts/smith.js` | the CLI: `detect`, `spec`, `check-spec`, `scaffold`, `freeze`, `verify` |
| `scripts/lib/house.mjs` | every registry, read from disk — the question budget |
| `scripts/lib/conform.mjs` | the two-tier check list: house, then smith |
| `scripts/lib/spec.mjs` | the spec contract, graded harder than CI |
| `scripts/lib/scaffold.mjs` | the ten-step checklist as one pure plan |
| `scripts/lib/apply.mjs` | all-or-nothing application of that plan |
| `scripts/lib/templates.mjs` | every byte a new skill starts life with |
| `scripts/lib/freeze.mjs` | a real run turned into a reproducible eval |
| `references/anatomy.md` | the fixed shape of a generated skill |
| `references/wiring.md` | the seven registries, and what breaks when one is missed |
| `references/evals.md` | what makes a baseline real instead of decorative |

## Maintainer reference — not part of a user run

`skill-invariants.json` names what must not silently disappear. The baseline is
pinned against a real `scaffold` run of the `tally` demo spec and re-runs it on
every test; `scripts/tests/conformance.test.mjs` asserts every skill shipped in
this repo still satisfies the house tier, with a floor so a resolver that matches
nothing goes red instead of quiet.

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

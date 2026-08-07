# anatomy — the fixed shape of a generated skill

```
skills/<name>/                        the plugin root — docs only
  LICENSE  README.md  CHANGELOG.md
  .claude-plugin/plugin.json          name == the directory, version == everything else

skills/<name>/skills/<name>/          the skill proper, one level deeper
  SKILL.md                            the nondeterministic half: judgment, in markdown
  skill-invariants.json               prose guardrails + the split + the baseline
  package.json                        version source, `npm test` entry point
  references/*.md                     markdown only
  scripts/                            the deterministic half — ALL of it
    <name>.js                         one CLI entry point
    lib/*.mjs
    tests/*.test.mjs
  evals/
    inputs/                           what a run was given
    baseline/                         what that run produced, frozen
```

## Why the skill is nested twice

Claude Code's plugin auto-discovery only scans `skills/<subdir>/SKILL.md`. A
root-level `SKILL.md` is invisible to Claude Desktop even though the CLI
currently tolerates it. Only `.claude-plugin/`, `LICENSE`, `README.md` and
`CHANGELOG.md` stay at the outer level.

## Why one code directory

The root should read, not scroll. A skill is a markdown instruction set that
calls deterministic code; when `bin/`, `lib/`, `src/`, `schemas/` and `scripts/`
all sit beside `SKILL.md`, the thing a reader came for is buried in the thing it
delegates to. Everything mechanical goes under `scripts/`, including its own
tests — `scripts/**/*.test.mjs` is a path `lint_baseline.py` already recognises
as discoverable, so no CI wiring is needed.

`ghfactory` and `shipflow` predate this and keep `bin/ lib/ tests/ evals/`. They are
shipped and not worth churning; new skills get the clean shape.

## What each file owes

| File | Owes |
|---|---|
| `SKILL.md` | the one rule, the flow, the split table, the non-negotiable rules |
| `skill-invariants.json` | every guardrail no code enforces, with a *rationale* that says what breaks without it |
| `scripts/<name>.js` | one command per step, each returning everything that step needs, already as a table |
| `scripts/tests/skill-contract.test.mjs` | that the guardrails are still in SKILL.md and the split is real |
| `scripts/tests/baseline.test.mjs` | the frozen run — red until there is one |
| `references/*.md` | the detail SKILL.md points at rather than inlines |

## The frontmatter

```yaml
---
name: <name>            # == the directory == plugin.json name. Never package.json name.
description: <…>        # the ONLY text a user's request is matched against
user_invocable: true
version: 0.1.0          # == package.json == plugin.json, all three or the lint fails
---
```

`description` is not a summary. It is the trigger surface: name the phrases
someone would actually type. `score_skill.py` accepts 20 characters; a
20-character description is a skill that never fires.

## The name

The name is the job, spelled out. Every part of it must appear in what the spec
says the skill does — allowing for a role word (`factory`, `builder`, `report`,
`lint`, `sync`, `stats`, `eval`, …) and an abbreviation whose expansion is in
the text (`gh` when the description says GitHub). `check-spec` enforces this;
`nameCoverage` in `scripts/lib/spec.mjs` is the implementation.

| name | verdict | why |
|---|---|---|
| `ghfactory` | ok | `gh` ← "GitHub" in the description, `factory` is a role word |
| `skillfactory` | ok | `skill` ← "makes skills" |
| `eval` | ok | role word, and "write **eval**s for my skill" is a stated trigger |
| `pluginsync` | ok | `plugin` ← "the **plugin**s installed on this machine" |
| `forge` | rejected | says nothing about GitHub Actions |
| `assay` | rejected | says nothing about grading a run |
| `smith` | rejected | says nothing about making skills |

Those last three are not hypotheticals: they shipped here under those names and
all three had to be renamed afterwards, which cost a directory, a plugin id, a
slash command, a tag prefix and a required status check each. The rule exists
because a metaphor always reads better at the moment you pick it, and never
again.

The rule is graded at spec time only. The eight skills that predate it —
`devlog`, `press`, `resume`, `shipflow`, `ghostwriter`, `ghostwriter-x`,
`github-stats`, `city-report` — are grandfathered: `verify` does not re-grade a
shipped name, because renaming a released skill costs more than the name is
worth.

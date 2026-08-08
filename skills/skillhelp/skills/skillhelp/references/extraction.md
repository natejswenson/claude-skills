# Where each section comes from

Extraction reads six files per skill and nothing else:

| File | Used for |
|---|---|
| `skills/<n>/skills/<n>/SKILL.md` | the trigger sentence, every section, the non-negotiable rules |
| `skills/<n>/README.md` | Requirements, Quick start, the file table |
| `skills/<n>/CHANGELOG.md` | past fixes, capped and last |
| `skills/<n>/skills/<n>/package.json` | version, node engine, scripts, bin |
| `skills/<n>/skills/<n>/skill-invariants.json` | the declared split, and the prose guardrails |
| `skills/<n>/.claude-plugin/plugin.json` | fallback version and description |

Stack is inferred: a `package.json` in the inner directory means node, its
absence means python (version then comes from SKILL.md frontmatter).

## Headings are matched WHOLE

The heading vocabulary in this repo is small and knowable, so it is matched
exactly rather than by substring. An unanchored `/install/` matched
**"Why install this"** and filled every Setup section with marketing copy.

| Section | Headings |
|---|---|
| setup | Requirements, Install, Installation, Setup, First-run setup, Getting started, Prerequisites, Configuration, Configure, Before you start |
| usage | Quick start, Usage, What you get, Why install this, Triggers, The flow, How it works, When to use, Modes |
| commands | Commands, CLI, Command reference, Reference, Running the scripts |
| architecture | What's here, Architecture, Anatomy, Design, Files, Tests, Modules, Structure, Layout, Maintainer reference |
| troubleshooting | Troubleshooting, Gotchas, Error handling, Edge cases, Security rules, Rules that…, Caveats, Limitations, Known issues, What breaks, Failure modes, Accuracy |

**Adding a heading is the normal way to extend this.** Six skills predate the
house's "What's here" convention and say `## Files`, `## Error handling` or
`## Edge cases`; a narrow regex silently gave all six an empty Architecture
section, which is exactly the "looks complete, answers nothing" failure the
fixed five sections exist to prevent.

### Template placeholders are not headings

devlog's SKILL.md carries the skeleton of the blog post it writes, including
`## <Descriptive heading: setup / prerequisites>`. Any heading containing `<`
or `>` is skipped — otherwise devlog's Setup section fills with the template for
an article devlog has not written yet.

## Per-section notes

**Setup** deliberately does *not* read Quick start: that section is a block of
invocations, and indexing it as Setup made "how do I set up gmailtriage" answer
with four commands and none of the credentials they need. Setup also gets the
`engines.node` constraint and — importantly — every environment variable the
code actually reads (`process.env.X`, `os.environ[...]`, `os.getenv(...)`), by
**name**. A Setup answer that omits the credential a run needs is the most
costly kind of incomplete.

**Commands** are ordered deliberately: runnable lines from fenced blocks first
(`node bin/press.js emit`), then any Commands-section prose, then
`package.json` scripts **last**. Built the other way round, "what commands does
press have" led with `npm run postpack`.

**Architecture** prefers the declared split in `skill-invariants.json` — the
author's own statement of which half is deterministic — then `code` entries
(the older spelling of the same thing), then the `What's here` table. Only if
all three are absent does it fall back to listing the modules the skill ships.
A file list is a weaker architecture answer than a declared split, but it is a
**true** one.

**Troubleshooting** weights `skill-invariants.json`'s `prose` block highest,
then SKILL.md's non-negotiable rules, then any Troubleshooting/Gotchas section,
and takes at most **four** CHANGELOG `fix` lines, last. This ordering is a
judgment worth stating: "what broke once" is weak evidence for "what to do when
it fails", and a section filled with changelog bullets looks complete while
being unactionable.

`pattern` fields in `skill-invariants.json` are **regexes**, not sentences —
they are what a test greps SKILL.md for. They are de-regexed before indexing, so
a card reads `Never ask about anything in that table` rather than
`[Nn]ever ask about anything in that table`.

## The two secret defences, and which does what

- **Markdown is indexed verbatim**, so it needs an active refusal: any line
  matching a token/key/private-key pattern is dropped and counted, and `build`
  reports the count. It is never indexed and never committed.
- **Source files are never indexed verbatim at all.** Extraction lifts only
  identifiers from them — an env var name, a module path — so a secret sitting
  in code has no route into a card by construction.

This repo has already shipped a redaction incident once, and the index is
committed to a public repo. Refusing is cheap; unpublishing is not.

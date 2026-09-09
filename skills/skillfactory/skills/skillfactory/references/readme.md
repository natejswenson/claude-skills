# The README house style

Every skill's `README.md` is one document in one publication. A reader arriving
from the marketplace should find "why would I install this" and "how do I start"
in the same place on every one.

The shape is **fixed head, free tail, fixed foot**. `gradeReadme`
(`scripts/lib/readme.mjs`) checks it, `skillfactory verify` reports it as
`readme-structure`, and `ci / marketplace` runs that check over every skill on
every pull request.

## The shape

```markdown
# <name>                          ← line 1, the bare skill name, nothing else
<!-- >>> press:masthead … -->     ← line 2. GENERATED. never typed by hand
<!-- <<< press:masthead -->

*One italic line: what this is for.*

> **The one rule.**

## Why install this
## What you get
## Quick start
## Triggers
## Requirements

  … any sections this skill needs, in any order …

## Development
## Changelog
## License
```

## What each part is, and why

| Part | PRESS component | Job | Checked |
|---|---|---|---|
| `# <name>` | headline (`h1`) | the one claim: this skill's name | is exactly `# <name>` |
| masthead region | `.mast` | stamp, brand line, document kind, issue, byline, rule | present, directly under the H1 |
| standfirst | `.stand` | the setup, in one italic line | italic, first content line |
| pull quote | `.pull` | **the one rule** — what this skill refuses to do | a `> **…**` blockquote |
| `## Why install this` | — | the argument, for someone who has not decided | present, first |
| `## What you get` | data table | the inventory: what is in the tree | contains a table |
| `## Quick start` | `.term` | the commands, copyable | both hosts’ fenced install and invocation paths |
| `## Triggers` | — | when the skill fires, in the user's words | present |
| `## Requirements` | — | runtimes, credentials and retained data | both host notes, data note and migration link |
| free tail | — | whatever this skill actually needs | not checked |
| `## Development` `## Changelog` `## License` | colophon | where a maintainer looks | present, in order, last |

## Four rules that are not style opinions

1. **The H1 is the bare skill name.** press's `<name>-readme` target anchors its
   masthead on `^# <name>$`. A decorated title (`# ghfactory (Claude Code skill)`)
   silently detaches the region, and the next `press emit --init` splices a
   second one below it. This is why the check is exact-match rather than
   "starts with the name".

2. **The masthead is generated, never typed.** It carries the press version, so
   a hand-written copy goes stale invisibly and `press check` reports drift on a
   file nobody edited. Create it with
   `press emit --init --target <name>-readme`.

3. **Order is checked, not just presence.** A README with the right sections in
   an arbitrary order is exactly as unscannable as one missing them, and
   "present somewhere in the file" is the check that lets a house style rot one
   pull request at a time.

4. **The tail is free on purpose.** devlog's configuration reference,
   ghostwriter's compliance notes and resume's theme gallery are real content
   that no five-section template has room for. Forcing them out would move
   detail into files nobody opens; the alternative — a longer fixed spine —
   would make every short README carry empty headings. So the head answers the
   stranger's questions, the foot serves the maintainer, and the middle belongs
   to the skill.

## Writing the head

The head is the part most likely to be written badly, because it is the part
that reads like marketing if you let it. `press/brand/voice-core.md` governs:
no throat-clearing, no hedges, no tacked-on closing line, real numbers only.

- **Standfirst** — what the skill does, not what it is. One line. It is the
  first thing under the brand rule and the only sentence most readers finish.
- **Why install this** — the *argument*, not a feature list. What goes wrong
  without it. If a real past failure motivated the skill, that failure is the
  strongest thing you can put here, and it must be true.
- **What you get** — paths and what each one provides. A reader should be able
  to see the tree without cloning it.
- **Quick start** — real commands that work. Never a placeholder; a command
  that has never been run is a bug report waiting to be filed.
- **Triggers** — the phrases from `SKILL.md`'s `description:`, because that is
  literally the text a request is matched against. Writing a separate list by
  hand lets the two disagree, and the README is the copy nobody notices is wrong.


## Dual-host setup

Quick start begins with two explicit paths. In Claude Code chat, show
`/plugin marketplace add natejswenson/claude-skills`,
`/plugin install <name>@claude-skills`, then `/<name>`. In a terminal at the
repository checkout root, show exactly `codex plugin marketplace add "$PWD"` and
`codex plugin add <name>@<target-marketplace>`; then tell the reader to start a new
Codex session and show `$<name>` in a separate chat example. Replace `<name>`
with this skill’s actual name. Keep all six commands in fenced blocks in
Quick start. A mention elsewhere, a comment, or another skill’s name does not
satisfy the contract. PRESS owns only the masthead, not these setup instructions.

Follow those paths with the skill’s own examples. Resolve bundled scripts from
the directory containing the loaded `SKILL.md`, or give an explicit checkout
working directory. Label Claude-only utilities (for example pluginsync’s Node
reconciler) and show the Codex route. Do not imply that plugin installation
installs Python/Node dependencies or authenticates an external service.

Requirements contains three non-empty labeled bullets: `- **Claude Code:**`,
`- **Codex:**`, and `- **Personal data:**`. Name the actual tools and account
setup each host needs. Codex does not import Claude’s MCP connections: Gmail
needs a connected Gmail tool surface; a publishing workflow using OAuth or an
API key still needs that script’s credentials. Generic local skills should say
that no app connection is needed and that Claude connections are not imported.
Link to the local `[Codex migration notes](../../docs/codex-migration.md)` when the
target provides it, or to the durable shared migration-guide URL when it does not.

State the exact existing personal-data location when there is one, including
retained `~/.claude/<skill>` directories; their names do not require Claude to
run. Some skills instead use `~/.gmailtriage/`, `~/.shipreport/`, system temporary
storage, or user-selected paths. Document the script’s real location, never
invent a `~/.claude/` directory to satisfy a template. Update the scaffold’s
generic note when the implementation introduces credentials or personal data.
The checker pins known retained Claude paths and the presence of both host
notes; reviewers still check the technical accuracy of each note.

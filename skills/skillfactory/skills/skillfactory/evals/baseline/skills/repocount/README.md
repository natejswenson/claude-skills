# repocount

*Count what a repository owes you — open PRs, stale branches, unreleased commits — as one table.*

> **Never report a count you did not read from the repository itself — an estimate is a guess wearing a number.**

## Why install this

Count what a repository owes you — open PRs, stale branches, unreleased commits — as one table. It ships the method as well as the commands: 2 steps the machine decides outright, and 2 the model has to judge, with the line between them written down in `skill-invariants.json` rather than left to taste.

Use it when the work needs a repeatable process and a result you can inspect.

## What you get

| Path | What it provides |
|---|---|
| `skills/repocount/SKILL.md` | What the agent reads: triggers, the flow, and the one rule. |
| `skills/repocount/scripts/` | The deterministic half — `count`, `detect`. |
| `skills/repocount/references/anatomy.md` | The fixed shape of a repocount report. |
| `skills/repocount/skill-invariants.json` | The prose guardrails and the baseline eval declaration. |

## Quick start

Claude Code — run in chat:

```text
/plugin marketplace add natejswenson/claude-skills
/plugin install repocount@claude-skills
/repocount
```

Codex — run in a terminal from the root of this repository checkout:

```bash
codex plugin marketplace add "$PWD"
codex plugin add repocount@claude-skills
```

Start a new Codex session, then invoke in chat:

```text
$repocount
```

```bash
repocount detect   # the repo's remote, default branch and release convention, as one table
repocount count    # open PRs, stale branches and unreleased commits, each with its age
```

## Triggers

- "what's outstanding"
- "any stale branches"
- "what hasn't shipped"
- Anything the method in `SKILL.md` covers, whether or not it is phrased that way.

## Requirements

- **Claude Code:** Allow the local file and shell tools needed by the bundled commands.
- **Codex:** Use the same bundled scripts and runtimes; Claude app connections are not imported. Connect any service required by the implemented workflow in Codex separately.
- **Personal data:** The scaffold adds no private configuration store. If the implementation uses an existing `~/.claude/` location, retain it for both hosts and document the exact path here.

See [Codex migration notes](../../docs/codex-migration.md) for host tools and retained data paths.

- Node 18+ (the bundled scripts are ESM, no dependencies).

## Development

```bash
cd skills/repocount/skills/repocount
npm test
```

Node skill. `ci / repocount` runs the same tests plus the house lints on
every pull request, and `skillfactory verify --skill repocount` reports which rung
of the ladder it has reached.

## Changelog

See [`CHANGELOG.md`](CHANGELOG.md). Releases are cut by a version bump, tagged
`repocount-v<version>`.

## License

MIT — see [`LICENSE`](LICENSE).

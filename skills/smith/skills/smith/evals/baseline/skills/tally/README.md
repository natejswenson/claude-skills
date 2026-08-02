# tally

*Count what a repository owes you — open PRs, stale branches, unreleased commits — as one table.*

> **Never report a count you did not read from the repository itself — an estimate is a guess wearing a number.**

## Why install this

Count what a repository owes you — open PRs, stale branches, unreleased commits — as one table. It ships the method as well as the commands: 2 steps the machine decides outright, and 2 the model has to judge, with the line between them written down in `skill-invariants.json` rather than left to taste.

Use it when the work needs a repeatable process and a result you can inspect.

## What you get

| Path | What it provides |
|---|---|
| `skills/tally/SKILL.md` | What the agent reads: triggers, the flow, and the one rule. |
| `skills/tally/scripts/` | The deterministic half — `count`, `detect`. |
| `skills/tally/references/anatomy.md` | The fixed shape of a tally report. |
| `skills/tally/skill-invariants.json` | The prose guardrails and the baseline eval declaration. |

## Quick start

```bash
tally detect   # the repo's remote, default branch and release convention, as one table
tally count    # open PRs, stale branches and unreleased commits, each with its age
```

Install from the [claude-skills marketplace](https://github.com/natejswenson/claude-skills), then ask
for work matching the triggers below.

## Triggers

- "what's outstanding"
- "any stale branches"
- "what hasn't shipped"
- Anything the method in `SKILL.md` covers, whether or not it is phrased that way.

## Requirements

- Node 18+ (the bundled scripts are ESM, no dependencies).

## Development

```bash
cd skills/tally/skills/tally
npm test
```

Node skill. `ci / tally` runs the same tests plus the house lints on
every pull request, and `smith verify --skill tally` reports which rung
of the ladder it has reached.

## Changelog

See [`CHANGELOG.md`](CHANGELOG.md). Releases are cut by a version bump, tagged
`tally-v<version>`.

## License

MIT — see [`LICENSE`](LICENSE).

# github-stats

A [Claude Code](https://claude.com/claude-code) skill that shows GitHub profile
statistics for any user — commits, followers, stars, pull requests, and issues —
as a clean summary table, plus a repository browser and per-repo detail. It is a
conversational re-make of the standalone [`github-stats-cli`](https://github.com/natejswenson/github-stats-cli)
app, with the same metric definitions but driven by the `gh` CLI.

## Invocation

`/github-stats` — or just ask: "show me github stats for octocat",
"how many stars does torvalds have?", "list octocat's repos".

## Dependencies

- [`gh`](https://cli.github.com/) (GitHub CLI), authenticated (`gh auth login`).
  The skill uses your existing `gh` auth — no separate token to manage.
- [`jq`](https://jqlang.github.io/jq/) for JSON aggregation.

## Direct script use

The deterministic core can also be run on its own:

```bash
scripts/gh-stats.sh overview octocat          # summary table
scripts/gh-stats.sh overview octocat --json   # raw numbers
scripts/gh-stats.sh stars   torvalds          # one metric
scripts/gh-stats.sh repos   octocat           # repo browser
scripts/gh-stats.sh repo    octocat Spoon-Knife
```

Subcommands: `overview`, `commits`, `followers`, `stars`, `prs`, `issues`,
`repos`, `repo`. Read-only commands accept a trailing `--json`. See
[`reference/commands.md`](reference/commands.md) for the full catalog, including
the confirmation-gated repository-creation flow.

## Layout

```
SKILL.md              # what Claude reads — lean core flow
reference/commands.md # full command catalog (progressive disclosure)
scripts/gh-stats.sh   # deterministic gh + jq core (all the arithmetic)
tests/                # network-free unit tests + gated live smoke
eval/                 # numeric-parity check vs the original CLI
```

## Development

```bash
shellcheck scripts/gh-stats.sh   # lint the core
pytest tests/ -v                 # network-free unit tests
python eval/run_eval.py          # parity vs the original CLI (needs gh auth + the original repo)
```

## License

MIT — see [LICENSE](LICENSE).

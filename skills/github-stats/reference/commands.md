# github-stats — full command catalog

Every command is run from the skill directory (the folder with `SKILL.md`).
`scripts/gh-stats.sh <command> [args] [--json]`. All read-only commands accept a
trailing `--json` flag to emit machine-readable JSON instead of a table.

## Profile

| Command | What it shows |
|---|---|
| `overview <user>` | Five-metric summary table: commits, followers, stars, PRs, issues. |
| `commits <user>` | Total commits authored by the user across their repos + top repo. |
| `followers <user>` | Followers and following counts. |
| `stars <user>` | Total stars across the user's repos + most-starred repo. |
| `prs <user>` | Total pull requests authored + estimated % closed. |
| `issues <user>` | Total issues authored + estimated % closed. |

### Switching users
There is no persistent session — to look at a different account, just run any
command again with the new username.

## Repositories

| Command | What it shows |
|---|---|
| `repos <user>` | Top 20 repositories by stars: name, stars, forks, language, description. |
| `repo <user> <name>` | One repo's detail: metadata, star/fork/watcher/issue counts, top languages, recent commits. |

When the user wants "the repo with the most stars" or to "pick a repo", run
`repos <user>` first, then `repo <user> <name>` on their choice.

## Creating a repository (state-changing — confirm first)

The original CLI could create a repo for the **authenticated** user. Replicate
that with `gh`, but **never run it without explicit confirmation.**

1. Gather: repository name, optional description, visibility (public/private).
2. Echo the plan back and get a clear yes:
   > Create **public** repo `my-repo` ("my description") under your account?
3. Only on confirmation, run:

```bash
gh repo create <name> \
  --public \            # or --private
  --description "<description>" \
  --add-readme
```

4. Report the resulting URL (`gh` prints it). If creation fails (name taken,
   missing scope), relay the error verbatim — don't retry blindly.

Never create a repo proactively, in bulk, or as a side effect of another
request. This is the only command in the skill that writes to GitHub.

## Metric definitions (parity with the original CLI)

These mirror `github_stats/metrics/*.py` from `github-stats-cli`; the skill is
faithful to them, quirks included, so its numbers match the original:

- **Commits** — commits authored by the user, counted per owned repo and summed,
  bounded at 1000 per repo. "Top" = repo with the most.
- **Followers** — `followers` / `following` from the user object.
- **Stars** — sum of `stargazers_count` over owned repos; "Top" = most-starred.
- **Pull Requests** — `search/issues?q=type:pr+author:<user>` total; `% closed`
  derived from the open count in a ≤100-item sample via `(total − open) / total`.
- **Issues** — same search with `type:issue`; `% closed` scales the sample's
  open ratio up to the total, then `closed / total`.

The PR/issue percentages are sample-based estimates and can differ slightly run
to run; the headline counts are exact.

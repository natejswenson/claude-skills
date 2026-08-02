# Where every fact comes from

Four sources, no fifth. `scripts/lib/state.mjs` is the executable version of
this page; if the two disagree, the code is right and this is stale.

| # | Source | Gives |
|---|---|---|
| 1 | `~/.claude/plugins/known_marketplaces.json` | every configured marketplace: its source kind, its source spec, its install location |
| 2 | `<installLocation>/.claude-plugin/marketplace.json` | which plugins that marketplace offers, and where each one's source is |
| 3 | `<source>/.claude-plugin/plugin.json` | the **available** version of one plugin |
| 4 | `claude plugin list --json` | the **installed** version, scope and enabled state |

Plus one probe: `~/.claude/skills/<name>/SKILL.md`, which is the shadow check.

## The traps

**`--available` is not the available list.** `claude plugin list --available
--json` returns `{installed, available}` where `available` holds only plugins
you have *not* installed. Every plugin you already have is absent from it, so
diffing against it compares nothing and reports it as clean. Available versions
come from source 3 or they are unknown.

**`claude plugin list --json` has two shapes.** Plain `--json` returns a bare
array; `--available --json` returns `{installed: [...]}`. Both are handled and a
third shape throws — "no plugins installed" and "I could not parse the list"
render as the same empty table, and the first one tells you to reinstall
everything.

**A marketplace source can be local or remote.** A string source, or an object
with a `path` and no `url`, resolves relative to the install location. A
`git-subdir` source lives somewhere this tool has no business guessing at, so it
becomes an `error` row rather than a silent omission.

**`installLocation` may be relative.** It is resolved against the home
directory, which is what lets the eval fixtures ship a portable marketplace. A
real config is always absolute and is unaffected.

**A directory-source marketplace tracks a working tree.** On this machine
`claude-skills` is registered as a `directory` source pointing at the local
checkout, so "available" means *what is in that working tree right now* —
including uncommitted version bumps. That is usually what you want when
developing a skill, and worth saying out loud when it is not.

## What is never read

`installed_plugins.json` — the CLI owns it, and parsing a file that a tool
maintains for itself is how a reader drifts from reality. Everything about the
installed state comes from `claude plugin list --json`.

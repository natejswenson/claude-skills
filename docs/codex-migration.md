# Codex migration

The 20 existing plugin roots remain under `skills/`. Each has a Codex manifest
and shares its skill, scripts, references, and assets with Claude Code. The
repository name and independently released versions stay unchanged.

This is ongoing support for both hosts. Claude's original manifests remain the
release metadata source; generation writes only Codex metadata. Runtime-specific
paths are conditional, and the Claude parser branches and test fixtures remain.

## Install and maintain

Run from the repository root:

```sh
python3 tools/sync_codex.py --check
python3 tools/check_compatibility.py
python3 tools/codex_marketplace_smoke.py --expected-version 0.153.4
```

The executable smoke creates a temporary `CODEX_HOME`, reports the installed
Codex CLI version, adds this local marketplace, discovers every catalog entry,
installs each plugin, and verifies that every plugin is enabled. It never uses
the developer's real Codex home, authenticates an account, or runs a model.

For a manual installation, use:

```sh
codex plugin marketplace add "$PWD"
codex plugin list --available --json --marketplace claude-skills
codex plugin add <name>@claude-skills
```

Use a real plugin name in the last command. Start a new session and invoke it
as `$<name>`. Local marketplace paths resolve from the repository root; the
catalog points directly at `./skills/<name>` without copies or symlinks.

`tools/sync_codex.py` generates Codex metadata from the existing Claude release
manifests and catalog. Run it after adding a plugin or bumping its version.
CI checks the generated files for drift. Edit source release metadata instead
of editing generated JSON. The generator does not modify user installations.

The combined compatibility check validates the Claude catalog and every Claude
plugin's name/version against the shared SKILL.md, package, and lockfile before
checking Codex metadata. Tests ensure generation leaves Claude files unchanged,
version bumps require regeneration, source version conflicts cannot be hidden by
fresh Codex metadata, and duplicate/missing/orphan entries fail. New Claude
component fields (for example hooks) fail with an adapter requirement instead of
being blindly copied or silently dropped. Add support for that component in the
generator with tests; preserve the Claude declaration.

The existing `ci / marketplace` workflow runs these checks on every PR. Making
that status mandatory for merging is a separate branch-protection setting; the
workflow alone does not establish it.

For a Git installation, refresh with `codex plugin marketplace upgrade
claude-skills`, then `codex plugin add <name>@claude-skills` and verify the
installed version. Local development changes without a version bump may require
Codex's plugin-creator cachebuster/reinstall workflow. Never equate a successful
command with the current session having reloaded a skill.

## Runtime compatibility

| Plugins | Codex handling |
| --- | --- |
| All 20 | Shared SKILL.md with Codex tool mappings and `$name` invocation; resolve bundled paths from SKILL.md |
| pluginsync | Codex CLI route; existing Node reconciler remains Claude-only |
| eval | Reads Codex response-item rollouts, preserves line anchors and call IDs, drops duplicate UI events and reasoning |
| shipreport | Recursive Codex session collection with explicit `--transcripts`; default remains Claude history |
| skillfactory | Run the metadata generator after scaffolding in this repository |
| ghostwriter, ghostwriter-x | Reuse voice profiles; git history fallback when the Claude recent-project collector is empty |
| issueflow | Use available Codex delegation tools; disclose when independent stage execution is unavailable |
| gmailtriage and other integrations | Connect/authenticate the required service in Codex or use the documented CLI; Claude MCP connections are not imported |
| devlog, resume, github-stats, shipflow, city-report, press, ghfactory, release, skillhelp, brandreport, netwatch, appletv | Existing scripts and dependencies are retained |

Personal data intentionally remains in the existing `~/.claude/<skill>` locations.
Those directory names do not require Claude to run. Moving them without changing
the scripts would hide credentials, resumes, voice profiles, and configuration.
No personal data is bundled or migrated by the metadata generator.

Issueflow retains canonical state at `~/.claude/issueflow` and separates child
execution from it. Pass `--workspace-root <approved-root>` at start/preparation;
the host must already permit children to write there. Each run owns a generation
with outputs, lane checkouts, an independent Git store and temporary storage.
The parent archives outputs and history before saving canonical state. Clean
legacy Codex runs migrate at a quiescent boundary; dirty or in-flight work stops
for recovery. Claude's artifact paths and source-linked worktrees are retained.

Some optional model-judged eval harnesses still invoke Claude or Anthropic APIs.
They require those tools/credentials separately; using a skill in Codex does not
convert their backend. Use deterministic checks and an explicitly identified
in-session review when the external judge is unavailable. Do not report that as
an external judge pass. Browser, publishing, Gmail, and Apple TV workflows still
require their existing accounts, tools, or hardware.

For Codex reports, index with `--transcripts "${CODEX_HOME:-$HOME/.codex}/sessions"`.
Use `--full` when switching transcript roots in an existing corpus so an old
watermark does not skip history. Archived sessions can be indexed with a separate
`--transcripts` pass and `--full`. Codex session receipts identify the session;
Claude UUID-specific moment citations are unavailable for Codex rollouts.

## Sources

Packaging was checked against the installed Codex CLI's `plugin --help`,
`plugin add --help`, and marketplace commands, plus the bundled plugin-creator
validator and [official plugin documentation](https://learn.chatgpt.com/docs/plugins).
The CLI discovery/install smoke test is implemented by
`python3 tools/codex_marketplace_smoke.py`. CI pins and asserts Codex CLI
version `0.153.4`; local runs can omit `--expected-version` when checking an
intentionally different installed version. It uses an isolated `CODEX_HOME`,
without authenticating accounts or running a model.

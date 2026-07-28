---
title: "How to turn a folder of Claude Code skills into a discoverable plugin marketplace"
date: 2026-07-11
project: ghostwriter
version: v0.8.1
tags: [claude-code, plugin-marketplace, skill-md, monorepo, ci, json-lint, developer-tooling]
summary: "Ghostwriter moved from a manual symlink install to a real Claude Code plugin, which meant learning the marketplace.json/plugin.json schema and one directory-nesting rule that Claude Desktop enforces and the CLI quietly didn't."
---

## Shipped

Ghostwriter, and three sibling skills in the same repo, switched from a manual "symlink this folder into `~/.claude/skills`" install to a real Claude Code plugin: each skill got a `.claude-plugin/plugin.json`, the repo root got a `.claude-plugin/marketplace.json` listing all four, and install became `/plugin marketplace add` + `/plugin install`. A day later, a follow-up release moved every skill's `SKILL.md` one directory deeper, because the first version worked fine from the command line and silently didn't work in Claude Desktop. That gap, and the two lint scripts written to make sure it can't reopen, is the part worth walking through.

## What a plugin marketplace actually is

A marketplace is nothing more than a JSON file. Per the [Claude Code docs](https://code.claude.com/docs/en/plugin-marketplaces), "create `.claude-plugin/marketplace.json` in your repository root. This file defines your marketplace's name, owner information, and a list of plugins with their sources." Each entry needs a `name` and a `source`; for a monorepo, the source is just a relative path:

```json
{
  "name": "my-tools",
  "owner": { "name": "You" },
  "plugins": [
    { "name": "formatter", "source": "./plugins/formatter" }
  ]
}
```

Each plugin listed there is, in turn, its own self-contained directory with a `.claude-plugin/plugin.json`:

```json
{
  "name": "formatter",
  "version": "1.0.0",
  "description": "Formats code on save"
}
```

Once both files exist, `/plugin marketplace add ./my-tools` followed by `/plugin install formatter@my-tools` is the entire install, and `/plugin marketplace update` picks up new pushes. No symlinks, no README with manual copy steps.

## Where the skill's content actually lives

This is the part that isn't obvious from the schema alone. The docs describe the skill location as: "**Location**: `skills/` or `commands/` directory in plugin root, or a single `SKILL.md` file at the plugin root," and then add the detail that matters here: "If a plugin has no `skills/` directory and no `skills` manifest field, a `SKILL.md` at the plugin root is loaded as a single skill. Set the frontmatter `name` field to control the skill's invocation name. Without it, Claude Code falls back to the install directory name, which for marketplace-installed plugins is a version string that changes on every update" ([Plugins reference](https://code.claude.com/docs/en/plugins-reference)).

So a root-level `SKILL.md` is documented and supported, as long as its frontmatter names itself explicitly. What happened here was a real-world gap between two Claude Code surfaces: the CLI tolerated the four skills' root-level `SKILL.md` files, but Claude Desktop, after installing the same plugin from the same marketplace entry, reported "This plugin doesn't have any skills or agents." The fix was to nest each skill one directory deeper:

```text
formatter/
├── .claude-plugin/
│   └── plugin.json
└── skills/
    └── formatter/
        └── SKILL.md
```

```markdown
---
name: formatter
description: Formats the current file
---

Format the selected file using the project's configured formatter.
```

That's the layout used above to build the verification scripts below, and it's also what the docs recommend outright for anything beyond a single trivial skill: "For plugins that ship more than one skill, use the `skills/` directory layout." Anthropic's own [official plugin catalog](https://github.com/anthropics/claude-plugins-official) follows the same pattern; its `skill-creator` plugin, for example, nests its skill at `plugins/skill-creator/skills/skill-creator/`, not at the plugin root.

## Build it: a name-consistency lint for one plugin

The nesting fix solves the immediate problem, but it opens a new one: now three separate files each carry the plugin's name (`plugin.json`, the directory itself, `SKILL.md`'s frontmatter), and nothing stops them from drifting apart. A rename in one place and not the other two produces a plugin that installs cleanly and then can't be found under the name anyone expects. The fix is a lint script that checks all three agree:

```python
#!/usr/bin/env python3
"""Checks that a plugin's name stays consistent across its manifest, its
directory, and its skill's frontmatter."""
import json
import os
import re
import sys


def parse_skill_name(skill_md_text):
    match = re.search(r'^name:\s*(\S+)', skill_md_text, re.MULTILINE)
    return match.group(1) if match else None


def lint_plugin(plugin_dir):
    errors = []
    dir_name = os.path.basename(os.path.normpath(plugin_dir))

    plugin_json_path = os.path.join(plugin_dir, ".claude-plugin", "plugin.json")
    with open(plugin_json_path) as fh:
        plugin_data = json.load(fh)
    plugin_name = plugin_data.get("name")

    if plugin_name != dir_name:
        errors.append(
            f"plugin.json name {plugin_name!r} != directory name {dir_name!r}"
        )

    skill_md_path = os.path.join(plugin_dir, "skills", dir_name, "SKILL.md")
    if os.path.isfile(skill_md_path):
        with open(skill_md_path) as fh:
            skill_name = parse_skill_name(fh.read())
        if skill_name != plugin_name:
            errors.append(
                f"SKILL.md name {skill_name!r} != plugin.json name {plugin_name!r}"
            )

    return errors


if __name__ == "__main__":
    errs = lint_plugin(sys.argv[1])
    if errs:
        for e in errs:
            print(f"FAIL: {e}")
        sys.exit(1)
    print("OK")
```

## Build it: a membership lint for the marketplace file

A single plugin passing its own lint doesn't guarantee the marketplace entry pointing at it is correct. A copy-pasted entry can have the right shape (a `name` and a valid `source`) while pointing at the wrong plugin directory entirely, which a naive "does this name exist somewhere in the plugin set" check won't catch. The check needs to tie each entry's name, its source's directory basename, and that directory's own `plugin.json.name` together as one three-way match, not three independent lookups:

```python
#!/usr/bin/env python3
"""Checks marketplace.json against the plugin.json files it references:
every entry resolves, and no entry is cross-wired to the wrong plugin."""
import glob
import json
import os
import sys


def lint_marketplace(repo_root):
    errors = []
    marketplace_path = os.path.join(repo_root, ".claude-plugin", "marketplace.json")
    with open(marketplace_path) as fh:
        data = json.load(fh)

    entry_names = set()
    for entry in data.get("plugins", []):
        entry_name = entry["name"]
        source_dir = os.path.normpath(os.path.join(repo_root, entry["source"]))
        source_plugin_json = os.path.join(source_dir, ".claude-plugin", "plugin.json")

        if not os.path.isfile(source_plugin_json):
            errors.append(f"entry {entry_name!r}: no plugin.json at {entry['source']}")
            continue

        with open(source_plugin_json) as fh:
            source_name = json.load(fh).get("name")

        # Per-row three-way tie: catches a cross-wired entry (right shape,
        # wrong target) that a set-membership check alone would miss.
        source_basename = os.path.basename(source_dir)
        if entry_name != source_basename or source_name != entry_name:
            errors.append(
                f"entry {entry_name!r}: basename={source_basename!r}, "
                f"plugin.json.name={source_name!r} -- all three must match"
            )
        entry_names.add(entry_name)

    dirs_with_plugin_json = {
        os.path.basename(os.path.dirname(os.path.dirname(p)))
        for p in glob.glob(os.path.join(repo_root, "plugins", "*", ".claude-plugin", "plugin.json"))
    }
    orphans = dirs_with_plugin_json - entry_names
    if orphans:
        errors.append(f"plugin directories with no marketplace entry: {sorted(orphans)}")

    return errors


if __name__ == "__main__":
    errs = lint_marketplace(sys.argv[1])
    if errs:
        for e in errs:
            print(f"FAIL: {e}")
        sys.exit(1)
    print("OK")
```

## Use it, then break it on purpose

Run both against a correctly wired plugin and marketplace:

```text
$ python3 lint_plugin.py my-tools/plugins/formatter
OK
$ python3 lint_marketplace.py my-tools
OK
```

Now rename only `plugin.json`'s `name` field, leaving the directory and `SKILL.md` untouched, the exact drift a careless rename produces:

```text
$ python3 lint_plugin.py my-tools/plugins/formatter
FAIL: plugin.json name 'code-formatter' != directory name 'formatter'
FAIL: SKILL.md name 'formatter' != plugin.json name 'code-formatter'
$ python3 lint_marketplace.py my-tools
FAIL: entry 'formatter': basename='formatter', plugin.json.name='code-formatter' -- all three must match
```

Both scripts catch it immediately, and both point at exactly which file disagrees with which. Wire either one into CI as a pre-merge check and this class of bug never reaches a released plugin.

## Gotchas

**A root-level `SKILL.md` worked in the CLI and silently failed in Desktop.** The CLI accepted a plugin whose `SKILL.md` sat directly at the plugin root; Claude Desktop, installing from that same marketplace entry, reported the plugin had no skills or agents at all. Nothing in either surface raised an error at publish time, so the first sign of trouble was a teammate opening Desktop after the marketplace conversion had already shipped. The fix, and the safer default going forward, is the nested `skills/<name>/SKILL.md` layout described above, plus setting the frontmatter `name` explicitly rather than relying on the install-directory fallback.

**Nesting the skill one directory deeper broke a test that assumed the old layout.** A version-consistency test read `CHANGELOG.md` relative to the skill's own directory, which worked when `CHANGELOG.md` sat next to `SKILL.md`. After the nesting fix moved `SKILL.md` down a level, `CHANGELOG.md` deliberately stayed at the outer plugin root, so the test's relative path pointed at the wrong location. CI caught it on the same pull request, which is the case for this kind of refactor: a path assumption baked into a test is invisible until something that isn't the test itself moves.

## Sources

- [Create and distribute a plugin marketplace](https://code.claude.com/docs/en/plugin-marketplaces) — the marketplace.json/plugin.json schema and the required `name`/`source` fields.
- [Plugins reference](https://code.claude.com/docs/en/plugins-reference) — the skill discovery rules, including the root-`SKILL.md` fallback and its version-string caveat.
- [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) — confirms the nested `skills/<name>/SKILL.md` layout in a real, official plugin (`skill-creator`).

## Changelog

- fix: nest SKILL.md under skills/<name>/ so plugins are discoverable (#32) ([cd9bc5b](https://github.com/natejswenson/claude-skills/commit/cd9bc5b94453c2f70632e1c784e8fcf878dfda7a))
- feat: convert claude-skills into a Claude Code plugin marketplace (#30) ([7537f10](https://github.com/natejswenson/claude-skills/commit/7537f103c73283a82e5432e99f552d206ccb808c))

# claude-skills (fixture house)

The three human-readable registries a scaffold run edits, trimmed to their
anchors: the skill table, the install block, and the symlink fallback.

## Skills

| Skill | Version | Invocation | Stack | Description |
|---|---|---|---|---|
| [`press`](skills/press) | ![press](https://img.shields.io/github/v/tag/natejswenson/claude-skills?filter=press-v*&label=&sort=semver&color=blue) | `/press` | Node | The one brand system. |
| [`tally`](skills/tally) | ![tally](https://img.shields.io/github/v/tag/natejswenson/claude-skills?filter=tally-v*&label=&sort=semver&color=blue) | `/tally` | Node | Count what a repository owes you — open PRs, stale branches, unreleased commits — as one table. |

## Install

```
/plugin marketplace add natejswenson/claude-skills
/plugin install press@claude-skills
/plugin install tally@claude-skills
```

<details>
<summary><strong>Manual install (symlink fallback)</strong></summary>

```bash
ln -sfn "$PWD/skills/press/skills/press" ~/.claude/skills/press
ln -sfn "$PWD/skills/tally/skills/tally" ~/.claude/skills/tally
```
</details>

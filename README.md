# claude-skills

[![License](https://img.shields.io/badge/license-MIT-blue)](#license)

A monorepo of self-contained, independently-released [Claude Code](https://claude.com/claude-code) productivity skills.

Each skill under `skills/` is versioned, tested, and released **on its own cadence** — consolidated into one repo for convenience, with the same independence as separate repos. Namespaced release tags (`<skill>-vX.Y.Z`) and path-filtered CI mean a change to one skill only tests and releases that skill.

## Skills

| Skill | Version | Invocation | Stack | Description |
|---|---|---|---|---|
| [`devlog`](skills/devlog) | ![devlog](https://img.shields.io/github/v/tag/natejswenson/claude-skills?filter=devlog-v*&label=&sort=semver&color=blue) | `/devlog` | Node | Generate a daily dev-log entry from today's git commits and publish it to GitHub. |
| [`ghostwriter`](skills/ghostwriter) | ![ghostwriter](https://img.shields.io/github/v/tag/natejswenson/claude-skills?filter=ghostwriter-v*&label=&sort=semver&color=blue) | `/ghostwriter` | Python | Turn engineering work into LinkedIn posts with diagram cards. |
| [`resume`](skills/resume) | ![resume](https://img.shields.io/github/v/tag/natejswenson/claude-skills?filter=resume-v*&label=&sort=semver&color=blue) | `/resume` | Node/TS | Tailor a résumé to a job description and render a polished PDF from the CLI. |
| [`github-stats`](skills/github-stats) | ![github-stats](https://img.shields.io/github/v/tag/natejswenson/claude-skills?filter=github-stats-v*&label=&sort=semver&color=blue) | `/github-stats` | Bash/`gh` | Show GitHub profile statistics — commits, followers, stars, PRs, issues — plus a repo browser. |
| [`shipflow`](skills/shipflow) | ![shipflow](https://img.shields.io/github/v/tag/natejswenson/claude-skills?filter=shipflow-v*&label=&sort=semver&color=blue) | `/shipflow` | Node | Scaffold a configurable dev/main branching, auto-merge, cleanup, and release-tagging workflow into any repo. This repo's own automation is dogfooded on it. |

Version badges track this repo's namespaced release tags and update automatically — no manual maintenance.

## Install

This repo is a self-hosted Claude Code plugin marketplace — add it once, then install whichever skills you want:

```
/plugin marketplace add natejswenson/claude-skills
/plugin install devlog@claude-skills
/plugin install ghostwriter@claude-skills
/plugin install resume@claude-skills
/plugin install github-stats@claude-skills
/plugin install shipflow@claude-skills
```

Each skill's own `README.md` covers its dependencies and configuration.

<details>
<summary><strong>Manual install (symlink fallback)</strong></summary>

Symlink each skill into your skills directory so `SKILL.md` is discovered:

```bash
ln -sfn "$PWD/skills/devlog/skills/devlog"             ~/.claude/skills/devlog
ln -sfn "$PWD/skills/ghostwriter/skills/ghostwriter"   ~/.claude/skills/ghostwriter
ln -sfn "$PWD/skills/resume/skills/resume"             ~/.claude/skills/resume
ln -sfn "$PWD/skills/github-stats/skills/github-stats" ~/.claude/skills/github-stats
ln -sfn "$PWD/skills/shipflow/skills/shipflow"         ~/.claude/skills/shipflow
```
</details>

## Branch & release flow

`dev` is the unprotected integration branch; `main` is the protected release branch — the only way in is a green, auto-merged `dev → main` PR.

This repo's own `dev → main` automation is managed by the `shipflow` skill it ships, dogfooded on itself: [`.github/shipflow.json`](.github/shipflow.json) is the policy source of truth (branch names, cleanup, release mode), and `.github/workflows/dev-to-main-automerge.yml` is *rendered* from it — never hand-edited. Branch protection stays separately owned by [`.github/repo-settings.sh`](.github/repo-settings.sh).

1. Branch off `dev`, land work there (PR or direct push — `dev` is unprotected).
2. Open a `dev → main` PR to release. It auto-merges once every `ci / <skill>` check passes.
3. On merge, a `release-pending` label survives the async gap until a later `shipflow releases` check finds it and asks whether to cut a release per changed skill.
4. To cut a release: bump the skill's version + add a `CHANGELOG.md` entry, then `shipflow release-dispatch`.

Full step-by-step process: [`CLAUDE.md`](CLAUDE.md). Always invoke shipflow pinned to `@latest` — `npx -y @natjswenson/shipflow@latest <command>` — an unpinned call can silently resolve a stale local install instead of the current version.

## Repo layout

| Path | Purpose |
|---|---|
| `.claude-plugin/marketplace.json` | Marketplace manifest listing every skill as a plugin |
| `skills/<name>/` | Plugin root — one self-contained skill, history preserved via git subtree |
| `skills/<name>/.claude-plugin/plugin.json` | Per-skill plugin manifest (name/version/description) |
| `skills/<name>/skills/<name>/SKILL.md` | The actual skill, nested one level deeper — Claude Code's plugin auto-discovery only scans `skills/<subdir>/SKILL.md` |
| `.github/workflows/` | Reusable release workflow, one CI caller per skill (path-filtered), and the shipflow-rendered auto-merge workflow |
| `.github/repo-settings.sh` | Repo + branch-protection config, as code |
| `.github/shipflow.json` | shipflow's policy config for this repo's own `dev → main` automation |

## License

MIT — see each skill's own `LICENSE`.

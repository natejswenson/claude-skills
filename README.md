# claude-skills

A monorepo of self-contained, independently-released [Claude Code](https://claude.com/claude-code) productivity skills.

Each skill under `skills/` is versioned, tested, and released **on its own cadence** —
consolidated into one repo for convenience, but with the same autonomy they had as
separate repos. Independence is achieved with **namespaced release tags**
(`devlog-vX`, `ghostwriter-vX`, `resume-vX`) and **path-filtered workflows**: a change
to one skill only runs that skill's CI and only cuts that skill's release.

## Skills

| Skill | Invocation | Stack | What it does |
|---|---|---|---|
| [`devlog`](skills/devlog) | `/devlog` | Node | Generate a daily dev-log entry from today's git commits and publish to GitHub. |
| [`ghostwriter`](skills/ghostwriter) | `/ghostwriter` | Python | Turn engineering work into LinkedIn posts with diagram cards. |
| [`resume`](skills/resume) | `/resume` | Node/TS | Tailor a résumé to a job description and render a polished PDF from the CLI. |

## Install (local Claude Code)

Symlink each skill into your skills directory so `SKILL.md` is discovered:

```bash
ln -sfn "$PWD/skills/devlog"      ~/.claude/skills/devlog
ln -sfn "$PWD/skills/ghostwriter" ~/.claude/skills/ghostwriter
ln -sfn "$PWD/skills/resume"      ~/.claude/skills/resume
```

Each skill's own `README.md` covers its dependencies and configuration.

## Releasing a skill

1. In a PR, bump the skill's version manifest (`package.json` for devlog/resume,
   `pyproject.toml` for ghostwriter) and add a `CHANGELOG.md` entry.
2. Merge to `main`. The skill's release workflow tags `&lt;skill&gt;-v&lt;version&gt;` and
   publishes a GitHub Release from the changelog — only if that version isn't
   already tagged. Other skills are untouched.

## Repo layout

```
skills/<name>/        # one self-contained skill (history preserved via git subtree)
.github/workflows/    # <name>-ci.yml + <name>-release.yml per skill, path-filtered
```

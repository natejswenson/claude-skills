# claude-skills

A monorepo of self-contained, independently-released [Claude Code](https://claude.com/claude-code) productivity skills.

Each skill under `skills/` is versioned, tested, and released **on its own cadence** —
consolidated into one repo for convenience, but with the same autonomy they had as
separate repos. Independence is achieved with **namespaced release tags**
(`devlog-vX`, `ghostwriter-vX`, `resume-vX`, `github-stats-vX`) and **path-filtered workflows**: a change
to one skill only runs that skill's CI and only cuts that skill's release.

## Skills

| Skill | Invocation | Stack | What it does |
|---|---|---|---|
| [`devlog`](skills/devlog) | `/devlog` | Node | Generate a daily dev-log entry from today's git commits and publish to GitHub. |
| [`ghostwriter`](skills/ghostwriter) | `/ghostwriter` | Python | Turn engineering work into LinkedIn posts with diagram cards. |
| [`resume`](skills/resume) | `/resume` | Node/TS | Tailor a résumé to a job description and render a polished PDF from the CLI. |
| [`github-stats`](skills/github-stats) | `/github-stats` | Bash/`gh` | Show GitHub profile statistics — commits, followers, stars, PRs, issues — plus a repo browser. |

## Install (Claude Code plugin marketplace)

This repo is a self-hosted Claude Code plugin marketplace — add it once, then install
whichever skills you want:

```
/plugin marketplace add natejswenson/claude-skills
/plugin install devlog@claude-skills
/plugin install ghostwriter@claude-skills
/plugin install resume@claude-skills
/plugin install github-stats@claude-skills
```

Each skill's own `README.md` covers its dependencies and configuration.

### Manual install / fallback

Symlink each skill into your skills directory so `SKILL.md` is discovered:

```bash
ln -sfn "$PWD/skills/devlog/skills/devlog"           ~/.claude/skills/devlog
ln -sfn "$PWD/skills/ghostwriter/skills/ghostwriter" ~/.claude/skills/ghostwriter
ln -sfn "$PWD/skills/resume/skills/resume"           ~/.claude/skills/resume
ln -sfn "$PWD/skills/github-stats/skills/github-stats" ~/.claude/skills/github-stats
```

This stays in place until the marketplace install path above is live-verified
end-to-end; it will be removed in a fast-follow once confirmed.

## Branch & release flow

Work integrates on `dev`; `main` is the protected release branch. A push to `main`
is what cuts a skill's release, and the only way in is an auto-merged PR.

1. Branch off `dev`, do the work, and land it on `dev` (open a PR into `dev`, or push
   directly — `dev` is unprotected).
2. To release, **open a PR from `dev` into `main`**. The `auto-merge dev to main`
   workflow enables GitHub native auto-merge, and the PR **merges itself once all
   `ci / <skill>` checks pass** (one required check per skill; each reports on every
   PR). If any check fails, it never merges. Open the PR as a **draft** to hold it —
   it won't auto-merge until you mark it ready.
3. On the merge to `main`, each **changed** skill's release job tags
   `<skill>-v<version>` and publishes a GitHub Release from its changelog — only if
   that version isn't already tagged. Unchanged skills are untouched.

To cut a skill's release, bump its version (`package.json` for devlog/resume, the
`SKILL.md` frontmatter `version:` for ghostwriter/github-stats) and add a `CHANGELOG.md`
entry in the same change. A `dev → main` merge with no version bump is a no-op release.

The required checks + native auto-merge are configured as code in
[`.github/repo-settings.sh`](.github/repo-settings.sh) (run once by a repo admin).

## Repo layout

```
.claude-plugin/marketplace.json                  # marketplace manifest listing all four skills as plugins
skills/<name>/                                   # plugin root (one self-contained skill, history preserved via git subtree)
skills/<name>/.claude-plugin/plugin.json         # per-skill plugin manifest (name/version/description)
skills/<name>/skills/<name>/SKILL.md             # the actual skill — nested one level deeper because
                                                  # Claude Code's plugin auto-discovery only scans
                                                  # skills/<subdir>/SKILL.md, never a root-level SKILL.md
.github/workflows/    # _release.yml (reusable) + one caller per skill, path-filtered
                      # + marketplace.yml (marketplace/plugin.json lint, not yet required)
                      # + auto-merge.yml (dev→main) and tools.yml (shared scorer)
.github/repo-settings.sh   # repo + main-branch-protection config, as code
```

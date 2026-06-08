# devlog

[![npm](https://img.shields.io/npm/v/@natjswenson/devlog?color=blue)](https://www.npmjs.com/package/@natjswenson/devlog)
[![license](https://img.shields.io/npm/l/@natjswenson/devlog)](./LICENSE)
[![security](https://img.shields.io/badge/security-audited-green)](./SECURITY.md)
[![vulnerabilities](https://img.shields.io/badge/npm%20audit-0%20issues-brightgreen)](#security)

A Claude Code skill that turns your daily git commits into a published dev log — and a React example for displaying it on your site.

> **Build in public, automatically.** Make commits like you always do. Run `/devlog`. Today's work shows up on your site as a narrative entry, not raw commit messages.

## Live example

The skill is in production at [natejswenson.com/devlog](https://natejswenson.com/devlog), publishing to [github.com/natejswenson/daily-dev-log](https://github.com/natejswenson/daily-dev-log). What you see on that page is exactly what `npx @natjswenson/devlog preview` renders for you locally.

## How it works

1. **You commit code** in your projects, like you already do.
2. **Run `/devlog` in Claude Code.** The skill reads today's commits, writes a narrative markdown entry, and pushes it to your dev-log GitHub repo.
3. **Your site fetches it.** Static `manifest.json` + per-day markdown files served from `raw.githubusercontent.com` — no backend needed.

## Quick start

```sh
npx @natjswenson/devlog init
```

That command:
- Creates `<your-username>/daily-dev-log` on GitHub (or uses an existing one)
- Installs the skill at `~/.claude/skills/devlog/`
- Writes `~/.claude/skills/devlog/config.json` with your answers
- Lets you register one or more projects in a single run

Then:

```sh
npx @natjswenson/devlog preview
```

to see your dev log rendered locally at `http://localhost:5173`.

## Prerequisites

- **Node 18+** — for the CLI and preview app
- **GitHub CLI** (`gh`), authenticated with `gh auth login` — used to create your dev-log repo and push entries
- **Claude Code** — to run the `/devlog` skill

## Commands

| Command | What it does |
|---|---|
| `npx @natjswenson/devlog init` | One-time setup: create dev-log repo, install skill, write config |
| `npx @natjswenson/devlog add-project` | Register an additional project without editing config.json by hand |
| `npx @natjswenson/devlog config` | Show your current config with validation status |
| `npx @natjswenson/devlog preview` | Run a local preview at `http://localhost:5173` |
| `npx @natjswenson/devlog --help` | Usage |
| `npx @natjswenson/devlog --version` | Version |

> **Tip:** run from any directory *outside* a clone of this repo. Running inside the repo causes a `package.json` name collision and `npx` fails with `command not found`.

## What you end up with

```
~/.claude/skills/devlog/
├── SKILL.md          # The /devlog slash-command instructions
└── config.json       # Your settings (mode 0600)

github.com/<you>/daily-dev-log/   # Created by init, populated by /devlog
├── myproject/
│   ├── manifest.json
│   ├── 2026-05-01.md
│   └── ...
└── ...
```

## Manual setup (if you prefer)

```sh
gh repo create <you>/daily-dev-log --public --add-readme
mkdir -p ~/.claude/skills/devlog
curl -o ~/.claude/skills/devlog/SKILL.md https://raw.githubusercontent.com/natejswenson/devlog/main/SKILL.md
# Then copy config.example.json → ~/.claude/skills/devlog/config.json and fill it in
```

## Add to your site

### React (drop-in)

```sh
cp -r examples/react/ your-site/src/devlog/
```

Edit `your-site/src/devlog/devlog-config.js` to point at your repo, then:

```jsx
import DevLogPage from './devlog/DevLogPage.jsx';

<DevLogPage project="myproject" />
```

Full instructions: [`examples/react/README.md`](./examples/react/README.md).

### No site yet?

The `preview/` directory is a complete deployable Vite app. Set `VITE_DEVLOG_OWNER` / `VITE_DEVLOG_REPO` / `VITE_DEVLOG_PROJECTS` env vars on Vercel, Netlify, or Cloudflare Pages, build with `vite build`, deploy `dist/`. See [`preview/README.md`](./preview/README.md).

### Other stacks (Next, Astro, plain HTML)

It's static JSON and Markdown on GitHub. Build whatever UI you want — see the **Data contract** below.

## Data contract

The dev-log repo has this layout, all served as raw files from `https://raw.githubusercontent.com/<owner>/<repo>/<branch>/`:

```
<repo>/
└── <project-key>/
    ├── manifest.json          # Index of all entries (newest first)
    ├── 2026-05-01.md          # One entry per day
    ├── 2026-04-30.md
    └── ...
```

**`manifest.json`:**
```json
{
  "entries": [
    { "date": "2026-05-01", "file": "2026-05-01.md", "title": "...", "summary": "..." }
  ]
}
```

Strict validation rules (entries that don't match are silently dropped by the React example):
- `date` matches `YYYY-MM-DD`
- `file` matches `^[a-zA-Z0-9._-]+\.md$`
- `title` and `summary` are non-empty strings

**Entry markdown:**

```markdown
---
title: "Concise day summary"
date: 2026-05-01
project: myproject
summary: "1-2 sentence summary"
---

## What I Built
Narrative paragraphs.

## What's Next
Forward-looking note.

## Public Commits
- [myproject] commit message ([abc1234](https://github.com/.../commit/abc1234567...))
```

That's the entire contract.

## Configuration reference

`~/.claude/skills/devlog/config.json`:

| Field | Type | Description |
|---|---|---|
| `targetRepo` | `"<owner>/<repo>"` | Repo where dev log entries are published. Must match `^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$`. |
| `branch` | string (optional) | Branch in the dev-log repo. Defaults to `main`. Must not contain `..` or start with `-`. |
| `gitAuthor` | string | Used as `git log --author=...` to find your commits. Whitespace OK; no shell metacharacters. |
| `githubUser` | string | Your GitHub username. |
| `projects` | array | One entry per project you want dev logs for. |
| `projects[].key` | string | Subdirectory name in the dev-log repo. Strict token: `^[a-z0-9][a-z0-9._-]*$`, no `..`. |
| `projects[].label` | string (optional) | Display name for the tab. Defaults to `key`. |
| `projects[].path` | string | Local filesystem path to the project. Whitespace OK. |
| `projects[].remote` | `"<owner>/<repo>"` | The project's GitHub remote. Used to mark public commits and link them. |

See [`config.example.json`](./config.example.json) for a complete template, or run `npx @natjswenson/devlog config` to inspect your current config with validation.

## Security

The package is designed to be safe to install on a developer's machine and have ambient gh/git credentials. See [SECURITY.md](./SECURITY.md) for the full threat model and audit history.

**At a glance:**
- ✓ All shell calls in the CLI use `spawnSync` with argv arrays (no shell, no injection surface)
- ✓ The skill validates every config field against an allowlist before interpolating into shell commands; instructs the LLM to single-quote interpolated values
- ✓ Markdown rendering uses `react-markdown` with `skipHtml` and an allowlist `urlTransform` (only http(s)/mailto allowed; data:, javascript:, vbscript:, file:, blob: all neutralized)
- ✓ Frontmatter parser uses `Object.create(null)` + key allowlist (no prototype pollution)
- ✓ All external JSON is schema-validated before use (manifest, env-var projects array)
- ✓ Vite dev server bound to `localhost`, CORS off
- ✓ Demo-mode `window.fetch` override gated to dev builds only
- ✓ `config.json` written atomically (tmp + rename), mode 0600
- ✓ All dependencies pinned to exact versions
- ✓ `npm audit`: 0 known vulnerabilities

**To report a vulnerability:** open a [GitHub security advisory](https://github.com/natejswenson/devlog/security/advisories/new). Do not open a public issue.

## Customization

- **Tweak the entry template:** edit `~/.claude/skills/devlog/SKILL.md` (Step 4 — generate the entry).
- **Tweak the UI:** override the `--devlog-*` CSS variables in `examples/react/DevLogPage.css` to match your theme.
- **Add more projects:** `npx @natjswenson/devlog add-project` (no manual JSON editing required).

## Troubleshooting

**`sh: devlog: command not found` when running `npx`:** you're inside a checkout of this repo. The local `package.json` name collides with the published one. Run `npx` from somewhere else, e.g. `cd ~ && npx @natjswenson/devlog ...`.

**Init prompts show `78` after placeholder text:** that's an artifact of how some output capture tools render `\x1b7`/`\x1b8` (cursor save/restore) escape sequences. In a real interactive terminal, you won't see it.

**Preview is blank / no tabs / no entries:** check the browser console. If you see CJS interop errors related to `react-dom/client`, `style-to-js`, or `react-markdown`, you're on a pre-0.1.6 release — upgrade with `npm cache clean --force && rm -rf ~/.npm/_npx && npx --yes @natjswenson/devlog@latest preview`.

**Init can't find `gh`:** install via [cli.github.com](https://cli.github.com/) and run `gh auth login`.

**`Config validation failed: ...`** — the validator rejected something in your `config.json`. Run `npx @natjswenson/devlog config` for a detailed diagnosis. Common causes:
- A field has shell metacharacters (`;` `&` `|` `` ` `` `$` etc) — see SKILL.md for the full list
- A project key contains `..` or `/`
- A path doesn't exist on disk

**Preview shows "Setup required":** you deployed the preview app standalone but didn't set the env vars. Set `VITE_DEVLOG_OWNER`, `VITE_DEVLOG_REPO`, `VITE_DEVLOG_PROJECTS` (JSON-stringified array) in your hosting environment.

## Versioning

Releases are documented in [CHANGELOG.md](./CHANGELOG.md). The package follows semver — bug fixes/security patches in patch releases (0.1.x), behavior changes in minor (0.x.0).

## License

MIT

# devlog

[![npm](https://img.shields.io/npm/v/@natjswenson/devlog?color=blue)](https://www.npmjs.com/package/@natjswenson/devlog)
[![license](https://img.shields.io/npm/l/@natjswenson/devlog)](./LICENSE)

A Claude Code skill that turns your daily git commits into a published dev log — and a React example for displaying it on your site.

> **Build in public, automatically.** Make commits like you always do. Run `/devlog`. Today's work shows up on your site as a narrative entry, not raw commit messages.

## Live example

The skill is in production at [natejswenson.com/devlog](https://natejswenson.com/devlog), publishing entries to [github.com/natejswenson/daily-dev-log](https://github.com/natejswenson/daily-dev-log). What you see on that page is exactly what `npx @natjswenson/devlog preview` renders for you locally.

## How it works

1. **You commit code** in your projects, like you already do.
2. **Run `/devlog` in Claude Code.** The skill reads today's commits, writes a narrative markdown entry, and pushes it to your dev-log GitHub repo.
3. **Your site fetches it.** Static `manifest.json` + per-day markdown files served from `raw.githubusercontent.com` — no backend needed.

## Quick start

```sh
npx @natjswenson/devlog init
```

That command:
- Creates `<your-username>/daily-dev-log` on GitHub
- Installs the skill at `~/.claude/skills/devlog/`
- Writes `~/.claude/skills/devlog/config.json` with your answers

Then:
```sh
npx @natjswenson/devlog preview
```
to see your dev log rendered locally.

## Prerequisites

- **Node 18+** — for the CLI and preview app
- **GitHub CLI** (`gh`), authenticated — used to create your dev-log repo and push entries
- **Claude Code** — to run the `/devlog` skill

## What you end up with

```
~/.claude/skills/devlog/
├── SKILL.md          # The slash command
└── config.json       # Your settings (target repo, projects, etc)

github.com/<you>/daily-dev-log/   # Created by `init`, populated by /devlog
├── myproject/
│   ├── manifest.json
│   ├── 2026-05-01.md
│   └── ...
└── ...
```

## Manual setup (if you'd rather not use the CLI)

1. **Create your dev-log repo:**
   ```sh
   gh repo create <you>/daily-dev-log --public --add-readme
   ```
2. **Install the skill:**
   ```sh
   mkdir -p ~/.claude/skills/devlog
   curl -o ~/.claude/skills/devlog/SKILL.md \
     https://raw.githubusercontent.com/natejswenson/devlog/main/SKILL.md
   ```
3. **Write your config** at `~/.claude/skills/devlog/config.json` — copy [`config.example.json`](./config.example.json) and fill in.

## Add to your site

### React (drop-in)

```sh
cp -r examples/react/ your-site/src/devlog/
```

Edit `your-site/src/devlog/devlog-config.js` to point at your repo, then mount:

```jsx
import DevLogPage from './devlog/DevLogPage.jsx';

<DevLogPage project="myproject" />
```

Full instructions: [`examples/react/README.md`](./examples/react/README.md).

### No site yet?

The `preview/` directory is a complete deployable Vite app. Set `VITE_DEVLOG_OWNER` / `VITE_DEVLOG_REPO` / `VITE_DEVLOG_PROJECTS` env vars on Vercel, Netlify, or Cloudflare Pages, build with `vite build`, deploy `dist/`. Done — you have a public dev log at your own URL. See [`preview/README.md`](./preview/README.md).

### Other stacks (Next, Astro, plain HTML, anything)

It's static JSON and Markdown on GitHub. Build whatever UI you want — see the **Data contract** below.

## Data contract

The dev-log repo has this layout, all served as raw files from `https://raw.githubusercontent.com/<owner>/<repo>/main/`:

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
| `targetRepo` | `"<owner>/<repo>"` | Repo where dev log entries are published. **You create this — `init` does it for you, or `gh repo create` manually.** |
| `branch` | string (optional) | Branch in the dev-log repo. Defaults to `main`. |
| `gitAuthor` | string | Used as `git log --author=...` to find your commits. |
| `githubUser` | string | Your GitHub username (for constructing commit links). |
| `projects` | array | One entry per project you want dev logs for. |
| `projects[].key` | string | Subdirectory name in the dev-log repo. |
| `projects[].label` | string (optional) | Display name for the project tab in the UI. Defaults to `key`. |
| `projects[].path` | string | Local filesystem path to the project. |
| `projects[].remote` | `"<owner>/<repo>"` | The project's GitHub remote, used to mark public commits and link them. |

See [`config.example.json`](./config.example.json) for a complete template.

## Customization

- **Tweak the entry template:** edit `~/.claude/skills/devlog/SKILL.md` (Step 4 — generate the entry).
- **Tweak the UI:** override the `--devlog-*` CSS variables in `examples/react/DevLogPage.css` to match your theme. Or build your own UI against the data contract above.
- **Add more projects:** edit `~/.claude/skills/devlog/config.json` directly.

## Troubleshooting

**`sh: devlog: command not found` when running `npx`:** you're probably inside a checkout of this repo. The local `package.json` collides with the published name. Run `npx` from anywhere else (e.g. `cd ~ && npx @natjswenson/devlog ...`).

**Init prompt shows `78` after the placeholder text:** that's an artifact of capturing terminal output (cursor save/restore escapes); in a real terminal you won't see it.

**Preview is blank / no tabs / no entries:** check the browser console. If you see *"does not provide an export named …"* errors related to `react-dom/client`, `style-to-js`, or `react-markdown`, you're on a pre-0.1.3 release — upgrade with `npm cache clean --force && rm -rf ~/.npm/_npx && npx --yes @natjswenson/devlog@latest preview`.

**`npm publish` (if you fork/republish your own copy) fails with 403:** npm requires 2FA or a granular access token with bypass-2FA enabled for write operations. Easiest path: enable 2FA, install an authenticator app, and pass `--otp=<code>` to `npm publish`.

**Init can't find `gh`:** install via [cli.github.com](https://cli.github.com/) and run `gh auth login`.

## Versioning

Stable: see [npm](https://www.npmjs.com/package/@natjswenson/devlog). The package follows semver — bug fixes in patch releases (0.1.x), behavior changes in minor (0.x.0).

## License

MIT

# preview/

Standalone Vite app that renders your published dev log locally.

## Run via CLI (recommended)

```sh
npx @natejswenson/devlog preview
```

The CLI reads `~/.claude/skills/devlog/config.json` and passes the values to Vite via env vars.

## Deploy as a standalone site

If you don't have a personal site yet, this directory is a complete React/Vite app you can deploy as your dev log site.

1. Set env vars (Vercel/Netlify/Cloudflare Pages — wherever):
   - `VITE_DEVLOG_OWNER` = your GitHub username
   - `VITE_DEVLOG_REPO` = your dev-log repo name (e.g. `daily-dev-log`)
   - `VITE_DEVLOG_BRANCH` = `main` (or `master`)
   - `VITE_DEVLOG_PROJECTS` = JSON array, e.g. `[{"key":"myproject","label":"My Project"}]`
2. Build command: `vite build` (root: this directory)
3. Output: `dist/`

For local-only dev (without the CLI), set the same env vars in a `.env.local` next to this `vite.config.js` and run `vite`.

---
ticket: "n/a"
title: "Shareable @natejswenson/devlog repo"
date: "2026-05-01"
source: "design"
---

# Shareable `@natejswenson/devlog` repo — design

## Goal

Turn the personal `/devlog` skill into a public, easy-to-adopt project. A new user should be able to run **one command** (`npx @natejswenson/devlog init`) and have:

1. A GitHub repo where their dev log entries get published.
2. The Claude Code skill installed and configured locally.
3. A path to either preview locally (`npx @natejswenson/devlog preview`) or copy the React components into their own site.

Lean v1 — ship fast for the LinkedIn audience that asked. No frameworks beyond React, no auth, no private-repo support.

## Why this is worth doing

The skill works today but is hardcoded to one user. Adopters currently have to read the SKILL.md, mentally substitute their identity, edit a registry table, create their own dev-log repo manually, and then figure out how to render entries on a site they may not even have yet. The CLI collapses that to a single command and the deployable preview app removes the "I don't have a website" blocker.

## Repo layout

```
devlog/
├── README.md                    # Single source of setup truth
├── SKILL.md                     # Genericized skill, reads config.json
├── config.example.json          # Schema reference + manual-setup template
├── package.json                 # name: @natejswenson/devlog, bin: devlog
├── bin/
│   └── devlog.js                # CLI: `init` and `preview` subcommands
├── preview/                     # Standalone Vite app, also deployable
│   ├── index.html
│   ├── main.jsx
│   ├── App.jsx
│   └── vite.config.js
├── examples/
│   └── react/                   # Canonical drop-in components
│       ├── README.md
│       ├── DevLogPage.jsx
│       ├── DevLogPage.css
│       ├── useDevLogEntries.js
│       └── devlog-config.js
└── docs/
    └── plans/                   # Design docs
        └── 2026-05-01-devlog-shareable-design.md
```

`preview/` imports from `../examples/react/` — single source of truth, no duplication. It doubles as a deployable starter site for adopters without one.

## Configuration

Config lives at `~/.claude/skills/devlog/config.json`:

```json
{
  "targetRepo": "yourusername/daily-dev-log",
  "gitAuthor": "Your Name",
  "githubUser": "yourusername",
  "projects": [
    {
      "key": "myproject",
      "path": "~/code/myproject",
      "remote": "yourusername/myproject"
    }
  ]
}
```

| Field | Purpose |
|---|---|
| `targetRepo` | `<owner>/<repo>` where dev log entries are published. **Adopter must have created this repo (CLI creates it during `init`).** |
| `gitAuthor` | Used as `git log --author=...` filter when gathering today's commits. |
| `githubUser` | Used to construct commit links in entries (`github.com/<user>/<remote>`). |
| `projects[].key` | Subdirectory name in the dev-log repo (also project label). |
| `projects[].path` | Local filesystem path to the project. `~` is expanded. |
| `projects[].remote` | `<owner>/<repo>` of the project's GitHub remote, used to mark commits as public and link them. |

`config.example.json` in the repo is a template adopters copy and edit (or the CLI generates it).

## SKILL.md changes

The genericized skill is a near-line-for-line port of the existing one. Only these changes:

1. **Step 0 (new):** Read and validate `~/.claude/skills/devlog/config.json`. If missing, instruct user to run `npx @natejswenson/devlog init`.
2. **Project Registry table** → replaced with: "Projects are configured in `config.json`. The skill operates on `config.projects[]`."
3. **`--author="Nate"`** → `--author="<config.gitAuthor>"`
4. **`natejswenson/daily-dev-log`** → `<config.targetRepo>` (everywhere it appears)
5. **`github.com/natejswenson/...` commit links** → `github.com/<project.remote>/...`

Everything else — step structure, append mode, manifest update logic, content rules, edge cases — is unchanged. The skill stays in markdown; no JS rewrite.

## CLI design

Single Node entrypoint at `bin/devlog.js`. Two subcommands. Minimal dependencies: `prompts` (interactive prompts) and `kleur` (terminal colors). Everything else uses Node built-ins.

### `npx @natejswenson/devlog init`

One-time bootstrap. Idempotent on re-run (prompts before overwriting).

**Preflight checks (fail fast with actionable messages):**
- Node ≥18 (for global `fetch`)
- `gh` CLI installed and authenticated (`gh auth status`)

**Interactive prompts** (with smart defaults):
- Git author name → default from `git config --global user.name`
- GitHub username → default from `gh auth status` (parsed)
- Target repo name → default `daily-dev-log`
- Register a project now? (Y/n) → if yes:
  - Project path (default: cwd)
  - Project key (default: basename of path)
  - Project remote (auto-detected from `git -C <path> remote get-url origin`, with override prompt)

**Confirmation summary**, then:
1. `gh repo create <user>/<repo> --public --description "Daily dev log" --add-readme` (skipped if repo exists; CLI detects via `gh repo view` and asks before continuing)
2. Create `~/.claude/skills/devlog/` if missing
3. Copy `SKILL.md` from package → `~/.claude/skills/devlog/SKILL.md` (prompt before overwrite)
4. Write `~/.claude/skills/devlog/config.json` (prompt before overwrite)
5. Print next steps:
   ```
   ✓ Skill installed at ~/.claude/skills/devlog/
   ✓ Target repo: github.com/<user>/<repo>
   ✓ Config: ~/.claude/skills/devlog/config.json

   Next steps:
   1. (Optional) Edit config.json to register more projects
   2. Make some commits in a registered project
   3. Run /devlog in Claude Code to publish your first entry
   4. Run `npx @natejswenson/devlog preview` to see it locally
   ```

### `npx @natejswenson/devlog preview`

**Preflight:** read `~/.claude/skills/devlog/config.json`. If missing, instruct user to run `init`.

**Action:**
1. Set `VITE_DEVLOG_OWNER`, `VITE_DEVLOG_REPO`, `VITE_DEVLOG_PROJECTS` (JSON-stringified) from config
2. `cd` into the package's `preview/` directory
3. Spawn `npm exec vite` (or `npx vite`) — opens `localhost:5173`

User sees their actual published dev log rendered in the React example. Hot-reloads on file changes (useful if they want to tweak before copying into their site).

## Preview app (`preview/`)

Vite + React app, ~5 small files. Imports `DevLogPage`, `useDevLogEntries`, etc. from `../examples/react/` so canonical components live in one place.

```
preview/
├── index.html               # <div id="root">, mounts main.jsx
├── main.jsx                 # ReactDOM.createRoot, renders <App />
├── App.jsx                  # Reads import.meta.env.VITE_DEVLOG_*, renders DevLogPage with project tabs
└── vite.config.js           # Default React plugin, no customization
```

`App.jsx` builds a `DEVLOG_PROJECTS` array from `VITE_DEVLOG_PROJECTS` env var (JSON), passes it to `DevLogPage`. If env vars are missing (someone runs `vite` directly without going through CLI), it shows a helpful message pointing at `init`.

**Deployability:** `npm run build` produces a static `dist/` that any host (Vercel, Netlify, Cloudflare Pages, GitHub Pages) can serve. README documents this as the "no website yet" path: deploy `preview/dist/` and you have a working dev log site.

## React example (`examples/react/`)

Lifted from `natejswenson.io/src/`, with three changes:

1. **Strip site-specific imports.** Current `DevLogPage.js` imports `ExperiencePage.css`, `NavIcons`, and uses `react-router-dom`'s `useNavigate`. Genericize: drop the `ArrowLeft`/`ExternalLink` nav header (it's site-chrome, not the log itself), inline any required CSS, accept project list via props.
2. **Externalize config.** `devlog-config.js` is the file an adopter edits — exports `DEVLOG_CONFIG` and `DEVLOG_PROJECTS` constants. Hook and page read from there.
3. **Add an `examples/react/README.md`** explaining: required peer deps (`react`, `react-markdown`, `remark-gfm`), where to put the files, what to edit (`devlog-config.js`), how to mount `<DevLogPage projects={...} />` in your routing.

The components stay framework-flavor-React but don't assume a router. If an adopter is on Next/Astro/Remix, the hook is portable; the page can be wrapped trivially.

## README structure

The README is the product. Single page, ordered for skim-first reading:

```
# devlog
[1-line pitch] [screenshot of natejswenson.io devlog page]

## Quick start
    npx @natejswenson/devlog init
That creates your dev-log repo, installs the skill, sets up config.

## How it works
- Commit code in your projects as usual
- Run /devlog in Claude Code → today's commits become a markdown entry
- Entry is pushed to your daily-dev-log repo, renders on your site

## Prerequisites
- Node 18+
- gh CLI, authenticated
- Claude Code

## Setup options
### Option A: One command (recommended)
    npx @natejswenson/devlog init

### Option B: Manual
1. gh repo create <you>/daily-dev-log --public
2. mkdir -p ~/.claude/skills/devlog && cp SKILL.md ~/.claude/skills/devlog/
3. cp config.example.json ~/.claude/skills/devlog/config.json (then edit)

## Preview locally
    npx @natejswenson/devlog preview

## Add to your site
- React: copy examples/react/ in, edit devlog-config.js, mount <DevLogPage>
- Other stacks: see "Data contract" below
- No site yet? Deploy preview/ as standalone — instructions in preview/README.md

## Data contract
- `<project>/manifest.json`: { entries: [{ date, file, title, summary }] } (newest first)
- `<project>/<YYYY-MM-DD>.md`: YAML frontmatter (title, date, project, summary) + body
- Files served as raw: https://raw.githubusercontent.com/<owner>/<repo>/main/<project>/...

## Customization
[bullet pointers: tweak templates in SKILL.md, build your own UI against the contract]

## License
MIT
```

## API surface

### CLI commands

| Command | Effect |
|---|---|
| `npx @natejswenson/devlog init` | Interactive setup. Creates `<user>/<repo>` on GitHub, writes `~/.claude/skills/devlog/{SKILL.md,config.json}`. |
| `npx @natejswenson/devlog preview` | Reads config, launches Vite dev server pointed at user's published dev log. |
| `npx @natejswenson/devlog --help` | Usage. |
| `npx @natejswenson/devlog --version` | Version from package.json. |

### Config schema (`~/.claude/skills/devlog/config.json`)

```ts
{
  targetRepo: string;     // "<owner>/<repo>"
  gitAuthor: string;      // matches git log --author
  githubUser: string;     // <owner> portion of project remotes
  projects: Array<{
    key: string;          // dev-log subdirectory + tab label
    path: string;         // local filesystem path (~ expanded)
    remote: string;       // "<owner>/<repo>" for commit links
  }>;
}
```

### Data contract (consumed by any UI)

`https://raw.githubusercontent.com/<owner>/<repo>/main/<project-key>/manifest.json`

```ts
{
  entries: Array<{
    date: string;     // YYYY-MM-DD
    file: string;     // YYYY-MM-DD.md
    title: string;
    summary: string;
  }>;
}
```

`https://raw.githubusercontent.com/<owner>/<repo>/main/<project-key>/<YYYY-MM-DD>.md`

```markdown
---
title: "..."
date: YYYY-MM-DD
project: <key>
summary: "..."
---

## What I Built
<narrative>

## What's Next
<short forward-looking paragraph>

## Public Commits
- [<key>] message ([hash](github.com/.../commit/...))
```

### React component surface (`examples/react/`)

```ts
// useDevLogEntries.js
useDevLogEntries(project: string): {
  entries: Entry[];
  loadedContent: Map<string, string>;
  loading: boolean;
  error: string | null;
  fetchEntryContent: (filename: string) => Promise<void>;
  retry: () => void;
}

// DevLogPage.jsx
<DevLogPage
  project={string}              // active project key
  projects={Project[]}           // tab list: { key, label }
  config={{ owner, repo, branch, baseUrl }}
  onProjectChange={(key) => void}
/>
```

## Invariants

**Checkable by inspection:**
- `SKILL.md` contains no string `natejswenson` (after genericization).
- `package.json` declares `bin: { "devlog": "./bin/devlog.js" }` and the file is executable.
- `preview/` imports components only from `../examples/react/` (no duplication of component logic).
- `examples/react/` files have no imports from outside the directory except npm packages.

**Testable:**
- `npx @natejswenson/devlog init` in a clean environment produces a valid `config.json` and copies SKILL.md to `~/.claude/skills/devlog/`.
- `npx @natejswenson/devlog preview` against a known-good `<owner>/<repo>/<project>` renders entries without console errors.
- Running the genericized SKILL.md with a valid config produces an entry whose content is structurally identical (frontmatter shape, sections) to the current production skill's output.

## Failure modes & handling

| Scenario | Handling |
|---|---|
| `gh` not installed | `init` prints install URL, exits non-zero |
| `gh` not authenticated | `init` prints `gh auth login` instructions, exits non-zero |
| Node < 18 | `init` and `preview` fail with version requirement message |
| Target repo already exists | `init` confirms with user before continuing (don't recreate, just write config) |
| `~/.claude/skills/devlog/` already has SKILL.md or config.json | Prompt before overwrite |
| `preview` run before `init` | Detects missing config, points at `init` command |
| Project path doesn't exist | `init` warns but continues; SKILL.md handles it at runtime per existing edge-case rules |
| Empty/missing manifest in dev-log repo | Hook returns empty entries; UI shows empty state (already implemented) |
| Network error fetching manifest | Hook surfaces error; UI shows retry button (already implemented) |

## Out of scope for v1

- Frameworks beyond React (Astro/Next/Remix/plain HTML examples)
- Private dev-log repos (would require auth in the hook)
- `npx devlog add-project` subcommand (editing config.json by hand is fine)
- `npx devlog publish` subcommand (the Claude skill *is* the publish action)
- Auto-update / version-check
- Telemetry
- CI/CD for the package itself (manual `npm publish` for v1)

## Open questions

None blocking. npm package name `@natejswenson/devlog` is confirmed. License: MIT (default for shareable repo, no reason to differ).

## Acceptance criteria

A new adopter, on a fresh machine with Node 18+, `gh` authenticated, and Claude Code installed:
1. Runs `npx @natejswenson/devlog init`, answers prompts → has working skill + repo + config.
2. Makes a commit in their registered project, runs `/devlog` in Claude Code → entry appears in their dev-log repo.
3. Runs `npx @natejswenson/devlog preview` → sees their entry rendered locally.
4. Either (a) follows `examples/react/README.md` to drop into their existing site, or (b) deploys `preview/dist/` to Vercel and gets a public dev log site.

# Skills Studio

A local workspace for running this repository’s skills with your Codex subscription.
Browse the library, start a conversation, review tool activity and approvals, and
preview generated work beside the conversation.

## Run locally

Requires Node.js 22.13 or newer (tested with 25.2.1), npm, and a locally installed
Codex CLI signed in with ChatGPT. The integration was tested with Codex 0.162.1;
the app-server protocol is experimental and older versions may differ.

From this directory:

```sh
codex login
npm ci
npm run build
npm start
```

Open <http://127.0.0.1:4317>. Choose **Settings** to select a trusted workspace.
The default is a dedicated `.studio-data/workspace` folder, keeping generated work
outside the skill sources. After changing your Codex login, use **Refresh connection**
in Settings. It restarts the app’s own Codex process; an active run must finish first.

The app launches `codex app-server` directly on your Mac. Native Codex owns sign-in
and credentials. Skills Studio requires ChatGPT authentication before every turn,
forces the OpenAI provider and ChatGPT login mode, and removes inherited
`OPENAI_API_KEY` and `CODEX_API_KEY` values from its child environment. There is no
API-billing fallback and no Claude integration in this version. Subscription usage
limits and any account-level extra-usage settings still apply.

The web server binds only to `127.0.0.1`, validates local Host/Origin headers, and
does not expose credentials to the browser. Keep it local; remote hosting is not
supported. The interface and files are local, while Codex inference uses OpenAI.

## Working in the studio

- Search skills by name or outcome; save favorites in the browser.
- Select a skill to prefill an example, or enter an open-ended request.
- Follow streamed responses, inspect activity, answer questions, and allow or
  decline individual command/file approval requests.
- Stop an active turn or continue a completed conversation.
- Search saved runs; **Run again** prepares a fresh request for you to submit.
- Review and download captured files, with versioned revisions retained.

One run executes at a time. Closing or refreshing the browser does not stop it.
Stopping the backend stops its Codex process; unfinished saved runs are marked
interrupted on restart. Their old approval IDs are discarded. Send a new follow-up
to resume the existing Codex conversation; work is never automatically retried.

SQLite history, settings, workspace files, and copied artifacts live in the ignored
`.studio-data/` directory. Set `STUDIO_DATA_DIR`, `STUDIO_WORKSPACE`, or `PORT` when
launching to override these defaults. `STUDIO_CODEX_BIN` selects the installed CLI.
Store local state outside the checkout with `STUDIO_DATA_DIR` for longer-term use.

## Skill and preview boundaries

The library reads the existing Claude marketplace and shared `SKILL.md` files;
invocations use Codex’s structured skill input with the exact source path. It does
not install plugins or change existing Claude/Codex configuration. A card’s
“instructions available” label confirms the source file exists. External services,
MCP servers, browser tools, image tools, hardware, and dependencies still need to
be available in the underlying Codex CLI. Desktop-app connections are not assumed
to exist in a separate app-server process. Unsupported interactive protocol requests
are denied and recorded in Activity rather than silently approved.

Previews capture new or modified supported files inside the selected workspace
after each turn, including partial output from interrupted turns. The scan skips
hidden folders, dependency/build folders, and symlinks; it is bounded to four
directory levels and roughly 500 candidate files. Individual previews are capped
at 10 MiB. Files written outside the workspace are not collected. Copies are
retained per revision so later runs cannot overwrite a previous preview.

Markdown renders without raw HTML. HTML/SVG previews are sandboxed without scripts,
network access, or same-origin privileges. Self-contained reports work best;
relative external assets and interactive JavaScript are intentionally unavailable.
Download outputs to use them in their full native environment.

## Develop and verify

```sh
npm start       # backend on 4317
npm run dev    # separate terminal: Vite on 5173, proxies /api
npm test       # offline transport, lifecycle, storage, and security checks
npm run build  # TypeScript and production build
```

Live checks consume your Codex subscription and run only when explicitly invoked:

```sh
npm run proof           # auth, skill discovery/invocation, streaming, follow-up,
                        # cancellation, and recovery in a new Codex process
node scripts/smoke.mjs # with backend running: real catalog skill and file preview
```

The proof creates its own temporary skill/workspace; smoke creates a `skillhelp`
conversation and a `studio-proof.md` file in the current workspace. Neither publishes
anything or uses external connected services. Approval/question bridging is covered
by deterministic tests; the live proof does not claim those events occurred.

Brand CSS is generated from PRESS. From the repository root:

```sh
node skills/press/skills/press/bin/press.js emit --target skills-studio
node skills/press/skills/press/bin/press.js check --target skills-studio
python3 tools/check_compatibility.py
```

Integration reference: [official Codex app-server documentation](https://learn.chatgpt.com/docs/app-server).

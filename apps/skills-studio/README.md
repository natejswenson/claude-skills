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
does not expose Codex credentials to the browser. Keep it local; public hosting
is not supported. The authenticated Kubernetes preview below is a separate entrypoint. The interface and files are local, while Codex inference uses OpenAI.

## Working in the studio

- Search skills by name or outcome; save favorites in the browser.
- Select a skill to see its purpose and an optional example, or enter an
  open-ended request. Choosing a skill preserves your draft; choosing its example
  adds it to your existing words.
- Follow streamed responses, inspect activity, answer questions, and allow or
  decline individual command/file approval requests.
- Stop an active turn or continue a completed conversation.
- Search saved runs by title, skill, or any conversation text; **Run again**
  prepares a fresh request for you to submit. Failed run loading offers Retry
  and Back to runs instead of leaving an opening indicator.
- Review and download captured files, with versioned revisions retained.
- Attach local files to new requests or follow-ups and retrieve their original
  copies from the conversation later.

Run status shows the latest activity, pending decisions, or a completion summary.
On narrow screens, **Conversation**, **Output**, and **Activity** tabs keep each
view within reach. New approval requests return you to the conversation and mark
its tab until answered. **Back to latest** returns to new responses after you
scroll up. Finished files link directly from the completion summary; Markdown
previews support tables and read-only task lists. Links to captured files open
their latest revision in Output; footnote links keep you in the current run.

Multi-file runs open a presentable report before supporting data or source files.
Your selected file stays selected as new outputs arrive; a newer revision of that
file is selected automatically. JSON is formatted for reading, and text/source
previews show at most 200,000 characters; downloads retain the complete file.
PDF output has an explicit download view. A captured image with the same folder
and filename stem can provide a labeled companion preview for the latest PDF
revision when both were captured in the same collection batch. Older revisions,
untracked legacy files, and PDF-only updates use the download view to avoid
showing an unrelated image.
While preview copies are being saved, **Preparing outputs** keeps the run locked
until its final files are available.

Each message accepts up to five files, with a 10 MiB limit per file and 20 MiB
total. Selecting a file keeps it in the browser draft; sending copies it into
private local storage and makes it available to Codex through your subscription.
Your source file is never changed. The saved copy stays with its message, so
later files with the same name do not overwrite earlier attachments.

Recognized PNG, JPEG, WebP, and GIF inputs use Codex's native image input. Other
files are provided as local references for Codex to read with its available tools;
PDF, Word, and other document parsing depends on those tools. Attachment contents
are not automatically executed. Downloads use attachment-only responses, including
HTML and SVG. **Run again** copies the request text and asks you to reattach files;
it does not silently reuse private files in a new run.

One run executes at a time. Closing or refreshing the browser does not stop it.
Stopping the backend stops its Codex process; unfinished saved runs are marked
interrupted on restart. Their old approval IDs are discarded. Send a new follow-up
to resume the existing Codex conversation; work is never automatically retried.

SQLite history, settings, workspace files, inputs, and copied artifacts live in the ignored
`.studio-data/` directory. Set `STUDIO_DATA_DIR`, `STUDIO_WORKSPACE`, or `PORT` when
launching to override these defaults. `STUDIO_CODEX_BIN` selects the installed CLI.
Store local state outside the checkout with `STUDIO_DATA_DIR` for longer-term use.

## Skill and preview boundaries

The library reads the existing Claude marketplace and shared `SKILL.md` files;
invocations use Codex’s structured skill input and an explicit source-path
instruction so same-named installed copies do not silently replace the selection. It does
not install plugins or change existing Claude/Codex configuration. A card’s
“instructions available” label confirms the source file exists. External services,
MCP servers, browser tools, image tools, hardware, and dependencies still need to
be available in the underlying Codex CLI. Desktop-app connections are not assumed
to exist in a separate app-server process. Unsupported interactive protocol requests
are denied and recorded in Activity rather than silently approved.

Previews capture new or modified supported files inside the selected workspace
after each turn, including partial output from interrupted turns. The scan skips
hidden folders, dependency/build folders, and symlinks; it is bounded to four
directory levels and at most 500 candidate files. Individual previews are capped
at 10 MiB. Files written outside the workspace are not collected. Copies are
retained per revision so later runs cannot overwrite a previous preview.

Markdown renders without raw HTML. HTML/SVG previews are sandboxed without scripts,
network access, or same-origin privileges. Self-contained reports work best;
relative external assets and interactive JavaScript are intentionally unavailable.
Download outputs to use them in their full native environment.

## Local Kubernetes preview

The checked-in `.dev/service.json` enrolls this app with the existing `tk` local
Kubernetes platform. It builds a non-root, stateless frontend gateway. Codex runs
on the Mac through an authenticated reverse WebSocket connection; no Codex login,
home directory, workspace, or database is copied into an image or mounted in a pod.
The pod keeps the platform’s existing network isolation.

Requires the configured `tk` platform, Docker, trusted local mkcert CA, and the same
native Codex ChatGPT sign-in used by the localhost app. From this app directory:

```sh
tk service check --repo "$PWD" --json
tk dev enroll --repo "$PWD" --dry-run --json
tk dev enroll --repo "$PWD" --json
tk dev ensure --repo "$PWD" --json
```

Use the returned preview ID. Wait for it to become ready with
`tk dev wait --preview PREVIEW_ID --timeout 30 --json`, then run:

```sh
npm run preview:connect -- --preview PREVIEW_ID
```

The launcher verifies the exact preview/worktree and its HTTPS hostname, derives
separate bridge and browser credentials inside the pod, and starts its own
loopback backend on a separate port. It saves a **private browser access file**
under `.studio-data/kubernetes/PREVIEW_ID/browser-access.json`; enter its `code`
on the preview sign-in page. The code grants access to this preview’s skills,
files, and approvals. It is never placed in a URL or printed in terminal output.
The browser receives a Secure, HttpOnly, SameSite cookie. All API/data routes
require sign-in; only health and source revision metadata are public.

Preview history and generated files live separately under that preview’s
`backend/` and `workspace/` directories on the Mac. The normal port 4317 app and
its workspace stay independent. Preview data survives pod replacement; browser
sessions do not. Keep the launcher running. Ctrl-C stops only its own backend and
Codex process and releases its ownership lock. It preserves preview files.

The reverse connection streams responses, SSE activity, uploads, downloads, and
approval decisions. A disconnect fails pending HTTP requests and reconnects the
transport; it never automatically replays a model request. Check saved history
before manually retrying an interrupted action. Restart the launcher after backend
source changes; a Kubernetes image rebuild updates the gateway, not the already
running Mac backend.

After changes, run the tests and `tk dev verify --preview PREVIEW_ID --json`.
Complete the requested real browser check and record its exact generation/source
receipt with `tk dev record-check`. Readiness alone is not full verification.
`tk dev stop --preview PREVIEW_ID --json` releases this preview’s slot; it does not
delete its Mac-side files. Never stop another preview to acquire capacity.

## Develop and verify

```sh
npm start       # backend on 4317
npm run dev    # separate terminal: Vite on 5173, proxies /api
npm test       # offline transport, lifecycle, storage, and security checks
npm run build  # TypeScript and production build
```

Offline tests also exercise attachment storage, limits, native image routing,
message isolation, and Unicode request decoding. User file contents and live Codex
calls are never part of CI.

The dedicated Skills Studio GitHub Actions workflow runs `npm ci`, offline tests,
the production build, and PRESS generation/CSS checks on Node.js 24 when app or
relevant brand files change. It uses no Codex login, credentials, or subscription;
live proof and smoke scripts remain manual. The app is separate from the per-skill
CI/release registry and does not add a required skill check.

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

Command approvals show the exact command, folder, and reason. Network requests
identify the destination and protocol, and file requests display the proposed diff.
Only offered one-action decisions are available. When Codex offers cancellation
instead of refusal, the button says **Decline and stop**. Session-wide command approvals and
persistent policy changes are never offered by this interface. An additional file
write root is labeled with its session scope when Codex requests one. Command Activity
includes captured output and exit codes, with nonzero exits identified as failures.

Brand CSS is generated from PRESS. From the repository root:

```sh
node skills/press/skills/press/bin/press.js emit --target skills-studio
node skills/press/skills/press/bin/press.js check --target skills-studio
python3 tools/check_compatibility.py
```

Integration reference: [official Codex app-server documentation](https://learn.chatgpt.com/docs/app-server).

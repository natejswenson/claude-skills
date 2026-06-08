---
name: onetapresume
description: Tailor a résumé to a job description and render a polished PDF, entirely from the CLI. Triggers on "/onetapresume", "tailor my resume", "optimize my resume for this job", or any request to adapt a résumé to a specific posting and produce a PDF.
user_invocable: true
version: 0.1.1
---

# /onetapresume — Résumé tailoring

You are running the **onetapresume** skill: a self-contained port of the
OneTap Resume pipeline (parse → extract job → LLM tailoring → multi-template
PDF). The tailoring runs through the `claude` CLI on the user's subscription —
no API key, no per-run cost.

**Announce at start:** "I'm using the onetapresume skill to tailor your résumé."

> All commands below run from the directory containing this `SKILL.md` (the
> skill's install dir, referred to as `$SKILL_DIR`). Resolve it once and `cd`
> there before running anything.

## Step 1 — One-time setup check

If `$SKILL_DIR/node_modules` does not exist, install dependencies first:

```bash
cd "$SKILL_DIR" && npm install
```

## Step 2 — Collect inputs

The skill needs two things. Gather whatever the user already gave you in their
message; ask for anything missing (one item at a time):

1. **Résumé file** — an absolute path to a `.pdf`, `.docx`, `.txt`, or `.md`.
   If the user would rather **pick the file** than type a path, run with
   `--pick` (with no résumé positional arg) — on macOS this opens a native
   Finder dialog and they select it. The picker works even though you launch
   the command, because it runs on the user's machine.
2. **Job posting** — a URL, a path to a `.txt` job description, or pasted text.

Optional, only if the user expresses a preference:
- **Template** — one of `modern` (default), `classic`, `technical`, `polished`,
  `timeline`, `editorial`, `spotlight`.
- **Output directory** — defaults to `./onetap-out` under `$SKILL_DIR`.
- **Model** — `--model <name>` (default `haiku` on the CLI subscription path).
  Do **not** switch to `sonnet` for a real CLI run: with no prompt caching on
  the subscription path, Sonnet reliably exceeds the timeout on a real résumé
  (observed 3/3 timeouts), while Haiku completes in ~5–6 min. The cost is the
  large tailoring prompt, not the model tier — don't promise a speedup by
  changing models.
- `--pdf-only` if they want just the PDF (no JSON sidecar).

Do not ask the user to pre-edit or "clean up" their résumé — the tool does the
work.

## Step 3 — Tailor once (the expensive step)

Tailoring runs the LLM and is the only slow step (~1–2 min). Run it ONCE with
`--open` so the result opens on the user's screen the moment it's ready. Quote
every argument:

```bash
cd "$SKILL_DIR" && node bin/onetapresume.mjs "<resume-path>" "<job-url-or-text>" --open [--out <dir>]
```

To let the user pick the résumé from a native dialog instead of passing a path,
use `--pick` (no résumé positional):

```bash
cd "$SKILL_DIR" && node bin/onetapresume.mjs --pick "<job-url-or-text>" --open
```

**Run it in the FOREGROUND — do not background it or pipe it through a monitor.**
The CLI emits a clean, self-updating progress display (one line per phase, a
live spinner + elapsed timer + streamed token count) and prints results as
tables. Note the **JSON sidecar path** it prints — you need it for the style
picker in Step 4.

Notes:
- Streamed via `stream-json` on the free subscription; **expect ~1–2 minutes**.
  The streaming status shows it is working; it is not hung.
- Do **not** set `MOCK_LLM=1` for a real run (fixed sample, testing only) and do
  **not** pass `--model sonnet` on the CLI path (it times out — Haiku is the
  default for a reason).
- If a job URL fails (`job_extract_failed`), ask the user to paste the job
  description text instead, and re-run.

## Step 4 — Style picker (interactive, instant)

The tailored content is now fixed in the JSON sidecar. Switching templates is a
cheap (~0.5s) re-render — never re-tailor. Drive this as a friendly loop:

1. **Show the change summary** from Step 3 as a small markdown table (optimized /
   dropped / kept / roles), and confirm the résumé opened.
2. **Offer the styles as a selector.** Use the `AskUserQuestion` tool with the
   seven templates as options, each with a one-line description (and, if useful,
   a tiny ASCII layout sketch in the option `preview`):
   `modern` (clean, accent headers · default), `classic` (traditional serif),
   `technical` (dense, monospace accents), `polished` (two-column sidebar),
   `timeline` (dated timeline rail), `editorial` (magazine-style),
   `spotlight` (colored header band).
3. **On each pick, re-render and re-open the preview** (instant):

   ```bash
   cd "$SKILL_DIR" && node bin/onetapresume.mjs --render "<json-sidecar-path>" --template <pick> --out <same-out-dir> --open
   ```

4. **Then ask what's next** with `AskUserQuestion`: **"Preview another style"**
   or **"Save & finish"**.
   - *Another style* → back to step 2/3.
   - *Save & finish* → the chosen PDF is already saved locally in the out dir;
     give its path as the final deliverable.
5. **End the run with exactly:** `Thanks for using OneTap Resume!`

If you have an image/screenshot tool, show the PDF after each render as the
preview; otherwise the `--open` flag opens it in the user's default viewer.

## Maintainer reference (not part of a user run)

- `npm test` — offline unit suite (no network, no paid LLM calls).
- `npm run eval` — quality eval of the non-deterministic tailoring; real
  tailoring is free (subscription), `--l3` adds a billed LLM judge under a hard
  budget cap. See `scripts/eval/run-eval.mjs`.
- Versioning (semver): in the `dev → master` PR, bump `version` here **and** in
  `package.json` (the release tag is driven by `package.json`), and add a
  matching `## [N.M.P]` section to `CHANGELOG.md`. On merge to `master`,
  `.github/workflows/release.yml` automatically tags `vN.M.P` and publishes a
  GitHub Release with notes pulled from that CHANGELOG section — no manual
  tagging. Merges that don't change the version are a no-op (idempotent).

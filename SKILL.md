---
name: onetapresume
description: Tailor a résumé to a job description and render a polished PDF, entirely from the CLI. Triggers on "/onetapresume", "tailor my resume", "optimize my resume for this job", or any request to adapt a résumé to a specific posting and produce a PDF.
user_invocable: true
version: 0.1.0
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
2. **Job posting** — a URL, a path to a `.txt` job description, or pasted text.

Optional, only if the user expresses a preference:
- **Template** — one of `modern` (default), `classic`, `technical`, `polished`,
  `timeline`, `editorial`, `spotlight`.
- **Output directory** — defaults to `./onetap-out` under `$SKILL_DIR`.
- `--pdf-only` if they want just the PDF (no JSON sidecar).

Do not ask the user to pre-edit or "clean up" their résumé — the tool does the
work.

## Step 3 — Run the pipeline

Pass the inputs as arguments (the CLI also prompts interactively, but since you
already have the inputs, pass them directly). Quote every argument:

```bash
cd "$SKILL_DIR" && node bin/onetapresume.mjs "<resume-path>" "<job-url-or-text>" [--template <name>] [--out <dir>] [--pdf-only]
```

Notes:
- This invokes a nested `claude -p` call for the tailoring step. It is normal
  for it to take 20–60 seconds.
- Do **not** set `MOCK_LLM=1` for a real run — that returns a fixed sample
  résumé and is for testing only.
- If extraction from a job URL fails (`job_extract_failed`), ask the user to
  paste the job description text instead, and re-run with the text.

## Step 4 — Present results

The CLI prints the output PDF path, the JSON sidecar path (unless
`--pdf-only`), and a diff of which bullets were optimized vs dropped. Relay to
the user:

- The **PDF path** (the deliverable).
- A short summary of the change counts (bullets optimized / dropped / kept).
- Offer to re-run with a different **template** if they want a different look.

If you have a way to display the PDF (an image/screenshot tool), show it;
otherwise give the path so they can open it.

## What this skill does NOT do

It deliberately omits the web product's monetization shell: no payment, no
Cloudflare Turnstile, no rate-limiting, no recovery flow. It is a local
single-user tool.

## Maintainer reference (not part of a user run)

- `npm test` — offline unit suite (no network, no paid LLM calls).
- `npm run eval` — quality eval of the non-deterministic tailoring; real
  tailoring is free (subscription), `--l3` adds a billed LLM judge under a hard
  budget cap. See `scripts/eval/run-eval.mjs`.
- Versioning: bump `version` here **and** in `package.json`; record in
  `CHANGELOG.md`. Release via PR `dev → master`, tag `vN.M.P`.

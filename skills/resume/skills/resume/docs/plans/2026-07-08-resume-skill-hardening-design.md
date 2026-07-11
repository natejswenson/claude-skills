---
ticket: "N/A"
title: "Resume skill hardening: extraction, style-loop reliability, vendor-neutral rebrand"
date: "2026-07-08"
source: "design"
---

# Resume skill hardening

## Context

Four requests against the `resume` skill (skills/resume), grounded against the
actual code (not the missing `ses_0c0e8689...` session log, which isn't a local
Claude Code transcript and couldn't be found on this machine):

1. Job-site scraping "doesn't work well."
2. Style/template choice should be a dropdown, not a silent default.
3. Output is saved under a Claude-specific path and the skill references
   Claude; needs to be agent/vendor-neutral.
4. After the PDF renders, ask if the user wants a different style, listing
   available styles.

## Finding: #1 is not a parser bug

`lib/parsing/job.ts` is a 5-tier waterfall (ATS adapters → readability/json-ld
parsers → Firecrawl). Two structural gaps cause hard failures on the most
common job boards, independent of any of the parsers actually having a bug:

- `FIRECRAWL_API_KEY` is unset in this environment (confirmed). Indeed,
  Glassdoor, and ZipRecruiter (`STEALTH_REQUIRED_HOSTS`) skip straight to
  Firecrawl's stealth proxy and always fail without a key.
- LinkedIn (`HOSTILE_HOSTS`) is unconditionally rejected before any fetch is
  attempted — a deliberate ToS/legal-risk call, not a bug.

`lib/pipeline.ts` surfaces both as `Error: job_extract_failed: <reason>`,
which `bin/resume.mjs` just dumps as `✖ <message>` — log-shaped, not
action-shaped.

## Decisions (confirmed with user)

| # | Decision | Choice |
|---|---|---|
| 1 | Extraction fix | Provision Firecrawl + universal paste-text fallback, **and** attempt Firecrawl stealth against LinkedIn too (opt-in, see risk note) |
| 2 | Agent-agnostic scope | Wording/branding cleanup only — no new native-CLI interactivity machinery |
| 3 | Style-choice timing | Keep silent `modern` default on first render; only offer the style dropdown in the post-render loop (items 2 and 4 collapse into one mandatory step) |
| 4 | Rebrand scope | Drop "OneTap Resume" branding too, not just literal "Claude" references |

**Risk note on LinkedIn stealth:** LinkedIn actively pursues scrapers
(hiQ v. LinkedIn-era legal posture). Rather than flipping this on for every
install, it's gated behind an opt-in env var, default OFF — the safe
today-behavior (`hostile_domain`, immediate reject) is unchanged unless the
user deliberately sets the flag, with the risk documented in SKILL.md/README.

## Changes by file

### Universal paste-text fallback — already implemented, no change
`resolveJobText` (`lib/pipeline.ts:99-102`) already falls through to
treating any non-URL, non-existing-file input as literal JD text. Decision
#1's "universal paste-text fallback" deliverable is therefore already
satisfied by existing code — flagged explicitly (round-4 review) so this
isn't mistaken for an unshipped gap.

### Extraction (`lib/parsing/job.ts`, `lib/parsing/url-classifier.ts`)
- New env gate `RESUME_ALLOW_LINKEDIN=1` (default unset/off). When set,
  LinkedIn is routed through the same stealth-required Firecrawl path as
  Indeed/Glassdoor instead of the immediate `hostile_domain` rejection. When
  unset, behavior is bit-for-bit identical to today.
- **Concrete mechanism (corrected — see round-1 review; simplified further in
  round 2):** `classifyUrl()` itself stays a pure function and keeps
  returning `kind: "hostile"` for LinkedIn unconditionally; it is NOT made
  env-aware, and `HOSTILE_HOSTS` in `url-classifier.ts` stays private
  (unexported) — no new export needed. The gate lives entirely in
  `extractJobFromUrl()` in `job.ts`, at the point it currently does:
  ```
  if (classification.kind === "hostile") {
    return { ok: false, error: "hostile_domain", ... };
  }
  ```
  This becomes: skip this early-return when
  `process.env.RESUME_ALLOW_LINKEDIN === "1"` AND the hostname is
  specifically `linkedin.com`/`www.linkedin.com` — falling through instead to
  the existing `if (STEALTH_REQUIRED_HOSTS.has(url.hostname))` check further
  down, updated to
  `if (STEALTH_REQUIRED_HOSTS.has(url.hostname) || (linkedInOptIn && (url.hostname === "linkedin.com" || url.hostname === "www.linkedin.com")))`.
  **Round-3 review correction:** gate on the explicit LinkedIn hostnames, NOT
  on `classification.kind === "hostile"` generically. Coupling to `"hostile"`
  would silently widen scope to any future host added to `HOSTILE_HOSTS` for
  an unrelated reason — a flag named `RESUME_ALLOW_LINKEDIN` must only ever
  unlock LinkedIn, never "whatever else `HOSTILE_HOSTS` happens to contain."
  This also removes the earlier round's justification for skipping a
  `HOSTILE_HOSTS` export (that justification relied on the now-rejected
  `classification.kind` check) — but the explicit-hostname form needs no
  import from `url-classifier.ts` either, so no export is needed regardless.
  When the flag is unset, the added condition is always false and behavior
  is byte-for-byte identical to today. This IS a change to `job.ts`'s
  extraction-tier logic (correcting the original claim of "no change to tier
  ordering or parser logic") — it is a narrowly-scoped conditional, not a
  change to any parser.
- **No validated success case.** Unlike Indeed/Glassdoor/ZipRecruiter (where
  Firecrawl stealth is observed to work per existing code comments), there is
  no evidence Firecrawl's stealth proxy actually defeats LinkedIn's anti-bot
  measures. Ship the opt-in, but do not claim it works until manually verified
  against a real LinkedIn job URL with a Firecrawl key.

### Error surfacing (`bin/resume.mjs`)
- Catch `job_extract_failed:` specifically and print a neutral, actionable
  two-line message ("Could not fetch this job posting automatically
  (`<reason>`). Paste the job description text instead and re-run.") instead
  of the raw internal error string. This is what makes SKILL.md's existing
  "ask the user to paste the JD text" instruction reliable for *any* agent
  reading stderr, not just one that happens to recognize
  `job_extract_failed`.
- **Insertion point (round-3 review — was previously unspecified):** the
  inner `try { runPipeline(...) } catch (err) { progress?.stop(); throw err; }`
  around line 166-185 rethrows unconditionally to the single top-level
  `main().catch((err) => { console.error(...); process.exit(1); })` at the
  bottom of the file. The `job_extract_failed:` prefix check belongs in that
  one top-level handler (not duplicated in the inner catch), since it's the
  single choke point every error already flows through; `process.exit(1)`
  behavior is unchanged either way.

### Setup guidance (`SKILL.md`)
- Step 1 gains a one-time check: if `FIRECRAWL_API_KEY` is unset, tell the
  user what it unlocks (Indeed/Glassdoor/ZipRecruiter + general Tier-4
  fallback) and where to get one, without blocking the run — extraction still
  degrades to the paste-text fallback either way.
- Document the `RESUME_ALLOW_LINKEDIN` flag and its risk tradeoff.
- **Step 2's output-directory line (round-2 review — missed in round 1):**
  `SKILL.md` line 44 currently reads "Output directory — defaults to
  `./onetap-out` under `$SKILL_DIR`." This is read aloud to the user when
  explaining where files land, so it must be updated to the new
  `~/resume-out` default in the same change as the code default — it was in
  the file-list header for this section but not called out as its own edit.

### Style loop (`SKILL.md` Step 4)
- No pipeline/render code changes. Reword Step 4 as an explicit, mandatory
  step: always run the "want a different style?" loop after opening the
  first PDF, regardless of whether the user asks — never silently skip it.
  Keep enumerating all 7 templates with one-line descriptions (already
  implemented).

### Rebrand (`SKILL.md`, `README.md`, `bin/resume.mjs`, `lib/pipeline.ts`, `lib/llm/index.ts`, `lib/url-safety.ts`, `package-lock.json`, test files)
- Default output directory changes from `resolve(input.outDir ?? "onetap-out")`
  (resolves relative to cwd, which SKILL.md sets to `$SKILL_DIR` — under
  `~/.claude/skills/resume` for a plugin install, which is the actual "claude
  path" bug) to `join(homedir(), "resume-out")` — stable, human-findable,
  independent of install location or invoking agent. `--out` still overrides.
- **All three defaults, not just `pipeline.ts`'s** (round-1 review caught two
  the first pass missed): `bin/resume.mjs`'s doc comment (line 18), its help
  text (line 52), AND its independent hardcoded default inside `renderOnly()`
  (line 228: `resolve(flags.out ?? "onetap-out")`) — used by the `--render`
  fast path that powers the style-picker re-render. If only `pipeline.ts`
  changes, the style-picker loop would save re-renders to a different,
  stale-branded directory than the initial tailoring run. All defaults move
  to `join(homedir(), "resume-out")` together. **Requires adding a
  `node:os` `homedir` import** (round-4 review) to both `lib/pipeline.ts`
  (currently imports only from `node:fs/promises`/`node:path`) and
  `bin/resume.mjs`'s `renderOnly()` (currently `node:path` only).
- **Correction (round-2 review):** the "Announce at start" line itself
  (`"I'm using the resume skill to tailor your résumé."`) is already
  vendor-neutral — no edit needed there. The actual Claude/OneTap-flavored
  text is the intro paragraph just above it: "a self-contained port of the
  **OneTap Resume** pipeline... The tailoring runs through the `claude` CLI
  on the user's subscription." Reword that paragraph to drop the "OneTap
  Resume" name and move the factual `claude`-binary-dependency note out of
  the skill's framing and into the setup/model-choice section only (can't
  rename an actual external binary dependency, but it doesn't need to be
  the skill's opening pitch).
- `lib/llm/index.ts` log line "ambient ~/.claude OAuth session" →
  "ambient CLI session" (still accurate, no path reference).
- Drop "OneTap Resume" naming: SKILL.md description prose, the closing line
  ("Thanks for using OneTap Resume!" → a neutral sign-off), README's
  `./onetap-out` references. Regenerate `package-lock.json` via `npm install`
  to drop its stale `onetapresume-skill`/`onetapresume` bin name (already
  inconsistent with `package.json`'s `resume-skill`; there is no actual
  `bin/onetapresume.mjs` file, so the lockfile regen is the complete fix —
  verify post-regen that `name`/`bin` synced to `package.json`'s values before
  committing).
- **`ONETAP_SKIP_DNS_CHECK` env var** (round-1 review — missed in the first
  pass): this is live production logic in `lib/url-safety.ts`, not just a
  test artifact, and is also referenced in `scripts/run-tests.mjs`,
  `scripts/extract.test.mjs`, `scripts/pipeline.test.mjs`,
  `scripts/summarize.test.mjs`. Rename to `RESUME_SKIP_DNS_CHECK` everywhere
  it appears (production code + all four test files) to actually satisfy
  decision #4.
- **`"Tailoring with Claude"` progress string** (round-3 review — missed in
  rounds 1-2): `lib/pipeline.ts:318` has
  `report.start("Tailoring with Claude")`, printed to every user on every
  real run via the CLI's `Progress` reporter. This is the most user-visible
  "Claude" string in the entire codebase and was omitted from the original
  `pipeline.ts` edit list (which covered only the `outDir` default). Change
  to a neutral phrase, e.g. `"Tailoring résumé"`.

## Testing
- `lib/parsing/url-classifier` / `job.ts` tests: opt-in flag on/off behavior
  for LinkedIn. In `scripts/extract.test.mjs`, mirror the existing
  `FIRECRAWL_API_KEY` save/restore pattern (lines 163-177) for
  `RESUME_ALLOW_LINKEDIN` around the new fixture(s) — round-1 review flagged
  that without an explicit restore, setting the flag in one fixture could
  leak into later fixtures run in the same process. Round-2 review noted the
  fixture-loop harness itself only reads a `fx.firecrawlKey` field today, so
  this requires adding a new field/handler to the harness, not just new
  fixture JSON.
- `bin/resume.mjs` / pipeline tests: new error-message wrapping for
  `job_extract_failed`.
- **New test required, not just an update** (round-1 review corrected this:
  every existing `runPipeline` call in `scripts/pipeline.test.mjs` already
  passes an explicit `outDir`, so there is no existing default-outDir
  assertion to "update" — nothing today exercises the default path at all).
  Add a new test that stubs/injects `homedir()` (or reads `os.homedir` via a
  seam consistent with the renamed `RESUME_SKIP_DNS_CHECK`-style test seam
  pattern in `lib/url-safety.ts`) so the new `join(homedir(), "resume-out")`
  default is verified without writing into a real `$HOME` during CI.
- No new network or paid-LLM calls by default — Firecrawl remains opt-in via
  the existing `FIRECRAWL_API_KEY` env check.
- CHANGELOG.md entry + version bump (SKILL.md frontmatter + package.json) per
  repo convention.

## Known limitations (disclosed, not fixed by this design)
- Decision #3 (silent `modern` default pre-render; dropdown only post-render)
  only partially satisfies the user's literal request #2 ("resume type should
  be a dropdown, the skill should not have to choose") — the skill still
  silently chooses for the first render. This was an explicit, confirmed
  user tradeoff, not an oversight; flagged here so it isn't mistaken for one
  later.
- The `RESUME_ALLOW_LINKEDIN` opt-in ships unvalidated against a real
  LinkedIn posting — see the extraction section above.

## Out of scope
- Replacing `claude -p` as the tailoring engine, or building new
  provider-pluggable LLM adapters beyond the existing `cli`/`api` modes —
  explicitly decided as wording-cleanup-only, not an architecture change.
- Native terminal-interactivity (readline menus) for the style loop — the
  loop stays orchestrated via SKILL.md prose, which already works for any
  agent capable of asking its user a question.
- **`README.md`'s "Claude Code skill" / install-via-`~/.claude/skills`
  framing (round-3 review flagged this as a scope question, resolved here):**
  this repo is genuinely a Claude Code skill today — the only supported
  install path is symlinking into `~/.claude/skills/resume` and invoking via
  `/resume` inside Claude Code. That's accurate documentation, not leftover
  branding, and rewriting it would misrepresent how the skill is actually
  installed and run (out of scope per decision #2 — wording/branding cleanup
  only, no re-architecture). The rebrand in this design is limited to the
  specific items listed under "Rebrand" above (default output path,
  `ONETAP_SKIP_DNS_CHECK`, the `"Tailoring with Claude"` progress string, the
  ambient-session log line, and "OneTap Resume" naming) — not a full README
  rewrite.
- **`CHANGELOG.md`'s historical "OneTap" mentions** — past entries describe
  what was true at the time and are not rewritten retroactively; only new
  entries added by this change use current naming.

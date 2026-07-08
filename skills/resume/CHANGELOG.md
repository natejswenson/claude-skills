# Changelog

All notable changes to the resume skill are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/), and the project adheres
to [Semantic Versioning](https://semver.org/).

## [1.0.0] — 2026-07-08

Complete agent-native rewrite — see
`docs/plans/2026-07-08-resume-agent-native-rewrite-design.md` for the full
design. Breaking: the CLI (`bin/resume.mjs`) and DOCX support are gone;
reading, job extraction, and tailoring are now the invoking agent's own work,
not a subprocess `claude -p` call.

### Changed
- **No more subprocess LLM call.** The agent reads the résumé, extracts the
  job description, and tailors the bullets directly in-conversation using its
  own tools and reasoning — replacing `lib/llm/`'s CLI/API adapter pair and
  `lib/pipeline.ts`'s orchestration. `SKILL.md` now carries the full flow as
  direct instructions, with the 11-rule optimizer prompt ported to
  `references/tailoring-rules.md` and the job-extraction fallback ported to
  `references/job-extraction-fallback.md` (Firecrawl `curl` via Bash, with an
  explicit `$FIRECRAWL_API_KEY` shell-variable-only security requirement so
  the key never appears in a tool-call transcript or shell history).
- **Job extraction fallback is a markdown reference file, not code.** The old
  5-tier waterfall (ATS adapters, JSON-LD/OpenGraph/Readability parsers,
  SSRF-safe fetch) is replaced by `WebFetch` first, then
  `references/job-extraction-fallback.md`'s procedure (LinkedIn policy check →
  Firecrawl stealth fetch → ask the user to paste text).
- **Dependencies cut roughly in half (8 → 4).** Removed `@mozilla/readability`,
  `jsdom`, `mammoth`, `unpdf` — nothing left to parse HTML or DOCX in code.
  Kept `@react-pdf/renderer`, `react`, `react-dom`, `zod`.
- `lib/pipeline.ts`'s PDF-rendering logic moved to a new `lib/render.ts`,
  exposed via a new thin `scripts/render.mjs` CLI entrypoint (self-registers
  the TSX loader; no `--import` flag needed for direct invocation).
  `scripts/validate.mjs` is a new equivalent thin entrypoint over
  `lib/validate.ts`'s `validateTailoring()` — the deterministic content
  checks (banned phrases, scope qualifiers, derived durations, invented
  numbers) survive as a standalone lightweight guardrail even though the
  agent, not a subprocess LLM, now does the tailoring.

### Removed
- **DOCX support.** The `Read` tool doesn't parse DOCX natively; rather than
  keep a small conversion script for one format, `.docx` is dropped. Only
  `.pdf`/`.txt`/`.md` are supported — ask the user to convert or paste the
  text instead.
- `bin/resume.mjs` (the CLI entrypoint and all its flags: `--pick`,
  `--model`, `--pdf-only`, `--json`, `--render`), `lib/parsing/` (job/URL/ATS
  extraction, résumé file parsing), `lib/llm/` (CLI/API adapters, budget
  gating), `lib/pipeline.ts`, `lib/prompt.ts`, `lib/summary-fix.ts`,
  `lib/log.ts`, `lib/ui/` (file-picker, job-summary, progress, table),
  `lib/url-safety.ts`, `lib/cli-args.ts`, `scripts/eval/` (the scored eval
  harness) and `npm run eval`/`npm run benchmark`.
- **Automated prompt-injection regression test** (`scripts/prompt-injection.test.mjs`).
  `lib/prompt.ts`'s `sanitizeBlock()` doesn't transfer to an agent-native
  architecture; prompt-injection defense is now explicit prose in `SKILL.md`
  and `references/job-extraction-fallback.md` instructing the agent to treat
  fetched content as data, never instructions.
  `docs/security/prompt-injection-fixtures/` remains as a **manual**
  verification checklist — this is a disclosed, permanent loss of automated
  coverage on a security-relevant surface, accepted as part of this rewrite's
  trade-offs.

## [0.3.0] — 2026-07-08

Extraction hardening, a mandatory style-picker loop, and a vendor-neutral
rebrand — see `docs/plans/2026-07-08-resume-skill-hardening-design.md` for
the full design.

### Added
- **`RESUME_ALLOW_LINKEDIN=1`** — opt-in (default off) that routes LinkedIn
  job URLs through the same Firecrawl stealth path already used for
  Indeed/Glassdoor/ZipRecruiter, instead of the unconditional
  `hostile_domain` rejection. Unvalidated against a real LinkedIn posting;
  ships as an opt-in specifically because LinkedIn actively pursues
  scrapers.
- Friendly `job_extract_failed` error message — the CLI now prints "Could
  not fetch this job posting automatically (`<reason>`). Paste the job
  description text instead and re-run." instead of the raw internal error
  string, so any invoking agent (not just one that parses
  `job_extract_failed`) gets an actionable instruction.
- A one-time setup note (SKILL.md Step 1) when `FIRECRAWL_API_KEY` is unset,
  explaining what it unlocks (Indeed/Glassdoor/ZipRecruiter extraction)
  without blocking the run.
- The post-render style picker (SKILL.md Step 4) is now explicit and
  mandatory — always run after the first PDF opens, not conditional on the
  user asking.

### Changed
- **Default output directory** moved from `./onetap-out` (resolved relative
  to `$SKILL_DIR`, which lands under `~/.claude/skills/resume` for a plugin
  install) to `~/resume-out` — stable and human-findable regardless of
  install location or invoking agent. `--out` still overrides.
- Renamed `ONETAP_SKIP_DNS_CHECK` → `RESUME_SKIP_DNS_CHECK` (production code
  + all test files).
- Dropped "OneTap Resume" naming from SKILL.md's intro paragraph and closing
  line, and the `"Tailoring with Claude"` progress string (now "Tailoring
  résumé") — the most user-visible "Claude" string in the codebase.
- `lib/llm/index.ts`'s log line "ambient ~/.claude OAuth session" →
  "ambient CLI session".
- Regenerated `package-lock.json` to drop its stale
  `onetapresume-skill`/`onetapresume` name/bin (already inconsistent with
  `package.json`'s `resume-skill`).

## [0.2.0] — 2026-06-21

Accuracy + speed benchmark for the tailoring pipeline, plus two measured
improvements it surfaced.

### Added
- **`npm run benchmark`** — a $0 benchmark that runs the real `tailorResume`
  pipeline over the résumé fixture × **7 real job postings** (5 high-fit +
  2 low-fit controls), timing each phase and scoring accuracy. Per-phase
  wall-clock (`--repeat N` for a true tailoring-latency distribution), a
  hard-rule faithfulness gate (HARD/REPORTED `checkRules` partition), JD-coverage,
  G2/G3/G4 + fitness, optional **$0 subscription-CLI judges** (`--judge`) for
  tailoring-fit + grounding (soft, fail-open, own 90s kill-timeout), and a
  directional discrimination check (only treatment jobs gate the exit code;
  controls are non-gating, but a control *crash* still fails the run).
  `--mock` is a CI-safe plumbing check; `--json` for regression tracking.
  See `docs/plans/2026-06-20-resume-benchmark-design.md`.

### Changed
- **Cheaper retry on summary-only violations.** A content-violation retry used to
  regenerate the entire résumé; now a summary-scoped violation (banned phrase /
  derived duration) gets a small focused fix spliced into the valid pass-1 output
  and re-validated, falling back to the full retry if it can't clear. Measured:
  per-retry cost ~39s → ~5.3s (≈86% cheaper), and safer (valid bullets are never
  regenerated). (`lib/summary-fix.ts`, `lib/pipeline.ts`.)

### Fixed
- **Drop no-op optimized bullets.** `optimizedBullets` entries whose rewrite
  equals the original (a model bookkeeping error that polluted the change summary
  and tripped the faithfulness check) are now removed deterministically before
  validation — no LLM call. (`lib/validate.ts`.)

## [0.1.1] — 2026-06-08

Packaging & licensing pass to make the repo ready for public consumption.

### Added
- **MIT `LICENSE`** (© Nate Swenson) and full `package.json` metadata
  (`license`, `author`, `repository`, `homepage`, `bugs`, `keywords`).
- README rewritten for outside users: requirements, install-as-a-skill, full
  flag table + usage, the style-picker flow, automated-release notes, and a
  license section.

### Changed
- Dropped the unused `@anthropic-ai/claude-agent-sdk` dependency (its only
  consumer was the `SDKAdapter` removed in 0.1.0) — 92 fewer transitive packages
  on install.

## [0.1.0] — 2026-06-08

Initial release: a self-contained Claude Code skill port of the OneTap Resume
tailoring pipeline.

### Added
- **Automated releases** (`.github/workflows/release.yml`): merging to `master`
  tags `v<package.json version>` and publishes a GitHub Release (notes pulled
  from this file), if that version isn't already released. Semver is driven by
  the `package.json` version bump in the PR.
- **Interactive style picker.** After a single (expensive) tailoring pass, the
  skill opens the PDF (`--open`) and lets the user switch templates instantly:
  `--render <json-sidecar> --template <name>` re-renders an already-tailored
  résumé in ~0.5s (no LLM). New `lib/pipeline.ts → renderTemplateFromResume` and
  `lib/ui/file-picker.ts → openFile` (cross-platform). The run ends with a
  "Thanks for using OneTap Resume!" sign-off (see SKILL.md Step 4).
- **Live progress UX** (`lib/ui/progress.ts`) — the LLM tailoring step is now
  streamed via `claude --output-format stream-json`; the CLI shows a spinner +
  elapsed timer + streamed token count in a TTY, and degrades to clean discrete
  one-line-per-phase output when piped/agent-driven (no raw JSON log spam).
- **Table output** (`lib/ui/table.ts`) — results render as Unicode tables: a
  change-count summary, output file paths, and a before→after table of every
  optimized bullet plus dropped bullets.
- **Native résumé picker** (`lib/ui/file-picker.ts`) — `--pick` opens a macOS
  Finder dialog to choose the résumé instead of typing a path; falls back to a
  text prompt off-macOS.
- `/resume` skill (`SKILL.md`) — smart invocation with args + interactive
  fallback, `--pick`, `--template`, `--out`, `--model`, `--pdf-only`, `--json`
  flags.
- `bin/resume.mjs` CLI entry (self-registers the TS loader).
- `lib/pipeline.ts` — end-to-end orchestrator: parse résumé (PDF/DOCX/TXT/MD) →
  resolve job (URL waterfall / file / text) → schema-validated LLM tailoring with
  one corrective retry → render PDF → readable diff.
- Vendored tailoring core from onetap-app: 5-tier job-extraction waterfall +
  ATS adapters, 11-rule optimizer prompt, dual LLM adapter (cli/api/sdk), 7 PDF
  templates, L1/L2/L3 scorer.
- Offline unit suite (12 test files) — zero network, zero paid LLM calls.
- `scripts/eval/run-eval.mjs` — quality eval of the non-deterministic tailoring;
  real tailoring runs free on the subscription, `--l3` judge is billed under a
  hard `BudgetGate` cap with an up-front quote.
- `scripts/eval/rules.mjs` — deterministic rule-compliance checker.

### Changed (vs. upstream onetap-app)
- Dropped all web-only layers: Stripe paywall, Cloudflare Turnstile, IP
  rate-limiting, SSRF recovery flow.
- **Dead-code sweep.** Removed vendored/vestigial leftovers with no purpose in
  the skill: `lib/mock-mode.ts` (+ its test; web Turnstile-bypass predicate),
  `lib/llm/sdk.ts` (`SDKAdapter` — no consumer), the unused accent-preset feature
  (`polishedAccents`/`spotlightAccents` + the `accentOverride` path in
  `components/ResumeDocument.tsx`), and dead exports (`silentProgress`,
  `preserveParagraphs`, `templateNames`, the `OptimizedBullet` type alias). Also
  removed orphaned scorer/fixtures (`scripts/scorer/budget-broker.mjs`,
  `budget-client.mjs`, `transformation.mjs`, `scripts/fixtures/{optimize,seeds}`,
  `fixtures/resumes.mjs`).
- **LLM factory defaults to the CLI subscription path** (`lib/llm/index.ts`).
  Previously it auto-switched to the paid Anthropic API whenever
  `ANTHROPIC_API_KEY` was present in the environment — a footgun for a
  subscription-first skill. `api` mode is now opt-in via `LLM_MODE=api` only.
- `lib/url-safety.ts` gained an `ONETAP_SKIP_DNS_CHECK` seam so the offline
  fixture harness never depends on real DNS.
- Résumé parser accepts `.txt`/`.md` (common CLI formats), in addition to
  PDF/DOCX.
- The CLI adapter switched from buffered `--output-format json` to streamed
  `--output-format stream-json --include-partial-messages`; it still resolves
  the schema-validated object from the final `result` event's
  `structured_output`, but can now report incremental progress. Library debug
  logs are suppressed during interactive runs so output stays clean.

### Fixed
- **~13× faster tailoring by disabling extended thinking on the CLI path.**
  Root cause of the multi-minute runs: the `claude -p` call ran with extended
  thinking enabled, so the model burned ~11–15k *thinking* tokens on the large
  rule-dense prompt before emitting a ~800-token JSON (a tiny résumé measured at
  130s wall / 122s to first token). The adapter now spawns with
  `MAX_THINKING_TOKENS=0`. An eval sweep (0 / 4000 / 8000) showed 0 was both the
  fastest (~42s/case vs ~153s at 4000) **and** the highest fitness (69.5 vs
  66.5) — thinking was making output slower *and* worse here. Override by
  exporting `MAX_THINKING_TOKENS`.
- **Deterministic content validation** (`lib/validate.ts`) replaces the prompt's
  "scan string-by-string before emitting" self-audit (which the model used to
  pay for in thinking tokens): banned summary phrases, scope qualifiers not in
  source, derived "X years" durations, and invented numbers are now checked in
  code, with one targeted corrective retry on violation. The optimizer prompt
  was trimmed accordingly (removed the FINAL SELF-CHECK section + "before
  emitting" narration; all rules R1–R11 retained).
- **CLI default model is now Haiku, not Sonnet.** On the subscription (CLI)
  path there is no prompt caching, so the ~9k-token tailoring prompt is
  re-processed cold on every call; Sonnet reliably exceeded the timeout on real
  résumés (observed 3/3 timeouts at 480s) while Haiku completes quickly. The
  adapter timeout was also raised 480s → 600s for headroom. Sonnet remains
  selectable via `--model sonnet` (intended for the cached API path).

# Changelog

All notable changes to the onetapresume skill are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/), and the project adheres
to [Semantic Versioning](https://semver.org/).

## [0.1.0] — unreleased

Initial release: a self-contained Claude Code skill port of the OneTap Resume
tailoring pipeline.

### Added
- `/onetapresume` skill (`SKILL.md`) — smart invocation with args + interactive
  fallback, `--template`, `--out`, `--model`, `--pdf-only`, `--json` flags.
- `bin/onetapresume.mjs` CLI entry (self-registers the TS loader).
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
- `lib/url-safety.ts` gained an `ONETAP_SKIP_DNS_CHECK` seam so the offline
  fixture harness never depends on real DNS.
- Résumé parser accepts `.txt`/`.md` (common CLI formats), in addition to
  PDF/DOCX.

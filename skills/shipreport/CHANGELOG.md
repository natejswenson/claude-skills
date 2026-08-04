# Changelog

All notable changes to the **shipreport** skill are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-04

### Added

- **First release.** Turns a stretch of real commits, pull requests and Claude
  Code sessions into a short executive summary a stakeholder can read — and
  refuses to print a line it cannot back with a receipt.

- **`index` — one cache, two passes.** The first run backfills a year of GitHub
  contributions and every session transcript on disk; later runs read a
  watermark and take only what is newer, filtering sessions by file mtime before
  a transcript is opened. On this machine that is 574 files on the first pass and
  one on the second.

- **Redaction at ingest, never later.** Assigned secrets, Anthropic/OpenAI keys,
  GitHub tokens and PATs, AWS key ids, Slack tokens, JWTs, bearer headers, PEM
  private-key blocks, email addresses and the absolute home path are removed on
  the way into the cache — so the raw value exists only in memory, for the length
  of one parse.

- **`rank` — scoring in code, with the reasons printed.** Every candidate shows
  the signals that produced its score before a word of prose exists. Two
  collapses run first: squash-merged pull requests are folded into the PR they
  came from (without it, one merge method systematically outranks the other),
  and a release series such as `0.3.0 → 0.3.1 → 0.3.2` collapses to its newest
  while the rest ride along as extra receipts.

- **`receipts` — the one rule as a gate.** Every claim must carry at least one
  receipt, every receipt must resolve, and no raw identifier may appear in the
  prose. It exits non-zero, and `render` re-runs it rather than trusting that it
  passed earlier.

- **`render` — a press-styled sheet.** Report stylesheet tokens come from the
  `shipreport-theme` press region, so no brand value is written here. The numbers
  strip is computed from the window rather than authored, because there is no
  receipt shape for a figure.

### Notes

Three things the first real run found, which reviewing the code had not:

- `gh search prs` returns `repository.nameWithOwner` and `gh search commits`
  returns `repository.fullName` for the same value. Reading one produced
  `commit:undefined@…` receipt ids, which then made the squash fold match
  nothing — so every squash-merged pull request was counted twice.
- A week with 52 releases scored all 52 identically, so the top-twelve cut was
  decided by a tiebreak rather than by ranking. Reading the semver bump fixed it,
  and a lone `2.0.0` now infers `major` from the version itself instead of
  scoring below patch releases.
- The numbers strip was computed from the cited items, so the sheet read
  "10 released" directly above a sentence saying more had been. A summary cites a
  handful of things and is still *about* the whole window.

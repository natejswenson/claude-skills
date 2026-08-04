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

- **`render` — a press-styled sheet composed from the named component
  vocabulary.** Masthead with stamp and eyebrow, headline, standfirst, a hero
  `.bigstat` figure, a ruled `.stat-strip`, sections of `.ledger` cards laid two
  to a row, a `table.data` receipt appendix, and a colophon. Tokens come from the
  `shipreport-theme` press region, so no brand value is written here. The hero
  and the strip are computed from the window rather than authored, because there
  is no receipt shape for a figure.

- **One original line-art scene per card, composed not catalogued.** The same
  contract devlog uses for its covers, one level smaller: read the item, name the
  concrete mechanism, draw *that*. Two versions and a selector that took the lower
  one; a chain whose links all report green and whose last one is missing; eight
  near-identical copies collapsing into one definition. A drawing this repo could
  generate would be the same drawing every time, which is the failure the idea
  exists to avoid — so `scripts/lib/art.mjs` validates and never draws.

  It refuses: a missing scene, anything that is not a single `<svg>`, a colour
  literal (the brand is generated, never typed), a `<script>`/`<image>`/
  `<foreignObject>`/external reference/inline handler, fewer than five drawing
  elements, a `viewBox` other than the shared frame, and two cards whose scenes
  match on a fingerprint that normalises whitespace and numeric jitter.

### The brand laws this obeys

The card grid is divided by ink rules and proximity — **never by drawing a
container** — because `laws.md` §2 forbids rounded corners, shadows, gradients,
fills and boxes inside boxes, and says plainly that this is the brand rather than
minimalism awaiting a fix. The accent is spent exactly twice, on the stamp and
the hero figure, per §1; a test counts them. `press lint` runs in `ci / shipreport`
alongside `press check`, because only the lint catches a hand-written hex or a
letter-spacing above the extraction ceiling in the hand-written half of the
stylesheet — it caught a literal white on its first run.

### Density

Three cards to a row rather than two, so a three-item section is exactly one row
and leaves no orphan void; headline and standfirst share one band instead of
stacking with a third of the sheet empty to the right.

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

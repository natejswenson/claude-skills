# Changelog

All notable changes to the **press** skill are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-07-31

First release. Replaces eight hand-ported copies of the PRESS brand with one
source of truth and a CI drift gate.

### Added

- **`brand/tokens.json`** — the only place a brand value is written down:
  colours, the terminal panel palette, font stacks, identity defaults, and the
  limits the lint enforces.
- **Four contract documents** the brand is more than colours:
  `laws.md` (the accent law, structure, the three voices, the tracking ceiling),
  `components.md` (the shared component vocabulary), `agent-ui.md` (how a run
  should read in the chat transcript), `voice-core.md` (the copy rules that
  hold for every artifact).
- **Marked-region splicing** — press owns a marked block inside an otherwise
  hand-written file, so a consumer keeps its stylesheet, its poster geometry and
  its personal footer. The start marker carries a version + content-hash
  receipt.
- **Five emitters** — `python-theme` (token dict plus the shared deep-merge
  loader), `css-vars` (with per-consumer name aliases), `md-palette`,
  `markdown-block`, `json`.
- **`press check`** — the drift gate. Fails on drifted bytes, on a region that
  has gone missing, and on a run that resolved zero targets.
- **`press lint`** — mechanical brand law: off-palette hexes, the tracking
  ceiling, emoji-presentation glyphs, shadows, gradients, radii, and an optional
  accent cap. Waivable per line or per file.
- **`press emit --init`** — first-time migration, swallowing the hand-written
  block it takes over rather than leaving a duplicate behind.
- **`press doctor`** and **`press tokens`**.
- **Baseline eval** pinned to a real past state: every brand value as it existed
  in eight files across four repos before press generated any of them, plus
  byte-exact goldens per target. Two-sided, with anti-vacuity floors.

### Changed

- **Migrated five in-repo consumers** to generated regions — `city-report`,
  `resume`, `ghostwriter`, `ghostwriter-x`, `devlog`. Every value is unchanged
  and each skill's own suite stays green (222, 13 files, 352, 432 and 255 tests
  respectively).
- **Font stacks widened to the union of every consumer's.** The résumé's
  print-tuned stacks were the deepest; fallbacks are additive, so the richest
  chain became the canonical one and every other consumer gained it.
- **The `.term` rules in both card sets now reference variables** instead of
  five hardcoded hexes.

### Fixed

- **Three genuinely-shared token groups were undeclared anywhere** and are now
  in `tokens.json`: `ink_faint` (`#8A8272`), the terminal panel palette
  (`#141A26`, `#EFE9DC`, `#8A8478`, `#FF8A5C`, `#1E2738` — hardcoded in three
  files), and two paper steps the site was carrying alone (`#ECE5D6`,
  `#E4DCCA`).
- **The tracking ceiling was over-strict.** It exists to protect PDF text
  extraction, so it binds on documents a machine reads back and not on
  rasterised cards, whose eyebrow legitimately runs at `.16em`. Scoped rather
  than waived, and caught by linting the real shipped corpus.

[0.1.0]: https://github.com/natejswenson/claude-skills/releases/tag/press-v0.1.0

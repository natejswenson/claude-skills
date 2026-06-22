# Changelog

All notable changes to the linkedin-ghostwriter skill are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-06-22

### Added
- **`code` card type** — share a snippet as a terminal coding session: a macOS-style window
  (traffic-light dots + filename), `bat`-style line-number gutter, theme-colored syntax tokens
  (`.t-kw/.t-fn/.t-str/.t-num/.t-com`, retheme via `--t-*`), one focal `.line.hot`, and a solid
  accent caret. `assets/card-template-code.html`. Syntax is hand-authored token spans so the
  card render path stays deterministic and JS-free.
- **`claude` card type** — a Claude Code *session* variant of the code card: a transcript
  (request → action bullets → `└` result branches) in Anthropic's clay accent, for
  "shipped with Claude Code" posts. `assets/card-template-claude.html`.

### Changed
- **Carousel rebuilt as the showstopper**, grounded in current LinkedIn document-post research.
  Switched from 1200×1200 square to **portrait 4:5 (1200×1500)** to own the mobile feed
  (`scripts/render_carousel.py` renders + stitches the PDF at the new ratio). New slide system:
  a cover that contrasts with content, numbered `.point` slides, a new `.recap` framework slide,
  and a `.cta` that ends on ONE action. A persistent progress bar + `NN/TOTAL` counter + byline
  on every slide; the bar fills from per-slide `--i/--n` custom props. One-accent (60/30/10)
  discipline throughout.
- **Redesigned the whole card family into one clean, minimal, professional language:** date →
  realistic ADMIT-ONE ticket; flow → numbered vertical spine; ramp → a real analytics chart
  (gridlines, axis baseline, SVG trend line, growth-delta pill); general hero → grid-aligned
  mapping rows with accent key-markers; stem → calmed onto the dark family base (dropped the
  confetti + saturated gradient, kept the chunky toy-block S T E M motif). Bylines ride inline
  in a crop-safe `.toprow` across the family.

## [0.3.0] - 2026-06-09

### Added
- **Carousel support** — the highest-reach native LinkedIn format, end-to-end:
  `assets/card-template-carousel.html` (cover → numbered `.point` slides → a `.cta` with a
  "Save this" prompt) + `.card.slide` styles; `scripts/render_carousel.py`, which screenshots
  each slide to preview PNGs and stitches them into one PDF; and a `--document`/`--title`
  flag on `scripts/linkedin_post.py` that posts the PDF as a document via `/rest/documents`.
- `voice/algorithm.md` — a sourced, evidence-based LinkedIn reach playbook (Richard van der
  Blom *Algorithm InSights*, Sprout Social, AuthoredUp, Hootsuite; current as of 2026). It is
  read on every draft alongside the voice files and **never overrides `voice-notes.md`**.
- New `flow` card type (`assets/card-template-flow.html` + `.card.flow` styles) — a clean,
  linear architecture/pipeline diagram with a crop-safe top byline. Documented in SKILL.md;
  preferred over Mermaid for architecture posts.

### Changed
- SKILL.md now bakes reach optimization into generation and publishing: hook in the first
  ~210 characters, length ~900–1,500 chars, optimize for **saves** over likes, no external
  links in the post body (use the first comment), 0–3 specific hashtags, and a format-by-reach
  ranking (document/carousel > image > text) so a single decorative card is no longer the
  default. Publish mode now prompts the **golden-hour** routine (reply to comments + engage
  5+ posts in the first 60 minutes), the biggest lever for low reach. Reconciled with
  voice-notes: chase saves and genuine discussion, never CTA bait.

## [0.2.0] - 2026-06-08

### Added
- `assets/card-template-stem.html` — a **STEM card type** for STEM / education /
  outreach posts: deliberately playful (a chunky toy-block S T E M motif, confetti
  accents, a rounded hero headline) so it reads as kid-energy rather than buttoned-up.
- `.card.stem` styles in `assets/diagram.css.example`, and a SKILL.md reference
  documenting when to reach for the STEM card under Visuals.

## [0.1.0] - 2026-06-08

### Added
- `assets/card-template-ramp.html` — a **ramp card type** for accelerating
  progressions: three ascending steps with the last highlighted. Bars are
  illustrative (not to scale); the labeled figures carry the truth.
- `.card.ramp` styles in `assets/diagram.css.example`, and a SKILL.md reference
  documenting when to reach for the ramp card under Visuals.

## [0.0.1] - 2026-06-06

First versioned release. Makes the skill follow its own advice: a skill is code,
so it gets scored, tested, and versioned.

### Added
- `scripts/score_skill.py` — eval that scores `SKILL.md` against grounded pass/fail
  checks (frontmatter, the three modes, the never-publish-without-approval guardrail,
  compliance rule, voice inputs) and exits non-zero on failure so CI can gate on it.
- `tests/` — pytest suite covering all five Python scripts at 100% line coverage,
  with `pyproject.toml` enforcing `--cov-fail-under=100`.
- `.github/workflows/ci.yml` — runs shellcheck, the test suite at 100% coverage,
  and the SKILL.md scorer on every push and PR to `main`.
- `requirements-dev.txt` — dev/test dependencies (the runtime scripts remain
  standard-library only).
- `version: 0.0.1` field in the `SKILL.md` frontmatter.

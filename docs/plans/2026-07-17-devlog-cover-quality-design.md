---
ticket: "N/A"
title: "devlog: icon catalog + geometry-enforced hero zone for cover-image quality"
date: "2026-07-17"
source: "design"
---

# devlog: icon catalog + geometry-enforced hero zone for cover-image quality

## Overview

devlog v0.8.1 shipped cover images rendered by a headless browser from an agent's
freehand inline-SVG, one illustration per post, guided only by a prose style guide and
up to 3 reference screenshots. The results feel half-baked: not because the topical
direction is wrong (the style guide already demands one specific, non-generic
illustration per post), but because freehand vector drawing in a single pass, with no
reusable components and no coordinate discipline, is a much harder generation task than
picking from a curated set and placing it — and it shows in inconsistent spacing,
near-misses, and shapes that are "technically on-topic" but poorly executed as actual
line art.

This design keeps the non-negotiable requirement (every post gets one bespoke
illustration depicting its specific mechanism, never generic, never reused) but adds
real scaffolding around it: a curated dark-theme icon catalog for secondary elements,
and a fixed grid/bounding-box contract for the hero illustration itself. Because a
sibling investigation found the existing anti-regression safeguard is a regex checking
that one sentence still exists in prose — not a check on anything actually rendered — a
new mechanical enforcement is added: `render_cover.mjs` measures actual rendered
geometry (via Playwright, already in the pipeline) and refuses to render if a catalog
icon overlaps the hero zone. All ~51 already-published covers get regenerated under the
new system.

## Why not a full template library (ghostwriter-style)

The sibling `ghostwriter` skill solves an adjacent problem (LinkedIn card images) with a
full named-template family plus an icon catalog, and produces genuinely polished
results. That approach was investigated and rejected as the primary path here: devlog
has a hard requirement ghostwriter's format doesn't — "two different posts should never
produce visually similar covers." A fixed template family converges toward recognizable
"types" (ghostwriter's cards visibly read as a family); across 50+ devlog posts that
would recreate the exact "bland, repetitive" complaint that shipped and got fixed once
already this cycle. The hero illustration therefore stays freehand — the catalog and
grid exist to fix everything *around* it, not to replace it.

## Components

**1. Icon catalog** — `image-style/icons.md`, a new file (repo-tracked in
`skills/devlog/skills/devlog/image-style/`, installed alongside the existing
`style-guide.example.md`/`font.ttf` to `~/.claude/skills/devlog/image-style/` by
`devlog init`). 20 named icons, real recurring technical domains pulled from the actual
title/summary text of all 51 published posts (agents/LLM, testing, CI/CD, git,
accessibility, debugging, CLI, config, deploy, database, API, search, auth, monitoring,
cover/image tooling, performance, parsing, caching, UI). Each icon is real inline SVG
(24×24 viewBox, stroke-only, `currentColor`) — recolors for either `#ededed` or the
`#fff503` accent by CSS `color`, never fill. A topic→icon cheat-sheet table lets the
agent look up a concept instead of re-deriving one. Explicitly for **secondary**
elements only (a small accent glyph next to a kicker, a supporting icon in a two-node
layout) — never the hero.

**2. Hero-zone grid contract** — added to `style-guide.md`: a fixed hero bounding box
`x:150 y:425 width:1300 height:400` on the 1600×900 canvas (below the existing
kicker/title area), a 25px coordinate grid every hero shape's key points must snap to
(fixes the "no rhythm/near-misses" failure mode), and three named composition slots the
agent picks from per post: **single centered hero** (one mechanism, nothing else),
**hero + supporting element** (mechanism left, one secondary icon right), **two-node
before/after** (a left node, a right node, a connecting line — for posts about a
transformation or a fix). These are placement/proportion guidance, not literal
templates — the actual shapes inside each slot are still freehand per post.

**3. Geometry-enforced hero-zone guard** — `lib/render_cover.mjs` change. Every catalog
icon usage in composed HTML must be wrapped in a container carrying
`data-catalog-icon="<name>"`. Immediately before the screenshot (after
`document.fonts.ready`, before `page.screenshot()`), the render step queries
`getBoundingClientRect()` on every `[data-catalog-icon]` element and on a required
`#hero-zone` element (the hero's own bounding box, drawn by the agent to match its
composition slot), and throws a descriptive error if any catalog icon's rect intersects
the hero zone's rect. This is a real pixel-geometry check against actual rendered
layout, not a string/regex match — closing the gap where an agent could satisfy every
prose rule while quietly drawing "two catalog icons connected by a line" as the "bespoke"
hero. `render-cover` surfaces this as a normal composition failure (same shape as a
missing-font error): the agent adjusts and retries, publish is never blocked silently.

**4. Cover-context data surface** — `lib/cover_gen.mjs`'s `loadStyleGuide()` /
`getRecentCovers()` and `bin/devlog.js`'s `cmdCoverContext` extend their returned
`{ styleGuide, references }` shape to also read and return the new icon catalog content
(so the agent gets it in the same `cover-context` call, no new CLI flag). No change to
`render_cover.mjs`'s actual rasterization beyond the new pre-screenshot geometry check.

## Backfill (all ~51 existing covers)

Uses the existing CLI flow unchanged: `backfill-covers list` (already lists every
manifest entry) → per-entry compose against the new style guide/catalog/grid →
`render-cover` into staging (now enforcing the geometry guard) → `commit-covers
<staging-dir>` with `--force` (bulk overwrite, since every entry already has a cover from
the prior batch). Regeneration is parallelized across subagents by project (6 projects,
51 posts), mirroring the pattern already used for the original 49-post redesign this
session. Verification: **not** full manual review of all 51, and **not** fully
automated — one sample cover per project (~6 total) shown for a subjective "does this
actually look good and distinct" check, while the new geometry guard mechanically
catches the structural regression (catalog-icon-as-hero) a human reviewer might not
reliably spot across 51 covers. If a sampled cover fails review, its whole project's
batch gets a second pass before commit.

## Invariants

**Checkable by inspection:**
- `image-style/icons.md` exists and every catalog icon entry has real `<svg>` markup
  (not a placeholder/TODO).
- `style-guide.md`'s hero-zone coordinates (`150,425,1300,400`) and 25px grid value are
  present and match the values `render_cover.mjs`'s guard actually checks against — the
  prose and the code must agree, not drift independently.
- `skill-invariants.json`'s existing `cover-custom-illustration` entry (SKILL.md prose:
  "a cover that just re-renders the title in large text is a failure") is preserved
  unchanged, its rationale extended to note it's independent of, not superseded by, the
  new geometry guard — two different regression surfaces (an agent's composition
  behavior vs. a future code edit silently deleting the enforcement), both still worth
  guarding.
- New `skill-invariants.json` `code` array (schema extension: entries target a file
  other than `SKILL.md`) with `cover-catalog-hero-overlap-guard`, asserting the
  `getBoundingClientRect`/overlap-throw logic is present in `lib/render_cover.mjs`.
  Requires a small extension to `tests/skill_contract.test.mjs`'s invariant-checking loop
  to also read `code`-array entries against their named file, not just `SKILL.md`.

**Testable:**
- `render_cover.mjs`: a synthetic HTML fixture with a `[data-catalog-icon]` element
  positioned inside `#hero-zone`'s rect must cause `renderCover()` to throw; a fixture
  with the same icon positioned outside the hero zone must render successfully.
- `cover_gen.mjs`: `loadStyleGuide()`'s (or a new sibling function's) returned data
  includes the icon catalog content when `image-style/icons.md` exists, and degrades the
  same way the existing missing-style-guide path does when it doesn't (never blocks
  publish — existing `cover-never-blocks-publish` invariant, unchanged).
- `tests/skill_contract.test.mjs`: extended loop confirms the new `code`-array invariant
  actually fails if the guard logic is removed from `render_cover.mjs` (a real
  regression test, not just schema validation).

## Versioning

**0.9.0**, not a patch — this repo's convention bumps minor for feature-level behavior
changes (0.7.0 private projects, 0.8.0 cover images); 0.8.1 was reserved for the same-day
prose-only fix. An icon catalog, a grid contract, a new mechanical enforcement path, and
a 51-post regeneration is feature scope.

## Out of scope

- No change to `render_cover.mjs`'s core rasterization (viewport, font-loading,
  quantization) — only the new pre-screenshot geometry check is added.
- No change to the `## Changelog`/commit-linking/private-project behavior.
- No cross-post shape-family similarity tracking (considered as a "heavy" enforcement
  option and explicitly declined in favor of the per-project sample review — revisit if
  the sampled review starts finding same-shape-family repeats in practice).

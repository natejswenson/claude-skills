# Cover image style guide

This is the fallback style guide devlog uses when composing a post's cover image. It is
generic. Replace it with your own — the more specific the visual direction, the more
consistent your covers will look across ~50+ posts.

devlog reads this file, plus (when available) the `n` most recently published covers as
reference images, before composing a new cover. **Actually look at the reference images
before composing** — the style guide alone under-specifies layout/spacing; the references
are how a from-scratch visual language stays consistent from post to post.

## What you're composing

A single self-contained HTML document (inline `<style>`, inline SVG for any artwork) that
renders, at exactly 1600×900px, as a cover image for one dev log entry. Compose from these
fields only — never open the post's raw markdown file, never reference any section other
than `## Shipped` (no `## Changelog`, no gotchas, no sources):
- `title`
- `tags`
- `summary`
- the `## Shipped` section's text

## The point of this cover: one custom illustration, not a repeated headline

**A cover that just re-renders the title in large text is a failure, no matter how clean
the typography is.** The title is already the `<h1>` on the post page one scroll down —
the cover's job is to give the reader something to *look at*, a specific visual idea that
came from *this* post's content and would look wrong on any other post.

Before writing any HTML, do this thinking step explicitly:
1. Read the title, summary, and `## Shipped` text.
2. Identify the one concrete technical concept or moment the post is actually about —
   not the project name, not "a bug fix," but the specific mechanism: a lock rejecting a
   key that doesn't fit, a git tag being distrusted like any other user input, one broken
   link in a chain, a filter separating signal from noise, a clock catching a stale
   timestamp, two paths diverging and one being cut off.
3. Design ONE illustration — built from inline SVG shapes (lines, arcs, polygons,
   simple geometric forms) — that depicts that concept. Not a photo, not a stock icon,
   not a screenshot: a small original line-art scene, in the spirit of an editorial
   illustration or a technical diagram, using only the palette below.
4. That illustration is the dominant visual element of the cover — roughly half the
   canvas, not a thumbnail in the corner. Title, kicker, and summary text support it;
   they do not replace it.

**Two different posts should never produce visually similar covers.** If your instinct is
to reach for a generic circle/square/checkmark because you're not sure what else to draw,
that's a sign to go back to step 2 and find the more specific concept — a post about
retrying a flaky network call and a post about deduplicating bank transactions should not
end up with the same shape family.

## Technical requirements (non-negotiable)

- Start the document with a literal `<!DOCTYPE html>` declaration, always.
- `html, body { margin: 0; width: 1600px; height: 900px; }` — the render is a
  viewport-clipped screenshot at exactly this size; content that overflows this box is
  simply never captured, so keep everything inside it.
- Reference the bundled font only by its fixed name, with a fallback:
  `font-family: 'DevlogCoverFont', sans-serif;` — never embed font bytes yourself, never
  reference any other font file. The renderer injects the real font after your markup is
  parsed.
- No external resources of any kind — no `<link>`, no `@import`, no remote `<img src>`,
  no web fonts, no raster images. All artwork is inline SVG built from basic shapes
  (`<path>`, `<circle>`, `<rect>`, `<line>`, `<polygon>`, `<polyline>`) — everything must
  be inline HTML/CSS/SVG, hand-composed, not fetched or embedded from anywhere.

## Visual direction

The site (natejswenson.com) is a minimalist, monospace, terminal-styled dev log. Covers
should feel like they belong to the same publication as the site itself — technical
editorial illustrations, not marketing graphics and not a repeated template:

- **Palette:** background `#0a0a0b` (near-black), foreground/line-art color `#ededed`,
  secondary/dim `#8a8a8a`, one accent color `#fff503` (yellow) for the single most
  important element of the illustration — the thing being emphasized, not a decoration.
  Prefer 2-3 colors on a page (black, white, one accent), not a rainbow. Prefer flat,
  limited color and solid/line fills over large smooth gradients — the render is
  compressed with lossy PNG palette quantization afterward, and gradients band visibly
  under that compression while flat fills don't.
- **Typography:** `'DevlogCoverFont'` (a monospace face) for any on-image text — kicker,
  title, date. Keep the title modest in size (it is not the main event); a short kicker
  (project + date) is enough context. Terminal/code aesthetic glyphs (`$`, `>`, `//`,
  brackets) are fair game as small accents, not as the illustration itself.
- **Composition:** the illustration occupies the dominant visual weight of the canvas —
  centered or offset to one side, large enough to read at a glance, with the
  title/kicker in the remaining negative space (not overlapping the artwork). Plenty of
  breathing room around the illustration; don't crowd it with text or decoration.
- **Restraint in execution, not in ambition:** the illustration should be a real, specific
  scene (multiple shapes composed together to depict one concept), not a single
  primitive. But avoid clutter — every shape in the illustration should serve the one
  concept, not decorate around it.

## Never do

- Don't make the title the largest, most prominent element on the cover — the
  illustration is.
- Don't restate the version number as the headline ("v0.6.0" as the big text) — use the
  post's actual title, and keep it secondary to the artwork.
- Don't reuse the same illustration, shape family, or visual metaphor across different
  posts — go back to the post's actual content and find what's specific to it.
- Don't fall back to a generic circle/square/checkmark/arrow when stuck — that's the
  exact failure mode this guide exists to prevent. Spend the extra step finding the
  concrete mechanism the post describes.
- Don't use a gradient as a full-bleed background.
- Don't embed a photograph, stock image, or anything requiring an external fetch — the
  illustration is drawn from inline SVG primitives, not sourced from anywhere.
- Don't reference any font other than `'DevlogCoverFont'` (with its `sans-serif`
  fallback).

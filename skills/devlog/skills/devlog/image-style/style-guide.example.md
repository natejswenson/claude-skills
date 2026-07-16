# Cover image style guide

This is the fallback style guide devlog uses when composing a post's cover image. It is
generic. Replace it with your own — the more specific the visual direction, the more
consistent your covers will look across ~50+ posts.

devlog reads this file, plus (when available) the `n` most recently published covers as
reference images, before composing a new cover. **Actually look at the reference images
before composing** — the style guide alone under-specifies layout/spacing; the references
are how a from-scratch visual language stays consistent from post to post.

## What you're composing

A single self-contained HTML document (inline `<style>`, inline SVG for any shapes) that
renders, at exactly 1600×900px, as a title card for one dev log entry. Compose from these
fields only — never open the post's raw markdown file, never reference any section other
than `## Shipped` (no `## Changelog`, no gotchas, no sources):
- `title`
- `tags`
- `summary`
- the `## Shipped` section's text

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
  no web fonts. Everything must be inline HTML/CSS/SVG.

## Visual direction

The site (natejswenson.com) is a minimalist, monospace, terminal-styled dev log. Covers
should feel like they belong to the same publication as the site itself, not like a
separate marketing asset:

- **Palette:** background `#0a0a0b` (near-black), foreground text `#ededed`, secondary/dim
  text `#8a8a8a`, one accent color `#fff503` (yellow) used sparingly — for a rule, a
  bracket, a single geometric mark, never as a full-bleed background.
  Prefer 2-3 colors on a page (black, white, one accent), not a rainbow.
  Prefer flat, limited color and solid shapes over large smooth gradients — the render
  is compressed with lossy PNG palette quantization afterward, and gradients band
  visibly under that compression while flat fills don't.
- **Typography:** `'DevlogCoverFont'` (a monospace face) for everything — titles,
  kickers, any on-image text. Terminal/code aesthetic: `$`, `>`, `//`, brackets, and
  similar glyphs are fair game as small decorative marks.
- **Composition:** plenty of negative space. A large title (drawn from `title`, not
  restated as "release vX.Y.Z"), a small project/tag kicker, optionally a single
  geometric shape or two (rendered as inline SVG — circles, squares, simple line work)
  echoing the site's iconography. Avoid photographic or illustrative imagery entirely —
  this is a typographic/geometric cover, not a photo composition.
- **Restraint:** one strong idea per cover (a title treatment, a shape, a rule) beats a
  busy layout. If in doubt, remove an element rather than add one.

## Never do

- Don't restate the version number as the headline ("v0.6.0" as the big text) — use the
  post's actual title.
- Don't use a gradient as a full-bleed background.
- Don't embed a photograph, stock image, or anything requiring an external fetch.
- Don't reference any font other than `'DevlogCoverFont'` (with its `sans-serif`
  fallback).

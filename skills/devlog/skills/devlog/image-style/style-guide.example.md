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
   not a screenshot: a small original line-art scene, **editorial line art in ink with
   sparing orange**, in the spirit of a newspaper diagram or a technical schematic, using
   only the palette below.
4. That illustration is the dominant visual element of the cover — roughly half the
   canvas, not a thumbnail in the corner. Title, kicker, and summary text support it;
   they do not replace it.

**Two different posts should never produce visually similar covers.** If your instinct is
to reach for a generic circle/square/checkmark because you're not sure what else to draw,
that's a sign to go back to step 2 and find the more specific concept — a post about
retrying a flaky network call and a post about deduplicating bank transactions should not
end up with the same shape family.

## Hero-zone grid contract

The hero illustration renders inside a fixed bounding box: `x:150 y:425 width:1300 height:400` on the 1600×900 canvas (below the kicker/title area). Draw a container
element with `id="hero-zone"` at exactly this position and size — `render-cover`
mechanically checks the rendered `#hero-zone` rect against these numbers (within a 2px
tolerance for subpixel rounding) and refuses to render if it doesn't match, or if
`#hero-zone` is missing or duplicated. This is a hard requirement, not a suggestion —
every post's hero renders inside the identical box so covers stay comparable. It is also a
convenient coincidence worth using: the box's 150px left/right insets are the same
outer margin the masthead and headline above it should sit inside, so the hero zone, the
eyebrow row, and the headline all line up on one shared left edge.

Every key point of the hero shape you draw *inside* `#hero-zone` should snap to a 25px coordinate grid (this is prose guidance, not mechanically checked — the guard verifies the outer box only) — pick coordinates as multiples of 25px from `#hero-zone`'s own top-left corner. This fixes near-misses and uneven spacing; it does not mean the shapes themselves must be simple, only that their key points land on a consistent rhythm.

**Fill the zone — this is not optional.** `render-cover` only checks the outer `#hero-zone` box; nothing mechanically stops you from drawing something small inside a mostly-empty rectangle, so this rule is on you, checkable by eye. The illustration's own ink — the actual bounding box of the shapes you draw, not the container — must cover at least 70% of the zone's 1300px width and at least 60% of its 400px height. A thin horizontal band of marks sitting low in the zone, with a large empty margin above it, is a specific and common failure: it reads as top-heavy — headline, then a dead void, then a sliver of drawing — rather than as one composed image. Distribute the drawing's mass across the zone's full height, not just its width: let elements reach toward both y:0 and y:400 of the zone's own coordinate space (labels, connecting lines, secondary marks all count), not cluster near one edge.

**Bridge a short headline — the band above the zone is yours to fill.** The hero zone
starts at a fixed `y:425` no matter how tall the headline is. A two-line headline ends
near `y:270` and leaves a comfortable ~155px of paper; a **one-line headline ends near
`y:215` and leaves ~210px of dead air** that no amount of good drawing inside the zone
can close — the cover reads as a headline, a void, then an unrelated diagram. When your
headline renders on one line, you must bridge that band. In order of preference:
- a **standfirst** — one serif-italic line behind a 5px orange left rule, restating the
  mechanism in plain words (this is the PRESS `.stand`, and it is the best answer);
- a **ledger strip** — two or three mono `label · value` pairs on one row, over a 2px ink
  rule, carrying real numbers from `## Shipped`;
- letting the illustration's own **labels or axis titles** rise into the band, so the
  drawing visually begins before the zone does.

Never leave the band empty under a one-line headline. Whitespace is part of the brand
only when it's *between* composed elements — a gap with nothing on either side of it is
just a hole.

**Five named composition slots** — pick one per post:
- **Single centered hero** — one freehand mechanism, nothing else, inside the hero zone.
- **Two-node before/after** — a left node, a right node, and a connecting line, all
  three freehand shapes (never catalog icons) — for a post about a transformation or a
  fix.
- **Axis / timeline** — one horizontal (or vertical) run with marks, labels, and events
  positioned along it. For anything about *ordering*, *timing*, or *a race*: what fired
  when, what arrived late, what overlapped. The marks carry the meaning, not boxes.
- **Nested / containment** — one shape inside another, or a stack of layers, showing
  what wraps what, what's isolated from what, or where a boundary sits. For posts about
  scope, sandboxing, encapsulation, or a thing living inside a thing.
- **Field / distribution** — many small marks whose *arrangement* is the point: a
  scatter, a cluster with an outlier, a grid with holes, a shape emerging from noise.
  For posts about many items, sampling, coverage, or one anomaly among many.

These are placement/proportion guidance, not literal templates — the actual shapes
inside each slot are still freehand per post.

**Do not default to two-node.** It is the easiest slot to reach for and it fits almost
any post *badly*, because nearly everything can be framed as before/after. That framing
is the single biggest threat to this set: fifty covers that are each individually fine
but all split-scene-with-a-connecting-line read as one template with the labels swapped,
which is the anti-similarity failure at the level of the whole publication rather than
the individual cover.

So, before you commit to a slot: **look at the reference covers `cover-context` handed
you and identify which slot each one used.** If two or more of them used the slot you
were about to pick, pick a different one — and only override that if the post's mechanism
genuinely cannot be drawn any other way, which is rarer than it feels. Reach for
single-centered-hero more often than instinct suggests; one well-drawn mechanism with
nothing beside it is usually stronger than a comparison, and it is the slot most likely
to be under-used across a long run.

**A third option, when the post is genuinely about code or a terminal session:** the
`.term` panel treatment (see Palette below) may fill some or all of `#hero-zone` instead
of a freehand mechanism — a real, believable command/output snippet drawn from the
`## Shipped` text, not invented. This is the one place the old dark palette survives, and
only here: never let the dark panel bleed to the canvas edges — keep at least the same
25px-grid margin of paper visible around it inside the hero zone so it reads as an object
floating on the page, not a background.

**Catalog icons are never placed inside `#hero-zone`, in either slot.** The mechanism
and both two-node shapes are always freehand SVG you draw yourself. A catalog icon
(`image-style/icons.md`) may only appear as a small accent glyph in the kicker/title
area, entirely outside the hero zone.

**Optional kicker-area accent icon — anchored, never floating.** Independent of which of the two slots you picked, you may add one small accent glyph near the kicker/title area — either a catalog icon (`image-style/icons.md`) or a terminal/code aesthetic glyph (`$`, `>`, `//`, brackets). It needs a defined home: sit it directly against the eyebrow row, baseline-aligned, immediately before or after the eyebrow text, so it reads as part of that line rather than a shape adrift in empty space. If there's nowhere for it to attach this cleanly, leave it out — an omitted accent icon is a better cover than a floating one, which is exactly why this element is optional. Never combine the catalog-icon accent and the terminal-glyph accent in the same cover. Color it ink or dim (`#181510` / `#6E675C`), never the signature orange — the accent icon is a small piece of structure, not the cover's one loud moment.

If you use a catalog-icon accent, it must be positioned with its bottom edge no lower than y:400 — a 25px buffer above the hero zone's y:425 top edge — so it can never clip into the hero zone and trip the geometry guard.

For the two-node slot specifically: the accent icon's presence must not be read as belonging to either node; it sits in the kicker/title area purely as a page-level decoration, unrelated to the two-node layout below it.

## Technical requirements (non-negotiable)

- Start the document with a literal `<!DOCTYPE html>` declaration, always.
- `html, body { margin: 0; width: 1600px; height: 900px; }` — the render is a
  viewport-clipped screenshot at exactly this size; content that overflows this box is
  simply never captured, so keep everything inside it.
- Reference the bundled font only by its fixed name, with a fallback:
  `font-family: 'DevlogCoverFont', sans-serif;` — never embed font bytes yourself, never
  reference any other font file. The renderer injects the real font (a monospace face)
  after your markup is parsed. **This is the only font whose bytes are ever loaded** — but
  it is not the only font-family value you're allowed to write. The Typography section
  below asks for a serif voice and a display voice as well; get those from this rendering
  host's own built-in system fonts (`Georgia`, `ui-serif`, `-apple-system`, generic
  `serif`/`sans-serif`), the same way the `sans-serif` fallback above already works before
  `DevlogCoverFont` finishes loading. That's resolving a name the browser already has, not
  embedding or fetching a file — no different in kind from the fallback this rule already
  requires.
- No external resources of any kind — no `<link>`, no `@import`, no remote `<img src>`,
  no web fonts, no raster images. All artwork is inline SVG built from basic shapes
  (`<path>`, `<circle>`, `<rect>`, `<line>`, `<polygon>`, `<polyline>`) — everything must
  be inline HTML/CSS/SVG, hand-composed, not fetched or embedded from anywhere.

## Visual direction

The site (natejswenson.com) runs on **PRESS** — a warm-paper editorial-poster brand:
huge black type, a serif standfirst voice, one loud signature accent, heavy ink rules, and
a personal monogram stamp. Covers should read as an issue of the same publication as the
site, not a marketing graphic and not a repeated template.

### Palette

- **Paper** `#F5F0E6` — the canvas background. Flat. No gradient, no vignette, no texture.
- **Ink** `#181510` — headline, structural rules, the stamp's frame when not orange, most
  line art.
- **Dim** `#6E675C` — secondary text: date/meta, captions, dim linework.
- **Tertiary** `#8A8272` — decorative use only inside the illustration (a faint
  background element), never body text, never the headline.
- **Signature** `#E8501F` (orange) — the ONE loud accent. See The accent law below.
- **Term panel** (only inside a `.term` hero, see above) — background `#141A26`, text
  `#EFE9DC`, dim text `#8A8478`, hot/verdict line `#FF8A5C`. This quartet never appears
  outside a `.term` panel.

Prefer flat, limited color and solid/line fills over gradients or smooth shading — the
render is compressed with lossy PNG palette quantization afterward, and gradients band
visibly under that compression while flat fills don't.

### The accent law, carried to covers

Orange is a signature, not a color scheme. On one cover it may appear as:
- the **stamp** (border + `NS` letters) — always, every cover.
- **at most one pivot phrase** inside the headline (`<span>` colored orange) — optional,
  use it when one word or short phrase is genuinely the point. **Cap it at two words.** A
  three-or-more-word orange run stops reading as a pivot and starts reading as a second
  headline, and it eats the budget the illustration needs. If the point can't be made in
  two words, leave the headline entirely ink and let the drawing carry the signature.
- **at most one orange element in the illustration, and only one of these two kinds:**
  either a *fill* (one payoff bar, one win-state shape) or *thin marks* (a cap line, a
  pivot tick, a labelled dot) — never both, and never a fill larger than the payoff itself.
  Count the headline pivot against this too: a cover with an orange pivot phrase AND a
  large orange fill is over budget. One loud thing per cover, plus the stamp.
- **a numeral, only if it's real.** If the `## Shipped` text hands you an actual number
  worth calling out (a count, a duration, a percentage), it may run in orange, large. Never
  invent a sequential "No. 042"-style issue number to fill an eyebrow — devlog doesn't
  pass covers a real published-count field the way the site's own pages do, and a
  fabricated one is exactly the ornamental-prop failure mode in Never do, below.
- **thin marks or rules inside the illustration** — sparing use, one or two strokes, never
  a fill.
- **`.hot` lines inside a `.term` panel** — panel-internal, doesn't count against the
  budget above.

Everything else is ink, or dim for secondary weight. If you're not sure whether something
should be orange, it should be ink — when orange shows up as the fill of three different
shapes, the badge, and the border all on one cover, it stops being a signature and starts
being a rainbow.

### Typography — three voices

Match the site's own split: **display** = structure (headline, eyebrow, numerals, labels),
**serif italic** = commentary (a short standfirst/caption, if you use one), **mono** =
data (dates, tags, terminal text, inline code).

| Role | Font stack | Notes |
|---|---|---|
| Headline, eyebrow, numerals, labels, stamp letters | `-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif` | weight 800–900, tight tracking (`-0.02em` to `-0.03em` on the headline) |
| Standfirst / caption (optional, ≤1 short line) | `Georgia, 'Times New Roman', ui-serif, serif`, italic | secondary ink or dim |
| Dates, tags, terminal/code text | `'DevlogCoverFont', ui-monospace, 'SF Mono', Menlo, monospace` | the injected font is a monospace face, so this voice is where it actually renders as intended; everything else falls back to a system font gracefully |

Keep the title modest — it is not the main event, the illustration is. A short kicker
(project name, plus a date if you know it) is enough context; don't restate the whole
summary as on-image text.

### Composition

- The illustration occupies the dominant visual weight of the canvas — inside `#hero-zone`,
  large enough to read at a glance, with the masthead/headline in the negative space above
  it (never overlapping the artwork).
- Masthead row near the top: a small stamp (a square, ~2.5–3px orange border, `NS`
  in orange, `transform: rotate(-4deg)`) plus an eyebrow — the project name in tracked
  caps, ink. A heavy ink rule (6–8px) above this row, matching the site's own page-frame
  weight, reads as the cover's top edge.
- Headline below the masthead, ink, up to two lines, sized to leave real air above
  `#hero-zone` — don't let it crowd down into the illustration's territory.
- Optional thin ink rule (2px) at the very bottom of the canvas, under `#hero-zone`, is a
  fine way to close the composition the way the site's own colophon closes a page — skip
  it if the illustration already reads as complete without one; it's a finishing touch,
  not a required element.
- **A caption, if you use one, anchors to the drawing, not to the canvas margin.** Center
  it under the illustration's own visual mass, or align it flush to one edge of the
  drawing's actual bounding box — never park it at the hero zone's left inset independent
  of where the artwork itself sits. A caption is a caption *for* the drawing; its position
  should say so, and it exists to reinforce a concept the drawing already communicates on
  its own, not to explain a drawing that doesn't communicate anything by itself.
- Breathing room belongs between the composed image and the canvas edges, and between the
  image and the masthead/headline above it — not inside the hero zone as empty space
  around an undersized drawing. Don't crowd the composition with unrelated text or
  decoration; do fill the zone the drawing is given (see the fill requirement above).
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
- Don't draw a row of repeated, near-identical marks along one baseline — a tick row, a
  barcode, evenly spaced dashes — as the whole illustration. It reads as a barcode, not a
  concept. A reader must be able to infer the concept from the shapes and their
  arrangement alone, before reading any caption; if the caption is doing the work of
  explaining what the drawing is, the drawing failed, and adding a caption to compensate
  doesn't fix it.
- Don't leave the hero zone mostly empty around a small drawing. `render-cover` only
  checks the outer `#hero-zone` box, not what's inside it, so a thin band of marks in an
  otherwise bare 1300×400 area passes the mechanical check and still fails this guide —
  see the fill requirement in Hero-zone grid contract.
- Don't let the kicker-area accent icon float in empty space with nothing beside it —
  anchor it to the eyebrow line, or leave it out entirely.
- Don't use a gradient as a full-bleed background, and don't add grain, noise, torn
  edges, fold lines, or any texture overlay — the paper is a flat hex, not a vintage
  poster prop.
- Don't round any corner or drop any shadow, on the illustration or anywhere else on the
  cover — PRESS structure comes from rules and whitespace, never rounded chrome. This
  includes *incidental* shapes you reach for without thinking: speech bubbles, callout
  balloons, pill badges, tooltips, rounded terminal chrome. A speech bubble is a
  rectangle with a triangular tail, not a lozenge. Check every `rx`/`ry` on an SVG rect
  and every `border-radius` before you render — a single rounded bubble in an otherwise
  square composition is the tell that collapses the whole cover into web-app chrome.
- Don't let orange spread across the cover — one signature moment (see The accent law),
  never orange as a fill color for multiple shapes, never a background wash.
- Don't set the headline, eyebrow, or numerals in the serif voice — that voice is for
  commentary only; structure is always the display face.
- Don't invent editorial props that aren't backed by real data: no fabricated issue
  numbers, no barcodes, no pull-quotes that aren't an actual quote from the post.
- Don't print a number the post didn't state. A figure that *looks* like a measurement
  ("0 edits left", "3x faster", "~40ms") must appear literally in the `## Shipped` text
  or the summary. A fair entailment is not enough: once it's set in mono on the cover it
  reads as something that was measured, and a reader who goes looking for it in the post
  won't find it. If the point is "none" or "zero," draw the absence — an empty frame, a
  severed line, a gap where marks used to be — rather than asserting a count.
- Don't leave old terminal furniture lying around outside a `.term` panel — no blinking
  cursor, no bare `_` suffix, no stray `$` prompt as decoration. The dark palette now
  belongs to exactly one place, the `.term` panel, and only when it's real code.
- Don't embed a photograph, stock image, or anything requiring an external fetch — the
  illustration is drawn from inline SVG primitives, not sourced from anywhere.
- Don't reference any font file other than the bundled `'DevlogCoverFont'` — the serif
  and display voices lean on this rendering host's own system fonts, never a file you
  fetch or embed yourself.

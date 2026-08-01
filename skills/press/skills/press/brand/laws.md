# The PRESS laws

PRESS is a **brand system, not a template**. Nothing here tells you what to
build; it tells you what every thing you build must obey so that a morning
brief, a city profile, a budget report, a résumé, a LinkedIn card and a dev-log
cover read as one publication.

The values live in `tokens.json` and are generated into consumers. These are the
rules the numbers can't carry.

## 1. The accent law

There is **one** loud color. It is spent **once or twice in a document** — on
the single most notable figure, and on the stamp. Never as decoration, never on
a whole row of things, never to mean "good" or "bad".

Adding more orange does not make it louder. It makes it quieter.

Corollaries that have each already cost a real bug:

- **No traffic lights.** Over-budget, failed, missed, at-risk — none of these get
  a hue. They get a text mark and a label, which survive greyscale printing and
  every form of color vision. `budget` carries over-budget on a `⚠︎` and a tick,
  not on red.
- **Emoji glyphs are a second loud color.** A bare `⚠` renders as a *colored*
  emoji in Chromium. Always use the text-presentation form from
  `tokens.marks.warn` (`⚠︎`, U+26A0 U+FE0E). The HTML looks fine and the PDF is
  wrong, so nothing catches this but the lint.
- **The one exception** is a two-subject comparison, where the subjects *are* the
  document (city A vs city B). There the accent identifies one subject
  throughout, because the alternative is asking the reader to match a hue from
  memory. A legend is mandatory when this exception is taken.

## 2. Structure is rules and whitespace

**No rounded corners. No shadows. No gradients. No fills. No boxes inside
boxes. No zebra striping.**

That is not minimalism for its own sake, and it is not an oversight to be
"fixed" later — it is the brand. Structure is carried by:

- **ink rules** — 8px above a masthead, 2px between sections, 1px under a row;
- **whitespace** — grouping is done by proximity, not by drawing a container;
- **typographic weight** — 900 display sans against 400 serif italic.

The single allowed radius is a circular avatar in the colophon, because a
cropped photograph is not a container.

## 3. Three voices, never mixed inside an element

| Voice | Face | Carries |
|---|---|---|
| **Structure** | display sans, 800–900, tight tracking (`-0.02` to `-0.03em`) | names, headlines, section titles, numerals |
| **Commentary** | serif italic, `dim` | standfirsts, captions, marginal notes, asides |
| **Data** | mono, tracked caps at small sizes | labels, dates, URLs, tables, terminal output, provenance |

Tones and verdicts are typographic — ink vs dim, roman vs italic — because that
is what is left once the accent law has taken color away.

## 4. Tracking has a hard ceiling

`letter-spacing` above **0.10em** silently breaks PDF text extraction: pdf.js
returns the string with spaces injected between characters, and poppler shows
nothing wrong, so a résumé that looks perfect becomes unparseable to an ATS.
`tokens.limits.max_letter_spacing_em` is the ceiling and `press lint` enforces
it. Tracked caps get their emphasis from size and weight, not from more space.

**The ceiling protects extraction, not taste**, so it binds only where a machine
reads the text back — PDFs and HTML pages. A rasterised card is pixels by the
time anyone sees it, and the card set runs its eyebrow at `.16em` deliberately.
Lint those with `--raster` (or `textExtractable: false`).

## 5. Every fill must be legible or labelled

The ink ramp (`derived.fill_steps`) is **sequential** — monotonic in lightness —
and encodes magnitude only, never identity. It is capped at three steps because
the lighter extensions drop below 3:1 against cream, and a fill nobody can see
is not worth the exception.

It is deliberately **not** a categorical palette. Run through the `dataviz`
skill's `validate_palette.js` it fails the chroma floor and the adjacent-pair
floor, which is the correct result for a near-neutral ramp and exactly why
identity here comes from direct labels rather than hue. Anything needing more
categories uses ranked bars, which need no categorical encoding at all.

## 6. A missing brand file must never break a render

Every consumer's theme loader deep-merges an optional local override file over
the defaults and **falls back silently on any error**. A report in the wrong
colors beats a report that didn't generate. This is why the generated loader is
part of the region rather than something each consumer reimplements.

## 7. Identity marks

- **Stamp** — a rotated (`-4deg`) square, accent border, accent initials from
  `tokens.identity.stamp`. It appears once, in the masthead.
- **Eyebrow** — tracked-caps mono: `{BRAND_LINE} · {DOCUMENT KIND} · {date}`.
- **Byline** — right-aligned, dim, mono, from `tokens.identity.byline`.
- **Colophon** — the closing line. What the document is for, or what happened.

## What PRESS does not decide

Layout, component choice, and composition are the medium's business. A poster
card, a two-column report and a résumé share these laws and share nothing else.
See `components.md` for the vocabulary they *do* share by name.

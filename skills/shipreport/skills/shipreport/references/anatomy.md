# The shape of the report

One sheet, composed from PRESS's named component vocabulary
(`skills/press/skills/press/brand/components.md`). Those names are the contract
that makes this sheet and a dev-log card read as issues of the same
publication — a medium may add classes, it may not rename these.

```
▪NS   SHIPPED · EXECUTIVE SUMMARY · 2026-07-28 → 2026-08-04    natejswenson.io
──────────────────────────────────────────────────────────────────────────────
<h1>          display sans 900 — the one claim
.standfirst   serif italic, dim — the setup
──────────────────────────────────────────────────────────────────────────────
  18      153        275        124        6          ← .bigstat + .stat-strip
RELEASED   MERGED   COMMITS   SESSIONS   REPOS           computed, never typed
──────────────────────────────────────────────────────────────────────────────
SHIPPED                                                    3   ← .block-title
 ⬡ Title              │  ⬡ Title                             ← .ledger, 2 cols
   text               │    text
   receipt receipt    │    receipt
──────────────────────────────────────────────────────────────────────────────
RECEIPTS                                                  13
 id · what · when                                              ← table.data
──────────────────────────────────────────────────────────────────────────────
every claim above resolves to a listed receipt      2026-07-28 → 2026-08-04
```

| Part | Class | Comes from |
|---|---|---|
| masthead, stamp, eyebrow, byline | `.masthead` `.stamp` `.eyebrow` `.byline` | `render` |
| headline | `h1` | model judgment |
| standfirst | `.standfirst` | model judgment |
| hero figure | `.bigstat > .fig .kicker` | **computed** |
| figures | `.stat-strip > .stat` | **computed** |
| section | `section.report-section` + `.block-title` | model judgment |
| cards | `.ledger > .lrow` (`.gl` `.lt` `.le` `.cites`) | ranked by `rank`, worded by the model |
| receipts | `table.data` | `render` |
| colophon | `.colophon` | `render` |

## The laws this sheet is built to

From `press/brand/laws.md`. They are not style preferences — each has already
cost a real bug somewhere in this repo.

- **§1 — one loud colour, spent twice.** Here: the stamp, and the hero figure.
  That is the whole budget. A third accent is the law failing quietly, so a
  test counts them. Never use the accent to mean "good" or "bad", and never
  give a whole row of things a hue.
- **§2 — structure is rules and whitespace.** *No rounded corners, no shadows,
  no gradients, no fills, no boxes inside boxes, no zebra striping.* The
  two-column card grid is divided by 1px ink rules and proximity; it never
  draws a container. This is the brand, not minimalism awaiting a fix.
- **§3 — three voices, never mixed inside an element.** Display sans for
  structure and numerals; serif italic for commentary; mono for data, labels,
  dates and receipts.
- **§4 — `letter-spacing` never above 0.10em.** Above it, PDF text extraction
  silently breaks — the page looks perfect and becomes unparseable.

## The glyphs

24×24, stroke only, `currentColor`, rounded caps — the same conventions as
ghostwriter's card catalogue, so the two families match. The catalogue is
`scripts/lib/glyphs.mjs`.

**The rule is meaningful and few.** A glyph matches the idea or it does not
appear: a scale for a refusal to guess between two states, a layer stack for
consolidation, a refresh for reconciliation. There is deliberately **no
hash-to-icon fallback** — an icon chosen by hashing a title is decoration
wearing the costume of meaning, and it reads as clip-art the moment two
unrelated items land on the same shape.

Two enforcement points, both throwing rather than warning:

- an unknown glyph name throws, because a silently-missing icon looks like a
  layout bug and layout bugs get "fixed" by deleting the slot;
- two items in one section sharing a glyph throws, because at least one of them
  was decorated rather than described.

An item may name its own `icon`; with none, it falls back by the kind of its
first receipt.

## Three rules the code enforces

- **The numbers are never authored.** `render` computes the hero and the strip
  from the window. There is no receipt shape for the figure "12", so a number a
  model typed is a number it could have invented. Want a different figure? Cite
  different items.
- **No identifier ever appears in the body.** No `#412`, no hash, no
  `owner/repo`. `receipts` fails the draft when one does — an identifier in a
  sentence assumes a reader who already knows your repositories.
- **Every item carries at least one receipt.** An item with none is not a
  thinner item, it is an unsupported one, and it is dropped.

## Sections that tend to work

Not a template — grouping is judgment. But these earn their place often:

- **Shipped** — what a user can now do that they could not before.
- **Made safer** — the failure that can no longer happen.
- **Groundwork** — work with no visible surface yet, named honestly as such.

Resist a section per repository. A reader who was not there does not know your
repositories and does not want to.

## What the report never does

- It never lists everything. The line exists so the report is a summary.
- It never counts activity as achievement. Sessions and commits are context;
  releases and merged work are the story.
- It never fills a thin week. A window where little shipped produces a short
  report, and a short honest report is the correct output — a giant zero in the
  hero slot is not printed, the prose says it.

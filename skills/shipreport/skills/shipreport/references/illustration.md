# The card illustrations

Every card carries **one small original line-art scene, composed for that card**.
This is the same contract devlog uses for its covers, one level smaller, and it
exists for the same reason: a reader scrolling a summary needs something to look
at that could only belong to *this* item.

`scripts/lib/art.mjs` refuses the ways the slot rots. It never draws — a picture
this repo could generate would be the same picture every time, which is the
failure the whole idea is meant to avoid.

## The point: depict the mechanism, not the topic

**A card whose art is a generic icon has failed, however tidy the icon is.** The
title already says what the item is. The drawing's job is to show *how the thing
actually worked or failed*.

Before drawing, do this step explicitly:

1. Read the item's title, its text, and the artifact behind its receipt.
2. Name the one concrete mechanism — not the product, not "a bug fix", but the
   specific moment: *two versions and a selector that picked the lower one*, *a
   chain where every link reports green and the last one is missing*, *eight
   near-identical copies collapsing into one definition*.
3. Draw that, in ink line work: lines, arcs, polygons, ticks, small labels.

**No two cards may look alike.** The validator enforces this on a normalised
fingerprint, but the real test is the eye: a card about reconciling two lists and
a card about consolidating eight copies must not both be "some rectangles with
arrows". If your instinct is a circle, a checkmark or a generic box, go back to
step 2 — you have not found the mechanism yet.

## The frame

- **`viewBox="0 0 320 130"`** exactly, on every card. One shared frame is what
  lets nine scenes read as one publication instead of nine stickers.
- Land key points on a **10-unit grid**. Not the shapes — the *key points*. It
  fixes near-misses and uneven rhythm without flattening the drawing.
- **Fill the frame.** The ink should span most of the 320 width and reach toward
  both the top and bottom of the 130. A thin band of marks floating in the middle
  reads as a placeholder. Nothing checks this mechanically; it is on you and it
  is obvious by eye.

## Ink only — the accent is already spent

The sheet's whole accent budget is two moments: the stamp and the hero figure
(`press/brand/laws.md` §1). Nine orange drawings would be exactly the "whole row
of things" the law forbids, so **card art is ink only**.

Concretely: paint attributes may be `currentColor` or `none` and nothing else.
The validator rejects any colour literal, because a hex in a hand-written file is
a brand value written down in a second place — the thing press exists to end.

Weight and texture come from what is available without colour:

| Want | Use |
|---|---|
| emphasis | a heavier stroke (`stroke-width` 2.5–3) |
| recession | a thinner stroke (1) or a dashed line |
| "this one is wrong" | a dashed outline, a gap, a struck-through mark |
| "this one is chosen" | a solid heavy mark against thin neighbours |
| labels | `<text>` at 9–11 units, mono, sparingly — see the budget below |

## The label budget, corrected by measurement

This file used to say **2–4 words total** per scene. Three graded runs rejected
that number: 8 of 10 scenes in the third exceeded it, and several of those are
among the best cards in the sheet — `higher, unread` against `lower, dispatched`
*is* the mechanism on the release card, and no drawing carries it alone.

So the honest budget is **one short label per element the scene needs named,
around six to twelve words in total.** Past that, cards get cluttered: a
twenty-three-word scene in that run wrapped a label onto two lines and read as a
diagram with a caption stuck to it.

**What actually breaks is placement, not word count.** The one visibly broken
card in that run had a *twenty-three character* label — well inside any budget —
sitting two units above a rectangle, so it struck through the geometry. Before
you commit a scene, trace where each `<text>` baseline lands: a label needs its
own empty band, not a gap that happens to look empty in the markup.

**There is deliberately no validator for this.** Word count is a proxy for
clutter, and a check on it would refuse the eight-short-label card that reads
perfectly while still passing the one that collides. A gate that fires on the
wrong cases teaches people to work around it — this repo has already paid for
that lesson once, when the receipts gate called the phrase "plus/minus" a
repository name.

## What the validator refuses

| Refusal | Why |
|---|---|
| no art on a card | the slot is not optional |
| not a single `<svg>` | one scene per card |
| a colour literal | a brand value written down twice |
| `<script>`, `<image>`, `<foreignObject>`, external `<use>`/`url()`, inline handlers | the sheet is self-contained and inert |
| fewer than 5 drawing elements | a lone shape is a placeholder, not a scene |
| a missing/other `viewBox` | the shared frame is the thing that makes them a set |
| two cards with the same fingerprint | two cards may never look alike |

The fingerprint normalises whitespace and numeric jitter, so nudging a
coordinate does not launder a duplicate.

## A worked example

Item: *"The release tool could tag the wrong version and call it a success."*

- **Topic** (wrong): "a release tool" → a rocket. Says nothing.
- **Mechanism** (right): two branches each carrying a version, one state name
  collapsing both facts, and the selector landing on the *lower* rung while
  reporting success.
- **Drawing**: a short vertical ladder with two labelled rungs, a selector arm
  pointing at the lower one, a heavy bar now blocking the arm, and a tick that
  used to sit at the end — drawn dashed, because it was the lie.

That drawing would look wrong on any other card in the report, which is the
whole test.

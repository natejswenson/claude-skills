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
geometry (via Playwright, already in the pipeline) and refuses to render if (a) the
agent's rendered `#hero-zone` element doesn't match the fixed `HERO_ZONE` bounding box
within a small tolerance, or (b) a catalog icon overlaps the hero zone. (Round 3
correction: an earlier draft of this design claimed the fixed bounding box itself was
geometry-checked, but the guard as specified only ever compared catalog icons against
whatever `#hero-zone` rect the agent happened to draw — an agent could draw a tiny
`#hero-zone` in a corner, trivially clear the catalog-overlap check, and the "fixed
box" would never actually be verified. Check (a) closes that gap; see Component 3.) All
~51 already-published covers get regenerated under the new system.

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
cover/image tooling, performance, parsing, caching, UI, networking — **round 5 fix**: an
earlier draft's parenthetical only enumerated 19 of the stated 20 domains; "networking" is
added here so the list actually enumerates all 20). Each icon is real inline SVG
(24×24 viewBox, stroke-only, `currentColor`) — recolors for either `#ededed` or the
`#fff503` accent by CSS `color`, never fill. A topic→icon cheat-sheet table lets the
agent look up a concept instead of re-deriving one. Explicitly for
**secondary/accent** elements only, and — **round 4 clarification, resolving a fatal
conflict with the geometry guard (see Component 3, AMB-CQ-2)** — only *outside*
`#hero-zone` entirely: a small accent glyph next to the kicker/title area above the hero
zone. Catalog icons are never placed inside `#hero-zone`, in any composition slot,
including the two-node slot — see the corrected slot definitions in Component 2. There is
no "sanctioned catalog icon inside the hero zone" case anywhere in this design; a catalog
icon overlapping the hero zone is always a violation, never a legitimate composition
choice, which is what lets `checkHeroZoneOverlap`'s binary any-intersection rule (Component
3) stay both simple and correct.

**Round 5 addition: accent-icon placement geometry, and reconciliation with the
terminal-glyph convention.** The accent icon's rendered rect must stay entirely above
y:400 — a 25px buffer above `HERO_ZONE`'s y:425 top edge, snapped to the same grid — so a
correctly-placed accent icon cannot clip past the hero zone's top edge and false-positive
`checkHeroZoneOverlap`'s zero-tolerance intersection check (Component 3). Concretely: the
accent icon renders at its native 24×24 catalog size, positioned in the kicker/title area
with its bottom edge no lower than y:400 and its horizontal position free within the
kicker's existing layout — this is prose guidance, not mechanically enforced (the same
"outer box checked, interior/adjacent placement is not" split already named elsewhere in
this design), but it gives the agent an unambiguous, grid-aligned target instead of a bare
"near"/"above" instruction. **Clarification: it is the icon's bottom-edge position, not
its own dimensions, that snaps to the grid.** The icon's native 24×24 size is not itself
altered to fit the 25px grid (24 does not evenly divide 25, so the icon's top edge will
not generally land on a grid line even when its bottom edge does) — only the y:400
placement constraint on the bottom edge is the grid-aligned point, and that's sufficient
on its own to keep the icon clear of the hero zone. Separately: `style-guide.example.md`'s Typography section
already sanctions terminal/code aesthetic glyphs ($, >, //, brackets) as small accents in
that same kicker/title area. This design treats the two as distinct, non-conflicting
accent conventions the agent chooses between per post — a typographic glyph accent or a
catalog-icon accent, never both in the same spot — rather than one superseding the other;
`style-guide.example.md` is updated to state this explicitly alongside the accent icon's
placement rule above.

**Round 7 correction (fixes a fatal vacuity in COVER-Q-12's check, plus adds a missing
anchor string).** The two round-5 placement-geometry phrases above are written as exact
literal strings specifically so they can be grepped for without collapsing onto COVER-Q-2's
unrelated `HERO_ZONE`-box literal (`x:150 y:425 width:1300 height:400`) — a bare-number
check for "400" and "25px" would pass automatically off COVER-Q-2's own required text
regardless of whether this accent-icon paragraph exists at all, which is exactly the gap
round 7 closes (a prior round's COVER-Q-12 check did exactly this and was vacuous as a
result). `image-style/style-guide.example.md` and/or `SKILL.md` must therefore state,
verbatim, the phrases **"bottom edge no lower than y:400"** and **"25px buffer above"**
when documenting the accent-icon placement rule — both phrases already appear worded this
way in this paragraph above, and the style-guide/SKILL.md prose is expected to match that
exact wording, not paraphrase it. The "never both at once" reconciliation similarly gets an
exact anchor rather than an abstract description: `image-style/style-guide.example.md`
and/or `SKILL.md` must state, verbatim, the sentence **"Never combine the catalog-icon
accent and the terminal-glyph accent in the same cover."** (**Round 9 correction:** an
earlier draft of this sentence narrowed this to `style-guide.example.md` specifically,
inconsistent with the "and/or SKILL.md" scope COVER-Q-12's contract verification and the
`SKILL.md` integration_point already use for every other phrase in this rule; corrected here
to match.) COVER-Q-12 (contract) greps for these exact strings — see the corrected
Invariants bullet below — rather than for bare numbers or a paraphrased description of
intent.

**2. Hero-zone grid contract** — added to `image-style/style-guide.example.md` (the
repo-tracked source of truth; `devlog init` copies it verbatim to the installed
`style-guide.md`, so the installed copy inherits this automatically): a fixed hero bounding box
`x:150 y:425 width:1300 height:400` on the 1600×900 canvas (below the existing
kicker/title area), a 25px coordinate grid every hero shape's key points must snap to
(fixes the "no rhythm/near-misses" failure mode), and **two** named composition slots the
agent picks from per post: **single centered hero** (one freehand mechanism, nothing else,
inside the hero zone) and **two-node before/after** (a left node, a right node, a
connecting line, all three elements freehand — **round 4 correction**: earlier drafts
allowed catalog icons as the two nodes; the nodes are now always freehand shapes, never
catalog icons — for posts about a transformation or a fix). **Round 6 correction (fixes a
self-contradiction): the optional kicker-area accent-icon toggle from Component 1 is
available for EITHER slot, not nested exclusively under "single centered hero."** The
accent icon is placed entirely outside `#hero-zone`, near the kicker/title area — nothing
about that external placement depends on which composition sits inside the hero zone, and
nothing about the two-node slot's own bounding-box math conflicts with an icon placed near
the kicker/title area (that area is entirely outside `HERO_ZONE` regardless of which slot
occupies it). The agent decides per post, independently of which hero-zone composition it
picked, whether to add the accent glyph (catalog-icon or terminal-glyph, per Component 1).
This independence was already the stated intent of the round 5 addition below — earlier
drafts of this enumeration (and the contract's `AMB-CQ-5`) nested the toggle under "single
centered hero" only, contradicting that stated intent; this correction makes the
enumeration match the intent everywhere it's stated. These are placement/proportion
guidance, not literal templates — the actual shapes inside each slot are still freehand
per post.

**Round 7 addition, resolving a compositional-coupling ambiguity round 6 left open
specifically for the two-node slot.** Round 6 established the accent icon is available for
either slot with no change to its own placement; but the two-node slot has two focal points
(a left node, a right node) rather than one, and the accent icon's default position — near
the kicker/title area, whose position is composition-dependent (`style-guide.example.md`
describes the kicker as sitting "in the remaining negative space," not a fixed corner) —
could easily be read as visually paired with whichever node happens to sit nearest it, an
unintended compositional coupling the agent never chose. This design resolves the ambiguity
explicitly rather than leaving it to per-agent guessing: when the accent icon is used with
the two-node slot, it must be treated as decoration only, never compositionally paired with
either node — **the accent icon's presence must not be read as belonging to either node; it
sits in the kicker/title area purely as a page-level decoration, unrelated to the two-node
layout below it.** `style-guide.example.md`/`SKILL.md` state this rule alongside the
two-node slot description so an agent placing the accent near either node's side of the
kicker area doesn't infer a "before"/"after"-node relationship that was never intended.
**Round 8 correction:** an earlier draft of this paragraph justified the rule by citing a
"top-left kicker convention per the existing style guide" — no such fixed-position
convention exists there; the style guide's actual language places the kicker "in the
remaining negative space," which is composition-dependent, not fixed to a corner. The
underlying decision (accent is decoration-only for the two-node slot) is unaffected by this
correction and stands on the reasoning above, not on the now-removed citation.

**Round 5 correction: "hero + supporting element" merged into "single centered hero,"
rather than kept as a third slot.** Round 4 moved the "hero + supporting element" slot's
accent icon entirely outside `#hero-zone` (see AMB-CQ-2 and the guard description below).
That left the slot's hero-zone-*internal* content — one freehand mechanism, nothing else —
identical to "single centered hero," with the only remaining difference being an external,
title-area accent decoration that has no mechanical link to which slot was "chosen." Since
a slot distinction that lives entirely outside the box it's supposed to describe isn't a
real composition difference, this design folds the accent icon into "single centered hero"
as an optional toggle instead of preserving a nominally separate slot: the agent decides
per post whether to add the kicker-area accent (catalog-icon or terminal-glyph, per
Component 1), independent of which hero-zone composition — single mechanism or two-node —
it picked. This reduces the design to **two** genuinely distinct hero-zone composition
slots, down from the three named in earlier rounds. Every other place in this document and
the accompanying contract that previously enumerated "three named composition slots" is
updated to say two.

**Round 4 correction, why the two slots above changed.** Round 3's exact-match
`#hero-zone` check (Component 3) and the pre-existing binary "any catalog icon
intersecting `#hero-zone` throws" rule (`checkHeroZoneOverlap`, AMB-CQ-2) together mean
the mechanical guard cannot tell a *sanctioned* catalog icon sitting inside the hero zone
(e.g. the old "secondary icon right" reading of "hero + supporting element," or a catalog
icon used as one of the two-node slot's nodes) apart from the exact *violation* the guard
exists to catch (catalog icons standing in for the required bespoke hero) — both are
geometrically identical: a `[data-catalog-icon]` rect inside the `#hero-zone` rect. Rather
than weaken the geometry guard (which round 3 hardened specifically to close a real
exploit) or add a new self-labeling escape hatch that an agent could apply just as easily
to an actual violation, this design resolves the conflict by narrowing the slots instead:
**no catalog icon is ever placed inside `#hero-zone`, in any slot, full stop.** The
mechanism and the two nodes are always freehand SVG the agent draws itself; a catalog icon
may only appear as the small accent glyph described in Component 1, and only outside the
hero zone. This keeps both mechanical checks (exact-match geometry, binary overlap)
meaningful exactly as specified, at the cost of the "hero + supporting element" and
"two-node before/after" slots losing the ability to use a catalog icon *inside* the box —
they can still use one just outside it (next to the kicker), and their freehand-shape
composition guidance is otherwise unchanged.

**Round 5 note:** this is exactly the redundancy that round 5 resolves by merging "hero +
supporting element" into "single centered hero" (see above). Once its only remaining
hero-zone-internal content is "one freehand mechanism, nothing else" — identical to
"single centered hero" — it was no longer a distinct slot, just the same slot with an
optional external accent, and is renamed/merged accordingly rather than kept as a
separately-named third option.

**What's mechanically checked vs. prose-only.** The outer bounding box — `#hero-zone`
being drawn at exactly `x:150 y:425 width:1300 height:400` — is mechanically enforced
by `render_cover.mjs` (Component 3, round 3 addition). The 25px grid that a hero
shape's *interior* key points should snap to is not, and structurally cannot be short of
parsing the agent's freehand shape coordinates out of arbitrary SVG/CSS — it stays
prose guidance in the style guide, verified only by human review of rendered covers
during backfill sampling (see Backfill/Verification). Naming this split explicitly so
neither file overclaims that grid-snapping itself is geometry-checked.

Residual risk, acknowledged and accepted: two named slots applied across 50+ posts are
themselves a (much weaker) convergence force in the same direction as the rejected
ghostwriter template family — a reviewer could plausibly start recognizing "the two-node
one" as a repeating type the way ghostwriter's cards read as a family. The risk is
accepted because the two mechanisms aren't the same magnitude: ghostwriter fixes the
complete layout and swaps in icons only, while a slot here fixes nothing but a bounding
box and a coarse left/right/center split — the shapes, icon choices, and connecting
geometry inside the slot are still fully freehand per post. If the per-project sample
review (see Backfill) starts turning up same-slot-same-composition repeats in practice,
that's the trigger to revisit, not something this design assumes away up front.

**Final state, for implementers (round 9 addition — consolidates the five stacked
round-N corrections above into one plain summary, rather than requiring an implementer to
chain them mentally):** two named hero-zone composition slots, **single centered hero**
and **two-node before/after**; the kicker-area accent-icon toggle (catalog-icon or
terminal-glyph, never both) is available for either slot, as an independent per-post
decision unrelated to which slot is chosen; and for the two-node slot specifically, the
accent is decoration-only and must not be read as paired with either node. The round-by-round
correction notes above are kept as-is for anyone who needs to understand *why* the design
arrived here — this paragraph exists only to state *where* it landed, in one place.

**3. Geometry-enforced hero-zone guard** — `lib/render_cover.mjs` change. Every catalog
icon usage in composed HTML must be wrapped in a container carrying
`data-catalog-icon="<name>"`. Immediately before the screenshot (after
`document.fonts.ready`, before `page.screenshot()`), the render step queries
`getBoundingClientRect()` on every `[data-catalog-icon]` element and on a `#hero-zone`
element (the hero's own bounding box, drawn by the agent to match its composition slot).
**`#hero-zone` is structurally mandatory, not an opt-in marker**: if it is absent from the
composed HTML, `renderCoverImage()` throws before ever reaching the screenshot — a missing
hero zone is treated as a malformed composition, the same class of hard failure as a
missing font, not a silent skip of the geometry check. The guard queries with
`querySelectorAll('#hero-zone')` (not `querySelector`) specifically so a malformed
composition with two or more elements sharing that id — which browsers happily render
without complaint — is itself flagged as a failure (count !== 1) rather than silently
resolving to whichever element the DOM would return first.

**Geometry-match check on `#hero-zone` itself (round 3 addition, fixes a fatal gap).**
Round 2's guard only ever compared catalog-icon rects against whatever `#hero-zone` rect
the agent happened to draw — it never checked the `#hero-zone` rect against anything
fixed. That meant an agent could draw `#hero-zone` as a tiny box tucked in a corner,
trivially clear the catalog-overlap check (nothing would be anywhere near it), and the
"fixed grid/bounding-box contract" this whole design is named for would never actually be
enforced — exactly the prose-only failure mode this redesign exists to close. The fix:
once exactly one `#hero-zone` element is confirmed to exist, the guard compares its
`getBoundingClientRect()` against the exported `HERO_ZONE` constant
(`x:150 y:425 width:1300 height:400`) on all four values (x, y, width, height), each
allowed to differ by **at most 2px** (a fixed, documented tolerance absorbing Chromium's
own subpixel/rounding behavior in `getBoundingClientRect()`, not a meaningful size/position
allowance). Any coordinate outside that tolerance throws a descriptive error before the
catalog-overlap check even runs. **Deliberately exact-match, not containment**: a
containment check (hero-zone rect ⊆ HERO_ZONE) would *not* close the reported gap — a
tiny corner box is still "contained within" the larger fixed box, so containment alone
would let the exact exploit described above pass. Exact match (within the 2px rounding
tolerance) is the only check that actually forces every post's hero into the identical,
comparable box the contract claims to guarantee. This is a third structural throw
condition alongside missing/duplicate `#hero-zone` (see `checkHeroZoneOverlap`'s
dual-outcome behavior below) — it throws directly from the helper, before the function
would otherwise proceed to compute catalog-icon overlap.

**Round 4 clarification: the binary overlap rule (AMB-CQ-2) has no sanctioned exception,
by design.** A prior round's slot descriptions (Component 2) implied a catalog icon could
legitimately sit inside `#hero-zone` — as the "hero + supporting element" slot's secondary
icon, or as one of the "two-node before/after" slot's two nodes. That reading directly
conflicted with this guard: since `checkHeroZoneOverlap` throws on *any*
`[data-catalog-icon]` rect intersecting `#hero-zone`'s rect with no tolerance (AMB-CQ-2),
a sanctioned catalog icon inside the hero zone would be geometrically indistinguishable
from the exact violation the guard exists to catch ("two catalog icons connected by a
line" standing in for the hero) — both are just a catalog-icon rect inside the hero-zone
rect, and there is no mechanical way to tell them apart. Component 2 is corrected in this
round to remove the conflict at the source: no composition slot ever places a catalog icon
inside `#hero-zone`. The mechanism and both two-node shapes are always freehand; a catalog
icon appears, if at all, only as the Component-1 accent glyph outside the hero zone. With
that correction, "a catalog icon overlaps `#hero-zone`" and "an agent misused the catalog"
are the same event — there is no longer any sanctioned case the binary rule would need to
carve out, which is exactly why AMB-CQ-2's no-tolerance, no-whitelist design stays correct
rather than needing a containment/allowlist mechanism.

**What this guard does and does not close.** This is a real pixel-geometry check against
actual rendered layout, not a string/regex match. As of round 3 it closes two distinct
gaps: it reliably catches the case where an agent *uses the catalog* incorrectly — e.g.
composing "two catalog icons connected by a line" and mislabeling that as the hero, or
letting a legitimate secondary icon drift into the hero's rect — **and** it now catches an
agent drawing `#hero-zone` at the wrong position/size entirely (the tiny-corner-box
exploit above), because that box is checked against the fixed `HERO_ZONE` constant
regardless of whether any catalog icons are nearby. It does **not**, and structurally
cannot, catch two remaining things: (1) an agent that never touches the catalog at all and
instead free-hands inline SVG shapes that merely *resemble* catalog icons inside a
correctly-sized `#hero-zone` — those elements carry no `data-catalog-icon` attribute, so
the guard has nothing to inspect; and (2) whether the hero shape's *interior* key points
actually snap to the 25px grid (Component 2) — the guard checks the outer box only, not
the freehand geometry drawn inside it. Closing either of those would require a
visual-similarity classifier against the catalog's own icon shapes, or parsing arbitrary
agent-authored SVG coordinates out of the composed HTML; this design does not attempt
either, and the claim made here is narrower: the guard defends against catalog misuse and
wrong-box placement, not against a lookalike freehand drawing that avoids the catalog by
construction or against interior grid non-compliance. The residual gap is why
`cover-custom-illustration` (prose, human-reviewed at publish time) stays in force
alongside this mechanical guard rather than being superseded by it. `render-cover`
surfaces the mandatory-hero-zone failure, the geometry-mismatch failure, and the overlap
failure all as a normal composition failure (same shape as a missing-font error): the
agent adjusts and retries, publish is never blocked silently.

**4. Cover-context data surface** — `lib/cover_gen.mjs`'s `loadStyleGuide()` widens its
return from today's plain string to `{ text, iconCatalog }`, so the agent gets the icon
catalog in the same `cover-context` call (no new CLI flag). **This widened return shape is
not self-updating at the call site** — `bin/devlog.js`'s `cmdCoverContext` today does
`styleGuide = loadStyleGuide()` (currently a plain string, per the existing implementation
and `tests/cover_gen.test.mjs`) and references that bare `styleGuide` variable in **two**
separate `emitJSON` calls, not one: a success-path call after `getRecentCovers()` resolves
(`emitJSON({ styleGuide, references })`) and a catch-block error-path call when
`getRecentCovers()` throws (`emitJSON({ styleGuide, references: [], error:
'reference-lookup-failed', message: e.message })`). If `cmdCoverContext` is not explicitly
updated to destructure the new `{ text, iconCatalog }` shape, the CLI's existing
`styleGuide` JSON field silently changes from a string to an object for every caller of
`cover-context` — a breaking change to an already-shipped command, not an additive one.

**Round 6 correction: `cmdCoverContext` is not the only call site that breaks.**
`tests/cover_gen.test.mjs` also calls `loadStyleGuide()` directly, in its own test
(`'loadStyleGuide reflects whether the real install exists at CONFIG_DIR'`), and asserts
`typeof text === 'string'` on the **raw** return value. Once the return shape widens to
`{ text, iconCatalog }`, that assertion breaks — `typeof` an object is `'object'`, not
`'string'` — on any machine where the style guide is actually installed (the branch of
that test that exercises the success path, not the try/catch's error branch). This test
must be updated in the same change to destructure the new shape before asserting, e.g.:

```js
const { text } = loadStyleGuide();
assert.equal(typeof text, 'string');
```

**The fix, stated explicitly rather than implied, and covering BOTH `emitJSON` call sites
inside `cmdCoverContext` (round 3 correction — an earlier draft of this design only
rewrote the success-path call, leaving the catch block referencing a `styleGuide`
identifier that no longer exists post-destructure; that's a `ReferenceError` thrown from
inside an already-executing catch block — uncaught, crashing the CLI process — instead of
the documented `reference-lookup-failed` JSON error):** `cmdCoverContext` has **two
separate try/catch blocks**, not one — confirmed against the real implementation
(`bin/devlog.js`): the first wraps only `loadStyleGuide()` and catches a
style-guide-missing error (returning early on failure); the second wraps only
`getRecentCovers()` and catches `reference-lookup-failed`, and it is this second try's
success path that contains the `emitJSON({ styleGuide, references })` call. Because
`text`/`iconCatalog` must remain readable both after the first try succeeds *and* inside
both branches of the second try/catch, **round 6 correction (fixes an internal
inconsistency in this design's own previous draft, which reintroduced the exact scoping
bug round 3 already fixed for the catch-block case, just one scope level up): `text` and
`iconCatalog` must be declared with `let`, OUTSIDE both try blocks — not with `const`
inside the first try** — and assigned via a bare destructuring assignment,
`({ text, iconCatalog } = loadStyleGuide());`, inside the first try. A `const` destructure
inside the first try would scope `text`/`iconCatalog` to that try block alone, leaving
them undefined (in practice, an uncaught `ReferenceError`) by the time the second try's
`emitJSON` calls run — the exact bug class this design already closed once for the
catch-block case. The code block below is the authoritative version; it — not the
now-corrected prose above it — is what an implementer should follow:

```js
let text, iconCatalog;
try {
  ({ text, iconCatalog } = loadStyleGuide());
} catch (e) {
  emitJSON({ error: 'style-guide-missing', message: e.message }, 1);
  return;
}

try {
  const references = getRecentCovers({ /* ...unchanged... */ });
  emitJSON({ styleGuide: text, references, iconCatalog }); // success path
} catch (e) {
  emitJSON({
    styleGuide: text, references: [], error: 'reference-lookup-failed',
    message: e.message, iconCatalog,
  }); // error path — was previously left un-fixed
}
```

`styleGuide: text` (still a plain string, byte-identical to today's behavior in both JSON
shapes) with `iconCatalog` added as a new sibling field in both the success and error
JSON payloads. Existing callers that only read `styleGuide` see no change in its type or
content on either path; only callers that also read the new `iconCatalog` field see
anything new. No change to
`render_cover.mjs`'s core rasterization (viewport sizing, font-loading/embedding, PNG
quantization) beyond the new pre-screenshot geometry check — but that check itself is a
real, intentional extension of `renderCoverImage()`'s documented throw contract, not an
out-of-scope-adjacent addition. The current implementation's docstring states it "throws
on exactly three realistic failure modes" (render timeout, Chromium not installed, a
missing/unreadable font); this design adds a fourth, structural failure mode covering
`#hero-zone` problems collectively — missing `#hero-zone`, duplicate `#hero-zone`, the
`#hero-zone` rect not matching the fixed `HERO_ZONE` bounding box within tolerance (round 3
addition), or a catalog-icon/hero-zone overlap — and the docstring must be updated in the
same change to say so — this is a deliberate widening of an already-tested,
already-documented behavioral contract, called out explicitly rather than described as a
side addition that leaves the contract unchanged.

## Backfill (all ~51 existing covers)

**Correction (round 2): `backfill-covers list` cannot be used unchanged for this backfill.**
The actual filter in `cmdBackfillCovers` (`bin/devlog.js`) is
`merged.filter((e) => e && !e.cover)` — it lists only entries *missing* a cover, which is
the right behavior for its original purpose (find posts that never got a cover at all).
But every one of the ~51 real entries in `daily-dev-log` already has `cover: true` from the
0.8.1 batch this design is regenerating. Run `backfill-covers list` today against the real
repo and it returns `[]` for every project — there is nothing to iterate over, and the
"uses the existing CLI flow unchanged" framing from the prior draft was simply wrong for
this use case.

**Fix: a new `--all` flag on `backfill-covers list`.** `cmdBackfillCovers`'s `list`
subcommand gains a boolean `--all` option (default `false`, preserving today's
missing-cover-only behavior for anyone still using this command for its original purpose).
**Minor, round 3 addition:** the confirmed real implementation's hardcoded usage-error
string (thrown when the subcommand isn't `list`: `'Usage: devlog backfill-covers list
--clone <cloneDir> [--project <key>] [--out <staging-dir>]'`) does not currently mention
`--all` and must be updated in the same change to `'Usage: devlog backfill-covers list
--clone <cloneDir> [--project <key>] [--out <staging-dir>] [--all]'` — otherwise the CLI's
own error message documents an incomplete flag set for the exact command this design
depends on.
When `--all` is passed, the `!e.cover` filter is skipped entirely and every manifest entry
is listed regardless of cover status — this is what the backfill in this design actually
needs (`devlog backfill-covers list --clone <dir> --all [--project <key>] [--out
<staging-dir>]`). This is a real, small code change to `bin/devlog.js` (one added
`parseArgs` option plus one conditional around the existing `.filter()` call), not
something prose alone can paper over, and is tracked as a new integration_point in the
contract. The `--project`/`--out` resume-support filters compose with `--all` unchanged —
`--all` only changes which candidates enter the list before those two run.

The rest of the flow is unchanged: `backfill-covers list --all` → per-entry compose against
the new style guide/catalog/grid → `render-cover` into staging (now enforcing the geometry
guard) → `commit-covers <staging-dir>` with `--force` (bulk overwrite, since every entry
already has a cover from the prior batch). Regeneration is parallelized across subagents by
project (6 projects, 51 posts), mirroring the pattern already used for the original 49-post
redesign earlier this session — the count moved from 49 to 51 because 2 more posts
published in the interim (one new entry in the `devlog` project itself, plus the new
`personal` project's first entry), so both numbers are correct for the point in time each
refers to, not a typo.

**Verification**, revised to actually detect the non-negotiable requirement ("two
different posts should never produce visually similar covers"): comparing exactly one
sampled cover per project yields zero within-project pairs and so cannot detect
within-project repetition at all — the failure mode that matters most, since a single
project's posts share the most topical/structural overlap. Instead, sample **2-3 covers
per project** (not 1), specifically so the reviewer can eye-check those covers against
each other for repeated composition-slot choice, repeated icon selection, or repeated
layout within that project — not just judge each sampled cover in isolation. This is
still **not** full manual review of all 51, and **not** fully automated: the new geometry
guard mechanically catches the structural regressions (catalog-icon-as-hero, wrong-box hero
placement) a human reviewer might not reliably spot across 51 covers, while the small
multi-cover sample per project is what's actually suited to catching "these two look like
the same template" — a one-cover sample structurally cannot do that job no matter how
carefully it's reviewed. If a sampled cover fails review, or two sampled covers within the
same project read as visually similar, that project's whole batch gets a second pass
before commit.

**Named artifact (round 3 addition, closes a gap):** no new review artifact needs to be
built for this. `render-cover`'s existing `regenerateContactSheet()` (`bin/devlog.js`)
already writes a staging-dir `index.html` grouping every rendered cover by project — it is
called automatically on every successful (and every idempotent re-run) `render-cover`
invocation, and CHANGELOG.md already documents backfill review as happening "via a contact
sheet." This is the artifact used for the per-project 2-3-sample review above: open the
relevant project's section of the staging dir's `index.html` and eyeball the sampled
covers against each other directly in that page. **Owner:** the orchestrating Claude Code
session/agent conducting the backfill performs this review — presenting the relevant
contact-sheet images to the user for the final go/no-go — consistent with how the original
49-post backfill earlier this session was actually reviewed.

**Cross-project pass (round 2 addition).** The non-negotiable rule in
`image-style/style-guide.example.md` is stated generically — "**Two different posts should
never produce visually similar covers.**" — it is not scoped to "same project." All 6 real
projects in `daily-dev-log` are software-release logs whose entries draw on the same
generic technical vocabulary the 20-icon catalog itself is organized around (testing,
CI/CD, config, deploy, auth, monitoring, and so on), so cross-project topical and visual
overlap is a live risk, not a hypothetical edge case — two posts in *different* projects
about, say, "fixed a flaky CI job" are exactly the kind of pair the within-project sample
cannot see, because it only ever compares covers against others from the same project.
After the per-project 2-3-sample pass above, do one additional round: lay out all sampled
covers from all ~6 projects side by side (roughly 12-18 images total, small enough to
eyeball in one pass) and check specifically for cross-project repetition — the same
composition slot, the same icon choice, or the same overall shape reused across projects
that happen to cover similar technical ground. A cross-project match found here triggers
the same response as a within-project match: the affected projects' batches get a second
pass before commit.

**Same named artifact, same owner (round 3 addition):** this pass uses the same
staging-dir `index.html` contact sheet named above — it already groups covers by project
in one page (see `regenerateContactSheet()`'s per-project `<h2>` sections in
`bin/devlog.js`), so "lay out all sampled covers side by side" means scrolling that one
page rather than assembling a second artifact. The orchestrating Claude Code session/agent
conducting the backfill performs this pass too, presenting the relevant contact-sheet
sections to the user for the final go/no-go — the same review flow as the per-project
pass, just widened to look across every project's section in the same page instead of one
project's section in isolation.

**Rollback / partial-failure protocol.** `commit-covers <staging-dir>` stages every
written cover into one `git add . && git commit` (see `cmdCommitCovers` in
`bin/devlog.js`) followed by a single push — the atomic unit for rollback is that one
commit, and `git revert` of it undoes the entire batch cleanly (confirmed against the
actual implementation: covers are only staged into the working PNG files during
generation, nothing is written to the target repo until that single commit). If
generation fails partway through — e.g. one of the 6 parallel per-project subagents dies
before finishing its project's covers — nothing has been committed for any project yet,
because staging happens to a local directory, not the target repo. Re-running
`backfill-covers list --all` is safe to re-run at any point: it only lists manifest entries
and does not mutate state, so a resumed session can re-list, skip already-staged/rendered
entries, and re-render only what's missing before running `commit-covers` once, across
whatever ended up staged.

## Invariants

**Checkable by inspection:**
- `image-style/icons.md` exists (COVER-Q-1) — at the repo-tracked path
  (`skills/devlog/skills/devlog/image-style/icons.md`) and, once a user has run
  `devlog init` locally, at the installed path (`~/.claude/skills/devlog/image-style/`).
  The repo path is what's actually checkable in CI/a fresh checkout; the installed path
  only exists after `devlog init` runs, mirroring how `font.ttf` and
  `style-guide.example.md` already work. Every catalog icon entry has real `<svg>`
  markup (not a placeholder/TODO). Home: `tests/skill_contract.test.mjs`.
- The hero-zone coordinates (COVER-Q-2) (`x:150 y:425 width:1300 height:400`) and 25px grid value are present and
  identical in two places that must never independently drift: the exported
  `HERO_ZONE`/`HERO_GRID_UNIT` constants in `lib/render_cover.mjs` (the values the guard
  actually checks against), and `image-style/style-guide.example.md` — **not**
  `style-guide.md`, which is installer-created at `devlog init` time and does not exist
  in this repo or in CI (confirmed: only `style-guide.example.md` is tracked under
  `skills/devlog/skills/devlog/image-style/`). Because `devlog init` copies
  `style-guide.example.md` to the installed `style-guide.md` verbatim (see
  `cmdInit` in `bin/devlog.js`), keeping the example in sync with the code constants is
  sufficient — the installed copy inherits it automatically at install time, and there
  is nothing further to check in this repo. **Round 5 correction (fixes a round-4 regex
  bug):** the 25px grid value must be checked via the literal substring `25px` — not the
  word-boundary pattern `\b25\b` that round 4 offered as an interchangeable alternative,
  which is broken: `\b` only fires at a transition between a word character and a
  non-word character, and in "25px" the `5`→`p` transition is word-char-to-word-char, so
  `\b25\b` never matches "25px" at all (verified: `/\b25\b/.test("a 25px coordinate
  grid")` is `false`). Nor is a bare substring search for `"25"` acceptable — the
  coordinate `425` already contains `"25"` as a substring, so a naive `grep -o "25"`
  against `image-style/style-guide.example.md` would trivially "pass" whether or not the
  document actually states a 25px grid anywhere. **Round 9 correction (fixes a vacuity the
  round-5 fix didn't anticipate, the mirror image of the bug round 5 itself fixed): the
  bare literal `25px` is no longer sufficient on its own.** Once Component 1's accent-icon
  placement rule (COVER-Q-12) also requires the literal phrase "25px buffer above" to exist
  in this same file, `image-style/style-guide.example.md` contains the substring "25px" in
  two unrelated sentences — the grid-snap rule this invariant is supposed to verify, and the
  accent-icon buffer rule (a different concern entirely, Component 1). A future edit that
  deleted the entire grid-snap sentence while leaving the accent-icon paragraph intact would
  still pass a bare-`25px` check, because the accent-icon text alone satisfies it. The check
  is corrected to target the combined literal `"25px coordinate grid"` instead — the exact
  phrase this design already uses to state the grid rule (Component 2, above: "a 25px
  coordinate grid every hero shape's key points must snap to") — which is unique to the
  grid-snap rule and shares no substring overlap with the accent-icon rule's "25px buffer
  above." **Round 10 tightening (matches the pattern above, applied to the sibling
  coordinate check):** the coordinate check itself must likewise target the combined
  literal `"x:150 y:425 width:1300 height:400"` — the exact `HERO_ZONE` constant format
  already used elsewhere in both documents — rather than four independent checks for
  `150`, `425`, `1300`, `400`. Unlike the grid-value check above, which was deliberately
  hardened onto a combined phrase after two rounds of fixing vacuity bugs, the
  four-separate-numbers form of this check only avoids the same failure mode today by
  coincidence — no other required literal in the file happens to contain one of those bare
  numbers — and offers no structural protection against a future one that does. Home:
  `tests/skill_contract.test.mjs`.
- `skill-invariants.json`'s existing `cover-custom-illustration` entry (COVER-Q-3) (SKILL.md prose:
  "a cover that just re-renders the title in large text is a failure") is preserved
  unchanged, its rationale extended to note it's independent of, not superseded by, the
  new geometry guard — two different regression surfaces (an agent's composition
  behavior vs. a future code edit silently deleting the enforcement), both still worth
  guarding. Home: `tests/skill_contract.test.mjs`.
- **(Part of COVER-Q-4 below, not a separate checkable ID — round 4 correspondence fix:**
  this bullet has no distinct ID of its own in the contract's `invariants.checkable`
  array; it is folded into COVER-Q-4's verification text there. Listed as its own bullet
  here only because it's a distinct documentation-only sub-requirement, not because it's a
  separate contract invariant.**)** `skill-invariants.json`'s top-level `"comment"` field
  currently reads "Prose guardrails in SKILL.md that must survive edits..." — describing
  only the `prose` array's purpose. This change adds a sibling `code` array with a
  different shape and a different target (arbitrary files, not `SKILL.md`), so the comment
  must be updated in the same change to also describe what the `code` array checks and why
  (a one- or two-clause addition, not a rewrite) — otherwise a future reader of the
  top-level comment has no indication the file now guards two different kinds of
  regression via two differently-shaped arrays. Home: `tests/skill_contract.test.mjs` (no
  new test — this is a documentation-only addition inside an already-tracked file, covered
  by the existing "file parses as valid JSON" check).
- New `skill-invariants.json` `code` array (schema extension: entries target a file
  other than `SKILL.md`) with `cover-catalog-hero-overlap-guard`, asserting the
  `getBoundingClientRect`/overlap-throw logic is present in `lib/render_cover.mjs`.
  Concrete entry shape (mirrors the existing `prose` array's `{id, pattern, rationale}`,
  adding one field — `file` — so two implementers can't diverge on what the entry checks
  against):
  ```json
  {
    "code": [
      {
        "id": "cover-catalog-hero-overlap-guard",
        "file": "lib/render_cover.mjs",
        "pattern": "(?:getBoundingClientRect[\\s\\S]{0,400}hero-zone|hero-zone[\\s\\S]{0,400}getBoundingClientRect)",
        "rationale": "The catalog-icon/hero-zone overlap check must stay wired into renderCoverImage() — losing it silently reopens the gap where a catalog icon (or two, connected by a line) can stand in for the required bespoke hero illustration."
      }
    ]
  }
  ```
  **Order-independence (round 2 correction):** the pattern is an alternation that matches
  `getBoundingClientRect` followed by `hero-zone` *or* `hero-zone` followed by
  `getBoundingClientRect`, within 400 chars either way. A single sequential
  `getBoundingClientRect[\s\S]{0,400}hero-zone` pattern would only match an implementation
  that happens to call `getBoundingClientRect()` before referencing `hero-zone` in source
  order — but an equally correct implementation could look up the `#hero-zone` element's
  rect first, then loop calling `.getBoundingClientRect()` per catalog icon afterward, which
  reverses that order in the source text and would permanently fail this invariant against
  correct code. The alternation checks proximity in either order, so it doesn't encode an
  implementation-order assumption the actual code has no reason to honor.
  `file` is resolved relative to the skill root (`skills/devlog/skills/devlog/`), same
  base path `SKILL.md`'s own checks already use. Requires a small extension to
  `tests/skill_contract.test.mjs`'s invariant-checking loop to also read each `code`-array
  entry's `file`, load that file's content, and regex-test `pattern` against it — the same
  mechanism already used for the `prose` array, generalized to a caller-specified file
  instead of a hardcoded `SKILL.md` read. Home: `tests/skill_contract.test.mjs`.
- **(Round 6 addition, closes a coverage gap — `COVER-Q-12` in the contract; round 7
  correction fixes a fatal vacuity in the original check; round 8 folds in a fourth phrase
  covering the two-node decoration-only rule.)** The round-5 accent-icon placement rule
  (bottom edge no lower than y:400, a 25px buffer above `HERO_ZONE`'s y:425 top edge), the
  "never both at once" reconciliation with the existing terminal-glyph accent convention,
  and the round-7 two-node decoration-only rule are all present, verbatim, in prose in
  `image-style/style-guide.example.md` and/or `SKILL.md`. **Round 7 fix:** the original
  check greped for the bare numbers `400`/`25px`, but COVER-Q-2 independently mandates the
  same files contain the `HERO_ZONE`-box text `x:150 y:425 width:1300 height:400`, which
  already contains both `400` and `25px` as substrings — meaning the bare-number check
  passed automatically regardless of whether the accent-icon placement rule was present at
  all, and a future edit deleting the entire accent-icon paragraph would not have been
  caught. The check is corrected below to target text unique to the accent-icon rule: it
  greps for two exact literal phrases — `"bottom edge no lower than y:400"` and `"25px
  buffer above"` — neither of which is a substring of COVER-Q-2's required `HERO_ZONE`-box
  literal, plus the exact reconciliation sentence `"Never combine the catalog-icon accent
  and the terminal-glyph accent in the same cover."` **Round 8 fix (closes a coverage gap
  round 7 left open):** round 7's own two-node decoration-only rule (Component 2, the
  paragraph above) was bolded the same way as these other grep-anchored sentences but was
  never actually added as a grep target here — nothing would catch a future edit dropping
  that rule while COVER-Q-12 kept passing on the other three phrases alone. The check is
  extended with a fourth exact literal phrase: `"the accent icon's presence must not be
  read as belonging to either node"` — already the exact wording used in Component 2's
  round-7 paragraph, so this is a coverage fix, not new prose. All four phrases are
  checkable by inspection only — a grep-based check confirming the exact prose exists —
  same category as COVER-Q-2/COVER-Q-3 above (the geometry itself can't be mechanically
  parsed from freehand coordinates, as already noted; this invariant only asserts the PROSE
  RULE exists in the guide, verbatim, not that any rendered cover honors it). Without this,
  every other prose rule in this design already has a checkable invariant (COVER-Q-2 for
  hero-zone coordinates/grid, COVER-Q-3 for cover-custom-illustration) but this one had
  none — a future edit could silently drop the accent-icon margin rule, the "never both at
  once" rule, or the two-node decoration-only rule from either file and nothing would catch
  it. Home: `tests/skill_contract.test.mjs`.

**Testable:**
- `render_cover.mjs`: a synthetic HTML fixture with a `[data-catalog-icon]` element
  positioned inside `#hero-zone`'s rect must cause `renderCoverImage(html, { width, height
  })` — passing valid, positive-integer `width`/`height` so the call actually reaches the
  overlap-check logic rather than failing width/height validation first — to throw
  (COVER-Q-5); a fixture with the same icon positioned outside the hero zone must render
  successfully (COVER-Q-6).
  **Round 4 correction (closes a precondition gap left over from round 3):** in both of
  these fixtures, the `#hero-zone` div itself must be positioned/sized at the exact
  `HERO_ZONE` coordinates (`x:150 y:425 width:1300 height:400`, within the documented 2px
  tolerance) — since round 3's geometry-match check runs *before* the overlap check inside
  the same helper (`checkHeroZoneOverlap`, Component 3), a fixture whose `#hero-zone` is
  anywhere else would throw the geometry-mismatch error first, never reaching the
  overlap-check logic these two cases exist to test, which would mean the test throws for
  the wrong reason (or throws in the "must render successfully" case, which is the exact
  false failure this correction prevents). This mirrors how COVER-Q-11's own fixtures are
  already described below.
  Two further, structurally distinct cases (split rather than bundled into one test, so a
  future regression in only one sub-case still fails traceably — round 3 correction): (a) a
  fixture with **no** `#hero-zone` element at all must throw (mandatory, not skip-silently
  — see Component 3) (COVER-Q-9a); (b) a fixture with **two** elements sharing the
  `#hero-zone` id must also throw (duplicate, not silently resolved to the first DOM match)
  (COVER-Q-9b). Home: `tests/render_cover.test.mjs`.
- `render_cover.mjs` (round 3 addition — geometry-match): a fixture whose single
  `#hero-zone` element is drawn at a position/size other than the fixed `HERO_ZONE`
  constant (`x:150 y:425 width:1300 height:400`) beyond the documented 2px tolerance — for
  example a small box tucked in a corner — must cause `renderCoverImage(...)` to throw a
  distinct geometry-mismatch error, even with zero catalog icons anywhere near it (closing
  the fatal gap where the overlap-only check could never detect a wrongly-sized/positioned
  hero zone). A fixture whose `#hero-zone` matches the fixed box exactly (or within the 2px
  tolerance) must render successfully. Home: `tests/render_cover.test.mjs`.
- `cover_gen.mjs` (COVER-Q-7): `loadStyleGuide()`'s (or a new sibling function's) returned data
  includes the icon catalog content when `image-style/icons.md` exists, and degrades the
  same way the existing missing-style-guide path does when it doesn't (never blocks
  publish — existing `cover-never-blocks-publish` invariant, unchanged). **Round 6
  correction: this is not a pure addition to the test file.** The existing test
  `'loadStyleGuide reflects whether the real install exists at CONFIG_DIR'` in this same
  file calls `loadStyleGuide()` directly and asserts `typeof text === 'string'` on its raw
  return value — that assertion must be updated in the same change to destructure the new
  shape first (`const { text } = loadStyleGuide(); assert.equal(typeof text, 'string');`),
  or it fails (on the branch where the style guide is actually installed) once the return
  shape widens. Home: `tests/cover_gen.test.mjs`.
- `tests/skill_contract.test.mjs` (COVER-Q-8): extended loop confirms the new `code`-array
  invariant actually fails if the guard logic is removed from `render_cover.mjs` (a real
  regression test, not just schema validation).
- `bin/devlog.js` (COVER-Q-10): `backfill-covers list --all` lists every manifest entry
  regardless of cover status, bypassing the existing `!e.cover` filter; `backfill-covers
  list` with no flag is unchanged from today — missing-cover-only. Fixes the fatal round-2
  finding that, without `--all`, `backfill-covers list` returns `[]` against every project
  in the real `daily-dev-log` repo (all ~51 entries already have `cover: true` from the
  0.8.1 batch). Verified against a stub manifest mixing `cover: true`/`false`/missing
  entries: `--all` returns everything, no flag returns only the missing-cover subset
  (regression guard against accidentally changing default behavior while adding the flag).
  Home: `tests/cli.test.mjs`.

## Versioning

**0.9.0**, not a patch — this repo's convention bumps minor for feature-level behavior
changes (0.7.0 private projects, 0.8.0 cover images); 0.8.1 was reserved for the same-day
prose-only fix. An icon catalog, a grid contract, a new mechanical enforcement path, and
a 51-post regeneration is feature scope.

## Out of scope

- No change to `render_cover.mjs`'s core rasterization (viewport, font-loading,
  quantization). The new pre-screenshot geometry check is in scope and is an intentional,
  documented widening of `renderCoverImage()`'s throw contract (see Component 4) — it is
  not being smuggled in as a no-op.
- No change to the `## Changelog`/commit-linking/private-project behavior.
- No cross-post shape-family similarity tracking (considered as a "heavy" enforcement
  option and explicitly declined in favor of the per-project sample review — revisit if
  the sampled review starts finding same-shape-family repeats in practice).

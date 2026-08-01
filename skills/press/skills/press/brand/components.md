# The shared component vocabulary

Every PRESS medium composes from the same named parts. The *geometry* differs by
medium — a masthead is 8px of rule and a 62px stamp on a 1200×1500 poster card,
and 8px of rule with a 0.8rem stamp on a letter page — but the **name, the
anatomy, and the job** are fixed. That is what makes a card and a report
recognisably the same publication.

Class names below are the contract. A medium may add classes; it may not rename
these or change what they mean.

## Frame — present on every document

| Part | Class | Anatomy | Job |
|---|---|---|---|
| **Masthead** | `.mast` / `header.masthead` | heavy top rule (8px ink) · `.stamp` (rotated -4°, accent border + initials) · `.eyebrow` (tracked-caps mono issue line) · `.byline` (right-aligned, dim, mono) | says whose publication this is, and which issue |
| **Headline** | `h1` | display sans 900, tracking `-0.03em`, line-height ~1.0 | the one claim |
| **Standfirst** | `.stand` / `p.standfirst` | serif italic, dim, ≤3 lines | the setup |
| **Colophon** | `.colophon` / `footer.provenance` | 2px ink rule above · mono, dim · optional circular avatar | what this was for, where the numbers came from |

The headline carries **at most one** accent-colored pivot phrase (`.sig`). That
is usually where the document's single accent moment is spent.

## Body — pick what the content needs, never all of them

| Part | Class | Proves | Budget |
|---|---|---|---|
| **Big stat** | `.bigstat > .fig` (+ `.unit`, `.kicker`) | a number-led claim | `.fig` ≤6 chars |
| **Stat strip** | `.stat-strip > .stat` (`.value .label .bench`) | 3–6 headline figures at a glance | ruled above and below, no tiles |
| **Facts strip** | `.facts > .fact` (`.flabel .fval .fcap`) | 2–4 quick specs | `.fval` ≤14 chars |
| **Ledger** | `.ledger > .lrow` (`.lno .lbody .lt .le`) | a method, 3–4 steps | `.lt` ≤38 · `.le` ≤60 |
| **Tiles** | `.tiles > .tile` (`.tno .tt .te`) | exactly 4 compact steps | `.tt` ≤22/line |
| **Duel** | `.duel > .side.lose/.win` (`.verdict .who .how`) | a decision between two | 2 sides, `.how` ≤40 |
| **Bars** | `.bars > .brow` (`.blabel .btrack > .bfill .bval`) | a comparison of magnitudes | 3–4 rows, every bar labelled |
| **Pull quote** | `.pull > .q` (+ `.qrule`) | the thesis | ≤2 lines |
| **Terminal** | `.term > .tl` (+ `.prompt`, `.dim`, `.hot`) | that it is real | see below |
| **Data table** | `table.data` | the full numbers | mono, ink rules, never zebra |
| **Section** | `section.report-section` + `h3.block-title` | an editorial division | 2px ink rule above |
| **Marginal** | `.marginal` (`.ast`) | the gotcha, as a footnote | ≤2 lines |
| **Caption** | `p.caption` | what a chart is showing | serif italic, dim |

**The hero earns roughly half the surface.** Whichever part proves the point gets
the space; the supporting parts stay small. Two to three body parts per card,
more only in a long-form report where sections do the pacing.

## The terminal is a transcription, not scenery

When a terminal appears, it is real captured output, condensed by **cutting whole
rows** — never by smoothing real output into summary prose. A 5-column table cut
to 3 rows still reads real; the same data rewritten as a sentence reads like
marketing. Missing values print `—`, the way a real CLI does; never invent one.
Monospace alignment is binary — every row pads to one shared character width.

## Charts

Charts obey `laws.md` §5: the ink ramp encodes magnitude only, every mark is
directly labelled, and any two-series chart carries a legend. Colour choices
beyond that belong to the `dataviz` skill, not to PRESS.

## Unavailable data

`p.unavailable` — mono, dim, a 2px dim rule on the left. A section with no data
says so in place. It is never silently dropped, because a missing section and a
section that doesn't exist look identical to the reader.

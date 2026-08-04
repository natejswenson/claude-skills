# The shape of the report

One sheet. It is read top to bottom by someone who was not in the room, and it
has to survive being forwarded without you attached to explain it.

```
Shipped                                     2026-07-28 → 2026-08-04
────────────────────────────────────────────────────────────────────
<headline>            one sentence — the thing the window was about
<standfirst>          one or two paragraphs of plain outcome
[ released ][ merged ][ commits ][ sessions ][ repos ]   ← computed
## <section>
   <item title>
   <item text>                       plain prose, no identifiers
   [receipt] [receipt]               ← the only place ids appear
## Receipts
   the appendix: id · what · when
NS                                                   <byline>
```

## What each part is for

| Part | Is | Comes from |
|---|---|---|
| headline | the one thing a reader would repeat to someone else | model judgment |
| standfirst | why the window mattered, in outcomes | model judgment |
| numbers | released / merged / commits / sessions / repos | **computed by `render`** |
| sections | the grouping that makes the work legible | model judgment |
| items | one outcome each, with its receipts | ranked by `rank`, worded by the model |
| receipts appendix | every cited artifact, resolved, with dates and links | `render` |

## Three rules the code enforces

- **The numbers strip is never authored.** `render` computes it from the cited
  items. There is no receipt shape for the figure "12", so a number a model
  typed is a number it could have invented. If you want a different figure in
  the strip, cite different items — do not write one.
- **No identifier ever appears in the body.** No `#412`, no `a1b2c3d`, no
  `owner/repo`. `receipts` fails the draft when one does. The reason is the
  audience: an identifier in a sentence is a demand that the reader already
  knows your repositories.
- **Every item carries at least one receipt.** An item with none is not a
  thinner item, it is an unsupported one, and it is dropped.

## Sections that tend to work

Not a template — the grouping is judgment. But these earn their place often:

- **Shipped** — what a user can now do that they could not before.
- **Made safer** — the failure that can no longer happen.
- **Groundwork** — work with no visible surface yet, named honestly as such.

Resist a section per repository. A reader who was not there does not know your
repositories and does not want to.

## What the report never does

- It never lists everything. The line exists so that the report is a summary.
- It never counts activity as achievement. Sessions and commits are context;
  releases and merged work are the story.
- It never fills a thin week. A window where little shipped produces a short
  report, and a short honest report is the correct output.

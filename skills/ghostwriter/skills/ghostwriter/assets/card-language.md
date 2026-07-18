# The card language — composing bespoke Press cards

Press is a **brand system, not a template**. Every card is composed fresh from this
vocabulary so no two posts ship the same skeleton, while the frame (masthead, paper,
ink rules, the signature color, the stamp) keeps every card unmistakably the author's.
All classes live in `diagram.css` (section: PRESS DESIGN SYSTEM); personalize
`--press-sig` (signature color), `--stamp` (monogram), `--byline`/`--avatar` there.

## How to compose a card (the method)

1. **Find the one image that proves the post's point.** Not "which layout fits" —
   what would make a reader *stop and save*? A duel proves a decision. A ledger proves
   a method. A big number proves a claim. A terminal proves it's real.
2. **Pick 2–3 body components** from the vocabulary below (between the masthead and
   the colophon — never more; whitespace is part of the brand).
3. **Check `images/card-history.jsonl` and differ from the last 3 cards on ≥2 axes**
   (see Variation axes). Same post shape twice in a row is fine; same *composition*
   is not.
4. Author `images/<slug>.html` (start from `assets/card-template-press.html` or from
   scratch), render with `--strict`, judge it like an art director, then show the user.
5. On approval, append one fingerprint line to `images/card-history.jsonl`:
   `{"date": "YYYY-MM-DD", "slug": "...", "hero": "ledger", "support": ["marginal"], "headline": "sig-word", "density": "airy"}`

## The vocabulary (body components)

| Component | Classes | Proves | Budget |
|---|---|---|---|
| **Ledger** | `.ledger > .lrow` (`.lno .lbody .lt .le`) | a method, 3–4 steps | `.lt` ≤38 · `.le` ≤60 |
| **Command bar** | `.cmdbar` (inside `.lbody` or alone) | the real command | ≤44 chars, one line |
| **Duel** | `.duel > .side.lose/.win` (`.verdict .who .how`) | a decision between two | 2 sides, `.how` ≤40 |
| **Pull quote** | `.pull > .q` (+ `.qrule`) | the thesis | ≤2 lines |
| **Big stat** | `.bigstat > .fig` (+ `.unit`, `.kicker`) | a number-led claim | `.fig` ≤6 chars |
| **Facts strip** | `.facts > .fact` (`.flabel .fval .fcap`) | 2–4 quick specs | `.fval` ≤14 chars |
| **Tiles** | `.tiles > .tile` (`.tno .tt .te`) | exactly 4 compact steps | `.tt` ≤22/line |
| **Terminal** | `.term > .tl` (+ `.dim`, `.hot`) | real code / a session | ≤10 rows, ≤42 chars |
| **Bars** | `.bars > .brow` (`.blabel .btrack>.bfill .bval`) | a comparison of magnitudes | 3–4 rows, `.win` on the payoff |
| **Standfirst** | `.stand` | the setup (near-always present) | ≤3 lines |
| **Marginal** | `.marginal` (`.ast`, `<em>` code) | the gotcha, as a footnote | ≤2 lines |

Frame (on every card): `.mast` (heavy rule + `.stamp` + `.eyebrow` issue line +
`.footer.brand`) on top; `.colophon` (outcome line) on the bottom. `h1` carries ONE
signature-colored pivot phrase (`<span class="sig">`); add class `compact` when the
headline needs ~20 chars/line.

## Composition rules (what keeps it premium)

- **One signature moment per card.** The orange goes to the pivot phrase OR the
  numerals OR the win column — never all at maximum volume. Ink does the rest.
- **Serif = commentary, sans = structure.** Standfirst, details, captions are serif
  italic; titles, numerals, labels are heavy sans. Don't mix within an element.
- **Rules divide, whitespace groups.** Use the 2px/8px ink rules to separate
  sections; never boxes-in-boxes.
- **The hero earns ~½ the card.** Whichever component proves the point gets the
  space; supporting components stay small.
- **Copy obeys voice-notes.** No em dashes, no hedge words, no clever-symmetry
  lines, real numbers only — same bar as the post body.

## Variation axes (differ from the last 3 cards on ≥2)

1. **Hero component** — ledger / duel / pull / bigstat / tiles / term / bars / facts.
2. **Headline treatment** — sig-phrase placement (start vs end), full-size vs `compact`,
   1-line vs 2-line.
3. **Density** — airy (2 body components) vs packed (3).
4. **Numeral presence** — giant numerals (ledger/tiles/bigstat) vs none (duel/pull/term).
5. **Support texture** — marginal footnote vs facts strip vs pull quote vs none.

## Carousels

Add `press` to every `.slide` — the cover/point/recap/cta types adapt to paper +
ink rules automatically. Same blueprint as before (7–9 slides, ≤30 words/slide,
`--i`/`--n` + literal pageno in sync).

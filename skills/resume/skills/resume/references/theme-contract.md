# The theme contract — writing your own résumé look

This skill renders **one** résumé structure. A theme is a single CSS file that
styles it. There is no template to fork, no config object to extend: if you can
write CSS, you can make the résumé look like anything.

```bash
node scripts/render.mjs --json resume.json --theme press          # shipped default
node scripts/render.mjs --json resume.json --theme ats-plain      # shipped, parser-first
node scripts/render.mjs --json resume.json --theme ~/my-brand.css # your own file
```

## Where a theme is loaded from

Highest wins:

1. **An explicit path** — anything containing a `/` or ending in `.css`.
2. **`~/.claude/resume/themes/<name>.css`** — your personal copy. Shared across
   every install of the skill, and it overrides the shipped theme of the same
   name. This is how you keep your own `press` without editing the repo.
3. **`assets/themes/<name>.css`** — what ships.

An unknown *name* is an error, never a silent fallback. Asking for `--theme
corporate` and quietly getting `press` produces a PDF that looks deliberate and
gives you no way to notice.

To start from the shipped theme:

```bash
mkdir -p ~/.claude/resume/themes
cp assets/themes/press.css ~/.claude/resume/themes/press.css
```

## The fast path: five variables

`press` is built on tokens. For a new palette, that is the whole job:

```css
:root {
  --paper: #F5F0E6;   /* page background      */
  --ink:   #181510;   /* primary text         */
  --dim:   #6E675C;   /* secondary text       */
  --sig:   #E8501F;   /* the ONE accent       */
  --hair:  rgba(24, 21, 16, 0.18);  /* hairline rules */
}
```

## The structure you are styling

Fixed. The generator (`scripts/build-html.mjs`) always emits this shape, and
`scripts/build-html.test.mjs` pins it.

```
article.resume
  header.mast
    .stamp                     derived initials, aria-hidden, decorative
    .identity  > h1.name, p.role
    ul.contact > li.c-email | li.c-phone | li.c-location | li.c-link
  section.sec.sec-summary     > h2 + .sbody > p.stand
  section.sec.sec-highlights  > h2 + .sbody > ul.facts   > li.fact  > .flabel .fval .fcap
  section.sec.sec-skills      > h2 + .sbody > ul.skills  > li.skill > .k .v
  section.sec.sec-experience  > h2 + .sbody > .job       > .jhead > h3.jtitle + p.jdate
                                                          > p.jorg > .company .where
                                                          > ul.bullets > li
  section.sec.sec-projects    > h2 + .sbody > .project   > .phead > h3.pname + p.pmeta
                                                          > p.pdesc
  section.sec.sec-education   > h2 + .sbody > .edu       > .degree .school .edetails
  footer.colophon             > .cname .cmeta
```

Notes:

- **`sec-highlights` and `sec-projects` are optional.** They appear only when
  the résumé JSON has `highlights` / `projects`. Style them; don't rely on them.
- **`ul.skills` carries `grouped` or `flat`.** `grouped` when entries look like
  `"CI/CD: Jenkins, Actions"` (each `li` gets a `.k` label and a `.v` value);
  `flat` for bare keywords like `"AWS"`, which want to run inline rather than
  burn a line each. Style both — a résumé can arrive either way.
- **`.jdate` gains `now`** on a role whose end date reads as ongoing.
- **`.stamp` is decorative** and `aria-hidden`; `display: none` it freely.

## Four rules that keep a theme readable by machines

A résumé PDF is read by software before a person sees it. These are not style
opinions — each one is a defect measured on a real render during the 2.0 work.

1. **Keep `letter-spacing` at or below `0.08em`** on anything carrying words,
   above all `.sec > h2`. Past roughly `0.10em`, Chromium writes glyphs far
   enough apart that pdf.js inserts a space between every one, and `EXPERIENCE`
   extracts as `E X P E R I E N C E`. Poppler does not reproduce this, so it is
   easy to ship. `scripts/baseline-render.test.mjs` fails on it.
2. **Never move meaning into `::before` / `::after`.** Generated content does
   not survive extraction reliably. Separators, bullet marks and rules are fine
   — they carry no meaning. A label, a date, a job title is not.
3. **Don't reorder the contact block into fragments.** Each `li` is one text
   node on purpose; splitting a right-aligned line into inline pieces reorders
   the runs in the PDF content stream, and the email address lands halfway down
   the extracted text.
4. **Prefer a single column if the résumé is going through a job board.** A
   left-gutter heading (what `press` does) reads to a column-detecting parser
   as its own column, so headings collect together away from their content.
   `press` accepts that trade for the look; `ats-plain` exists because
   sometimes you shouldn't.

## Pagination

Content flows naturally across pages; there are no fixed-height page boxes.

- Use `break-inside: avoid` to keep a block whole, and `break-after: avoid` to
  keep a heading with what follows it. `press` keeps each `.job` whole;
  `ats-plain` lets long jobs split, because keeping them whole can strand half
  a page and push a 2-page résumé to 3.
- **A background cannot reach the paper edge.** Chromium never paints into the
  `@page` margin — not from the canvas, not from a fixed-position layer (both
  measured). Only `@page { margin: 0 }` bleeds, and that leaves page-2 content
  flush against the sheet edge. `press` therefore sets an even `0.5in` margin
  and reads as a card on a mat.
- **A repeating running head is not available.** `position: fixed` does repeat
  the top of a page in Chromium's PDF output, but bottom-anchored elements land
  on the wrong edge and negative offsets into the margin break outright. The
  masthead appears once, and the colophon closes the document.

## Checking your theme

```bash
node scripts/render.mjs --json <résumé>.json --theme ~/my-brand.css --out /tmp/t --open
```

The generated HTML is written next to the PDF. Edit either and re-render — that
loop is why the source is kept rather than cleaned up.

To hold your theme to the same bar as the shipped ones, add it to the loop in
`scripts/baseline-render.test.mjs` and run `npm test`.

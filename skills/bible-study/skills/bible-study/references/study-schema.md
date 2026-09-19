# Study bundle and outputs

See `evals/input/john-3.json` for the complete tested example. Required top-level strings:
`passage`, `title` (<=9 words), `subtitle`, `translation`, `translationNotice`, `audience`,
`reviewedOn` (YYYY-MM-DD), `opening`, `application`, `prayer`.
`opening` gives brief prayer and reading instructions.

Required claims: `composition`, `events`, `historicalContext`, `literaryContext`,
`bigIdea`, `interpretiveNote`, `quote`. Each is `{text, sources:["S1",...]}`.
`composition` also requires `author` and `uncertainty`; those assertions share its citations.
`quote` also requires `reference`. Even a known date needs an uncertainty field explaining
what is established and what is not. Do not invent controversy where evidence is strong.

`meaning` and `related` each have 3-4 `{title,reference,text,sources}` entries.
`questions` has six strings, ordered as observation then interpretation for each of the
three `flow` sections. Prefix them with Observe / Interpret for easy use in the group.
Each `related` entry also requires a `prompt`: a question comparing that passage to the
corresponding `flow` section. Put the first three connections in reading-section order.
The renderer reserves writing space after each section and a weekly commitment area.
`flow` has three `{title,reference}` entries mapping the requested passage.
For a short verse, these may map to its surrounding context and must be labelled accordingly.
All three review fields must be true only after actual review:
`christianSourcesOnly`, `claimsChecked`, `passageReadInContext`.

`sources` has 4-10 objects, including Bible text and >=3 distinct Christian research publishers.
Every source must be cited. IDs are unique `S1`, `S2`, etc. Each stores:
`id`, `kind` (`bible` or `christian`), `title`, `publisher`, `url` (HTTPS),
`identityURL` (HTTPS), `identityEvidence`, `read:true`, `accessed`, `supportNotes`.
Use real publisher names, not multiple names for one publisher to satisfy the source floor.

Visible prose is limited to 520 words as an initial guard, but that is not a promise it fits.
The exporter refuses overflow. Aim for 380-460 words; preserve content coverage while shortening.
All variable text is escaped. URLs are limited to HTTPS, and exports block remote subresources.

Outputs: `study.html`, `study.pdf` (US Letter, one page), `study.png` (1632 x 2112),
plus `study.json` research data and `layout-check.json` measurements. HTML adapts to small screens;
PDF and PNG preserve print geometry. Links are clickable in HTML/PDF; PNG has source labels,
so share the PDF alongside the PNG when people need to follow references.

From any directory, invoke scripts using their absolute bundled paths and explicit input/output
paths. Renderer returns a nonzero exit for invalid bundles and does not emit partial HTML.
PDF/PNG exports require Python Playwright (`pip install playwright`; `playwright install chromium`).
`pdfinfo study.pdf` and a PDF-to-PNG visual review are additional delivery checks.

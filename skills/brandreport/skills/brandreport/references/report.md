# The report's fixed sections

`brandreport report` renders four sections in a fixed order. The renderer owns
the order and the chrome; `findings.json` owns every word of content. A
section never silently disappears — an empty one renders empty, which is
itself information.

| # | Section | Holds |
|---|---|---|
| 01 | Where you were found | the coverage table: every confirmed snapshot with platform, kind, artifact link, fetch date |
| 02 | The confirmed presence | the claims — factual statements, each with its mono citation of snapshot ids |
| 03 | The read | the brand analysis: themes with evidence, what is missing (gaps), and the summary — how a stranger doing this same search would read the person |
| 04 | Same name, not you | the unconfirmed residue: each same-name finding with where it lives and why it could not be tied |

Section 04 is the one rule made visible. It exists so exclusion is auditable:
a reader can see what the search found and deliberately left out, instead of
trusting that nothing was dropped.

The masthead is dated by the corpus (`corpus as of <newest fetchedAt>`), never
by the clock, so re-rendering a frozen run is byte-identical. The accent
colour is spent exactly twice: the identity stamp and the section numbers.

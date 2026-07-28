# Changelog

All notable changes to the city-report skill are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-07-28

Improvements found by running the skill against seven real cities and three
comparisons, rather than by re-reading the code.

### Added
- **Median home value is now a first-class metric.** It was computed at render
  time only, so it never reached the digest — meaning the one figure most
  people ask about after income wasn't in context when the question came. It is
  now derived in `bundle.py` with a full 2015-2024 series and state/national
  benchmarks (the same interpolation runs on the benchmark payloads), and it
  costs **no extra request**: it shares its query with the value-bucket
  distribution. Verified against Data USA's published 1-year figure for
  Minneapolis: $362,170 vs $368,300, within 1.7%.
- **`--vs` auto-loads a city that isn't cached.** Every comparison run so far
  needed a separate `load.py` call first. An ambiguous name is still never
  guessed.

### Changed
- **The digest reports margin magnitude, not a binary flag.** Two neighbouring
  Minnesota towns both returned a 4.6% poverty rate — one at ±70%, the other at
  ±171% — and `[wide margin]` made them look equally solid. Now `[±70%]` vs
  `[±171%]`, which is the difference between "soft" and "no information".
  (Lake Park's uninsured rate turns out to be ±375%.)
- **Count comparisons read as size ratios.** Comparing two cities' populations
  produced "+263%" and "−98%"; now "3.6× larger" and "1/60 the size". The
  percentage form is arithmetically correct and nobody thinks that way.
- **The indexed-comparison caption no longer names a base year the second city
  doesn't share.** Where two cities' series start in different years it says
  "first published year" instead of asserting one of them.
- `report.py` reads the derived median instead of recomputing it, so the report
  and the digest cannot drift apart.

## [0.3.0] - 2026-07-28

### Added
- **Comparative reports** — `report.py "Hawley, MN" --vs "Fargo, ND"` renders a
  two-city document instead of two separate ones. Every block puts both cities
  on one scale, with two decisions that make the comparison mean something:
  - **Breakdowns are normalised to shares of each city's own total.** Comparing
    raw category counts across a 2,178-person town and a 131,627-person city
    makes every bar in the small town invisible and measures population instead
    of composition.
  - **Count trends are indexed to each city's own first year (= 100).** On a
    shared linear axis those two populations both render as flat lines; indexed,
    the chart shows what was actually being asked — Fargo at 121 vs Hawley at
    106 since 2013.
  Categories are unioned across both cities, not taken from the first, so
  whatever the second city is distinctive for still surfaces.
- **Two-series chart primitives**: `charts.dual_sparkline`, `charts.paired_bars`
  and `charts.legend`. City A is ink, city B is the accent — validated at ΔE
  47.6 normal-vision and 35.5 protan against ink, well clear of the separation
  floor, with a legend on every chart so identity never rests on hue alone. This
  is the one document type where the signature accent is spent on every chart
  rather than once: in a comparison, the two cities *are* the subject.
- Small shares keep a decimal (`0.4%` rather than `0%`), since a visible bar
  labelled zero reads as a rendering bug.

### Notes
- State/national benchmarks are omitted from comparison documents — two cities
  are usually in different states, so "vs state" would mean something different
  on each side of the page.

## [0.2.0] - 2026-07-28

A UX pass over the three commands, driven by actually running the skill from a
plugin install rather than from its own directory.

### Fixed
- **Multi-section reports were mislabelled.** `--section housing --section
  economy` wrote a file named `…-housing.html` whose masthead read "ECONOMY
  REPORT" — the title took whichever section sorted first. The masthead now
  names every section it contains (`ECONOMY · WORK & COMMUTE`), and so does the
  filename, so a two-section report can no longer overwrite a one-section one.
- **`cd`-ing into the skill sent reports into the plugin install.** `report.py`
  writes to `./reports` relative to the current directory, and SKILL.md was
  telling the agent to run from the skill directory. It now instructs invoking
  the scripts by path from wherever the user is.

### Added
- **The city argument is optional and accepts a place name.** With one city
  loaded, `report.py` and `query.py` need no argument at all; with several, they
  list what's loaded and ask. Both accept a slug (`minneapolis-mn`) or a name
  (`"Minneapolis, MN"`, and even a comma-less `"Minneapolis MN"`). Slugs are a
  cache detail and nobody should have to memorize one to see data they just
  loaded.
- **`query.py --cities`** lists the loaded cities, and a lone metric key
  (`query.py poverty_rate`) is understood as a metric rather than a city.
- **Section aliases.** `--section commute|demographics|income|homes|insurance|
  cost of living|…` map onto the five manifest sections, so a user's own word
  can be passed straight through instead of translated into an internal key.
- **Ambiguous-place output is capped** at 12 candidates with an "and N more"
  line; `--list` still shows every one. A bare "Springfield" matched 25 and
  buried the question being asked.
- Install instructions in the README, and `city-report@claude-skills` added to
  the marketplace install list at the repo root.

### Changed
- The load digest now ends with `report.py "<City, ST>"` instead of exposing the
  internal slug.
- 156 offline tests (up from 136), still at 100% coverage.

## [0.1.0] - 2026-07-28

First release. Load any US city's Census data from the Data USA API, answer
questions about it from context, and render a PRESS-branded HTML report.

### Added
- **Pinned metric manifest** (`scripts/manifest.py`) — 21 metrics across People,
  Economy, Housing, Work & Commute and Health, each with its cube, exact
  drilldown set, measure and derivation rule verified live against a 427k city
  and a 248-person village. Nothing composes a query at runtime.
- **Cross-dimension guard test.** Asserts against recorded cube schemas that no
  metric leaves a dimension silently summed, and that no median leaves one
  uncovered at all. It found three real bugs during development: an un-drilled
  `Race` on population, an un-drilled `Gender` under the headline median age,
  and a malformed margin-of-error measure name.
- **Parallel fan-out client** (`scripts/datausa.py`). One concurrent burst covers
  the city, its state and the nation — a cold load runs in about two seconds,
  then caches for 24 hours. Place resolution comes from the documented `/members`
  list (cached 30 days) with exact → in-state prefix → substring matching, and
  reports which strategy hit so a fuzzy match is never passed off as a lookup.
- **Margins of error throughout.** Every measure is requested with its MOE,
  summed margins combine by the Census rule `sqrt(Σ MOE²)`, and any figure whose
  margin exceeds 30% of the estimate is flagged in the digest, the report and the
  query CLI rather than being presented as precise.
- **Three commands** — `load.py` (fetch + cache + digest), `query.py` (offline
  slices of the cached bundle), `report.py` (self-contained HTML, auto-opens).
- **PRESS-branded report.** Inline SVG charts and inline CSS, zero dependencies,
  no browser automation. Sparklines, ranked bars, share bars and histograms in a
  single-hue ink ramp with one accent per document, plus a `<details>` table view
  beside every chart so no value is reachable only by hovering.
- **`references/api-gotchas.md`** — field notes on all eight documented ways the
  Data USA API returns a wrong answer without erroring.

### Notes
- Median home value is **interpolated** from the value-bucket histogram and
  always labelled as an estimate, because `acs_yg_housing_median_value_5` returns
  HTTP 500 on every query. Verified against the published 1-year figure for
  Minneapolis: within 2%.
- Population is derived from the race cube, because
  `acs_yg_total_population_5` — the cube Data USA's own API docs use as their
  worked example — returns HTTP 200 with zero rows at every geography level.
- All cubes are ACS 5-year (`_5`). The `_1` variants cover only 675 places
  (population 65k+); `_5` covers all 29,576, which is what lets the skill work
  in small towns.
- Language-spoken-at-home is deliberately excluded from v1 — the cube returns
  null measures unless English Ability is also drilled.

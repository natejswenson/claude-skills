# Changelog

All notable changes to the city-report skill are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-07-28

First release. Load any US city's Census data once, answer questions about it
from context with no further network calls, and render a PRESS-branded HTML
report.

```
you: city report for Duluth, MN
     ├─ 22 metrics for the city + Minnesota + the US   (~2s cold, cached 24h)
     └─ prints a digest

you: how does poverty compare to the state?
     └─ answered from context — no tool call, no network

you: generate the report
     └─ reports/duluth-mn-2026-07-28.html  ← opens in the browser
```

### Why the queries are pinned

The [Data USA API](https://datausa.io/about/api) is free, fast and
comprehensive. It is also treacherous, because **its failure mode is silently
wrong numbers, not errors**:

- `acs_yg_total_population_5` — *the cube the official docs use as their own
  worked example* — returns HTTP 200 with **zero rows** at every geography
  level. `acs_yg_housing_median_value_5` returns HTTP 500 on every query.
  Neither looks like a failure.
- Tesseract sums a measure across every dimension you did not drill down on.
  Asking the household-income cube for Minneapolis returns `165438` — a **count
  of households** that reads exactly like a plausible median income.
- There is no universal "Total" member. Filtering the race cube's Ethnicity
  dimension to what looks like one silently drops every Hispanic resident, 10%
  of Minneapolis.

So **nothing composes a query at runtime**. Every figure comes from a verified
entry in `scripts/manifest.py`, and a guard test asserts against recorded cube
schemas that no metric leaves a dimension silently summed — and that no
*median* leaves one uncovered at all. That test found three real bugs while the
skill was being built: an un-drilled `Race` under population, an un-drilled
`Gender` under the headline median age, and a malformed margin-of-error measure
name that made the API return estimates with their margins silently missing.

Full field notes on all eight documented ways the API returns a wrong answer
without erroring: `references/api-gotchas.md`.

### Added

- **22 verified metrics** across People, Economy, Housing, Work & Commute and
  Health — each pinned to a cube, an exact drilldown set, a measure and a
  derivation rule, verified live against a 427,246-person city and a
  248-person village.
- **Three commands.** `load.py` fetches and caches a city and prints a digest
  that becomes the working set; `query.py` slices that bundle offline;
  `report.py` renders a self-contained HTML report and opens it.
- **Parallel fan-out client.** One concurrent burst covers the city, its state
  and the nation — ~2s cold, then cached 24h. Place resolution comes from the
  documented `/members` list (cached 30 days) with exact → in-state prefix →
  substring matching, and reports which strategy hit so a fuzzy match is never
  passed off as a lookup. Ambiguous input is never guessed.
- **Margins of error as a first-class concern.** Every measure is requested
  with its MOE, summed margins combine by the Census rule `sqrt(Σ MOE²)`, and
  anything past 30% of its estimate is surfaced with its magnitude — `[±70%]`
  vs `[±171%]`, because a binary flag made two neighbouring towns reporting the
  same 4.6% poverty rate look equally solid when one was four times shakier.
- **Median home value**, interpolated from the value-bucket histogram because
  the cube that would publish it directly returns HTTP 500. Always labelled an
  estimate; validated against Data USA's published 1-year figure for
  Minneapolis at $362,170 vs $368,300, within 1.7%.
- **Comparative reports** — `report.py "Hawley, MN" --vs "Fargo, ND"` renders
  one document with both cities on a shared scale. Breakdowns are normalised to
  shares of each city's own total and count trends are indexed to each city's
  own first year, because raw counts across a 2,178-person town and a
  131,627-person city measure population rather than composition, and both
  populations on a shared linear axis render as flat lines.
- **PRESS-branded output.** Inline SVG charts and inline CSS — zero
  dependencies, no build step, no browser automation, renders in milliseconds
  and works offline. Sparklines, ranked bars, share bars and histograms in a
  single-hue ink ramp, with a `<details>` table view beside every chart so no
  value is reachable only by hovering.
- **Provenance on every report**: survey vintage, Census table IDs, retrieval
  date, and which geographies the benchmarks came from.

### Notes

- All cubes are ACS 5-year (`_5`). The `_1` variants cover only 675 places
  (population 65k+); `_5` covers all 29,576, which is what lets the skill work
  in small towns.
- Population is derived from the race cube, and median home value from the
  value-bucket histogram, for the reasons above.
- Counts are never benchmarked against the state — a city is *part of* its
  state, so "population −93% vs Minnesota" is arithmetically true and useless.
  Counts carry growth-since-2013 instead; between two cities they read as size
  ratios ("3.6× larger", "1/60 the size").
- Language-spoken-at-home is deliberately excluded — that cube returns null
  measures unless English Ability is also drilled.
- Runtime is **stdlib only**. `requirements-dev.txt` covers the test suite
  alone.

### Tested

- **197 offline tests at 100% coverage**, fixture-based, no network required.
- **14 live contract tests** (`pytest -m live`) asserting every metric still
  returns data for both a large city and a tiny village. This is what catches
  Data USA retiring a cube — it has already happened to two of them.
- Exercised end-to-end on seven cities ranging from 248 to 427,246 people, plus
  three two-city comparisons.

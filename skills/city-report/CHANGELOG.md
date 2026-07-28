# Changelog

All notable changes to the city-report skill are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

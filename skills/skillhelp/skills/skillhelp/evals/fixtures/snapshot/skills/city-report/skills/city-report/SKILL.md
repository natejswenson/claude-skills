---
name: city-report
version: 0.4.0
user_invocable: true
description: Pull US Census demographic, economic, housing and health data for any American city from the Data USA API, answer questions about it instantly, and generate a polished editorial HTML report. Use when the user asks for a city report, city profile, demographics, census data, population, median income, cost of living, or "tell me about <city>, <state>" — or wants to compare a city against its state and the nation.
---

# City Report

Load any US city's Census data once, answer questions about it from memory, and
render a PRESS-branded HTML report on request.

**No setup, no API key, no dependencies.** Python 3.10+ and stdlib only — the
first command works immediately.

## Running the scripts

Run them **by path, from wherever the user is**. Do not `cd` into the skill
directory: `report.py` writes to `./reports` relative to the current directory,
so a `cd` would bury the user's report inside the plugin install.

```bash
python3 <skill-dir>/scripts/load.py "Minneapolis, MN"
```

`<skill-dir>` is the directory holding this SKILL.md. Use its absolute path.

## The flow

**1. Ask which city — unless they already said.**

If the user named a city and state, skip straight to loading. If they only said
"generate a city report", ask once:

> Which city and state?

**2. Load it.**

```bash
python3 <skill-dir>/scripts/load.py "Minneapolis, MN"
```

Fetches 22 metrics for the city, its state and the nation concurrently (~2s
cold, cached 24h) and prints a digest. **Read that digest — it is the working
set for the rest of the conversation.**

Exit codes: `2` means ambiguous — it lists the candidates; show them and ask
which. `1` means no such place — ask them to re-check the spelling.

**3. Answer questions from the digest.**

The digest is now in context. Answer follow-ups from it — do **not** shell out
for a number already on screen. That is the whole point of the load step.

Reach for `query.py` only when you need something the digest doesn't carry: a
full year series, the long tail of a breakdown, or exact margins.

```bash
python3 <skill-dir>/scripts/query.py poverty_rate          # detail + benchmarks
python3 <skill-dir>/scripts/query.py commute_means --top 5
python3 <skill-dir>/scripts/query.py median_household_income --series
python3 <skill-dir>/scripts/query.py --cities             # what's loaded
```

The city argument is optional when one city is loaded. With several loaded,
name one — a slug (`duluth-mn`) or a place name (`"Duluth, MN"`) both work.
`query.py` never touches the network.

**4. Generate the report when asked.**

```bash
python3 <skill-dir>/scripts/report.py
python3 <skill-dir>/scripts/report.py --section housing
python3 <skill-dir>/scripts/report.py "Duluth, MN" --section commute --section economy
```

Writes a self-contained HTML file to `./reports/` and **opens it in the user's
browser**. Never pass `--no-open` in an interactive session — the user needs to
see the report on their own screen, not just be told it exists.

Sections: `people`, `economy`, `housing`, `work`, `health`. Common words are
aliased (`commute`, `demographics`, `income`, `homes`, `insurance`, …), so pass
the user's own word through rather than translating it.

## Comparing two cities

Load both, then answer from the two digests. For a written comparison that's
all you need — say which year each figure is from, since the latest available
year can differ between cities.

For a **comparative report**, use `--vs`:

```bash
python3 <skill-dir>/scripts/report.py "Hawley, MN" --vs "Fargo, ND"
python3 <skill-dir>/scripts/report.py "Hawley, MN" --vs "Fargo, ND" --section economy
```

If the second city isn't loaded yet it is fetched automatically. The comparison
document puts both on one scale in every block: breakdowns become shares of each city's own total (raw
counts would just measure population), and count trends are indexed to each
city's own first year (a 2,178-person town and a 131,627-person city both
render as flat lines on a shared linear axis).

State benchmarks are omitted from a comparison — the two cities are usually in
different states, so "vs state" means different things on each side.

## Reporting the numbers honestly

- **Always state the vintage.** These are ACS 5-year estimates. "Median income
  is $80,846" is incomplete; "$80,846 as of 2024" is the claim.
- **Never quote a wide-margin figure as fact.** Anything the digest marks
  `[±N%]` has a margin of error over 30% of the estimate — routine for towns
  under a few thousand people. **Read the magnitude, not just the flag**: ±40%
  is soft, ±171% means the estimate and its margin overlap zero, and ±375%
  means the figure carries no information at all. Say "roughly 26%, though the
  margin on a town this small is wide" rather than "25.7%"; past about ±100%,
  don't quote a number — give a range or skip the metric.
- **Counts are not benchmarked against the state**, because a city is part of
  its state. Population carries growth-since-2013 instead; rates and medians
  carry state and national comparisons.
- **Never invent a metric.** If it isn't in the manifest, the answer is "Data
  USA doesn't publish that at city level" — not an estimate. There is no
  crime, school-rating, weather or cost-of-living-index data here.

## Accuracy: why queries are pinned, not composed

Do **not** write ad-hoc Data USA queries. The API returns HTTP 200 with zero
rows for dead cubes, and silently sums a measure across every dimension you
didn't drill down on — so a wrong query returns a plausible number, not an
error. Asking the household-income cube for Minneapolis without drilling the
bucket dimension returns `165438`, which reads like a median income and is
actually a count of households.

Every number comes from a verified entry in `scripts/manifest.py`. To add a
metric, add a manifest entry and let the guard test check it — never bypass it
with a one-off fetch.

`references/api-gotchas.md` documents all eight traps with the evidence for
each. Read it before touching the manifest.

## Files

| Path | What it is |
|---|---|
| `scripts/manifest.py` | The 22 verified metric definitions — the accuracy asset |
| `scripts/datausa.py` | API client: place resolution, parallel fan-out, caching |
| `scripts/bundle.py` | Turns raw API payloads into reportable series + margins |
| `scripts/load.py` / `query.py` / `report.py` | The three commands |
| `scripts/brand.py` / `charts.py` | PRESS theme and inline-SVG chart primitives |
| `references/api-gotchas.md` | Field notes on the API's failure modes |

## Tests

```bash
pytest                    # offline, fixture-based, 100% coverage
pytest -m live            # hits the real API; verifies every metric still returns data
```

The live contract test is what catches Data USA retiring a cube — it has already
happened to two of them.

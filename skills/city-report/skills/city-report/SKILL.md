---
name: city-report
version: 0.1.0
user_invocable: true
description: Pull US Census demographic, economic, housing and health data for any American city from the Data USA API, answer questions about it instantly, and generate a polished editorial HTML report. Use when the user asks for a city report, city profile, demographics, census data, population, median income, cost of living, or "tell me about <city>, <state>" — or wants to compare a city against its state and the nation.
---

# City Report

Load any US city's Census data once, answer questions about it from memory, and
render a PRESS-branded HTML report on request.

Three commands, all under `scripts/`. Run them from the skill directory.

## The flow

**1. Ask which city — unless they already said.**

If the user named a city and state, skip straight to loading. If they only said
"generate a city report", ask once:

> Which city and state?

**2. Load it.**

```bash
python3 scripts/load.py "Minneapolis, MN"
```

This fetches all 21 metrics for the city, its state and the nation concurrently
(~2s cold, cached 24h) and prints a digest. **Read that digest — it is the
working set for the rest of the conversation.**

If the input is ambiguous, `load.py` lists the candidates and exits with status
2 rather than guessing. Show the user the list and ask which one. If it exits 1,
no such place exists — ask them to re-check the spelling.

**3. Answer questions directly from the digest.**

Once loaded, the digest is in context. Answer follow-ups from it — do **not**
shell out for something already on screen. That is the entire point of the load
step, and a tool call for a number you can already see just adds latency.

Only reach for `query.py` when you need something the digest doesn't carry: a
full year-by-year series, the long tail of a breakdown, or exact margins.

```bash
python3 scripts/query.py minneapolis-mn                       # list all metric keys
python3 scripts/query.py minneapolis-mn poverty_rate          # detail + benchmarks
python3 scripts/query.py minneapolis-mn commute_means --top 5
python3 scripts/query.py minneapolis-mn median_household_income --series
```

`query.py` reads the cached bundle. It never touches the network.

**4. Generate the report when asked.**

```bash
python3 scripts/report.py minneapolis-mn                    # full profile
python3 scripts/report.py minneapolis-mn --section housing  # one section
```

Writes a self-contained HTML file to `reports/` and **opens it in the user's
browser**. Never pass `--no-open` in an interactive session — the user needs to
see the report on their own screen, not just be told it exists.

Sections: `people`, `economy`, `housing`, `work`, `health`.

## Reporting the numbers honestly

- **Always state the vintage.** These are ACS 5-year estimates. "Median income
  is $80,846" is incomplete; "$80,846 as of 2024" is the claim.
- **Never quote a wide-margin figure as fact.** Anything the digest marks
  `[wide margin]` has a margin of error over 30% of the estimate — common for
  towns under a few thousand people. Say "roughly 26%, though the margin on a
  town this small is wide" rather than "25.7%".
- **Counts are not benchmarked against the state**, because a city is part of
  its state. Population carries growth-since-2013 instead. Rates and medians
  carry state and national comparisons.
- **Never invent a metric.** If it isn't in the manifest, the answer is "Data
  USA doesn't publish that at city level" — not an estimate.

## Accuracy: why queries are pinned, not composed

Do **not** write ad-hoc Data USA queries. The API returns HTTP 200 with zero
rows for dead cubes, and silently sums a measure across every dimension you
didn't drill down on — so a wrong query returns a plausible number, not an
error. Asking the household-income cube for Minneapolis without drilling the
bucket dimension returns `165438`, which reads like a median income and is
actually a count of households.

Every number this skill can report comes from a verified entry in
`scripts/manifest.py`. To add a metric, add a manifest entry and let the guard
test check it — never bypass it with a one-off fetch.

`references/api-gotchas.md` documents all eight traps in full, with the
verified evidence for each. Read it before touching the manifest.

## Files

| Path | What it is |
|---|---|
| `scripts/manifest.py` | The 21 verified metric definitions — the accuracy asset |
| `scripts/datausa.py` | API client: place resolution, parallel fan-out, caching |
| `scripts/bundle.py` | Turns raw API payloads into reportable series + margins |
| `scripts/load.py` / `query.py` / `report.py` | The three commands |
| `scripts/brand.py` / `charts.py` | PRESS theme and inline-SVG chart primitives |
| `references/api-gotchas.md` | Field notes on the API's failure modes |

## Tests

```bash
pytest                    # offline, fixture-based
pytest -m live            # hits the real API; verifies every metric still returns data
```

The live contract test is what catches Data USA retiring a cube — it has already
happened to two of them.

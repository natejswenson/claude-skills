# Data USA API — field notes

Everything here was verified live against `https://api.datausa.io/tesseract/` on
2026-07-28. Read this before changing `scripts/manifest.py`, and **never compose
a new query by guessing** — the API's failure mode is silently wrong numbers,
not errors.

## The one-sentence version

Tesseract aggregates a measure across every dimension you did not drill down
on, returns HTTP 200 for cubes that hold no data, and has no universal "Total"
member — so a query that looks right and returns a plausible number is not
evidence of anything.

## 1. Dead cubes that return HTTP 200 with zero rows

`acs_yg_total_population_5` — **the cube the official API docs use as their own
worked example** — returns `page.total = 0` at every geography level:

```
data.jsonrecords?cube=acs_yg_total_population_5&drilldowns=State,Year&measures=Population
→ {"page":{"total":0},"data":[]}
```

`acs_yg_housing_median_value_5` is worse: HTTP 500 on every query, at every
level.

Neither failure looks like a failure. A skill that trusts the docs reports
"no population data for your city."

**What this skill does:** population comes from `acs_ygr_race_with_hispanic_5`;
median home value is interpolated from `acs_ygo_housing_value_bucket_5` and
labelled as an estimate. A `pytest -m live` contract test asserts all 21 metrics
return rows, so the next cube to die is caught by CI rather than by a reader.

## 2. Un-drilled dimensions are silently summed

This is the trap that costs you correctness.

```
cube=acs_yg_household_income_5&drilldowns=Place,Year&measures=Household Income
→ Minneapolis 2013: 165438
```

`165438` reads exactly like a median household income. It is the **count of
households**, summed across all 16 income buckets, because `Household Income
Bucket` was not drilled. Nothing in the response says so.

**When the sum is fine, and when it isn't.** ACS crosstabs partition their
universe: in `acs_ygpsar_poverty_by_gender_age_race_5` (Poverty Status × Gender
× Age × Race) every person occupies exactly one cell, so summing the un-drilled
axes returns the correct marginal total. The danger is not double-counting —
it's that:

1. **the marginal total may not be the quantity you wanted.** The household
   cube's marginal total is a household *count*; the thing named "Household
   Income" is not an income at all.
2. **summing a median is meaningless.** Ask for median age without drilling the
   Gender dimension and you are relying on the API's choice of aggregator over
   three medians. It currently returns the `Total` member's value, which is
   right — by luck, not by contract.

**Rules:**
- Every dimension is drilled, or named in the metric's `summed` map with a
  reason. There is no third option.
- A median, mean or index must never leave a dimension uncovered — drill it and
  pin the member.
- `tests/test_manifest.py` enforces both, against recorded cube schemas offline
  and the live schemas under `-m live`. It has already caught three real bugs in
  this manifest: an un-drilled `Race` on population, an un-drilled `Gender` on
  median age, and a malformed MOE measure name.

## 3. There is no implicit "Total" member

`Ethnicity` in `acs_ygr_race_with_hispanic_5` has exactly two members:

```
0  Not Hispanic or Latino
1  Hispanic or Latino
```

Filtering `include=Ethnicity:0` looks like selecting a total. It selects
*non-Hispanic only* and silently drops 44,748 people — 10% of Minneapolis.

Some cubes *do* ship a total (`acs_ygr_median_household_income_race_5` has
`Race = "Total"`, and it is the correct published median). The only way to know
is `GET /members?cube=<cube>&level=<level>`. Check; don't assume.

## 4. `_1` vs `_5` is a coverage cliff, not a precision knob

| suffix | survey | places covered |
|---|---|---|
| `_1` | ACS 1-year | **675** (population 65k+) |
| `_5` | ACS 5-year | **29,576** (all) |

Build against `_1` and the skill works in Minneapolis and fails in every small
town. **Every cube in this manifest is `_5`.** The cost is that 5-year estimates
lag and smooth; the benefit is that the skill works everywhere, which matters
more.

## 5. The latest year differs per cube

Median age had 2024 data while household income was still at 2023. Hardcoding a
year silently returns nothing for some metrics. Fetch the full series and take
`max(year)` per metric — which is what `bundle._series` does. (`time=Year.latest`
also works if you ever need a single year.)

## 6. Place captions are not always "City, ST"

Captions are **unique** across all 29,576 places, so an exact match is
unambiguous. But eight consolidated city-county governments don't use the plain
form:

```
Indianapolis city (balance), IN
Louisville/Jefferson County metro government (balance), KY
Athens-Clarke County unified government (balance), GA
Augusta-Richmond County consolidated government (balance), GA
Nashville-Davidson metropolitan government (balance), TN
Milford city (balance), CT
Greeley County unified government (balance), KS
Butte-Silver Bow (balance), MT
```

Exact matching on `"Indianapolis, IN"` finds nothing. `datausa.resolve_place`
falls back to a prefix match within the named state, then to a substring match,
and **reports which strategy hit** so a fuzzy match is never passed off as a
lookup.

## 7. The MOE measure name is not always `"<measure> Moe"`

Cubes whose measure name carries a level suffix after a colon put `Moe` *before*
the colon:

```
Median Earnings by Industry: Industry Group        ← estimate
Median Earnings by Industry Moe: Industry Group    ← margin
```

Appending ` Moe` to the whole string names a measure that does not exist — and
the API answers that request with **HTTP 200, the estimate, and no MOE column**
rather than an error. The margin simply goes missing.
`Metric.moe_measure` handles both forms.

## 8. Margins of error are not optional at city scale

Every ACS cube ships a margin-of-error measure alongside the estimate, and at
place level the sample can be tiny. Hackensack, MN (population 248) returns:

| metric | estimate | MOE as % of estimate |
|---|---|---|
| uninsured rate | 3.4% | **142%** |
| poverty rate | 25.7% | **79%** |
| median household income | $41,250 | **40%** |

Quoting "25.7% poverty rate" for that town without the margin is fabricating
precision. This skill fetches the MOE with every measure, propagates summed
margins by the Census rule `MOE_total = sqrt(Σ MOE_i²)`, and flags anything over
30%.

## Useful endpoints

```
/cubes                                   # 126 cubes, ~740KB
/cubes/<name>                            # one cube's dimensions + measures
/members?cube=<name>&level=<level>       # a level's members (Place = 1.5MB)
/data.jsonrecords?cube=&drilldowns=&measures=&include=&parents=&sort=&limit=
```

`include` uses `Level:key` pairs joined by `;`. `limit` is `count,offset`.

## Performance

Not a constraint. 38 concurrent queries completed in **1.17s**; a full city load
(21 metrics × 3 geographies, de-duplicated to 18 queries each) runs in about
2 seconds cold and is then cached for 24 hours.

## Undocumented endpoint, deliberately unused

`https://datausa.io/api/searchLegacy/?q=<query>` is the website's own geo search
and returns nicely ranked results. It is not part of the documented API and
could change without notice, so this skill resolves places from the documented
`/members` list instead — slower to first use (one 1.5MB fetch, cached 30 days)
but stable and exactly matchable.

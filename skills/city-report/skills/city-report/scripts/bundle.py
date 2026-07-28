"""Turn raw tesseract payloads into a reportable bundle.

This is where a manifest ``kind`` becomes a number. Everything here is pure —
dicts in, dicts out, no network — so the derivation rules that decide whether
a figure is right can be tested against recorded fixtures.

Margins of error are propagated, not dropped. The Census publishes an MOE for
every ACS estimate because the estimates are samples, and at place level the
sample can be tiny: a 300-person town's "median income" may carry a margin
wider than the estimate. Summed members combine by the Census's documented
rule, ``MOE_total = sqrt(sum(MOE_i^2))``, so a derived total's margin is as
honest as a published one.
"""
from __future__ import annotations

import datetime as _dt
import math

import manifest
from manifest import Metric


def _rows(payload: dict | None) -> list[dict]:
    """Rows from a payload, tolerating the API's empty and error shapes."""
    if not payload or not isinstance(payload, dict):
        return []
    data = payload.get("data")
    return data if isinstance(data, list) else []


def _table_id(payload: dict | None) -> str | None:
    """The Census table this cube is built from (e.g. ``B03002``).

    Carried onto the report so a figure can be traced back to its source table
    rather than being taken on faith.
    """
    if not payload:
        return None
    return (payload.get("annotations") or {}).get("table_id")


def _dimension_column(metric: Metric) -> str | None:
    """The response column holding the drilled dimension's member captions.

    tesseract names the column after the level, so ``drilldowns=Year,Race``
    yields a ``Race`` column. Metrics with only ``Year`` have no such column.
    """
    extra = [d for d in metric.drilldowns if d != "Year"]
    return extra[0] if extra else None


def _num(value) -> float | None:
    """Coerce a measure cell to a float, mapping the API's nulls to ``None``.

    Some cubes return ``null`` measures for members that exist but were not
    tabulated. Those must stay ``None`` all the way to the report rather than
    becoming a silent zero, which would drag a median or a share downward.
    """
    if value is None:
        return None
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(out) else out


def _combine_moe(moes: list[float | None]) -> float | None:
    """Census rule for the MOE of a sum: root of the sum of squares."""
    present = [m for m in moes if m is not None]
    if not present:
        return None
    return math.sqrt(sum(m * m for m in present))


def _latest_year(payload: dict | None) -> int | None:
    """The most recent year present in a payload, regardless of metric shape."""
    years = [r["Year"] for r in _rows(payload) if isinstance(r.get("Year"), int)]
    return max(years) if years else None


def _by_year(rows: list[dict], metric: Metric) -> dict[int, list[dict]]:
    grouped: dict[int, list[dict]] = {}
    for row in rows:
        year = row.get("Year")
        if isinstance(year, int):
            grouped.setdefault(year, []).append(row)
    return grouped


def _series(payload: dict | None, metric: Metric) -> tuple[dict[int, float], dict[int, float | None]]:
    """``({year: value}, {year: moe})`` for a metric's headline series.

    ``breakdown`` metrics have no single series — a bar chart of 15 industries
    does not collapse to one number — so they return empty and are read through
    ``_categories`` instead.
    """
    rows = _rows(payload)
    if not rows or metric.kind == "breakdown":
        return {}, {}

    dim = _dimension_column(metric)
    values: dict[int, float] = {}
    moes: dict[int, float | None] = {}

    for year, year_rows in _by_year(rows, metric).items():
        if metric.kind == "scalar":
            value = _num(year_rows[0].get(metric.measure))
            moe = _num(year_rows[0].get(metric.moe_measure))

        elif metric.kind == "total":
            parts = [_num(r.get(metric.measure)) for r in year_rows]
            present = [p for p in parts if p is not None]
            value = sum(present) if present else None
            moe = _combine_moe([_num(r.get(metric.moe_measure)) for r in year_rows])

        elif metric.kind == "member":
            picked = [r for r in year_rows if r.get(dim) == metric.member]
            value = _num(picked[0].get(metric.measure)) if picked else None
            moe = _num(picked[0].get(metric.moe_measure)) if picked else None

        elif metric.kind == "rate":
            numer = [r for r in year_rows if r.get(dim) in metric.numerator]
            n_parts = [_num(r.get(metric.measure)) for r in numer]
            d_parts = [_num(r.get(metric.measure)) for r in year_rows]
            n_sum = sum(p for p in n_parts if p is not None) if n_parts else None
            d_sum = sum(p for p in d_parts if p is not None) if d_parts else None
            # A zero denominator is a real state for a tiny place, not an error;
            # it must yield "unavailable", never a ZeroDivisionError or a 0%.
            value = (n_sum / d_sum * 100) if n_sum is not None and d_sum else None
            n_moe = _combine_moe([_num(r.get(metric.moe_measure)) for r in numer])
            moe = (n_moe / d_sum * 100) if n_moe is not None and d_sum else None
        else:  # pragma: no cover - guarded by test_manifest
            raise ValueError(f"unknown metric kind: {metric.kind}")

        if value is not None:
            values[year] = value
            moes[year] = moe

    return values, moes


def _categories(payload: dict | None, metric: Metric, year: int | None) -> list[dict]:
    """Members of a ``breakdown`` metric for one year, largest first.

    ``metric.exclude`` drops subtotal members that would otherwise be charted
    alongside their own components — the industry cube ships a ``Total`` and a
    duplicated Arts member, either of which would dominate a bar chart while
    double-counting the categories beside it.
    """
    rows = _rows(payload)
    dim = _dimension_column(metric)
    if not rows or not dim:
        return []

    years = sorted({r["Year"] for r in rows if isinstance(r.get("Year"), int)})
    if not years:
        return []
    target = year if year in years else years[-1]

    out = []
    for row in rows:
        if row.get("Year") != target:
            continue
        label = row.get(dim)
        if label in metric.exclude:
            continue
        if metric.label_style == "after_dash" and isinstance(label, str) and "-" in label:
            # Drop the shared hierarchy prefix so the distinguishing part of
            # the caption is what survives truncation in a chart gutter. Split
            # on the FIRST dash, not the last: the separator is the one after
            # "...Coverage", while member names carry their own hyphens
            # ("With Employer-Based Health Insurance Only"), and rsplit would
            # leave "Based Health Insurance Only".
            label = label.split("-", 1)[1].strip()
        value = _num(row.get(metric.measure))
        if value is None:
            continue
        out.append({
            "label": label,
            "value": value,
            "moe": _num(row.get(metric.moe_measure)),
        })
    out.sort(key=lambda c: c["value"], reverse=True)
    return out


def build_metric(metric: Metric, payloads: dict[str, dict | None]) -> dict:
    """Assemble one metric across place, state and nation.

    An unavailable metric is recorded with ``available: False`` and a stated
    reason rather than omitted, so the report can say "not published for this
    place" instead of quietly rendering a shorter document — a missing section
    and a suppressed section look identical to a reader otherwise.
    """
    key = f"{metric.cube}|{','.join(metric.drilldowns)}|{metric.measure}"
    place_payload = (payloads.get("Place") or {}).get(key)

    values, moes = _series(place_payload, metric)
    # Breakdowns have no series, so their year has to come from the rows —
    # otherwise every breakdown block is captioned with a blank year.
    latest_year = max(values) if values else _latest_year(place_payload)
    latest = values.get(latest_year) if latest_year else None
    latest_moe = moes.get(latest_year) if latest_year else None
    moe_ratio = (abs(latest_moe / latest)
                 if latest_moe is not None and latest else None)

    categories = _categories(place_payload, metric, latest_year)

    # Counts are deliberately left unbenchmarked — see Metric.benchmarkable.
    benchmarks: dict[str, dict] = {}
    if metric.benchmarkable:
        for level in manifest.BENCHMARK_LEVELS:
            bench_values, _ = _series((payloads.get(level) or {}).get(key), metric)
            if latest_year and latest_year in bench_values:
                benchmarks[level] = {"year": latest_year, "value": bench_values[latest_year]}
            elif bench_values:
                year = max(bench_values)
                benchmarks[level] = {"year": year, "value": bench_values[year]}

    # A count's meaningful comparison is against its own past, not against the
    # state it sits inside. Change is measured over the full published series.
    growth = None
    if not metric.benchmarkable and len(values) >= 2:
        first_year, last_year = min(values), max(values)
        base = values[first_year]
        if base:
            growth = {
                "from_year": first_year,
                "to_year": last_year,
                "pct": (values[last_year] - base) / abs(base) * 100,
            }

    available = bool(values or categories)
    return {
        "key": metric.key,
        "section": metric.section,
        "label": metric.label,
        "unit": metric.unit,
        # A rate's headline is a percentage, but the members underneath it are
        # the raw counts the percentage was computed from — formatting those
        # with the headline's unit prints "345276.0%".
        "category_unit": "count" if metric.kind == "rate" else metric.unit,
        "kind": metric.kind,
        "note": metric.note,
        "headline": metric.headline,
        "is_median": metric.is_median,
        "available": available,
        "reason": None if available else "not published for this place",
        "series": {str(y): v for y, v in sorted(values.items())},
        "moe_series": {str(y): m for y, m in sorted(moes.items())},
        "latest_year": latest_year,
        "latest": latest,
        "moe": latest_moe,
        "moe_ratio": moe_ratio,
        "wide_margin": bool(moe_ratio is not None and moe_ratio > manifest.MOE_WIDE_RATIO),
        "categories": categories,
        "benchmarks": benchmarks,
        "growth": growth,
        "cube": metric.cube,
        "table_id": _table_id(place_payload),
    }


def build_bundle(place, payloads: dict[str, dict], now: _dt.datetime | None = None) -> dict:
    """The full cached artifact for one city: every metric, both benchmarks."""
    stamp = (now or _dt.datetime.now(_dt.timezone.utc)).replace(microsecond=0)
    metrics = {m.key: build_metric(m, payloads) for m in manifest.METRICS}
    return {
        "place": {
            "name": place.name,
            "place_id": place.place_id,
            "state_name": place.state_name,
            "state_id": place.state_id,
            "slug": place.slug,
        },
        "vintage": manifest.VINTAGE,
        "fetched_at": stamp.isoformat(),
        "source": "Data USA (datausa.io) / US Census Bureau American Community Survey",
        "metrics": metrics,
    }


# ------------------------------------------------------------- presentation


def interpolated_median(categories: list[dict], bounds: list[tuple[float, float]]) -> float | None:
    """Median of a bucketed histogram by linear interpolation.

    Needed because ``acs_yg_housing_median_value_5`` — the cube that would
    publish a median home value directly — returns HTTP 500 on every query. The
    result is always presented as an estimate, never as a reported median,
    because interpolation assumes values spread evenly inside each bucket and
    the top bucket is open-ended.

    ``bounds`` is the ``(low, high)`` range of each bucket, in ``categories``'
    original (ascending) order — so callers must pass the unsorted bucket list.
    """
    total = sum(c["value"] for c in categories)
    if total <= 0 or len(categories) != len(bounds):
        return None
    half = total / 2
    running = 0.0
    for cat, (low, high) in zip(categories, bounds):
        # The bucket that crosses the halfway point necessarily has a positive
        # count — a zero-count bucket cannot move `running` past `half` — so
        # this division is always safe.
        if running + cat["value"] >= half:
            return low + (half - running) / cat["value"] * (high - low)
        running += cat["value"]
    return bounds[-1][1]  # pragma: no cover - float-rounding safety net


def parse_bucket_bounds(label: str) -> tuple[float, float] | None:
    """Parse a Census bucket caption into numeric bounds.

    Handles the three shapes the value/income cubes emit: ``"$100,000 to
    $124,999"``, ``"Less Than $10,000"`` / ``"< $10,000"``, and
    ``"$2,000,000 or More"`` / ``"$200,000+"``. The open-ended top bucket is
    given a finite ceiling of 1.5x its floor purely so interpolation has a
    range; a median landing there is unreliable by nature and the report says so.
    """
    text = label.replace(",", "").replace("$", "").strip()
    numbers = []
    for token in text.replace("-", " ").split():
        cleaned = token.rstrip("+")
        try:
            numbers.append(float(cleaned))
        except ValueError:
            continue
    if not numbers:
        return None
    if len(numbers) >= 2:
        return numbers[0], numbers[1]
    value = numbers[0]
    lowered = label.lower()
    if "less than" in lowered or lowered.startswith("<"):
        return 0.0, value
    return value, value * 1.5

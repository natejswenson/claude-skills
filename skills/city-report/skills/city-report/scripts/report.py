#!/usr/bin/env python3
"""Render a cached city bundle as a self-contained PRESS-branded HTML report.

    python3 scripts/report.py                          # the only loaded city
    python3 scripts/report.py "Minneapolis, MN"        # or a slug: minneapolis-mn
    python3 scripts/report.py --section housing
    python3 scripts/report.py --section commute --section economy
    python3 scripts/report.py --out ~/Desktop --no-open

The city argument is optional whenever exactly one city is loaded, and accepts
a slug or a place name. Reports are written to ``./reports`` relative to the
**current** directory, so run this from wherever the user wants the file — not
from inside the skill, or the report lands in the plugin install.

Output is one ``.html`` file with the stylesheet and every chart inlined —
nothing is fetched at view time, so it works offline, survives being emailed,
and opens instantly. It auto-opens in the default browser unless ``--no-open``.

Every section pairs its chart with a ``<details>`` table view, so no value is
reachable only by hovering a mark, and every figure whose margin of error
exceeds 30% of the estimate is called out rather than being presented as
precise.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import html
import json
import os
import subprocess
import sys
import webbrowser

import brand
import bundle as bundle_mod
import charts
import fmt
import manifest

#: Bars shown in a ranked chart before the rest fall to the table view. Six
#: keeps a breakdown block close in height to a trend block, which is what
#: lets two columns balance; the table view still carries every row.
BREAKDOWN_LIMIT = 6


def _esc(text) -> str:
    return html.escape(str(text), quote=True)


#: Section aliases, so a user's own words reach the right section. The report
#: calls it "Work & Commute"; somebody asking for "a commute report" should not
#: get an argparse error listing the internal keys.
SECTION_ALIASES = {
    "commute": "work", "jobs": "work", "employment": "work", "transport": "work",
    "demographics": "people", "population": "people", "diversity": "people",
    "income": "economy", "wages": "economy", "cost_of_living": "economy",
    "homes": "housing", "home": "housing", "rent": "housing",
    "healthcare": "health", "insurance": "health",
}

SECTION_KEYS = tuple(k for k, _ in manifest.SECTIONS)


def normalize_section(value: str) -> str:
    """Map a user-supplied section word onto a manifest section key."""
    key = value.strip().lower().replace("&", "").replace(" ", "_")
    key = SECTION_ALIASES.get(key, key)
    if key not in SECTION_KEYS:
        raise argparse.ArgumentTypeError(
            f"unknown section '{value}' — choose from {', '.join(SECTION_KEYS)} "
            f"(aliases: {', '.join(sorted(SECTION_ALIASES))})")
    return key


def load_bundle(slug: str) -> dict:
    """Read a bundle written by ``load.py``."""
    import datausa
    path = datausa.cache_path(f"bundle-{slug}.json")
    if not os.path.exists(path):
        raise SystemExit(
            f"No cached data for '{slug}'. Run:  "
            f"{datausa.script_cmd('load.py')} \"<City, ST>\"")
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


# ------------------------------------------------------------------ blocks


def _moe_note(metric: dict) -> str:
    """The wide-margin caveat, or nothing.

    Shown only past the threshold. A note on every figure would be noise; a
    note on the handful that are genuinely soft is information — and for a
    small town that is most of the report, which is itself the point.
    """
    if not metric.get("wide_margin"):
        return ""
    pct = metric["moe_ratio"] * 100
    return (f'<p class="wide-margin">Wide margin of error — ±{pct:.0f}% of the '
            f'estimate. Treat this as a range, not a number.</p>')


def _stat_tile(metric: dict, focal: bool) -> str:
    """One masthead figure with its two benchmark comparisons."""
    value = fmt.format_compact(metric["latest"], metric["unit"])
    bench_bits = fmt.context_bits(metric)
    bench_html = (f'<span class="bench">{_esc(" · ".join(bench_bits))}</span>'
                  if bench_bits else "")
    moe = fmt.format_moe(metric.get("moe"), metric["unit"])
    moe_html = f' <span class="moe">{_esc(moe)}</span>' if moe else ""
    return (
        f'<div class="stat{" focal" if focal else ""}">'
        f'<span class="value">{_esc(value)}</span>'
        f'<span class="label">{_esc(metric["label"])}{moe_html}</span>'
        f'{bench_html}</div>')


def _table(headers: list[str], rows: list[list[str]], numeric_from: int = 1) -> str:
    head = "".join(
        f'<th class="{"num" if i >= numeric_from else ""}">{_esc(h)}</th>'
        for i, h in enumerate(headers))
    body = "".join(
        "<tr>" + "".join(
            f'<td class="{"num" if i >= numeric_from else ""}">{_esc(c)}</td>'
            for i, c in enumerate(row)) + "</tr>"
        for row in rows)
    return f'<table class="data"><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>'


def _table_view(headers: list[str], rows: list[list[str]], label: str = "table view") -> str:
    """A chart's accessible companion, collapsed by default."""
    if not rows:
        return ""
    return (f'<details class="table-view"><summary>{_esc(label)}</summary>'
            f'{_table(headers, rows)}</details>')


def _trend_block(metric: dict, theme: dict) -> str:
    """A scalar/rate/total metric: sparkline + its own value table."""
    series = metric.get("series") or {}
    unit = metric["unit"]
    svg = charts.sparkline(
        series, theme, value_format=lambda v: fmt.format_compact(v, unit),
        label=metric["label"])
    rows = [[year, fmt.format_value(value, unit)]
            for year, value in sorted(series.items())]
    return (f'<div class="chart">{svg}</div>'
            + _table_view(["Year", metric["label"]], rows))


def _breakdown_block(metric: dict, theme: dict, limit: int = BREAKDOWN_LIMIT) -> str:
    """A breakdown metric: ranked bars over the latest year + full table."""
    cats = metric.get("categories") or []
    unit = metric.get("category_unit", metric["unit"])
    svg = charts.ranked_bars(
        cats, theme, limit=limit,
        value_format=lambda v: fmt.format_compact(v, unit))
    rows = [[c["label"], fmt.format_value(c["value"], unit)] for c in cats]
    shown = min(limit, len(cats))
    label = (f"table view — all {len(cats)} rows" if len(cats) > shown else "table view")
    return f'<div class="chart">{svg}</div>' + _table_view(
        [metric["label"], f'{metric["latest_year"] or ""}'.strip() or "Value"],
        rows, label)


def _share_block(metric: dict, theme: dict) -> str:
    """A two-or-three-way split rendered as one 100% bar."""
    cats = metric.get("categories") or []
    unit = metric["unit"]
    svg = charts.stacked_bar(
        cats, theme, value_format=lambda v: fmt.format_compact(v, unit))
    rows = [[c["label"], fmt.format_value(c["value"], unit)] for c in cats]
    return f'<div class="chart">{svg}</div>' + _table_view(
        [metric["label"], "Households"], rows)


def _distribution_block(metric: dict, theme: dict) -> str:
    """An ordered histogram with the median bucket highlighted.

    The highlight is the whole point: a 26-bar shape tells you the spread, but
    only the marked bucket tells you where the middle household actually sits.
    """
    cats = metric.get("categories") or []
    if not cats:
        return ""
    # Categories arrive sorted by size; buckets must be redrawn in their
    # published order or the distribution is meaningless.
    ordered = sorted(cats, key=lambda c: (bundle_mod.parse_bucket_bounds(c["label"]) or (0, 0))[0])
    bounds = [bundle_mod.parse_bucket_bounds(c["label"]) for c in ordered]
    usable = [(c, b) for c, b in zip(ordered, bounds) if b]
    median_index = None
    median_value = None
    if usable:
        cats_u = [c for c, _ in usable]
        bounds_u = [b for _, b in usable]
        median_value = bundle_mod.interpolated_median(cats_u, bounds_u)
        if median_value is not None:
            for i, (_, (low, high)) in enumerate(usable):
                if low <= median_value <= high:
                    median_index = i
                    break

    svg = charts.histogram(
        [c for c, _ in usable] or ordered, theme, highlight=median_index,
        value_format=lambda v: f"{v:,.0f}")
    caption = ""
    if median_value is not None:
        caption = (f'<p class="caption">Median ≈ {fmt.format_value(median_value, "usd")}, '
                   f'interpolated from this histogram — Data USA publishes no working '
                   f'median-value series at city level.</p>')
    rows = [[c["label"], fmt.format_value(c["value"], "count")] for c in ordered]
    return (f'<div class="chart">{svg}</div>{caption}'
            + _table_view(["Bracket", "Households"], rows))


def _metric_block(metric: dict, theme: dict) -> str:
    """Dispatch a metric to the form its shape calls for."""
    if not metric["available"]:
        return (f'<p class="unavailable">{_esc(metric["label"])} — '
                f'{_esc(metric["reason"])}.</p>')

    # Order matters: the specific keys are tested BEFORE the generic
    # breakdown branch, because they are all breakdowns too — checking kind
    # first swallows them and renders every one as ranked bars.
    if metric["key"] in ("income_distribution", "home_value_distribution"):
        body = _distribution_block(metric, theme)
    elif metric["key"] == "tenure":
        body = _share_block(metric, theme)
    elif metric["kind"] == "breakdown":
        body = _breakdown_block(metric, theme)
    else:
        body = _trend_block(metric, theme)

    note = f'<p class="caption">{_esc(metric["note"])}</p>' if metric["note"] else ""
    return body + note + _moe_note(metric)


#: Rough rendered height of a block, in arbitrary units, used only to balance
#: the two columns. A trend chart is a fixed-height sparkline plus its heading;
#: a breakdown grows with its bar count.
_TREND_UNITS = 4
_ROW_UNITS = 1


def _estimated_units(metric: dict) -> int:
    """How tall this block will render, roughly.

    Only the *ratio* between blocks matters — this feeds column packing, not
    layout geometry, so it can be crude as long as it ranks blocks correctly.
    """
    if not metric["available"]:
        return 1
    if metric["key"] in ("income_distribution", "home_value_distribution"):
        return 8
    if metric["key"] == "tenure":
        return 5
    if metric["kind"] == "breakdown":
        return 3 + _ROW_UNITS * min(len(metric["categories"]), BREAKDOWN_LIMIT)
    return _TREND_UNITS


def _pack_columns(blocks: list[tuple[int, str]]) -> tuple[list[str], list[str]]:
    """Greedily assign blocks to two columns, always filling the shorter one.

    CSS multi-column balances by *splitting the flow*, which cannot help when
    one block dominates a short section: Work & Commute is a 4-unit trend, an
    11-unit breakdown and a 4-unit trend, and every flow-order split of that
    leaves one column near-empty (the observed failure — a half-page void
    beside the commute chart). Packing explicitly lets the tall block stand
    alone opposite the two short ones, which balances. Reading order within a
    column is preserved; only the left/right assignment changes.
    """
    left: list[str] = []
    right: list[str] = []
    left_h = right_h = 0
    for units, html_block in blocks:
        if left_h <= right_h:
            left.append(html_block)
            left_h += units
        else:
            right.append(html_block)
            right_h += units
    return left, right


def _section_html(section_key: str, title: str, metrics: dict, theme: dict) -> str:
    """One ruled editorial section: heading, then a block per metric."""
    entries = [metrics[m.key] for m in manifest.metrics_for_section(section_key)
               if m.key in metrics]
    if not entries:
        return ""
    blocks = []
    for metric in entries:
        blocks.append((
            _estimated_units(metric),
            f'<div class="block"><h3 class="block-title">{_esc(metric["label"])}</h3>'
            f'{_metric_block(metric, theme)}</div>'))
    left, right = _pack_columns(blocks)
    return (f'<section class="report-section"><h2>{_esc(title)}</h2>'
            f'<div class="cols">'
            f'<div class="col">{"".join(left)}</div>'
            f'<div class="col">{"".join(right)}</div>'
            f'</div></section>')


# ------------------------------------------------------------------ document


def _standfirst(data: dict) -> str:
    """The serif-italic opening line: the two or three facts that frame the rest."""
    metrics = data["metrics"]
    pop = metrics.get("population", {})
    income = metrics.get("median_household_income", {})
    age = metrics.get("median_age", {})
    bits = []
    if pop.get("latest"):
        bits.append(f'{fmt.format_value(pop["latest"], "count")} residents')
    if income.get("latest"):
        bits.append(f'a median household income of '
                    f'{fmt.format_value(income["latest"], "usd")}')
    if age.get("latest"):
        bits.append(f'a median age of {fmt.format_value(age["latest"], "years")}')
    if not bits:
        return "A demographic profile drawn from the American Community Survey."
    year = pop.get("latest_year") or income.get("latest_year") or ""
    return f'{data["place"]["name"]} has {", ".join(bits)} as of {year}.'


def build_html(data: dict, sections: list[str] | None = None) -> str:
    """Assemble the full document.

    ``sections`` restricts output to named sections — the same renderer and the
    same blocks, just fewer of them, so a "housing report" can never drift from
    the housing section of the full profile.
    """
    theme = brand.load_theme()
    ident = theme["identity"]
    metrics = data["metrics"]
    wanted = [(k, t) for k, t in manifest.SECTIONS
              if not sections or k in sections]

    stamp = _dt.datetime.fromisoformat(data["fetched_at"]).strftime("%b %Y").upper()
    # The masthead must describe what the document actually contains. Naming it
    # after `wanted[0]` labelled a two-section report with whichever section
    # happened to sort first — a file called "…-housing.html" whose masthead
    # read "ECONOMY REPORT".
    if not sections:
        kind = "CITY PROFILE"
    elif len(wanted) == 1:
        kind = f"{wanted[0][1].upper()} REPORT"
    else:
        # Middot, not "&" — one section is already called "Work & Commute", so
        # an ampersand join reads as "ECONOMY & WORK & COMMUTE" and hides where
        # one section ends and the next begins.
        kind = " · ".join(title.upper() for _, title in wanted)
    eyebrow = f'{ident["brand_line"]} · {kind} · {stamp}'

    headline = [metrics[m.key] for m in manifest.headline_metrics()
                if m.key in metrics and metrics[m.key]["available"]]
    if sections:
        headline = [m for m in headline if m["section"] in sections]
    # Exactly one accent figure in the strip — the brand allows one loud mark,
    # and spending it on the city's population is the reading everything else
    # is scaled against.
    focal_key = headline[0]["key"] if headline else None
    strip = "".join(_stat_tile(m, m["key"] == focal_key) for m in headline)

    body_sections = "".join(
        _section_html(key, title, metrics, theme) for key, title in wanted)

    years = [m["latest_year"] for m in metrics.values() if m.get("latest_year")]
    vintage_year = max(years) if years else ""
    tables = sorted({m["table_id"] for m in metrics.values() if m.get("table_id")})
    fetched = _dt.datetime.fromisoformat(data["fetched_at"]).strftime("%Y-%m-%d")

    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{_esc(data["place"]["name"])} — City Profile</title>
<style>{brand.stylesheet(theme)}</style>
</head><body><main>
<header class="masthead">
  <div class="masthead-row">
    <span class="stamp">{_esc(ident["stamp"])}</span>
    <span class="eyebrow">{_esc(eyebrow)}</span>
    <span class="byline">{_esc(ident["byline"])}</span>
  </div>
  <h1>{_esc(data["place"]["name"])}</h1>
  <p class="standfirst">{_esc(_standfirst(data))}</p>
</header>
<section class="stat-strip">{strip}</section>
{body_sections}
<footer class="provenance">
  <strong>Source</strong> {_esc(data["source"])}<br>
  <strong>Vintage</strong> {_esc(data["vintage"])}, {_esc(vintage_year)} ·
  benchmarks: {_esc(data["place"]["state_name"])} and the United States<br>
  <strong>Census tables</strong> {_esc(", ".join(tables)) or "—"}<br>
  <strong>Retrieved</strong> {_esc(fetched)} · figures marked with a wide margin of
  error are sample estimates and should be read as ranges
</footer>
</main></body></html>
"""


# --------------------------------------------------------------- comparison


def _shares(metric: dict, limit: int) -> list[dict]:
    """A breakdown's categories as percentages of its own total.

    Raw counts cannot be compared across cities of different size — a 2,178
    person town's every bar disappears beside a 131,627 person city's, and the
    chart ends up measuring population instead of composition.
    """
    cats = metric.get("categories") or []
    total = sum(c["value"] for c in cats)
    if total <= 0:
        return []
    return [{"label": c["label"], "share": c["value"] / total * 100}
            for c in cats[:limit]]


def _paired_rows(metric_a: dict, metric_b: dict, limit: int) -> list[dict]:
    """Union the two cities' leading categories, largest combined share first.

    Taking only city A's top categories would hide whatever city B is
    distinctive for, which is usually the interesting half of a comparison.
    """
    a = {r["label"]: r["share"] for r in _shares(metric_a, 99)}
    b = {r["label"]: r["share"] for r in _shares(metric_b, 99)}
    labels = sorted(set(a) | set(b),
                    key=lambda label: max(a.get(label, 0), b.get(label, 0)),
                    reverse=True)
    return [{"label": label, "a": a.get(label, 0.0), "b": b.get(label, 0.0)}
            for label in labels[:limit]]


def _index_to_base(series: dict) -> dict:
    """Rebase a series so its earliest year is 100.

    Turns "how big" into "how much has it changed", which is the only
    like-for-like reading when two cities differ in size by 60×.
    """
    if not series:
        return {}
    base_year = min(series, key=lambda y: int(y))
    base = series[base_year]
    if not base:
        return {}
    return {year: value / base * 100 for year, value in series.items()}


def _share_pct(value: float) -> str:
    """Format a share, keeping a decimal where rounding would print "0%".

    A visible bar labelled 0% reads as a rendering bug rather than a small
    number; 0.4% is both honest and legible.
    """
    return f"{value:.0f}%" if value >= 10 else f"{value:.1f}%"


def _compare_delta(metric_a: dict, metric_b: dict) -> str:
    """How A stands against B, phrased in the metric's own terms."""
    if not (metric_a.get("available") and metric_b.get("available")):
        return ""
    return fmt.compare(metric_a["latest"], metric_b["latest"], metric_a["unit"])


def _compare_stat_tile(metric_a: dict, metric_b: dict, name_a: str, name_b: str) -> str:
    """One masthead figure carrying both cities and the gap between them."""
    unit = metric_a["unit"]
    a_val = fmt.format_compact(metric_a.get("latest"), unit)
    b_val = fmt.format_compact(metric_b.get("latest"), unit)
    delta = _compare_delta(metric_a, metric_b)
    flags = []
    if metric_a.get("wide_margin"):
        flags.append(name_a)
    if metric_b.get("wide_margin"):
        flags.append(name_b)
    flag_html = (f'<span class="bench">wide margin: {_esc(", ".join(flags))}</span>'
                 if flags else "")
    return (
        f'<div class="stat">'
        f'<span class="value">{_esc(a_val)}</span>'
        f'<span class="value alt">{_esc(b_val)}</span>'
        f'<span class="label">{_esc(metric_a["label"])}</span>'
        f'<span class="bench">{_esc(delta)} vs {_esc(name_b)}</span>'
        f'{flag_html}</div>')


def _compare_block(metric_a: dict, metric_b: dict, theme: dict,
                   name_a: str, name_b: str) -> str:
    """One metric, both cities."""
    if not (metric_a["available"] and metric_b["available"]):
        missing = name_a if not metric_a["available"] else name_b
        return (f'<p class="unavailable">{_esc(metric_a["label"])} — not published '
                f'for {_esc(missing)}.</p>')

    if metric_a["kind"] == "breakdown":
        rows = _paired_rows(metric_a, metric_b, BREAKDOWN_LIMIT)
        svg = charts.paired_bars(rows, theme, value_format=_share_pct)
        table_rows = [[r["label"], f'{r["a"]:.1f}%', f'{r["b"]:.1f}%'] for r in rows]
        body = (f'<div class="chart">{svg}</div>'
                + _table_view([metric_a["label"], name_a, name_b], table_rows,
                              "table view — % of category total"))
        caption = ('<p class="caption">Shown as a share of each city\'s own '
                   'total, so the comparison measures composition rather than '
                   'size.</p>')
        return charts.legend([name_a, name_b], theme) + body + caption

    unit = metric_a["unit"]
    series_a = metric_a.get("series") or {}
    series_b = metric_b.get("series") or {}
    caption = ""

    # Counts of wildly different magnitude cannot share a linear axis — a town
    # of 2,178 and a city of 131,627 both render as flat lines and the chart
    # says nothing. Indexing each city to its own first year turns it into the
    # comparison that was actually wanted: which one is growing faster.
    if unit == "count":
        plot_a, plot_b = _index_to_base(series_a), _index_to_base(series_b)
        base_year = min([int(y) for y in (plot_a or plot_b)], default="")
        plot_fmt = lambda v: f"{v:.0f}"  # noqa: E731
        caption = (f'<p class="caption">Indexed to each city\'s own '
                   f'{base_year} level = 100, because the two populations differ '
                   f'by enough that a shared axis would flatten both lines. '
                   f'Absolute values are in the table.</p>')
    else:
        plot_a, plot_b = series_a, series_b
        plot_fmt = lambda v: fmt.format_compact(v, unit)  # noqa: E731

    svg = charts.dual_sparkline(plot_a, plot_b, theme, value_format=plot_fmt,
                                label=metric_a["label"])
    years = sorted(set(series_a) | set(series_b))
    table_rows = [[
        year,
        fmt.format_value(series_a.get(year), unit),
        fmt.format_value(series_b.get(year), unit),
    ] for year in years]
    body = (f'<div class="chart">{svg}</div>' + caption
            + _table_view(["Year", name_a, name_b], table_rows))
    return (charts.legend([name_a, name_b], theme) + body
            + _moe_note(metric_a) + _moe_note(metric_b))


def _compare_section_html(section_key: str, title: str, data_a: dict, data_b: dict,
                          theme: dict, name_a: str, name_b: str) -> str:
    blocks = []
    for metric in manifest.metrics_for_section(section_key):
        m_a = data_a["metrics"].get(metric.key)
        m_b = data_b["metrics"].get(metric.key)
        if not (m_a and m_b):
            continue
        blocks.append((
            _estimated_units(m_a) + 1,
            f'<div class="block"><h3 class="block-title">{_esc(m_a["label"])}</h3>'
            f'{_compare_block(m_a, m_b, theme, name_a, name_b)}</div>'))
    if not blocks:
        return ""
    left, right = _pack_columns(blocks)
    return (f'<section class="report-section"><h2>{_esc(title)}</h2>'
            f'<div class="cols"><div class="col">{"".join(left)}</div>'
            f'<div class="col">{"".join(right)}</div></div></section>')


def build_comparison_html(data_a: dict, data_b: dict,
                          sections: list[str] | None = None) -> str:
    """A two-city comparison document.

    Deliberately not two reports side by side: every block puts both cities on
    one scale, breakdowns are normalised to shares, and the masthead carries
    the gap rather than two independent figures.
    """
    theme = brand.load_theme()
    ident = theme["identity"]
    name_a, name_b = data_a["place"]["name"], data_b["place"]["name"]
    wanted = [(k, t) for k, t in manifest.SECTIONS if not sections or k in sections]

    stamp = _dt.datetime.fromisoformat(data_a["fetched_at"]).strftime("%b %Y").upper()
    eyebrow = f'{ident["brand_line"]} · CITY COMPARISON · {stamp}'

    strip = "".join(
        _compare_stat_tile(data_a["metrics"][m.key], data_b["metrics"][m.key],
                           name_a, name_b)
        for m in manifest.headline_metrics()
        if m.key in data_a["metrics"] and m.key in data_b["metrics"]
        and data_a["metrics"][m.key]["available"]
        and data_b["metrics"][m.key]["available"]
        and (not sections or m.section in sections))

    body = "".join(
        _compare_section_html(key, title, data_a, data_b, theme, name_a, name_b)
        for key, title in wanted)

    years = [m["latest_year"] for d in (data_a, data_b)
             for m in d["metrics"].values() if m.get("latest_year")]
    vintage_year = max(years) if years else ""
    tables = sorted({m["table_id"] for d in (data_a, data_b)
                     for m in d["metrics"].values() if m.get("table_id")})
    fetched = _dt.datetime.fromisoformat(data_a["fetched_at"]).strftime("%Y-%m-%d")

    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{_esc(name_a)} vs {_esc(name_b)} — City Comparison</title>
<style>{brand.stylesheet(theme)}</style>
</head><body><main>
<header class="masthead">
  <div class="masthead-row">
    <span class="stamp">{_esc(ident["stamp"])}</span>
    <span class="eyebrow">{_esc(eyebrow)}</span>
    <span class="byline">{_esc(ident["byline"])}</span>
  </div>
  <h1>{_esc(name_a)}<span class="versus">vs</span>{_esc(name_b)}</h1>
  <p class="standfirst">Every figure below puts both cities on one scale.
  Breakdowns are shown as a share of each city's own total, so the comparison
  measures composition rather than size.</p>
</header>
<section class="stat-strip">{strip}</section>
{body}
<footer class="provenance">
  <strong>Source</strong> {_esc(data_a["source"])}<br>
  <strong>Vintage</strong> {_esc(data_a["vintage"])}, {_esc(vintage_year)} ·
  each city's state benchmarks differ and are omitted here<br>
  <strong>Census tables</strong> {_esc(", ".join(tables)) or "—"}<br>
  <strong>Retrieved</strong> {_esc(fetched)} · figures marked with a wide margin of
  error are sample estimates and should be read as ranges
</footer>
</main></body></html>
"""


def write_report(data: dict, out_dir: str, sections: list[str] | None = None) -> str:
    os.makedirs(out_dir, exist_ok=True)
    # Every requested section appears in the filename, so a two-section report
    # can't be mistaken for the single-section one it would otherwise overwrite.
    suffix = f"-{'-'.join(sections)}" if sections else ""
    stamp = _dt.datetime.now().strftime("%Y-%m-%d")
    path = os.path.join(out_dir, f'{data["place"]["slug"]}{suffix}-{stamp}.html')
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(build_html(data, sections))
    return path


def write_comparison(data_a: dict, data_b: dict, out_dir: str,
                     sections: list[str] | None = None) -> str:
    os.makedirs(out_dir, exist_ok=True)
    suffix = f"-{'-'.join(sections)}" if sections else ""
    stamp = _dt.datetime.now().strftime("%Y-%m-%d")
    path = os.path.join(
        out_dir,
        f'{data_a["place"]["slug"]}-vs-{data_b["place"]["slug"]}{suffix}-{stamp}.html')
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(build_comparison_html(data_a, data_b, sections))
    return path


def open_in_browser(path: str) -> None:
    """Open the report on the user's own screen.

    A report the user has not seen is not a delivered report — the whole value
    of this step is visual, so it opens by default and only ``--no-open``
    suppresses it.
    """
    try:
        if sys.platform == "darwin":
            subprocess.run(["open", path], check=False)
        else:
            webbrowser.open(f"file://{os.path.abspath(path)}")
    except OSError:
        pass


def main(argv: list[str] | None = None) -> int:
    import datausa

    parser = argparse.ArgumentParser(description="Render a PRESS city report.")
    parser.add_argument("city", nargs="?",
                        help='Slug (minneapolis-mn) or name ("Minneapolis, MN"). '
                             'Omit when only one city is loaded.')
    parser.add_argument("--section", action="append", dest="sections",
                        type=normalize_section,
                        help=f"Limit to a section, repeatable: "
                             f"{', '.join(SECTION_KEYS)}.")
    parser.add_argument("--vs", metavar="CITY",
                        help='Render a two-city comparison against this loaded '
                             'city, e.g. --vs "Fargo, ND".')
    parser.add_argument("--out", default="reports",
                        help="Output directory (default: ./reports).")
    parser.add_argument("--no-open", action="store_true",
                        help="Don't open the report in a browser.")
    args = parser.parse_args(argv)

    slug, message = datausa.resolve_cached_slug(args.city)
    if slug is None:
        print(message, file=sys.stderr)
        return 1

    # De-duplicate while keeping manifest order, so --section housing --section
    # housing doesn't produce a doubled filename.
    sections = None
    if args.sections:
        sections = [k for k in SECTION_KEYS if k in set(args.sections)]

    data = load_bundle(slug)

    if args.vs:
        other_slug, message = datausa.resolve_cached_slug(args.vs)
        if other_slug is None:
            print(message, file=sys.stderr)
            return 1
        if other_slug == slug:
            print("Both cities are the same — nothing to compare.", file=sys.stderr)
            return 1
        path = write_comparison(data, load_bundle(other_slug), args.out, sections)
    else:
        path = write_report(data, args.out, sections)

    print(f"Report written: {path}")
    if not args.no_open:
        open_in_browser(path)
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())

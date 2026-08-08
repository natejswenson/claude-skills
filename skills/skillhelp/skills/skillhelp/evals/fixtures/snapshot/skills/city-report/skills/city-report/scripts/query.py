#!/usr/bin/env python3
"""Answer a question about an already-loaded city — local files only, no network.

    python3 scripts/query.py --cities                  # what's loaded
    python3 scripts/query.py                           # list metrics
    python3 scripts/query.py poverty_rate              # one metric, full detail
    python3 scripts/query.py commute_means --top 5
    python3 scripts/query.py median_household_income --series
    python3 scripts/query.py "Duluth, MN" poverty_rate # name a city when several are loaded

The city argument is optional whenever exactly one city is loaded, and accepts
either a slug or a place name — nobody should have to retype ``minneapolis-mn``
from memory to see data they just loaded.

This exists so a follow-up question never costs a round trip. The bundle is
already on disk and its digest is already in the agent's context, so most
questions need no tool call at all; this covers the rest — a full year series,
the long tail of a breakdown, exact margins of error.
"""
from __future__ import annotations

import argparse
import json
import sys

import datausa
import fmt
import manifest
import report as report_mod


def list_metrics(data: dict) -> str:
    """Every metric key with its latest value — the index for the other mode."""
    lines = [f'{data["place"]["name"]} — {len(data["metrics"])} metrics', ""]
    for section_key, section_title in manifest.SECTIONS:
        lines.append(section_title.upper())
        for m in manifest.metrics_for_section(section_key):
            metric = data["metrics"].get(m.key)
            if not metric:
                continue
            if metric["kind"] == "breakdown":
                value = f'{len(metric["categories"])} categories'
            elif metric["available"]:
                value = fmt.format_value(metric["latest"], metric["unit"])
            else:
                value = "unavailable"
            lines.append(f'  {m.key:<28} {value}')
        lines.append("")
    return "\n".join(lines).rstrip()


def describe(metric: dict, top: int | None = None, series: bool = False) -> str:
    """Full detail for one metric: value, margin, benchmarks, and its data."""
    if not metric["available"]:
        return f'{metric["label"]}: {metric["reason"]}.'

    lines = [f'{metric["label"]}  ({metric["latest_year"]}, {metric["cube"]})']

    if metric["kind"] != "breakdown":
        value = fmt.format_value(metric["latest"], metric["unit"])
        moe = fmt.format_moe(metric.get("moe"), metric["unit"])
        lines.append(f'  value      {value} {moe}'.rstrip())
        if metric["wide_margin"]:
            lines.append(f'  WARNING    margin of error is '
                         f'{metric["moe_ratio"] * 100:.0f}% of the estimate — '
                         f'read as a range, not a number')
        for level, bench in (metric.get("benchmarks") or {}).items():
            lines.append(
                f'  vs {fmt.BENCH_LABEL.get(level, level):<7} '
                f'{fmt.format_value(bench["value"], metric["unit"])}  '
                f'({fmt.compare(metric["latest"], bench["value"], metric["unit"])})')
        growth = metric.get("growth")
        if growth:
            lines.append(f'  change     {growth["pct"]:+.0f}% '
                         f'({growth["from_year"]}–{growth["to_year"]})')

    if metric["categories"]:
        shown = metric["categories"][:top] if top else metric["categories"]
        cat_unit = metric.get("category_unit", metric["unit"])
        lines.append("")
        for cat in shown:
            lines.append(f'  {cat["label"]:<52} '
                         f'{fmt.format_value(cat["value"], cat_unit):>12}')
        if top and len(metric["categories"]) > top:
            lines.append(f'  ... {len(metric["categories"]) - top} more')

    if series and metric["series"]:
        lines.append("")
        for year, value in sorted(metric["series"].items()):
            lines.append(f'  {year}  {fmt.format_value(value, metric["unit"]):>12}')

    if metric["note"]:
        lines.append("")
        lines.append(f'  note: {metric["note"]}')
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Query a cached city bundle (offline).")
    parser.add_argument("city", nargs="?",
                        help='Slug (minneapolis-mn) or name ("Minneapolis, MN"). '
                             'Omit when only one city is loaded.')
    parser.add_argument("metric", nargs="?", help="Metric key; omit to list all.")
    parser.add_argument("--top", type=int, help="Limit breakdown rows.")
    parser.add_argument("--series", action="store_true",
                        help="Include the full year-by-year series.")
    parser.add_argument("--json", action="store_true",
                        help="Emit the raw metric object as JSON.")
    parser.add_argument("--cities", action="store_true",
                        help="List the cities currently cached, and exit.")
    args = parser.parse_args(argv)

    if args.cities:
        cached = datausa.list_cached()
        if not cached:
            print(f'No city loaded yet. Run:  '
                  f'{datausa.script_cmd("load.py")} "<City, ST>"')
            return 0
        for slug, name in cached:
            print(f"  {slug:<28} {name}")
        return 0

    city, metric_name = args.city, args.metric
    # `query.py poverty_rate` is the natural thing to type when one city is
    # loaded. Both positionals are optional, so a lone argument would otherwise
    # be read as a city name and fail with a confusing "not loaded" error.
    if city and not metric_name and city in manifest.METRICS_BY_KEY:
        city, metric_name = None, city

    slug, message = datausa.resolve_cached_slug(city)
    if slug is None:
        print(message, file=sys.stderr)
        return 1

    data = report_mod.load_bundle(slug)

    if not metric_name:
        print(list_metrics(data))
        return 0

    metric = data["metrics"].get(metric_name)
    if metric is None:
        print(f'Unknown metric "{metric_name}". Known keys:', file=sys.stderr)
        print("  " + ", ".join(sorted(data["metrics"])), file=sys.stderr)
        return 1

    if args.json:
        print(json.dumps(metric, indent=2))
    else:
        print(describe(metric, top=args.top, series=args.series))
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())

#!/usr/bin/env python3
"""Load a city's full Data USA bundle into the local cache, and print a digest.

    python3 scripts/load.py "Minneapolis, MN"
    python3 scripts/load.py "Minneapolis, MN" --refresh
    python3 scripts/load.py "Springfield" --list

Every manifest query runs concurrently for the place, its state and the nation
— one burst, ~2s cold, then cached for 24 hours. The digest printed to stdout
is the point of the command: it lands in the agent's context, so ordinary
follow-up questions ("what's the poverty rate?", "how does income compare to
the state?") are answered from context with no further tool call at all.

Ambiguous input is never guessed. ``"Springfield"`` matches 25 places, so the
command lists them and stops rather than silently picking one.
"""
from __future__ import annotations

import argparse
import sys

import bundle as bundle_mod
import datausa
import fmt
import manifest


def digest(data: dict) -> str:
    """A compact, high-signal summary of the whole bundle.

    Written for a reader who will answer questions from it later, so it leads
    with the headline figures and their benchmark deltas, then lists every
    remaining metric with its latest value. Wide-margin figures are marked
    inline — an estimate whose margin swamps it must not be quoted back as
    fact.
    """
    place = data["place"]
    metrics = data["metrics"]
    lines = [
        f'{place["name"]}  ({place["place_id"]})',
        f'{data["vintage"]} · benchmarks: {place["state_name"]}, United States',
        "",
        "HEADLINE",
    ]

    for m in manifest.headline_metrics():
        metric = metrics.get(m.key)
        if not metric or not metric["available"]:
            continue
        value = fmt.format_value(metric["latest"], metric["unit"])
        bits = fmt.context_bits(metric)
        flag = fmt.margin_note(metric)
        lines.append(f'  {metric["label"]:<26} {value:>12}   '
                     f'{" · ".join(bits)}{flag}  ({metric["latest_year"]})')

    for section_key, section_title in manifest.SECTIONS:
        rows = []
        for m in manifest.metrics_for_section(section_key):
            metric = metrics.get(m.key)
            if not metric:
                continue
            if not metric["available"]:
                rows.append(f'  {metric["label"]:<34} unavailable')
                continue
            if metric["kind"] == "breakdown":
                top = metric["categories"][:3]
                cat_unit = metric.get("category_unit", metric["unit"])
                summary = "; ".join(
                    f'{c["label"]} {fmt.format_compact(c["value"], cat_unit)}'
                    for c in top)
                rows.append(f'  {metric["label"]:<34} {summary}')
            else:
                rows.append(f'  {metric["label"]:<34} '
                            f'{fmt.format_value(metric["latest"], metric["unit"])}'
                            f'{fmt.margin_note(metric)}')
        if rows:
            lines.append("")
            lines.append(section_title.upper())
            lines.extend(rows)

    unavailable = [m["label"] for m in metrics.values() if not m["available"]]
    lines.append("")
    lines.append(f'Loaded {len(metrics) - len(unavailable)}/{len(metrics)} metrics '
                 f'for {place["name"]}')
    lines.append(f'Report:  {datausa.script_cmd("report.py")} "{place["name"]}"')
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Load a city's Data USA bundle and print a digest.")
    parser.add_argument("city", help='City and state, e.g. "Minneapolis, MN"')
    parser.add_argument("--refresh", action="store_true",
                        help="Bypass the cache and refetch.")
    parser.add_argument("--list", action="store_true",
                        help="List matching places and exit without fetching.")
    args = parser.parse_args(argv)

    candidates, how = datausa.resolve_place(args.city, refresh=args.refresh)
    if not candidates:
        print(f'No Census place matches "{args.city}".\n'
              f'Try "City, ST" — e.g. "Duluth, MN".', file=sys.stderr)
        return 1

    if args.list or len(candidates) > 1:
        print(f'{len(candidates)} places match "{args.city}" ({how} match):')
        # A bare "Springfield" matches dozens. Showing every one buries the
        # question being asked; the state suffix is what the user needs to add.
        shown = candidates if args.list else candidates[:12]
        for c in shown:
            print(f'  {c.name}   [{c.place_id}]')
        if len(shown) < len(candidates):
            print(f'  ... and {len(candidates) - len(shown)} more '
                  f'(--list shows all)')
        if len(candidates) > 1:
            print('\nRe-run with the full "City, ST" for the one you want.')
            return 2
        return 0

    place = candidates[0]
    cache_name = f"bundle-{place.slug}.json"
    data = None if args.refresh else datausa.read_cache(cache_name, datausa.BUNDLE_TTL)

    if data is None:
        payloads = datausa.fetch_place_data(place)
        data = bundle_mod.build_bundle(place, payloads)
        datausa.write_cache(cache_name, data)
        source = "fetched"
    else:
        source = "cached"

    if how != "exact":
        print(f'Matched "{args.city}" -> {place.name} ({how} match)\n')
    print(digest(data))
    print(f"\n[{source}: {datausa.cache_path(cache_name)}]")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())

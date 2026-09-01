#!/usr/bin/env python3
"""Record how a published post performed.

Updates a record in ~/.claude/ghostwriter/published.jsonl (written by
scripts/linkedin_post.py) with a self-reported outcome. The skill reads these
outcomes to bias future topic/format choices — LinkedIn exposes no member-post
analytics API, so the loop is closed by asking the human (see COMPLIANCE.md:
no scraping). The optional numeric fields (--impressions/--reactions/--comments)
are read off the post's own analytics view in the LinkedIn app by the human;
they are the only real distribution signal available, so capture them when
offered.

Usage:
    python3 scripts/post_outcome.py --latest --outcome great
    python3 scripts/post_outcome.py --slug 2026-08-18-autofix-injection --outcome flopped --impressions 210
    python3 scripts/post_outcome.py --urn urn:li:share:123 --outcome flopped --notes "no comments"
    python3 scripts/post_outcome.py --list-unscored

Standard library only.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

PUBLISHED_LOG = Path.home() / ".claude" / "ghostwriter" / "published.jsonl"
OUTCOMES = ("great", "normal", "flopped")


def load_records(log_path: Path) -> list[dict]:
    if not log_path.exists():
        sys.exit(f"ERROR: {log_path} not found — nothing has been published yet.")
    records = []
    for line in log_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            records.append(json.loads(line))
    if not records:
        sys.exit(f"ERROR: {log_path} is empty.")
    return records


def pick_record(
    records: list[dict], urn: str | None, slug: str | None, latest: bool
) -> dict:
    if urn:
        for rec in records:
            if rec.get("urn") == urn:
                return rec
        sys.exit(f"ERROR: no record with urn {urn}.")
    if slug:
        for rec in records:
            if rec.get("slug") == slug:
                return rec
        sys.exit(f"ERROR: no record with slug {slug}.")
    if latest:
        # The most recent record still missing an outcome; else the newest overall.
        unscored = [r for r in records if not r.get("outcome")]
        return (unscored or records)[-1]
    sys.exit("ERROR: pass --urn <urn>, --slug <slug>, or --latest.")


def list_unscored(records: list[dict]) -> None:
    unscored = [r for r in records if not r.get("outcome")]
    if not unscored:
        print("All published posts have an outcome recorded.")
        return
    for rec in unscored:
        first = (rec.get("first_line") or "")[:60]
        print(f"{rec.get('date', '?')}  {rec.get('slug') or rec.get('urn')}  {first}")
    print(f"({len(unscored)} unscored of {len(records)} published)")


def stats(records: list[dict]) -> None:
    """The computed half of the feedback loop: what each lane/format actually did.

    The idea menu used to re-derive this by eyeballing the raw jsonl every
    session; this prints one authoritative rollup to cite in the board's
    provenance line instead.
    """
    cols = ("great", "normal", "flopped", "unscored")

    def bump(table: dict, key: str, outcome: str) -> None:
        table.setdefault(key, dict.fromkeys(cols, 0))[outcome] += 1

    lanes: dict[str, dict] = {}
    formats: dict[str, dict] = {}
    for rec in records:
        outcome = rec.get("outcome") or "unscored"
        bump(lanes, rec.get("lane") or "?", outcome)
        bump(formats, rec.get("format") or "?", outcome)

    def render(name: str, table: dict) -> str:
        lines = [
            f"| {name} | " + " | ".join(cols) + " | flop rate |",
            "|---|" + "---|" * (len(cols) + 1),
        ]
        for key in sorted(table):
            row = table[key]
            scored = row["great"] + row["normal"] + row["flopped"]
            rate = f"{row['flopped']}/{scored}" if scored else "—"
            lines.append(
                f"| {key} | " + " | ".join(str(row[c]) for c in cols) + f" | {rate} |"
            )
        return "\n".join(lines)

    print(render("lane", lanes))
    print()
    print(render("format", formats))

    scored = [r for r in records if r.get("outcome")]
    with_numbers = [r for r in scored if isinstance(r.get("impressions"), int)]
    trailing_without = 0
    for rec in reversed(scored):
        if isinstance(rec.get("impressions"), int):
            break
        trailing_without += 1
    print(
        f"\nimpressions recorded: {len(with_numbers)} of {len(scored)} scored"
        f" · trailing scored posts without a number: {trailing_without}"
    )
    if trailing_without >= 3:
        print(
            "NOTE: 3+ scored posts in a row have no impressions number —"
            " the recovery protocol in voice/algorithm.md cannot be evaluated"
            " without them (it judges the trend across 6+ posts under ~300)."
        )


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    which = ap.add_mutually_exclusive_group(required=True)
    which.add_argument("--urn", help="URN of the post to score (from the publish log).")
    which.add_argument("--slug", help="Slug of the post to score (from the publish log).")
    which.add_argument(
        "--latest",
        action="store_true",
        help="Score the most recent post that has no outcome yet.",
    )
    which.add_argument(
        "--list-unscored",
        action="store_true",
        help="List posts with no outcome recorded, oldest first, then exit.",
    )
    which.add_argument(
        "--stats",
        action="store_true",
        help="Print the lane/format outcome rollup the idea menu ranks against, then exit.",
    )
    ap.add_argument("--outcome", choices=OUTCOMES)
    ap.add_argument("--notes", default="", help="Optional free-text context.")
    ap.add_argument(
        "--impressions",
        type=int,
        help="Impression count read off the post's analytics in the LinkedIn app.",
    )
    ap.add_argument("--reactions", type=int, help="Reaction count from the app.")
    ap.add_argument(
        "--impressions-declined",
        action="store_true",
        help="Record explicitly that the user was asked for the impressions number and did not have it.",
    )
    ap.add_argument("--comments", type=int, help="Comment count from the app.")
    ap.add_argument(
        "--log",
        default=str(PUBLISHED_LOG),
        help=argparse.SUPPRESS,  # test hook
    )
    args = ap.parse_args()

    log_path = Path(args.log)
    records = load_records(log_path)

    if args.list_unscored:
        list_unscored(records)
        return

    if args.stats:
        stats(records)
        return

    if not args.outcome:
        ap.error("--outcome is required unless --list-unscored is used.")

    rec = pick_record(records, args.urn, args.slug, args.latest)
    rec["outcome"] = args.outcome
    if args.notes:
        rec["outcome_notes"] = args.notes
    for field in ("impressions", "reactions", "comments"):
        value = getattr(args, field)
        if value is not None:
            rec[field] = value
    if args.impressions_declined and args.impressions is None:
        rec["impressions"] = None  # asked, not provided — distinct from never asked
    rec["outcome_date"] = time.strftime("%Y-%m-%d")

    tmp = log_path.with_suffix(".jsonl.tmp")
    tmp.write_text(
        "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in records),
        encoding="utf-8",
    )
    tmp.replace(log_path)
    extras = "".join(
        f" · {f}={getattr(args, f)}"
        for f in ("impressions", "reactions", "comments")
        if getattr(args, f) is not None
    )
    print(f"Recorded: {rec.get('slug') or rec.get('urn')} -> {args.outcome}{extras}")


if __name__ == "__main__":
    main()

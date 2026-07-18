#!/usr/bin/env python3
"""Record how a published post performed.

Updates a record in ~/.claude/ghostwriter/published.jsonl (written by
scripts/linkedin_post.py) with a self-reported outcome. The skill reads these
outcomes to bias future topic/format choices — LinkedIn exposes no member-post
analytics API, so the loop is closed by asking the human (see COMPLIANCE.md:
no scraping).

Usage:
    python3 scripts/post_outcome.py --latest --outcome great
    python3 scripts/post_outcome.py --urn urn:li:share:123 --outcome flopped --notes "no comments"

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


def pick_record(records: list[dict], urn: str | None, latest: bool) -> dict:
    if urn:
        for rec in records:
            if rec.get("urn") == urn:
                return rec
        sys.exit(f"ERROR: no record with urn {urn}.")
    if latest:
        # The most recent record still missing an outcome; else the newest overall.
        unscored = [r for r in records if not r.get("outcome")]
        return (unscored or records)[-1]
    sys.exit("ERROR: pass --urn <urn> or --latest.")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    which = ap.add_mutually_exclusive_group(required=True)
    which.add_argument("--urn", help="URN of the post to score (from the publish log).")
    which.add_argument(
        "--latest",
        action="store_true",
        help="Score the most recent post that has no outcome yet.",
    )
    ap.add_argument("--outcome", required=True, choices=OUTCOMES)
    ap.add_argument("--notes", default="", help="Optional free-text context.")
    ap.add_argument(
        "--log",
        default=str(PUBLISHED_LOG),
        help=argparse.SUPPRESS,  # test hook
    )
    args = ap.parse_args()

    log_path = Path(args.log)
    records = load_records(log_path)
    rec = pick_record(records, args.urn, args.latest)
    rec["outcome"] = args.outcome
    if args.notes:
        rec["outcome_notes"] = args.notes
    rec["outcome_date"] = time.strftime("%Y-%m-%d")

    tmp = log_path.with_suffix(".jsonl.tmp")
    tmp.write_text(
        "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in records),
        encoding="utf-8",
    )
    tmp.replace(log_path)
    print(f"Recorded: {rec.get('slug') or rec.get('urn')} -> {args.outcome}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Record how a published post or thread performed.

Updates a record in ~/.claude/ghostwriter-x/published.jsonl (written by
scripts/typefully_post.py) with a self-reported outcome. The skill reads these
outcomes to bias future topic/format choices — free-tier read access on the
X API is effectively nil, so the loop is closed by asking the human (see
COMPLIANCE.md: no scraping).

Usage:
    python3 scripts/post_outcome.py --latest --outcome great
    python3 scripts/post_outcome.py --id 1801234567890 --outcome flopped --notes "no replies"

Standard library only.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import sys
import time
from pathlib import Path

PUBLISHED_LOG = Path.home() / ".claude" / "ghostwriter-x" / "published.jsonl"
OUTCOMES = ("great", "normal", "flopped")
# Written to posts that aged out unasked, so they stop being offered without
# being confused for real data.
UNRECALLED = "unrecalled"
# A post needs a couple of days before its performance means anything.
CHECKIN_MIN_AGE_DAYS = 2
# ...and past this it is not worth asking: the user cannot honestly remember how
# a month-old post did, and a guess is worse than a gap. Without an upper bound
# the unscored backlog grows forever and every session opens with a question
# about something nobody remembers, which is how a feedback loop dies twice.
CHECKIN_MAX_AGE_DAYS = 30


def _today() -> _dt.date:
    return _dt.date.today()


def due_record(records: list[dict], today: _dt.date | None = None) -> dict | None:
    """The post a check-in is owed on: the OLDEST unscored post that is ripe.

    Deliberately oldest-first, not newest. Picking the newest is why this loop
    never fired in practice: posting two threads in one day leaves the newest
    record same-day (never ripe), so the check was skipped every session while
    genuinely ripe older posts were never asked about and aged out silently.
    """
    today = today or _today()
    ripe = []
    for rec in records:
        if rec.get("outcome"):
            continue
        try:
            posted = _dt.date.fromisoformat(str(rec.get("date", "")))
        except ValueError:
            continue  # undated record: can't age it, so never due
        if CHECKIN_MIN_AGE_DAYS <= (today - posted).days <= CHECKIN_MAX_AGE_DAYS:
            ripe.append((posted, rec))
    if not ripe:
        return None
    return min(ripe, key=lambda pair: pair[0])[1]


def _write(log_path: Path, records: list[dict]) -> None:
    """Rewrite the log atomically — a torn publish log loses real history."""
    tmp = log_path.with_suffix(".jsonl.tmp")
    tmp.write_text(
        "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in records),
        encoding="utf-8",
    )
    tmp.replace(log_path)


def stale_records(records: list[dict], today: _dt.date | None = None) -> list[dict]:
    """Unscored posts that aged past the ask window without ever being asked."""
    today = today or _today()
    out = []
    for rec in records:
        if rec.get("outcome"):
            continue
        try:
            posted = _dt.date.fromisoformat(str(rec.get("date", "")))
        except ValueError:
            continue
        if (today - posted).days > CHECKIN_MAX_AGE_DAYS:
            out.append(rec)
    return out


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
    records: list[dict], tweet_id: str | None, latest: bool, due: bool = False
) -> dict:
    if tweet_id:
        for rec in records:
            if tweet_id in rec.get("ids", []):
                return rec
        sys.exit(f"ERROR: no record containing tweet id {tweet_id}.")
    if due:
        rec = due_record(records)
        if rec is None:
            sys.exit("ERROR: no post is due a check-in.")
        return rec
    if latest:
        # The most recent record still missing an outcome; else the newest overall.
        unscored = [r for r in records if not r.get("outcome")]
        return (unscored or records)[-1]
    sys.exit("ERROR: pass --id <tweet id>, --due, or --latest.")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    which = ap.add_mutually_exclusive_group(required=True)
    which.add_argument(
        "--id", help="Any tweet id of the post/thread to score (from the publish log)."
    )
    which.add_argument(
        "--latest",
        action="store_true",
        help="Score the most recent post that has no outcome yet.",
    )
    which.add_argument(
        "--due",
        action="store_true",
        help="Score the post a check-in is owed on (oldest unscored, at least "
        f"{CHECKIN_MIN_AGE_DAYS} days old).",
    )
    which.add_argument(
        "--check-due",
        action="store_true",
        help="Query only: print the post a check-in is owed on as JSON, or "
        "'none' if there isn't one. Records nothing. Use this to decide whether "
        "to ask the user at all.",
    )
    which.add_argument(
        "--retire-stale",
        action="store_true",
        help=f"Housekeeping: mark every unscored post older than "
        f"{CHECKIN_MAX_AGE_DAYS} days as '{UNRECALLED}' so it stops sitting in "
        "the backlog. Records no opinion about how those posts did.",
    )
    ap.add_argument("--outcome", choices=OUTCOMES)
    ap.add_argument("--notes", default="", help="Optional free-text context.")
    ap.add_argument(
        "--log",
        default=str(PUBLISHED_LOG),
        help=argparse.SUPPRESS,  # test hook
    )
    args = ap.parse_args()

    log_path = Path(args.log)

    if args.check_due:
        # Query mode runs before anything is published too, so an absent log is
        # "nothing due", not an error.
        if not log_path.exists():
            print("none")
            return
        rec = due_record(load_records(log_path))
        print(json.dumps(rec, ensure_ascii=False) if rec else "none")
        return

    if args.retire_stale:
        records = load_records(log_path)
        stale = stale_records(records)
        for rec in stale:
            rec["outcome"] = UNRECALLED
            rec["outcome_date"] = time.strftime("%Y-%m-%d")
        if stale:
            _write(log_path, records)
        print(f"Retired {len(stale)} post(s) as {UNRECALLED}.")
        return

    if not args.outcome:
        sys.exit("ERROR: --outcome is required when recording.")

    records = load_records(log_path)
    rec = pick_record(records, args.id, args.latest, args.due)
    rec["outcome"] = args.outcome
    if args.notes:
        rec["outcome_notes"] = args.notes
    rec["outcome_date"] = time.strftime("%Y-%m-%d")
    _write(log_path, records)
    print(f"Recorded: {rec.get('slug') or (rec.get('ids') or ['?'])[0]} -> {args.outcome}")


if __name__ == "__main__":
    main()

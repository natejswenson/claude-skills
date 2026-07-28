#!/usr/bin/env python3
"""Fetch trending Hacker News stories for the Generate step's Trending lane.

This exists because the obvious one-liner is a footgun. The Algolia endpoint
wants `numericFilters=points>150,created_at_i>1750000000`, and in a shell the
`>` redirects and `$(date -v-3d +%s)` needs escaping, so a hand-written curl
silently fetches nothing and the JSON parse blows up. That cost a wasted round
trip on a real run. Encoding it once, here, removes the class of error.

Usage:
    python3 scripts/hn_trending.py                     # last 2 days, >=150 pts
    python3 scripts/hn_trending.py --days 3 --min-points 200
    python3 scripts/hn_trending.py --json              # machine-readable

Standard library only.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

API = "https://hn.algolia.com/api/v1/search"
TIMEOUT = 20


def build_url(days: int, min_points: int, limit: int, now: float | None = None) -> str:
    """Build the query with the numericFilters properly percent-encoded."""
    since = int((now if now is not None else time.time()) - days * 86400)
    params = {
        "tags": "story",
        "numericFilters": f"points>{min_points},created_at_i>{since}",
        "hitsPerPage": str(limit),
    }
    return f"{API}?{urllib.parse.urlencode(params)}"


def fetch(url: str) -> list[dict]:
    try:
        with urllib.request.urlopen(url, timeout=TIMEOUT) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.URLError as e:
        sys.exit(f"ERROR: could not reach the Hacker News API: {e.reason}")
    except json.JSONDecodeError as e:
        sys.exit(f"ERROR: Hacker News returned something that is not JSON: {e}")
    return payload.get("hits", [])


def normalize(hits: list[dict]) -> list[dict]:
    """Keep only what the idea lane needs, newest-and-hottest first."""
    out = []
    for h in hits:
        out.append({
            "title": h.get("title") or "",
            "points": h.get("points") or 0,
            "comments": h.get("num_comments") or 0,
            "date": (h.get("created_at") or "")[:10],
            "url": h.get("url") or "",
            "hn_url": f"https://news.ycombinator.com/item?id={h.get('objectID')}",
        })
    out.sort(key=lambda s: s["points"], reverse=True)
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--days", type=int, default=2,
                    help="How far back to look (default 2 — X moves fast).")
    ap.add_argument("--min-points", type=int, default=150,
                    help="Minimum points to count as a surge (default 150).")
    ap.add_argument("--limit", type=int, default=25, help="Max stories (default 25).")
    ap.add_argument("--json", action="store_true", help="Emit JSON instead of a table.")
    args = ap.parse_args()

    stories = normalize(fetch(build_url(args.days, args.min_points, args.limit)))
    if args.json:
        print(json.dumps(stories, indent=2, ensure_ascii=False))
        return
    if not stories:
        print(f"No stories over {args.min_points} points in the last {args.days} days.")
        return
    for s in stories:
        print(f"{s['points']:>5} pts / {s['comments']:>4} c · {s['date']} · {s['title']}")
        print(f"       {s['url'] or s['hn_url']}")


if __name__ == "__main__":
    main()

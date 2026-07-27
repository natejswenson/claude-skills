#!/usr/bin/env python3
"""Extract your tweets from an X (Twitter) archive into clean Markdown.

X's "Download an archive of your data" export contains a `data/tweets.js` file:
a JS assignment (`window.YTD.tweets.part0 = [...]`) wrapping a JSON array of
tweet objects. This script strips the JS prefix, drops retweets and pure
@-replies (they carry someone else's voice or no standalone voice), unescapes
HTML entities, and writes a readable `data/my_posts.md` that Claude then reads
to build your voice profile.

Usage:
    python3 scripts/extract_tweets.py                  # data/tweets.js -> data/my_posts.md
    python3 scripts/extract_tweets.py --in path.js --out path.md
    python3 scripts/extract_tweets.py --min-chars 40   # skip very short tweets

Standard library only — no pip install needed.
"""
from __future__ import annotations

import argparse
import html
import json
import sys
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DEFAULT_IN = REPO / "data" / "tweets.js"
DEFAULT_OUT = REPO / "data" / "my_posts.md"

# X's created_at format, e.g. "Wed Oct 10 20:19:24 +0000 2018".
CREATED_AT_FMT = "%a %b %d %H:%M:%S %z %Y"


def parse_archive(raw: str, in_path: Path) -> list[dict]:
    """Strip the `window.YTD... =` JS prefix and parse the JSON array."""
    stripped = raw.lstrip()
    if stripped.startswith("window.YTD"):
        _, _, stripped = stripped.partition("=")
    stripped = stripped.strip()
    if not stripped:
        sys.exit(f"ERROR: {in_path} appears to be empty.")
    try:
        items = json.loads(stripped)
    except ValueError as e:
        sys.exit(f"ERROR: could not parse {in_path} as a tweets.js archive: {e}")
    if not isinstance(items, list):
        sys.exit(f"ERROR: {in_path} did not contain a JSON array of tweets.")
    return items


def sort_key(tweet: dict) -> datetime:
    try:
        return datetime.strptime(tweet.get("created_at", ""), CREATED_AT_FMT)
    except ValueError:
        return datetime.fromtimestamp(0).astimezone()


def extract(in_path: Path, out_path: Path, min_chars: int) -> int:
    if not in_path.exists():
        sys.exit(
            f"ERROR: {in_path} not found.\n"
            "Request your archive from X (Settings -> Your account -> Download "
            "an archive of your data), unzip it, and drop data/tweets.js "
            f"into {in_path.parent}/."
        )

    items = parse_archive(in_path.read_text(encoding="utf-8"), in_path)

    tweets: list[dict] = []
    skipped = 0
    for item in items:
        tweet = item.get("tweet", item) if isinstance(item, dict) else {}
        text = html.unescape((tweet.get("full_text") or tweet.get("text") or "").strip())
        is_retweet = text.startswith("RT @")
        is_reply = bool(tweet.get("in_reply_to_status_id_str")) or text.startswith("@")
        if is_retweet or is_reply or len(text) < min_chars:
            skipped += 1
            continue
        tweets.append({"text": text, "created_at": tweet.get("created_at", ""), "_t": sort_key(tweet)})

    if not tweets:
        sys.exit(
            "ERROR: no usable tweets found after filtering. Try lowering "
            "--min-chars, or check that tweets.js actually contains your posts."
        )

    tweets.sort(key=lambda t: t["_t"])
    lengths = [len(t["text"]) for t in tweets]
    avg = sum(lengths) // len(lengths)
    lines = [
        "# My X posts (extracted for voice analysis)",
        "",
        f"- Tweets: **{len(tweets)}**",
        f"- Skipped (retweets / replies / too short): {skipped}",
        f"- Length: min {min(lengths)} / avg {avg} / max {max(lengths)} chars",
        "",
        "---",
        "",
    ]
    for i, t in enumerate(tweets, 1):
        lines.append(f"## Tweet {i}" + (f"  \n*{t['created_at']}*" if t["created_at"] else ""))
        lines.append("")
        lines.append(t["text"])
        lines.append("")
        lines.append("---")
        lines.append("")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("\n".join(lines), encoding="utf-8")
    return len(tweets)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--in", dest="in_path", type=Path, default=DEFAULT_IN)
    ap.add_argument("--out", dest="out_path", type=Path, default=DEFAULT_OUT)
    ap.add_argument(
        "--min-chars",
        type=int,
        default=20,
        help="Skip tweets shorter than this many characters (default: 20).",
    )
    args = ap.parse_args()
    count = extract(args.in_path, args.out_path, args.min_chars)
    print(f"Wrote {count} tweets to {args.out_path}")
    print("Next: ask Claude to \"build my voice profile\".")


if __name__ == "__main__":
    main()

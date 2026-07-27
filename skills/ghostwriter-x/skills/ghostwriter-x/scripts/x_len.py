#!/usr/bin/env python3
"""Weighted X (Twitter) character counting — the 280 limit, done properly.

X does not count Python ``len()`` characters. Per the twitter-text weighted
rules (config v3):

  - Any URL counts a flat 23 (the t.co transformation), no matter its length.
  - Code points in a small set of "light" ranges (roughly Latin, Cyrillic,
    Greek, Hebrew, Arabic, general punctuation) weigh 1.
  - Every other code point (emoji, CJK, most symbols) weighs 2.
  - The limit is 280 weight units.

This module implements a CONSERVATIVE approximation of those rules:

  - ZWJ emoji sequences (e.g. 👩‍💻) are counted per code point at weight 2,
    where twitter-text counts the whole sequence as one emoji (weight 2).
  - Variation selectors are counted at weight 2 instead of being folded into
    their emoji.
  - Bare domains (no scheme) are counted as ``max(23, their text weight)`` —
    correct whether or not X linkifies them.

Every divergence OVER-counts, never under-counts: text that passes here is
guaranteed to fit on X; a rare heavily-emoji'd draft may be flagged as over
when it would actually fit. The error message says so.

Usage:
    python3 scripts/x_len.py --text "Draft tweet…"
    python3 scripts/x_len.py --file drafts/2026-07-26-slug.md --thread

With --thread, the input is split into tweets on lines containing only
``---`` and each tweet is reported as ``[n/N · used/280]``. Exits 1 if any
tweet is over the limit.

Standard library only — no pip install needed.
"""
from __future__ import annotations

import argparse
import re
import sys
import unicodedata
from pathlib import Path

LIMIT = 280
URL_WEIGHT = 23

# twitter-text config v3 weight-100 ranges (inclusive), in code points.
_LIGHT_RANGES = (
    (0x0000, 0x10FF),
    (0x2000, 0x200D),
    (0x2010, 0x201F),
    (0x2032, 0x2037),
)

# Schemed URLs (and www.-prefixed hosts) are always linkified by X → flat 23.
_SCHEMED_URL_RE = re.compile(r"(?:https?://|www\.)[^\s<>]+", re.IGNORECASE)

# Bare domains X commonly linkifies. Deliberately limited to well-known TLDs —
# anything matched here is charged max(23, text weight), which is safe whether
# or not X actually linkifies it (see module docstring).
_BARE_DOMAIN_RE = re.compile(
    r"\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)*"
    r"\.(?:com|net|org|io|dev|ai|co|app|me|sh|xyz|gg|tv|so|to|us|uk|ca|de|fr|"
    r"jp|in|au|br|es|it|nl|se|ch|edu|gov|info|biz)"
    r"(?:/[^\s<>]*)?",
    re.IGNORECASE,
)


def _codepoint_weight(cp: int) -> int:
    for lo, hi in _LIGHT_RANGES:
        if lo <= cp <= hi:
            return 1
    return 2


def _text_weight(text: str) -> int:
    return sum(_codepoint_weight(ord(ch)) for ch in text)


def weighted_length(text: str) -> int:
    """Weighted length of ``text`` under the (conservative) X counting rules."""
    text = unicodedata.normalize("NFC", text)

    spans: list[tuple[int, int, int]] = []  # (start, end, weight)
    for m in _SCHEMED_URL_RE.finditer(text):
        spans.append((m.start(), m.end(), URL_WEIGHT))
    for m in _BARE_DOMAIN_RE.finditer(text):
        # Skip bare-domain hits inside an already-matched schemed URL.
        if any(s <= m.start() < e for s, e, _ in spans):
            continue
        spans.append((m.start(), m.end(), max(URL_WEIGHT, _text_weight(m.group()))))

    total = 0
    cursor = 0
    for start, end, weight in sorted(spans):
        if start < cursor:  # overlapping match already charged
            continue
        total += _text_weight(text[cursor:start]) + weight
        cursor = end
    total += _text_weight(text[cursor:])
    return total


def check(text: str, limit: int = LIMIT) -> tuple[bool, int]:
    """Return ``(fits, weighted_length)`` for one tweet."""
    n = weighted_length(text)
    return n <= limit, n


def split_thread(text: str) -> list[str]:
    """Split draft text into tweets on lines containing only ``---``."""
    tweets: list[str] = []
    current: list[str] = []
    for line in text.splitlines():
        if line.strip() == "---":
            tweets.append("\n".join(current).strip())
            current = []
        else:
            current.append(line)
    tweets.append("\n".join(current).strip())
    return [t for t in tweets if t]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    src = ap.add_mutually_exclusive_group()
    src.add_argument("--text", help="Tweet text passed directly.")
    src.add_argument("--file", help="Path to a draft file.")
    ap.add_argument(
        "--thread",
        action="store_true",
        help="Treat the input as a thread: split on lines containing only ---.",
    )
    args = ap.parse_args()

    if args.text is not None:
        text = args.text
    elif args.file is not None:
        text = Path(args.file).read_text(encoding="utf-8")
    elif not sys.stdin.isatty():
        text = sys.stdin.read()
    else:
        sys.exit("ERROR: provide --text, --file, or pipe text via stdin.")
    text = text.strip()
    if not text:
        sys.exit("ERROR: input is empty.")

    tweets = split_thread(text) if args.thread else [text]
    over = False
    for i, tweet in enumerate(tweets, 1):
        ok, n = check(tweet)
        marker = "" if ok else f"  OVER by {n - LIMIT}"
        print(f"[{i}/{len(tweets)} · {n}/{LIMIT}]{marker}")
        if not ok:
            over = True
    if over:
        sys.exit(
            "ERROR: over the 280 weighted-character limit. (Counting is "
            "conservative: heavy emoji sequences may be over-counted — trim "
            "anyway to be safe.)"
        )


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Extract your LinkedIn posts from a data export into clean Markdown.

LinkedIn's "Get a copy of your data" export contains a `Shares.csv` file. This
script pulls the post text out of it (the `ShareCommentary` column), drops empty
rows and bare reshares, and writes a readable `data/my_posts.md` that Claude then
reads to build your voice profile.

Usage:
    python3 scripts/extract_posts.py                 # data/Shares.csv -> data/my_posts.md
    python3 scripts/extract_posts.py --in path.csv --out path.md
    python3 scripts/extract_posts.py --min-chars 40  # skip very short posts

Standard library only — no pip install needed.
"""
from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DEFAULT_IN = REPO / "data" / "Shares.csv"
DEFAULT_OUT = REPO / "data" / "my_posts.md"

# LinkedIn has used a few column names over the years; check them in order.
TEXT_COLUMNS = ("ShareCommentary", "Commentary", "ShareText", "Text")
DATE_COLUMNS = ("Date", "ShareDate", "CreatedDate")
LINK_COLUMNS = ("ShareLink", "ShareUrl", "Link")


def _first_present(row: dict, names: tuple[str, ...]) -> str:
    """Return the first non-empty value among the candidate column names."""
    for name in names:
        if name in row and (row[name] or "").strip():
            return row[name].strip()
    return ""


def extract(in_path: Path, out_path: Path, min_chars: int) -> int:
    if not in_path.exists():
        sys.exit(
            f"ERROR: {in_path} not found.\n"
            "Request your data from LinkedIn (Settings -> Data privacy -> "
            "Get a copy of your data -> Posts), unzip it, and drop Shares.csv "
            f"into {in_path.parent}/."
        )

    posts: list[dict] = []
    skipped = 0
    # utf-8-sig strips the BOM LinkedIn sometimes prepends.
    with in_path.open(newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        if reader.fieldnames is None:
            sys.exit(f"ERROR: {in_path} appears to be empty.")
        if not any(c in reader.fieldnames for c in TEXT_COLUMNS):
            sys.exit(
                f"ERROR: none of the expected text columns {TEXT_COLUMNS} were "
                f"found in {in_path}. Columns present: {reader.fieldnames}"
            )
        for row in reader:
            text = _first_present(row, TEXT_COLUMNS)
            if len(text) < min_chars:
                skipped += 1
                continue
            posts.append(
                {
                    "text": text,
                    "date": _first_present(row, DATE_COLUMNS),
                    "link": _first_present(row, LINK_COLUMNS),
                }
            )

    if not posts:
        sys.exit(
            "ERROR: no usable posts found after filtering. Try lowering "
            "--min-chars, or check that Shares.csv actually contains your posts."
        )

    lengths = [len(p["text"]) for p in posts]
    avg = sum(lengths) // len(lengths)
    lines = [
        "# My LinkedIn posts (extracted for voice analysis)",
        "",
        f"- Posts: **{len(posts)}**",
        f"- Skipped (empty / too short / bare reshares): {skipped}",
        f"- Length: min {min(lengths)} / avg {avg} / max {max(lengths)} chars",
        "",
        "---",
        "",
    ]
    for i, p in enumerate(posts, 1):
        meta = " · ".join(x for x in (p["date"], p["link"]) if x)
        lines.append(f"## Post {i}" + (f"  \n*{meta}*" if meta else ""))
        lines.append("")
        lines.append(p["text"])
        lines.append("")
        lines.append("---")
        lines.append("")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("\n".join(lines), encoding="utf-8")
    return len(posts)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--in", dest="in_path", type=Path, default=DEFAULT_IN)
    ap.add_argument("--out", dest="out_path", type=Path, default=DEFAULT_OUT)
    ap.add_argument(
        "--min-chars",
        type=int,
        default=30,
        help="Skip posts shorter than this many characters (default: 30).",
    )
    args = ap.parse_args()
    count = extract(args.in_path, args.out_path, args.min_chars)
    print(f"Wrote {count} posts to {args.out_path}")
    print("Next: ask Claude to \"build my voice profile\".")


if __name__ == "__main__":
    main()

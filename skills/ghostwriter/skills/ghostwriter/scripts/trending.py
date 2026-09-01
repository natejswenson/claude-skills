#!/usr/bin/env python3
"""Sweep the trending surfaces and print one ranked candidate table.

Replaces the prose-only "curl Hacker News" trending lane: every idea-menu run
gets the same measured sweep across four surfaces — Hacker News (Algolia),
Lobsters, Google News RSS (recency-scoped per interest), and GitHub repo
search — filtered against the user's interest keywords and deduped against
what was already published or recently boarded.

Reads queries/keywords from ~/.claude/ghostwriter/voice/trending-queries.json
(seeded from voice/trending-queries.example.json on first run — edit yours
freely; the example is only a starting point derived from interests.md).

Outputs a markdown table on stdout and a JSON sidecar under research/
(.trending-YYYY-MM-DD.json) so the session and the idea board can cite exact
signals. A surface that fails is reported and skipped; a sweep where EVERY
surface returns nothing exits 2 (that is a broken sweep, not a quiet day).

Research only — reads public web sources, never touches LinkedIn (COMPLIANCE.md).
Standard library only.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

CONFIG_PATH = Path.home() / ".claude" / "ghostwriter" / "voice" / "trending-queries.json"
EXAMPLE_CONFIG = Path(__file__).resolve().parent.parent / "voice" / "trending-queries.example.json"
PUBLISHED_LOG = Path.home() / ".claude" / "ghostwriter" / "published.jsonl"
USER_AGENT = "ghostwriter-trending/0.19 (research; github.com/natejswenson/claude-skills)"


def fetch(url: str, timeout: int = 15) -> bytes:
    """One thin network wrapper so tests (and the frozen baseline) can replace it."""
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 (https only)
        return resp.read()


def load_config(path: Path) -> dict:
    """Load the per-user query config, seeding it from the bundled example once."""
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(EXAMPLE_CONFIG, path)
        print(f"seeded {path} from the bundled example — edit it to tune the sweep", file=sys.stderr)
    return json.loads(path.read_text(encoding="utf-8"))


def match_interest(title: str, interests: list[dict]) -> str | None:
    """Return the name of the first interest whose keywords hit the title."""
    lowered = title.lower()
    for interest in interests:
        for kw in interest["keywords"]:
            if kw.lower() in lowered:
                return interest["name"]
    return None


# ---------------------------------------------------------------- surfaces
def sweep_hn(cfg: dict, get) -> list[dict]:
    hn = cfg.get("hn", {})
    cutoff = int(time.time()) - hn.get("days", 3) * 86400
    url = (
        "https://hn.algolia.com/api/v1/search?tags=story&hitsPerPage=30"
        f"&numericFilters=points>{hn.get('min_points', 150)},created_at_i>{cutoff}"
    )
    data = json.loads(get(url))
    out = []
    for hit in data.get("hits", []):
        out.append(
            {
                "source": "hn",
                "title": hit["title"],
                "url": hit.get("url") or f"https://news.ycombinator.com/item?id={hit['objectID']}",
                "signal": f"HN {hit['points']} pts / {hit['num_comments']} comments",
                "rank": hit["points"],
                "age": hit["created_at"][:10],
            }
        )
    return out


def sweep_lobsters(cfg: dict, get) -> list[dict]:
    tags = set(cfg.get("lobsters", {}).get("tags", []))
    data = json.loads(get("https://lobste.rs/hottest.json"))
    out = []
    for story in data:
        if tags and not tags.intersection(story.get("tags", [])):
            continue
        out.append(
            {
                "source": "lobsters",
                "title": story["title"],
                "url": story.get("url") or story["comments_url"],
                "signal": f"Lobsters {story['score']} pts / {story['comment_count']} comments"
                f" · tags {','.join(story.get('tags', []))}",
                "rank": story["score"] * 15,  # lobsters scores run ~15x lower than HN
                "age": story["created_at"][:10],
            }
        )
    return out


def sweep_gnews(cfg: dict, get) -> list[dict]:
    out = []
    window = cfg.get("news", {}).get("window", "2d")
    for interest in cfg.get("interests", []):
        query = interest.get("news_query")
        if not query:
            continue
        url = (
            "https://news.google.com/rss/search?q="
            + urllib.parse.quote(f"{query} when:{window}")
            + "&hl=en-US&gl=US&ceid=US:en"
        )
        root = ET.fromstring(get(url))
        for item in root.iter("item"):
            title = item.findtext("title") or ""
            out.append(
                {
                    "source": "news",
                    "title": title,
                    "url": item.findtext("link") or "",
                    "signal": f"News ({window}) · {(item.findtext('source') or 'unknown outlet')}",
                    "rank": 50,  # recency is the signal; rank below any real vote count
                    "age": (item.findtext("pubDate") or "")[:16],
                    "matched_interest": interest["name"],
                }
            )
    return out


def sweep_github(cfg: dict, get) -> list[dict]:
    gh = cfg.get("github", {})
    since = time.strftime("%Y-%m-%d", time.gmtime(time.time() - gh.get("days", 7) * 86400))
    topics = "+".join(f"topic:{t}" for t in gh.get("topics", ["ai-agents"]))
    url = (
        "https://api.github.com/search/repositories?q="
        f"created:>{since}+{topics}&sort=stars&order=desc&per_page=10"
    )
    data = json.loads(get(url))
    out = []
    for repo in data.get("items", []):
        if repo["stargazers_count"] < gh.get("min_stars", 100):
            continue
        out.append(
            {
                "source": "github",
                "title": f"{repo['full_name']} — {(repo.get('description') or '')[:80]}",
                "url": repo["html_url"],
                "signal": f"GitHub {repo['stargazers_count']} stars in <{gh.get('days', 7)}d",
                "rank": repo["stargazers_count"],
                "age": repo["created_at"][:10],
            }
        )
    return out


SURFACES = {
    "hn": sweep_hn,
    "lobsters": sweep_lobsters,
    "news": sweep_gnews,
    "github": sweep_github,
}


# ---------------------------------------------------------------- dedup
def known_text(published_log: Path, research_dir: Path) -> str:
    """Everything already published or on the last 3 idea boards, as one haystack."""
    chunks = []
    if published_log.exists():
        chunks.append(published_log.read_text(encoding="utf-8"))
    boards = sorted(research_dir.glob("idea-board-*.md"))[-3:]
    for board in boards:
        chunks.append(board.read_text(encoding="utf-8"))
    return "\n".join(chunks).lower()


def is_known(candidate: dict, haystack: str) -> bool:
    if candidate["url"] and candidate["url"].lower() in haystack:
        return True
    title = candidate["title"].lower().strip()
    return len(title) > 12 and title in haystack


# ---------------------------------------------------------------- output
def render(candidates: list[dict]) -> str:
    lines = [
        "| # | Source | Signal | Age | Interest | Title |",
        "|---|--------|--------|-----|----------|-------|",
    ]
    for i, c in enumerate(candidates, 1):
        title = c["title"].replace("|", "\\|")
        lines.append(
            f"| {i} | {c['source']} | {c['signal']} | {c['age']} "
            f"| {c.get('matched_interest') or '—'} | {title} |"
        )
    return "\n".join(lines)


def build_candidates(cfg: dict, get, haystack: str, limit: int, include_all: bool = False):
    """Run every surface through filter/dedup/rank — the shared core of main() and the baseline."""
    candidates: list[dict] = []
    surface_counts: dict[str, int] = {}
    failures: list[str] = []
    for name, sweep in SURFACES.items():
        try:
            found = sweep(cfg, get)
        except Exception as exc:  # noqa: BLE001 — a dead surface must not kill the sweep
            failures.append(f"{name}: {exc}")
            surface_counts[name] = 0
            continue
        surface_counts[name] = len(found)
        candidates.extend(found)

    for c in candidates:
        c.setdefault("matched_interest", match_interest(c["title"], cfg.get("interests", [])))

    fresh = [c for c in candidates if not is_known(c, haystack)]
    if not include_all:
        fresh = [c for c in fresh if c["matched_interest"]]
    fresh.sort(key=lambda c: (-c["rank"], c["title"]))
    return fresh[:limit], surface_counts, failures


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--config", default=str(CONFIG_PATH), help=argparse.SUPPRESS)
    ap.add_argument("--research-dir", default=str(Path(__file__).resolve().parent.parent / "research"), help=argparse.SUPPRESS)
    ap.add_argument("--published-log", default=str(PUBLISHED_LOG), help=argparse.SUPPRESS)
    ap.add_argument("--limit", type=int, default=12, help="Max candidates in the table.")
    ap.add_argument("--all", action="store_true", help="Include candidates matching no interest.")
    args = ap.parse_args(argv)

    cfg = load_config(Path(args.config))
    haystack = known_text(Path(args.published_log), Path(args.research_dir))
    fresh, surface_counts, failures = build_candidates(
        cfg, fetch, haystack, args.limit, include_all=args.all
    )

    for failure in failures:
        print(f"WARN surface failed — {failure}", file=sys.stderr)

    counts = " · ".join(f"{k}:{v}" for k, v in surface_counts.items())
    if not any(surface_counts.values()):
        print(f"ERROR: every surface returned nothing ({counts}) — the sweep is broken, not quiet.", file=sys.stderr)
        return 2

    print(f"trending sweep {time.strftime('%Y-%m-%d')} · raw {counts} · {len(fresh)} fresh candidates\n")
    print(render(fresh))

    sidecar = Path(args.research_dir) / f".trending-{time.strftime('%Y-%m-%d')}.json"
    sidecar.parent.mkdir(parents=True, exist_ok=True)
    sidecar.write_text(
        json.dumps({"counts": surface_counts, "failures": failures, "candidates": fresh}, indent=1),
        encoding="utf-8",
    )
    print(f"\nsidecar: {sidecar}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

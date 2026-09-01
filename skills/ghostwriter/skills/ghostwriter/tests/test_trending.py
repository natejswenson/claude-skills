"""Tests for scripts/trending.py — the measured trending sweep.

The baseline half replays REAL captured payloads (evals/baseline/trending/,
fetched 2026-09-01 from the live surfaces) through the same build_candidates()
path main() uses and byte-compares the rendered table — plus the two-sided
trap: a sweep where every surface dies must exit 2, never print an empty
table as if it were a quiet day.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

import trending

SKILL_ROOT = Path(__file__).resolve().parent.parent
FIXTURES = SKILL_ROOT / "evals" / "baseline" / "trending"
EXAMPLE_CONFIG = SKILL_ROOT / "voice" / "trending-queries.example.json"


def frozen_fetch(url: str, timeout: int = 15) -> bytes:
    if "hn.algolia" in url:
        return (FIXTURES / "hn.json").read_bytes()
    if "lobste.rs" in url:
        return (FIXTURES / "lobsters.json").read_bytes()
    if "news.google" in url:
        return (FIXTURES / "news-ai-agents-ops.xml").read_bytes()
    if "api.github" in url:
        return (FIXTURES / "github.json").read_bytes()
    raise AssertionError(f"unexpected url {url}")


def frozen_config() -> dict:
    cfg = json.loads(EXAMPLE_CONFIG.read_text(encoding="utf-8"))
    cfg["interests"] = [cfg["interests"][0]]  # the one whose news query was captured
    return cfg


# ------------------------------------------------------------------ baseline
def test_baseline_replay_matches_frozen_table():
    """The real captured sweep re-renders byte-identically (drift = a parser change)."""
    fresh, counts, failures = trending.build_candidates(frozen_config(), frozen_fetch, "", 12)
    assert failures == []
    assert all(counts[s] > 0 for s in ("hn", "lobsters", "news", "github")), counts
    expected = (FIXTURES / "expected-table.md").read_text(encoding="utf-8")
    assert trending.render(fresh) + "\n" == expected, (
        "rendered table drifted from the frozen real run — if the change is deliberate, "
        "re-freeze: python3 - <<'PY' (see skill-invariants.json update_command)"
    )


def test_baseline_all_surfaces_dead_is_an_error(tmp_path, monkeypatch, capsys):
    """Two-sided trap: a sweep that finds NOTHING anywhere exits 2, not green."""

    def dead_fetch(url, timeout=15):
        raise OSError("network down")

    monkeypatch.setattr(trending, "fetch", dead_fetch)
    cfg_path = tmp_path / "cfg.json"
    cfg_path.write_text(EXAMPLE_CONFIG.read_text(encoding="utf-8"), encoding="utf-8")
    rc = trending.main(
        ["--config", str(cfg_path), "--research-dir", str(tmp_path), "--published-log", str(tmp_path / "none.jsonl")]
    )
    assert rc == 2
    err = capsys.readouterr().err
    assert "every surface returned nothing" in err and "broken" in err


# ------------------------------------------------------------------ surfaces
def test_hn_falls_back_to_comments_url():
    hits = {"hits": [{"title": "Ask HN: x", "url": None, "objectID": "42",
                      "points": 200, "num_comments": 10, "created_at": "2026-09-01T00:00:00Z"}]}
    out = trending.sweep_hn({"hn": {}}, lambda u, timeout=15: json.dumps(hits).encode())
    assert out[0]["url"] == "https://news.ycombinator.com/item?id=42"
    assert out[0]["rank"] == 200


def test_lobsters_tag_filter_and_no_tags():
    stories = [
        {"title": "a", "url": "http://a", "comments_url": "http://ca", "score": 3,
         "comment_count": 1, "tags": ["ai"], "created_at": "2026-09-01T00:00:00-05:00"},
        {"title": "b", "url": "", "comments_url": "http://cb", "score": 9,
         "comment_count": 2, "tags": ["cooking"], "created_at": "2026-09-01T00:00:00-05:00"},
    ]
    get = lambda u, timeout=15: json.dumps(stories).encode()  # noqa: E731
    filtered = trending.sweep_lobsters({"lobsters": {"tags": ["ai"]}}, get)
    assert [c["title"] for c in filtered] == ["a"]
    assert filtered[0]["rank"] == 45  # score * 15
    unfiltered = trending.sweep_lobsters({}, get)
    assert len(unfiltered) == 2
    assert unfiltered[1]["url"] == "http://cb"  # comments_url fallback


def test_gnews_skips_interest_without_query():
    cfg = {"interests": [{"name": "x", "keywords": []}]}
    out = trending.sweep_gnews(cfg, lambda u, timeout=15: (_ for _ in ()).throw(AssertionError))
    assert out == []


def test_gnews_parses_items_and_stamps_interest():
    rss = (
        "<rss><channel><item><title>T1</title><link>http://l</link>"
        "<source>Outlet</source><pubDate>Mon, 01 Sep 2026 08:00</pubDate></item>"
        "<item><title>T2</title></item></channel></rss>"
    )
    cfg = {"interests": [{"name": "ops", "keywords": [], "news_query": "q"}]}
    out = trending.sweep_gnews(cfg, lambda u, timeout=15: rss.encode())
    assert [c["title"] for c in out] == ["T1", "T2"]
    assert out[0]["matched_interest"] == "ops"
    assert out[0]["signal"] == "News (2d) · Outlet"
    assert out[1]["signal"] == "News (2d) · unknown outlet"
    assert out[1]["url"] == ""


def test_github_filters_min_stars_and_handles_null_description():
    items = {"items": [
        {"full_name": "a/big", "description": None, "html_url": "http://g",
         "stargazers_count": 500, "created_at": "2026-08-30T00:00:00Z"},
        {"full_name": "a/small", "description": "d", "html_url": "http://s",
         "stargazers_count": 3, "created_at": "2026-08-30T00:00:00Z"},
    ]}
    out = trending.sweep_github({"github": {"min_stars": 100}}, lambda u, timeout=15: json.dumps(items).encode())
    assert [c["url"] for c in out] == ["http://g"]
    assert out[0]["title"].startswith("a/big — ")


# ------------------------------------------------------------- filter/dedup
def test_match_interest_first_hit_wins_and_none():
    interests = [{"name": "one", "keywords": ["agent"]}, {"name": "two", "keywords": ["kube"]}]
    assert trending.match_interest("An AGENT for kube", interests) == "one"
    assert trending.match_interest("gardening", interests) is None


def test_is_known_by_url_title_and_short_title():
    hay = "seen https://example.com/story here; also the exact long title lives on"
    assert trending.is_known({"url": "https://EXAMPLE.com/story", "title": "x"}, hay)
    assert trending.is_known({"url": "", "title": "The Exact Long Title"}, hay)
    assert not trending.is_known({"url": "", "title": "on"}, hay)  # short titles never match
    assert not trending.is_known({"url": "http://new", "title": "brand new thing"}, hay)


def test_known_text_reads_log_and_last_three_boards(tmp_path):
    log = tmp_path / "published.jsonl"
    log.write_text("published-line\n", encoding="utf-8")
    research = tmp_path / "research"
    research.mkdir(exist_ok=True)
    for day in ("01", "02", "03", "04"):
        (research / f"idea-board-2026-08-{day}.md").write_text(f"board{day}", encoding="utf-8")
    hay = trending.known_text(log, research)
    assert "published-line" in hay and "board04" in hay and "board01" not in hay
    assert trending.known_text(tmp_path / "missing.jsonl", research)  # no log → boards only


def test_render_escapes_pipes():
    table = trending.render([{"source": "hn", "title": "a|b", "signal": "s", "age": "d",
                              "matched_interest": None, "rank": 1, "url": ""}])
    assert "a\\|b" in table and "| — |" in table


# ------------------------------------------------------------------ config/io
def test_load_config_seeds_from_example_once(tmp_path, capsys):
    target = tmp_path / "voice" / "trending-queries.json"
    cfg = trending.load_config(target)
    assert target.exists() and cfg["interests"]
    assert "seeded" in capsys.readouterr().err
    trending.load_config(target)  # second call: no reseed message
    assert "seeded" not in capsys.readouterr().err


def test_fetch_uses_urlopen(monkeypatch):
    class FakeResp:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return b"body"

    seen = {}

    def fake_urlopen(req, timeout):
        seen["url"] = req.full_url
        seen["ua"] = req.get_header("User-agent")
        seen["timeout"] = timeout
        return FakeResp()

    monkeypatch.setattr(trending.urllib.request, "urlopen", fake_urlopen)
    assert trending.fetch("https://x.example/z") == b"body"
    assert seen == {"url": "https://x.example/z", "ua": trending.USER_AGENT, "timeout": 15}


# ---------------------------------------------------------------------- main
def _main_env(tmp_path, monkeypatch, fetcher):
    monkeypatch.setattr(trending, "fetch", fetcher)
    cfg_path = tmp_path / "cfg.json"
    cfg_path.write_text(EXAMPLE_CONFIG.read_text(encoding="utf-8"), encoding="utf-8")
    research = tmp_path / "research"
    research.mkdir(exist_ok=True)
    return ["--config", str(cfg_path), "--research-dir", str(research),
            "--published-log", str(tmp_path / "published.jsonl")], research


def test_main_happy_path_writes_sidecar_and_reports_failures(tmp_path, monkeypatch, capsys):
    def one_dead_fetch(url, timeout=15):
        if "lobste.rs" in url:
            raise OSError("down")
        return frozen_fetch(url, timeout)

    argv, research = _main_env(tmp_path, monkeypatch, one_dead_fetch)
    assert trending.main(argv) == 0
    out, err = capsys.readouterr().out, capsys.readouterr().err
    assert "fresh candidates" in out and "| # | Source |" in out
    sidecars = list(research.glob(".trending-*.json"))
    assert len(sidecars) == 1
    data = json.loads(sidecars[0].read_text(encoding="utf-8"))
    assert data["counts"]["lobsters"] == 0 and data["failures"]
    assert data["candidates"], "real fixtures must yield candidates"


def test_main_all_flag_keeps_unmatched(tmp_path, monkeypatch, capsys):
    argv, _ = _main_env(tmp_path, monkeypatch, frozen_fetch)
    assert trending.main(argv + ["--all", "--limit", "50"]) == 0
    with_all = capsys.readouterr().out.count("\n")
    argv2, _ = _main_env(tmp_path, monkeypatch, frozen_fetch)
    assert trending.main(argv2 + ["--limit", "50"]) == 0
    without = capsys.readouterr().out.count("\n")
    assert with_all >= without


def test_main_dedups_against_published_and_boards(tmp_path, monkeypatch, capsys):
    argv, research = _main_env(tmp_path, monkeypatch, frozen_fetch)
    assert trending.main(argv + ["--limit", "1"]) == 0
    first_table = capsys.readouterr().out
    top_title = first_table.split("| 1 | ")[1].split(" |")[-2].strip()
    (research / "idea-board-2026-09-01.md").write_text(first_table.lower(), encoding="utf-8")
    argv2 = argv[:]  # same dirs — board now contains the previous top candidate
    assert trending.main(argv2 + ["--limit", "1"]) == 0
    second_table = capsys.readouterr().out
    assert top_title not in second_table

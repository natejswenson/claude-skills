"""Tests for scripts/hn_trending.py — the Trending lane's fetch.

The whole point of the script is that the URL is built correctly, so that is
what these lean on hardest: a shell-written `points>150` silently fetched
nothing on a real run.
"""
from __future__ import annotations

import io
import json
import urllib.error
import urllib.parse

import pytest

import hn_trending as hn


# --------------------------------------------------------------------- url
def test_build_url_percent_encodes_the_comparison_operators():
    url = hn.build_url(days=2, min_points=150, limit=25, now=1_000_000)
    assert ">" not in url, "a raw > in a shell URL redirects to a file"
    q = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
    assert q["numericFilters"] == ["points>150,created_at_i>827200"]
    assert q["tags"] == ["story"] and q["hitsPerPage"] == ["25"]


def test_build_url_window_scales_with_days():
    a = hn.build_url(1, 10, 5, now=1_000_000)
    b = hn.build_url(3, 10, 5, now=1_000_000)
    since = lambda u: int(  # noqa: E731
        urllib.parse.parse_qs(urllib.parse.urlparse(u).query)["numericFilters"][0]
        .split("created_at_i>")[1]
    )
    assert since(a) - since(b) == 2 * 86400


def test_build_url_defaults_to_wall_clock(monkeypatch):
    monkeypatch.setattr(hn.time, "time", lambda: 500_000)
    url = hn.build_url(2, 150, 25)
    q = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
    assert q["numericFilters"] == ["points>150,created_at_i>327200"]


# ------------------------------------------------------------------- fetch
class _Resp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _urlopen(payload):
    def fake(url, timeout=None):
        return _Resp(json.dumps(payload).encode())
    return fake


def test_fetch_returns_hits(monkeypatch):
    monkeypatch.setattr(hn.urllib.request, "urlopen", _urlopen({"hits": [{"title": "a"}]}))
    assert hn.fetch("u") == [{"title": "a"}]


def test_fetch_missing_hits_key_is_empty(monkeypatch):
    monkeypatch.setattr(hn.urllib.request, "urlopen", _urlopen({}))
    assert hn.fetch("u") == []


def test_fetch_network_error_exits_cleanly(monkeypatch):
    def boom(url, timeout=None):
        raise urllib.error.URLError("no route")

    monkeypatch.setattr(hn.urllib.request, "urlopen", boom)
    with pytest.raises(SystemExit, match="could not reach"):
        hn.fetch("u")


def test_fetch_non_json_exits_cleanly(monkeypatch):
    """The exact failure mode of the bad shell curl: HTML where JSON was expected."""
    def html(url, timeout=None):
        return _Resp(b"<!doctype html><h1>nope</h1>")

    monkeypatch.setattr(hn.urllib.request, "urlopen", html)
    with pytest.raises(SystemExit, match="not JSON"):
        hn.fetch("u")


# --------------------------------------------------------------- normalize
HIT = {
    "title": "Ruff v0.16.0", "points": 348, "num_comments": 231,
    "created_at": "2026-07-26T09:01:39Z", "url": "https://astral.sh/blog/ruff-v0.16.0",
    "objectID": "49056112",
}


def test_normalize_shapes_and_sorts_by_points():
    out = hn.normalize([dict(HIT, points=10), HIT])
    assert [s["points"] for s in out] == [348, 10]
    assert out[0]["date"] == "2026-07-26"
    assert out[0]["comments"] == 231
    assert out[0]["hn_url"].endswith("id=49056112")


def test_normalize_tolerates_missing_fields():
    (only,) = hn.normalize([{"objectID": "1"}])
    assert only["title"] == "" and only["points"] == 0 and only["date"] == ""


# -------------------------------------------------------------------- main
def _run(monkeypatch, argv, hits):
    monkeypatch.setattr("sys.argv", ["hn_trending.py", *argv])
    monkeypatch.setattr(hn, "fetch", lambda url: hits)
    hn.main()


def test_main_table_output(monkeypatch, capsys):
    _run(monkeypatch, [], [HIT])
    out = capsys.readouterr().out
    assert "348 pts" in out and "Ruff v0.16.0" in out and "astral.sh" in out


def test_main_falls_back_to_the_hn_permalink(monkeypatch, capsys):
    _run(monkeypatch, [], [dict(HIT, url="")])
    assert "news.ycombinator.com/item?id=49056112" in capsys.readouterr().out


def test_main_json_output(monkeypatch, capsys):
    _run(monkeypatch, ["--json"], [HIT])
    assert json.loads(capsys.readouterr().out)[0]["points"] == 348


def test_main_says_so_when_nothing_is_trending(monkeypatch, capsys):
    """Silence would read as 'no signal checked'; the lane needs to know."""
    _run(monkeypatch, ["--days", "1"], [])
    assert "No stories over 150 points in the last 1 days" in capsys.readouterr().out

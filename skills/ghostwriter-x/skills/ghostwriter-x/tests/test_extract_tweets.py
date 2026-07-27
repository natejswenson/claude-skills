"""Tests for scripts/extract_tweets.py — X archive → voice corpus."""
from __future__ import annotations

import json

import pytest

import extract_tweets as et


def make_archive(tmp_path, items, prefix="window.YTD.tweets.part0 = "):
    p = tmp_path / "tweets.js"
    p.write_text(prefix + json.dumps(items), encoding="utf-8")
    return p


def tweet(text, created="Wed Oct 10 20:19:24 +0000 2018", **kw):
    t = {"full_text": text, "created_at": created}
    t.update(kw)
    return {"tweet": t}


# ----------------------------------------------------------------- parse_archive
def test_parse_archive_strips_js_prefix(tmp_path):
    p = make_archive(tmp_path, [tweet("hello world, a real tweet")])
    items = et.parse_archive(p.read_text(encoding="utf-8"), p)
    assert items[0]["tweet"]["full_text"].startswith("hello")


def test_parse_archive_plain_json(tmp_path):
    p = make_archive(tmp_path, [tweet("plain json works too")], prefix="")
    assert len(et.parse_archive(p.read_text(encoding="utf-8"), p)) == 1


def test_parse_archive_empty_exits(tmp_path):
    p = tmp_path / "tweets.js"
    p.write_text("window.YTD.tweets.part0 =   ", encoding="utf-8")
    with pytest.raises(SystemExit):
        et.parse_archive(p.read_text(encoding="utf-8"), p)


def test_parse_archive_bad_json_exits(tmp_path):
    p = tmp_path / "tweets.js"
    p.write_text("window.YTD.tweets.part0 = {nope", encoding="utf-8")
    with pytest.raises(SystemExit):
        et.parse_archive(p.read_text(encoding="utf-8"), p)


def test_parse_archive_not_a_list_exits(tmp_path):
    p = tmp_path / "tweets.js"
    p.write_text('{"a": 1}', encoding="utf-8")
    with pytest.raises(SystemExit):
        et.parse_archive(p.read_text(encoding="utf-8"), p)


# ---------------------------------------------------------------------- sort_key
def test_sort_key_bad_date_falls_back():
    assert et.sort_key({"created_at": "not a date"}) == et.sort_key({})


# ----------------------------------------------------------------------- extract
def test_extract_missing_file_exits(tmp_path):
    with pytest.raises(SystemExit) as e:
        et.extract(tmp_path / "nope.js", tmp_path / "out.md", 20)
    assert "not found" in str(e.value)


def test_extract_filters_and_sorts(tmp_path):
    items = [
        tweet("newer real tweet with enough length", "Wed Oct 10 20:19:24 +0000 2020"),
        tweet("RT @someone: a retweet that must be dropped"),
        tweet("@reply this is a pure reply and dropped"),
        tweet(
            "threaded reply dropped via id",
            in_reply_to_status_id_str="123",
        ),
        tweet("short"),  # under min-chars
        tweet("older real tweet with enough length", "Wed Oct 10 20:19:24 +0000 2018"),
        tweet("has &amp; entity and enough length too"),
    ]
    p = make_archive(tmp_path, items)
    out = tmp_path / "out.md"
    count = et.extract(p, out, 20)
    assert count == 3
    text = out.read_text(encoding="utf-8")
    assert "Skipped (retweets / replies / too short): 4" in text
    # Sorted oldest → newest; entity unescaped.
    assert text.index("older real tweet") < text.index("newer real tweet")
    assert "has & entity" in text
    assert "RT @" not in text


def test_extract_bare_item_shape(tmp_path):
    # Some archive variants nest nothing under "tweet".
    p = make_archive(tmp_path, [{"full_text": "bare item shape still parses fine"}])
    assert et.extract(p, tmp_path / "out.md", 20) == 1


def test_extract_non_dict_item_skipped(tmp_path):
    p = make_archive(
        tmp_path, ["garbage", tweet("one good tweet with enough length")]
    )
    assert et.extract(p, tmp_path / "out.md", 20) == 1


def test_extract_nothing_usable_exits(tmp_path):
    p = make_archive(tmp_path, [tweet("RT @x: nope")])
    with pytest.raises(SystemExit) as e:
        et.extract(p, tmp_path / "out.md", 20)
    assert "no usable tweets" in str(e.value)


def test_extract_tweet_without_date(tmp_path):
    p = make_archive(tmp_path, [{"tweet": {"full_text": "no created_at but long enough"}}])
    out = tmp_path / "out.md"
    assert et.extract(p, out, 20) == 1
    assert "## Tweet 1\n" in out.read_text(encoding="utf-8")


# -------------------------------------------------------------------------- main
def test_main_roundtrip(monkeypatch, tmp_path, capsys):
    p = make_archive(tmp_path, [tweet("a perfectly usable tweet for the corpus")])
    out = tmp_path / "my_posts.md"
    monkeypatch.setattr(
        "sys.argv", ["x", "--in", str(p), "--out", str(out), "--min-chars", "20"]
    )
    et.main()
    assert out.exists()
    assert "Wrote 1 tweets" in capsys.readouterr().out

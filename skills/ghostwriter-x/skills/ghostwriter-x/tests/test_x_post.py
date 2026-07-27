"""Tests for scripts/x_post.py — full branch coverage (no real network)."""
from __future__ import annotations

import io
import json
import urllib.error
from pathlib import Path

import pytest

import x_post


class FakeResp:
    def __init__(self, body=b"{}"):
        self._body = body

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def read(self):
        return self._body


def http_error(code, body=b"boom", headers=None):
    return urllib.error.HTTPError("http://x", code, "err", headers or {}, io.BytesIO(body))


def make_args(**kw):
    defaults = dict(
        file=None,
        text=None,
        image=[],
        alt=[],
        lane="",
        dry_run=False,
        resume=False,
        allow_unverified=False,
    )
    defaults.update(kw)
    return type("Args", (), defaults)()


# -------------------------------------------------------------------- read_draft
def test_read_draft_text():
    assert x_post.read_draft(make_args(text="hi")) == "hi"


def test_read_draft_file(tmp_path):
    p = tmp_path / "d.md"
    p.write_text("from file\n", encoding="utf-8")
    assert x_post.read_draft(make_args(file=str(p))) == "from file"


def test_read_draft_stdin(monkeypatch):
    class FakeStdin:
        def isatty(self):
            return False

        def read(self):
            return "piped"

    monkeypatch.setattr(x_post.sys, "stdin", FakeStdin())
    assert x_post.read_draft(make_args()) == "piped"


def test_read_draft_tty_exits(monkeypatch):
    class FakeTty:
        def isatty(self):
            return True

    monkeypatch.setattr(x_post.sys, "stdin", FakeTty())
    with pytest.raises(SystemExit):
        x_post.read_draft(make_args())


def test_read_draft_empty_exits():
    with pytest.raises(SystemExit) as e:
        x_post.read_draft(make_args(text="   "))
    assert "empty" in str(e.value)


# --------------------------------------------------------------- validate_tweets
def test_validate_tweets_ok():
    assert x_post.validate_tweets(["hello", "world"]) == [5, 5]


def test_validate_tweets_reports_all_failures():
    with pytest.raises(SystemExit) as e:
        x_post.validate_tweets(["a" * 290, "ok", "b" * 300])
    msg = str(e.value)
    assert "tweet 1/3: 290/280 (+10)" in msg
    assert "tweet 3/3: 300/280 (+20)" in msg
    assert "ok" not in msg.splitlines()[0]


# --------------------------------------------------------------- parse_media_args
def test_parse_media_default_tweet_one(tmp_path, monkeypatch):
    img = tmp_path / "a.png"
    img.write_bytes(b"png")
    got = x_post.parse_media_args([str(img)], ["cover art"], 3)
    assert got == {1: [[str(img), "cover art"]]}


def test_parse_media_indexed_and_relative(tmp_path, monkeypatch):
    monkeypatch.setattr(x_post, "REPO", tmp_path)
    (tmp_path / "images").mkdir()
    (tmp_path / "images" / "b.png").write_bytes(b"png")
    got = x_post.parse_media_args(["2:images/b.png"], [], 3)
    assert got == {2: [[str(tmp_path / "images" / "b.png"), ""]]}


def test_parse_media_index_out_of_range():
    with pytest.raises(SystemExit) as e:
        x_post.parse_media_args(["9:a.png"], [], 2)
    assert "out of range" in str(e.value)


def test_parse_media_alt_without_image():
    with pytest.raises(SystemExit) as e:
        x_post.parse_media_args([], ["orphan alt"], 1)
    assert "no matching --image" in str(e.value)


def test_parse_media_more_alts_than_images(tmp_path):
    img = tmp_path / "a.png"
    img.write_bytes(b"png")
    with pytest.raises(SystemExit) as e:
        x_post.parse_media_args([str(img)], ["one", "two"], 1)
    assert "no matching --image" in str(e.value)


def test_parse_media_five_images_exits(tmp_path):
    img = tmp_path / "a.png"
    img.write_bytes(b"png")
    with pytest.raises(SystemExit) as e:
        x_post.parse_media_args([str(img)] * 5, [], 1)
    assert "at most 4" in str(e.value)


def test_parse_media_missing_file_exits(tmp_path):
    with pytest.raises(SystemExit) as e:
        x_post.parse_media_args([str(tmp_path / "nope.png")], [], 1)
    assert "not found" in str(e.value)


# ------------------------------------------------------------------ _api_request
def make_req():
    return x_post.urllib.request.Request("https://api.x.com/2/tweets")


def test_api_request_success(monkeypatch):
    monkeypatch.setattr(
        x_post.urllib.request, "urlopen", lambda req: FakeResp(b'{"ok":1}')
    )
    assert x_post._api_request(make_req(), "ctx") == {"ok": 1}


def test_api_request_429_with_reset(monkeypatch):
    def boom(req):
        raise http_error(429, headers={"x-rate-limit-reset": "1753500000"})

    monkeypatch.setattr(x_post.urllib.request, "urlopen", boom)
    with pytest.raises(x_post.RateLimited) as e:
        x_post._api_request(make_req(), "posting")
    assert "rate limited on posting" in str(e.value)
    assert "resets" in str(e.value)


def test_api_request_429_without_reset(monkeypatch):
    def boom(req):
        raise http_error(429)

    monkeypatch.setattr(x_post.urllib.request, "urlopen", boom)
    with pytest.raises(x_post.RateLimited) as e:
        x_post._api_request(make_req(), "posting")
    assert "resets" not in str(e.value)


def test_api_request_401_hint(monkeypatch, capsys):
    def boom(req):
        raise http_error(401)

    monkeypatch.setattr(x_post.urllib.request, "urlopen", boom)
    with pytest.raises(SystemExit):
        x_post._api_request(make_req(), "ctx")
    assert "Re-run scripts/x_auth.py" in capsys.readouterr().err


def test_api_request_other_error(monkeypatch, capsys):
    def boom(req):
        raise http_error(500)

    monkeypatch.setattr(x_post.urllib.request, "urlopen", boom)
    with pytest.raises(SystemExit):
        x_post._api_request(make_req(), "ctx")
    assert "HTTP 500" in capsys.readouterr().err


def test_api_request_network_error(monkeypatch):
    def boom(req):
        raise urllib.error.URLError("down")

    monkeypatch.setattr(x_post.urllib.request, "urlopen", boom)
    with pytest.raises(SystemExit) as e:
        x_post._api_request(make_req(), "ctx")
    assert "network problem" in str(e.value)


# ------------------------------------------------------------------ upload_media
ENV = {"X_ACCESS_TOKEN": "tok", "X_USERNAME": "nate"}


def test_upload_media_with_alt(tmp_path, monkeypatch):
    img = tmp_path / "a.png"
    img.write_bytes(b"pngbytes")
    calls = []

    def fake_api(req, context):
        calls.append((req, context))
        if "metadata" in context:
            return {}
        return {"data": {"id": "m1"}}

    monkeypatch.setattr(x_post, "_api_request", fake_api)
    assert x_post.upload_media(ENV, str(img), "alt text") == "m1"
    assert len(calls) == 2
    upload_req = calls[0][0]
    assert b"pngbytes" in upload_req.data
    assert b"tweet_image" in upload_req.data
    meta_req = calls[1][0]
    assert json.loads(meta_req.data)["metadata"]["alt_text"]["text"] == "alt text"


def test_upload_media_without_alt_notes(tmp_path, monkeypatch, capsys):
    img = tmp_path / "a.png"
    img.write_bytes(b"png")
    monkeypatch.setattr(
        x_post, "_api_request", lambda req, ctx: {"data": {"media_key": "mk"}}
    )
    assert x_post.upload_media(ENV, str(img), "") == "mk"
    assert "without alt text" in capsys.readouterr().err


def test_upload_media_v11_style_id(tmp_path, monkeypatch):
    img = tmp_path / "a.png"
    img.write_bytes(b"png")
    monkeypatch.setattr(
        x_post, "_api_request", lambda req, ctx: {"media_id_string": "legacy"}
    )
    assert x_post.upload_media(ENV, str(img), "") == "legacy"


def test_upload_media_unexpected_response(tmp_path, monkeypatch):
    img = tmp_path / "a.png"
    img.write_bytes(b"png")
    monkeypatch.setattr(x_post, "_api_request", lambda req, ctx: {"nope": 1})
    with pytest.raises(SystemExit) as e:
        x_post.upload_media(ENV, str(img), "")
    assert "unexpected media upload" in str(e.value)


# -------------------------------------------------------------------- post_tweet
def test_post_tweet_payload(monkeypatch):
    captured = {}

    def fake_api(req, context):
        captured["payload"] = json.loads(req.data)
        return {"data": {"id": "111"}}

    monkeypatch.setattr(x_post, "_api_request", fake_api)
    tid = x_post.post_tweet(ENV, "hi", reply_to="100", media_ids=["m1", "m2"])
    assert tid == "111"
    assert captured["payload"] == {
        "text": "hi",
        "reply": {"in_reply_to_tweet_id": "100"},
        "media": {"media_ids": ["m1", "m2"]},
    }


def test_post_tweet_minimal_payload(monkeypatch):
    captured = {}

    def fake_api(req, context):
        captured["payload"] = json.loads(req.data)
        return {"data": {"id": "1"}}

    monkeypatch.setattr(x_post, "_api_request", fake_api)
    x_post.post_tweet(ENV, "hi", None, [])
    assert captured["payload"] == {"text": "hi"}


def test_post_tweet_unexpected_response(monkeypatch):
    monkeypatch.setattr(x_post, "_api_request", lambda req, ctx: {})
    with pytest.raises(SystemExit) as e:
        x_post.post_tweet(ENV, "hi", None, [])
    assert "unexpected /2/tweets" in str(e.value)


# ------------------------------------------------------------- ensure_fresh_token
def test_ensure_fresh_token_no_expiry_passthrough():
    env = {"X_TOKEN_EXPIRES_AT": ""}
    assert x_post.ensure_fresh_token(env) is env


def test_ensure_fresh_token_still_valid(monkeypatch):
    monkeypatch.setattr(x_post.time, "time", lambda: 1000)
    env = {"X_TOKEN_EXPIRES_AT": "5000"}
    assert x_post.ensure_fresh_token(env) is env


def test_ensure_fresh_token_near_expiry_refreshes(monkeypatch):
    monkeypatch.setattr(x_post.time, "time", lambda: 1000)
    refreshed = {"X_ACCESS_TOKEN": "new"}
    monkeypatch.setattr(
        x_post.x_auth, "refresh_access_token", lambda env, path: refreshed
    )
    assert x_post.ensure_fresh_token({"X_TOKEN_EXPIRES_AT": "1100"}) is refreshed


# ---------------------------------------------------------------------- progress
def test_progress_path_none_without_file():
    assert x_post.progress_path(make_args(text="hi")) is None


def test_progress_roundtrip(tmp_path):
    args = make_args(file=str(tmp_path / "slug.md"))
    p = x_post.progress_path(args)
    assert p.name == "slug.thread-progress.json"
    assert x_post.load_progress(p) == []
    x_post.save_progress(p, ["1", "2"])
    assert x_post.load_progress(p) == ["1", "2"]


def test_load_progress_none_and_corrupt(tmp_path):
    assert x_post.load_progress(None) == []
    p = tmp_path / "bad.json"
    p.write_text("{not json", encoding="utf-8")
    assert x_post.load_progress(p) == []


def test_save_progress_none_noop():
    x_post.save_progress(None, ["1"])  # must not raise


def test_save_progress_oserror_warns(tmp_path, capsys):
    x_post.save_progress(tmp_path / "no-dir" / "p.json", ["1"])
    assert "WARNING" in capsys.readouterr().err


# ---------------------------------------------------------------- record_publish
def test_record_publish_thread(tmp_path):
    log = tmp_path / "log.jsonl"
    args = make_args(file="drafts/2026-07-26-slug.md", lane="opinion")
    x_post.record_publish(["1", "2"], args, ["one", "two"], [3, 3], "nate", log)
    rec = json.loads(log.read_text(encoding="utf-8"))
    assert rec["ids"] == ["1", "2"]
    assert rec["url"] == "https://x.com/nate/status/1"
    assert rec["slug"] == "2026-07-26-slug"
    assert rec["format"] == "thread"
    assert rec["tweets"] == 2
    assert rec["chars"] == [3, 3]
    assert rec["lane"] == "opinion"


def test_record_publish_single_no_username_default_log(tmp_path):
    # log_path=None exercises the PUBLISHED_LOG default (isolated by conftest).
    x_post.record_publish(["9"], make_args(text="hi"), ["hi"], [2], "")
    rec = json.loads(x_post.PUBLISHED_LOG.read_text(encoding="utf-8"))
    assert rec["format"] == "single"
    assert rec["url"] == ""
    assert rec["slug"] == ""


def test_record_publish_write_failure_warns(tmp_path, monkeypatch, capsys):
    log = tmp_path / "log.jsonl"

    def boom(*a, **k):
        raise OSError("disk full")

    monkeypatch.setattr(Path, "open", boom)
    x_post.record_publish(["1"], make_args(text="x"), ["x"], [1], "n", log)
    assert "WARNING" in capsys.readouterr().err


# ----------------------------------------------------------- enforce_source_gate
def test_gate_allow_unverified_warns(capsys):
    x_post.enforce_source_gate(make_args(allow_unverified=True))
    assert "human use only" in capsys.readouterr().err


def test_gate_no_file_exits():
    with pytest.raises(SystemExit) as e:
        x_post.enforce_source_gate(make_args(text="hi"))
    assert "refusing to publish unverified" in str(e.value)


def test_gate_verify_fail_exits(monkeypatch):
    monkeypatch.setattr(
        x_post.verify_sources, "verify", lambda f: {"ok": False, "reason": "bad"}
    )
    with pytest.raises(SystemExit) as e:
        x_post.enforce_source_gate(make_args(file="d.md"))
    assert "source check failed" in str(e.value)


def test_gate_pass(monkeypatch, capsys):
    monkeypatch.setattr(
        x_post.verify_sources, "verify", lambda f: {"ok": True, "reason": "3 hosts"}
    )
    x_post.enforce_source_gate(make_args(file="d.md"))
    assert "Source check passed" in capsys.readouterr().out


# -------------------------------------------------------------------------- main
def run_main(monkeypatch, argv, env=None):
    monkeypatch.setattr(x_post.sys, "argv", ["x_post.py", *argv])
    monkeypatch.setattr(
        x_post, "load_env", lambda path: dict(env or {"X_ACCESS_TOKEN": "t", "X_USERNAME": "nate"})
    )
    x_post.main()


def test_main_dry_run_thread_with_media(monkeypatch, tmp_path, capsys):
    draft = tmp_path / "t.md"
    draft.write_text("one\n---\ntwo", encoding="utf-8")
    img = tmp_path / "c.png"
    img.write_bytes(b"png")
    run_main(
        monkeypatch,
        ["--file", str(draft), "--image", f"1:{img}", "--alt", "1:cover", "--dry-run"],
    )
    out = capsys.readouterr().out
    assert "DRY RUN" in out
    assert "[1/2 · 3/280]" in out
    assert "c.png" in out
    assert "in_reply_to_tweet_id" in out


def publish_setup(monkeypatch, tmp_path, tweets_text, posted_ids):
    """Wire main() for a real (faked) publish; returns the calls list."""
    draft = tmp_path / "slug.md"
    draft.write_text(tweets_text, encoding="utf-8")
    calls = []
    ids = iter(posted_ids)

    def fake_post(env, text, reply_to, media_ids):
        tid = next(ids)
        calls.append({"text": text, "reply_to": reply_to, "media": media_ids, "id": tid})
        return tid

    monkeypatch.setattr(x_post, "post_tweet", fake_post)
    monkeypatch.setattr(x_post, "upload_media", lambda env, p, a: f"m:{Path(p).name}")
    monkeypatch.setattr(x_post, "enforce_source_gate", lambda args: None)
    monkeypatch.setattr(x_post, "ensure_fresh_token", lambda env: env)
    monkeypatch.setattr(x_post.time, "sleep", lambda s: None)
    return draft, calls


def test_main_publish_thread_chains_replies(monkeypatch, tmp_path, capsys):
    draft, calls = publish_setup(monkeypatch, tmp_path, "one\n---\ntwo\n---\nthree", ["1", "2", "3"])
    img = tmp_path / "c.png"
    img.write_bytes(b"png")
    run_main(monkeypatch, ["--file", str(draft), "--image", f"2:{img}"])
    assert [c["reply_to"] for c in calls] == [None, "1", "2"]
    assert calls[1]["media"] == ["m:c.png"]
    assert not x_post.progress_path(make_args(file=str(draft))).exists()
    out = capsys.readouterr().out
    assert "https://x.com/nate/status/1" in out
    rec = json.loads(x_post.PUBLISHED_LOG.read_text(encoding="utf-8"))
    assert rec["ids"] == ["1", "2", "3"]


def test_main_resume_skips_posted(monkeypatch, tmp_path, capsys):
    draft, calls = publish_setup(monkeypatch, tmp_path, "one\n---\ntwo", ["2"])
    prog = x_post.progress_path(make_args(file=str(draft)))
    prog.write_text(json.dumps({"ids": ["1"]}), encoding="utf-8")
    run_main(monkeypatch, ["--file", str(draft), "--resume"])
    assert calls == [{"text": "two", "reply_to": "1", "media": [], "id": "2"}]
    assert "Resuming: 1/2" in capsys.readouterr().out


def test_main_resume_all_posted_exits(monkeypatch, tmp_path):
    draft, _ = publish_setup(monkeypatch, tmp_path, "one", ["x"])
    prog = x_post.progress_path(make_args(file=str(draft)))
    prog.write_text(json.dumps({"ids": ["1"]}), encoding="utf-8")
    with pytest.raises(SystemExit) as e:
        run_main(monkeypatch, ["--file", str(draft), "--resume"])
    assert "already posted" in str(e.value)


def test_main_rate_limited_saves_progress(monkeypatch, tmp_path, capsys):
    draft = tmp_path / "slug.md"
    draft.write_text("one\n---\ntwo", encoding="utf-8")
    monkeypatch.setattr(x_post, "enforce_source_gate", lambda args: None)
    monkeypatch.setattr(x_post, "ensure_fresh_token", lambda env: env)
    monkeypatch.setattr(x_post.time, "sleep", lambda s: None)

    def fake_post(env, text, reply_to, media_ids):
        if text == "two":
            raise x_post.RateLimited("rate limited on POST /2/tweets")
        return "1"

    monkeypatch.setattr(x_post, "post_tweet", fake_post)
    with pytest.raises(SystemExit) as e:
        run_main(monkeypatch, ["--file", str(draft)])
    assert e.value.code == 1
    err = capsys.readouterr().err
    assert "Progress saved (1/2)" in err
    assert "--resume" in err
    prog = x_post.progress_path(make_args(file=str(draft)))
    assert json.loads(prog.read_text(encoding="utf-8"))["ids"] == ["1"]


def test_main_text_publish_no_progress_file(monkeypatch, capsys):
    monkeypatch.setattr(x_post, "post_tweet", lambda env, t, r, m: "77")
    monkeypatch.setattr(x_post, "ensure_fresh_token", lambda env: env)
    run_main(
        monkeypatch,
        ["--text", "quick note", "--allow-unverified"],
        env={"X_ACCESS_TOKEN": "t", "X_USERNAME": ""},
    )
    out = capsys.readouterr().out
    assert "Published to X." in out
    assert "status" not in out  # no username → no URL line


def test_main_progress_unlink_oserror_swallowed(monkeypatch, tmp_path):
    draft, _ = publish_setup(monkeypatch, tmp_path, "one", ["1"])
    prog = x_post.progress_path(make_args(file=str(draft)))
    prog.write_text(json.dumps({"ids": []}), encoding="utf-8")

    def bad_unlink(self, *a, **k):
        raise OSError("locked")

    monkeypatch.setattr(Path, "unlink", bad_unlink)
    run_main(monkeypatch, ["--file", str(draft)])  # must not raise
    assert prog.exists()

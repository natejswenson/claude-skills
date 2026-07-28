"""Tests for scripts/typefully_post.py — full branch coverage (no real network)."""
from __future__ import annotations

import io
import json
import urllib.error
from pathlib import Path

import pytest

import typefully_post as tp


class FakeResp:
    def __init__(self, body=b"{}", status=200):
        self._body = body
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def read(self):
        return self._body


def http_error(code, body=b"boom", headers=None):
    return urllib.error.HTTPError("http://t", code, "err", headers or {}, io.BytesIO(body))


def make_args(**kw):
    defaults = dict(
        file=None,
        text=None,
        connect=False,
        image=[],
        alt=[],
        lane="",
        dry_run=False,
        allow_unverified=False,
    )
    defaults.update(kw)
    return type("Args", (), defaults)()


ENV = {"TYPEFULLY_API_KEY": "tk", "TYPEFULLY_SOCIAL_SET_ID": "77"}


# --------------------------------------------------------------------- env io
def test_load_env_missing_exits(tmp_path):
    with pytest.raises(SystemExit) as e:
        tp.load_env(tmp_path / "nope.env")
    assert "TYPEFULLY_API_KEY" in str(e.value)


def test_load_env_parses(tmp_path):
    env = tmp_path / ".env"
    env.write_text("# c\nA=1\nbad\nB='two'\n", encoding="utf-8")
    assert tp.load_env(env) == {"A": "1", "B": "two"}


def test_save_env_updates_and_appends(tmp_path):
    env = tmp_path / ".env"
    env.write_text("# header\nEXISTING=old\nKEEP=yes\n", encoding="utf-8")
    tp.save_env({"EXISTING": "new", "ADDED": "fresh"}, env)
    text = env.read_text(encoding="utf-8")
    assert "EXISTING=new" in text and "KEEP=yes" in text and "ADDED=fresh" in text


# ------------------------------------------------------------------ api_request
def test_api_request_get_success(monkeypatch):
    captured = {}

    def fake_urlopen(req):
        captured["req"] = req
        return FakeResp(b'{"ok":1}')

    monkeypatch.setattr(tp.urllib.request, "urlopen", fake_urlopen)
    assert tp.api_request(ENV, "GET", "/social-sets") == {"ok": 1}
    req = captured["req"]
    assert req.get_header("Authorization") == "Bearer tk"
    assert req.data is None


def test_api_request_post_sends_json(monkeypatch):
    captured = {}

    def fake_urlopen(req):
        captured["req"] = req
        return FakeResp(b"{}")

    monkeypatch.setattr(tp.urllib.request, "urlopen", fake_urlopen)
    tp.api_request(ENV, "POST", "/x", {"a": 1})
    assert json.loads(captured["req"].data) == {"a": 1}
    assert captured["req"].get_header("Content-type") == "application/json"


@pytest.mark.parametrize(
    ("code", "needle"),
    [(401, "API key"), (402, "paid plan"), (500, "")],
)
def test_api_request_http_errors(monkeypatch, code, needle):
    def boom(req):
        raise http_error(code)

    monkeypatch.setattr(tp.urllib.request, "urlopen", boom)
    with pytest.raises(SystemExit) as e:
        tp.api_request(ENV, "GET", "/x", context="ctx")
    if needle:
        assert needle in str(e.value)


def test_api_request_429_with_and_without_reset(monkeypatch):
    def boom_reset(req):
        raise http_error(429, headers={"X-RateLimit-User-Reset": "1785200000"})

    monkeypatch.setattr(tp.urllib.request, "urlopen", boom_reset)
    with pytest.raises(SystemExit) as e:
        tp.api_request(ENV, "GET", "/x", context="posting")
    assert "rate limit" in str(e.value) and "resets" in str(e.value)

    def boom_plain(req):
        raise http_error(429)

    monkeypatch.setattr(tp.urllib.request, "urlopen", boom_plain)
    with pytest.raises(SystemExit) as e:
        tp.api_request(ENV, "GET", "/x")
    assert "resets" not in str(e.value)


def test_api_request_network_error(monkeypatch):
    def boom(req):
        raise urllib.error.URLError("down")

    monkeypatch.setattr(tp.urllib.request, "urlopen", boom)
    with pytest.raises(SystemExit) as e:
        tp.api_request(ENV, "GET", "/x")
    assert "network problem" in str(e.value)


# ---------------------------------------------------------------- setup/connect
def test_require_setup_missing_key_exits():
    with pytest.raises(SystemExit) as e:
        tp.require_setup({})
    assert "TYPEFULLY_API_KEY" in str(e.value)


def test_require_setup_missing_social_set_exits():
    with pytest.raises(SystemExit) as e:
        tp.require_setup({"TYPEFULLY_API_KEY": "tk"})
    assert "--connect" in str(e.value)


def test_require_setup_ok():
    assert tp.require_setup(dict(ENV)) == "77"


def test_connect_requires_key(tmp_path):
    with pytest.raises(SystemExit) as e:
        tp.connect({}, tmp_path / ".env")
    assert "TYPEFULLY_API_KEY" in str(e.value)


def test_connect_no_social_sets_exits(monkeypatch, tmp_path):
    monkeypatch.setattr(tp, "api_request", lambda *a, **k: {"results": []})
    with pytest.raises(SystemExit) as e:
        tp.connect({"TYPEFULLY_API_KEY": "tk"}, tmp_path / ".env")
    assert "Connect your X account" in str(e.value)


def test_connect_saves_first_social_set(monkeypatch, tmp_path, capsys):
    env_path = tmp_path / ".env"
    env_path.write_text("TYPEFULLY_API_KEY=tk\n", encoding="utf-8")
    monkeypatch.setattr(
        tp, "api_request",
        lambda *a, **k: {"results": [{"id": 42, "username": "nate"}]},
    )
    tp.connect({"TYPEFULLY_API_KEY": "tk"}, env_path)
    assert "TYPEFULLY_SOCIAL_SET_ID=42" in env_path.read_text(encoding="utf-8")
    assert "@nate" in capsys.readouterr().out


def test_connect_multiple_social_sets_notes_others(monkeypatch, tmp_path, capsys):
    env_path = tmp_path / ".env"
    env_path.write_text("TYPEFULLY_API_KEY=tk\n", encoding="utf-8")
    monkeypatch.setattr(
        tp, "api_request",
        lambda *a, **k: {"results": [{"id": 1, "username": "a"}, {"id": 2, "username": "b"}]},
    )
    tp.connect({"TYPEFULLY_API_KEY": "tk"}, env_path)
    out = capsys.readouterr().out
    assert "stored the first" in out and "@b (2)" in out


# ------------------------------------------------------------------ draft input
def test_read_draft_text():
    assert tp.read_draft(make_args(text="hi")) == "hi"


def test_read_draft_file(tmp_path):
    p = tmp_path / "d.md"
    p.write_text("from file\n", encoding="utf-8")
    assert tp.read_draft(make_args(file=str(p))) == "from file"


def test_read_draft_stdin(monkeypatch):
    class FakeStdin:
        def isatty(self):
            return False

        def read(self):
            return "piped"

    monkeypatch.setattr(tp.sys, "stdin", FakeStdin())
    assert tp.read_draft(make_args()) == "piped"


def test_read_draft_tty_exits(monkeypatch):
    class FakeTty:
        def isatty(self):
            return True

    monkeypatch.setattr(tp.sys, "stdin", FakeTty())
    with pytest.raises(SystemExit):
        tp.read_draft(make_args())


def test_read_draft_empty_exits():
    with pytest.raises(SystemExit) as e:
        tp.read_draft(make_args(text="   "))
    assert "empty" in str(e.value)


def test_validate_tweets_ok_and_overflow_report():
    assert tp.validate_tweets(["hello", "world"]) == [5, 5]
    with pytest.raises(SystemExit) as e:
        tp.validate_tweets(["a" * 290, "ok", "b" * 300])
    msg = str(e.value)
    assert "tweet 1/3: 290/280 (+10)" in msg
    assert "tweet 3/3: 300/280 (+20)" in msg


# --------------------------------------------------------------- parse_media_args
def test_parse_media_default_and_indexed(tmp_path, monkeypatch):
    img = tmp_path / "a.png"
    img.write_bytes(b"png")
    got = tp.parse_media_args([str(img)], ["cover"], 3)
    assert got == {1: [[str(img), "cover"]]}
    monkeypatch.setattr(tp, "REPO", tmp_path)
    (tmp_path / "images").mkdir()
    (tmp_path / "images" / "b.png").write_bytes(b"png")
    got = tp.parse_media_args(["2:images/b.png"], [], 3)
    assert got == {2: [[str(tmp_path / "images" / "b.png"), ""]]}


def test_parse_media_errors(tmp_path):
    img = tmp_path / "a.png"
    img.write_bytes(b"png")
    with pytest.raises(SystemExit, match="out of range"):
        tp.parse_media_args(["9:a.png"], [], 2)
    with pytest.raises(SystemExit, match="no matching --image"):
        tp.parse_media_args([], ["orphan"], 1)
    with pytest.raises(SystemExit, match="no matching --image"):
        tp.parse_media_args([str(img)], ["one", "two"], 1)
    with pytest.raises(SystemExit, match="at most 4"):
        tp.parse_media_args([str(img)] * 5, [], 1)
    with pytest.raises(SystemExit, match="not found"):
        tp.parse_media_args([str(tmp_path / "nope.png")], [], 1)


# ---------------------------------------------------------------- upload_media
def upload_env(monkeypatch, tmp_path, statuses, create=None, put_status=200, put_error=None):
    img = tmp_path / "a.png"
    img.write_bytes(b"pngbytes")
    api_calls = []
    states = iter(statuses)

    def fake_api(env, method, path, payload=None, context=""):
        api_calls.append((method, path, payload))
        if method == "POST":
            return create if create is not None else {
                "media_id": "m-1", "upload_url": "https://s3/x"
            }
        return next(states)

    def fake_urlopen(req):
        # Record headers too: the presigned-S3 PUT is signature-sensitive, so a
        # test that only checks url+body cannot catch a wrong Content-Type.
        api_calls.append(("PUT", req.full_url, req.data, dict(req.headers)))
        if put_error:
            raise put_error
        return FakeResp(status=put_status)

    monkeypatch.setattr(tp, "api_request", fake_api)
    monkeypatch.setattr(tp.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(tp.time, "sleep", lambda s: None)
    return img, api_calls


def test_upload_media_happy_path_polls_until_ready(monkeypatch, tmp_path):
    img, calls = upload_env(
        monkeypatch, tmp_path, [{"status": "processing"}, {"status": "ready"}]
    )
    assert tp.upload_media(ENV, "77", str(img)) == "m-1"
    put = next(c for c in calls if c[0] == "PUT")
    assert put[1] == "https://s3/x" and put[2] == b"pngbytes"


def test_upload_media_put_sends_empty_content_type(monkeypatch, tmp_path):
    """Regression: Typefully hands back an S3 SigV2 presigned URL signed with an
    EMPTY Content-Type. Sending a real one (image/png) — or omitting the header
    and letting urllib substitute application/x-www-form-urlencoded — changes
    S3's StringToSign and the upload dies with 403 SignatureDoesNotMatch. This
    shipped broken because the old test asserted only url+body, never headers.
    """
    img, calls = upload_env(monkeypatch, tmp_path, [{"status": "ready"}])
    tp.upload_media(ENV, "77", str(img))
    headers = next(c for c in calls if c[0] == "PUT")[3]
    ctype = {k.lower(): v for k, v in headers.items()}.get("content-type")
    assert ctype == "", f"presigned PUT must send an empty Content-Type, got {ctype!r}"


def test_upload_media_bad_create_response(monkeypatch, tmp_path):
    img, _ = upload_env(monkeypatch, tmp_path, [], create={"nope": 1})
    with pytest.raises(SystemExit, match="unexpected media upload"):
        tp.upload_media(ENV, "77", str(img))


def test_upload_media_put_bad_status(monkeypatch, tmp_path):
    img, _ = upload_env(monkeypatch, tmp_path, [], put_status=500)
    with pytest.raises(SystemExit, match="HTTP 500"):
        tp.upload_media(ENV, "77", str(img))


def test_upload_media_put_http_error(monkeypatch, tmp_path):
    img, _ = upload_env(monkeypatch, tmp_path, [], put_error=http_error(403))
    with pytest.raises(SystemExit, match="HTTP 403"):
        tp.upload_media(ENV, "77", str(img))


def test_upload_media_processing_failed(monkeypatch, tmp_path):
    img, _ = upload_env(
        monkeypatch, tmp_path, [{"status": "failed", "error_reason": "bad file"}]
    )
    with pytest.raises(SystemExit, match="bad file"):
        tp.upload_media(ENV, "77", str(img))


def test_upload_media_processing_timeout(monkeypatch, tmp_path):
    img, _ = upload_env(monkeypatch, tmp_path, [{"status": "processing"}] * 3)
    clock = iter([0, 0, 1000, 1000, 1000])
    monkeypatch.setattr(tp.time, "time", lambda: next(clock))
    with pytest.raises(SystemExit, match="timed out"):
        tp.upload_media(ENV, "77", str(img))


# --------------------------------------------------------------- build/publish
def test_build_payload_shapes():
    payload = tp.build_payload(["one", "two"], {2: ["m-9"]}, "slug")
    assert payload["platforms"]["x"]["enabled"] is True
    assert payload["platforms"]["x"]["posts"] == [
        {"text": "one"},
        {"text": "two", "media_ids": ["m-9"]},
    ]
    assert payload["publish_at"] == "now"
    assert payload["draft_title"] == "slug"
    assert payload["share"] is False


def test_publish_draft_immediate_finish(monkeypatch):
    monkeypatch.setattr(
        tp, "api_request",
        lambda *a, **k: {"id": 5, "publish_state": "finished", "x_published_url": "u"},
    )
    draft = tp.publish_draft(ENV, "77", {"p": 1})
    assert draft["x_published_url"] == "u"


def test_publish_draft_polls_then_finishes(monkeypatch):
    responses = iter([
        {"id": 5, "publish_state": "in_progress"},
        {"id": 5, "publish_state": "in_progress"},
        {"id": 5, "publish_state": "finished", "x_published_url": "u"},
    ])
    monkeypatch.setattr(tp, "api_request", lambda *a, **k: next(responses))
    monkeypatch.setattr(tp.time, "sleep", lambda s: None)
    assert tp.publish_draft(ENV, "77", {})["x_published_url"] == "u"


def test_publish_draft_error_status_exits(monkeypatch):
    monkeypatch.setattr(
        tp, "api_request",
        lambda *a, **k: {"id": 5, "status": "error", "private_url": "purl"},
    )
    with pytest.raises(SystemExit) as e:
        tp.publish_draft(ENV, "77", {})
    assert "purl" in str(e.value)


def test_publish_draft_timeout_warns_about_double_post(monkeypatch):
    monkeypatch.setattr(
        tp, "api_request", lambda *a, **k: {"id": 5, "publish_state": "in_progress"}
    )
    monkeypatch.setattr(tp.time, "sleep", lambda s: None)
    clock = iter([0] + [1000] * 5)
    monkeypatch.setattr(tp.time, "time", lambda: next(clock))
    with pytest.raises(SystemExit, match="double post"):
        tp.publish_draft(ENV, "77", {})


def test_publish_draft_missing_id_exits(monkeypatch):
    monkeypatch.setattr(tp, "api_request", lambda *a, **k: {"weird": True})
    with pytest.raises(SystemExit, match="unexpected draft response"):
        tp.publish_draft(ENV, "77", {})


# ---------------------------------------------------------------- record/gate
def test_record_publish_thread(tmp_path):
    log = tmp_path / "log.jsonl"
    args = make_args(file="drafts/2026-07-27-slug.md", lane="opinion")
    draft = {"id": 9, "x_published_url": "https://x.com/n/status/1"}
    tp.record_publish(draft, args, ["one", "two"], [3, 3], log)
    rec = json.loads(log.read_text(encoding="utf-8"))
    assert rec["ids"] == ["9"]
    assert rec["url"] == "https://x.com/n/status/1"
    assert rec["slug"] == "2026-07-27-slug"
    assert rec["format"] == "thread" and rec["tweets"] == 2
    assert rec["via"] == "typefully"


def test_record_publish_minimal_default_log():
    # log_path=None exercises the PUBLISHED_LOG default (isolated by conftest).
    tp.record_publish({}, make_args(text="hi"), ["hi"], [2])
    rec = json.loads(tp.PUBLISHED_LOG.read_text(encoding="utf-8"))
    assert rec["ids"] == [] and rec["url"] == "" and rec["format"] == "single"


def test_record_publish_write_failure_warns(tmp_path, monkeypatch, capsys):
    def boom(*a, **k):
        raise OSError("disk full")

    monkeypatch.setattr(Path, "open", boom)
    tp.record_publish({"id": 1}, make_args(text="x"), ["x"], [1], tmp_path / "l.jsonl")
    assert "WARNING" in capsys.readouterr().err


def test_gate_branches(monkeypatch, capsys):
    tp.enforce_source_gate(make_args(allow_unverified=True))
    assert "human use only" in capsys.readouterr().err
    with pytest.raises(SystemExit, match="refusing to publish unverified"):
        tp.enforce_source_gate(make_args(text="hi"))
    monkeypatch.setattr(
        tp.verify_sources, "verify", lambda f: {"ok": False, "reason": "bad"}
    )
    with pytest.raises(SystemExit, match="source check failed"):
        tp.enforce_source_gate(make_args(file="d.md"))
    monkeypatch.setattr(
        tp.verify_sources, "verify", lambda f: {"ok": True, "reason": "3 hosts"}
    )
    tp.enforce_source_gate(make_args(file="d.md"))
    assert "Source check passed" in capsys.readouterr().out


# -------------------------------------------------------------------------- main
def run_main(monkeypatch, argv, env=None):
    monkeypatch.setattr(tp.sys, "argv", ["typefully_post.py", *argv])
    monkeypatch.setattr(tp, "load_env", lambda path: dict(env or ENV))
    tp.main()


def test_main_connect_path(monkeypatch):
    called = {}
    monkeypatch.setattr(tp, "connect", lambda env, path: called.update(env=env))
    run_main(monkeypatch, ["--connect"])
    assert called["env"] == ENV


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
    assert "<uploaded c.png>" in out
    assert '"publish_at": "now"' in out
    assert "[1/2 · 3/280]" in out


def test_main_publish_happy_path(monkeypatch, tmp_path, capsys):
    draft = tmp_path / "slug.md"
    draft.write_text("one\n---\ntwo", encoding="utf-8")
    img = tmp_path / "c.png"
    img.write_bytes(b"png")
    monkeypatch.setattr(tp, "enforce_source_gate", lambda args: None)
    monkeypatch.setattr(tp, "upload_media", lambda env, ss, p: "m-1")
    captured = {}

    def fake_publish(env, ss, payload, draft_only=False):
        captured["payload"] = payload
        captured["draft_only"] = draft_only
        return {"id": 9, "publish_state": "finished",
                "x_published_url": "https://x.com/n/status/1"}

    monkeypatch.setattr(tp, "publish_draft", fake_publish)
    run_main(monkeypatch, ["--file", str(draft), "--image", f"2:{img}", "--lane", "opinion"])
    out = capsys.readouterr().out
    assert "Published to X via Typefully" in out
    assert "https://x.com/n/status/1" in out
    posts = captured["payload"]["platforms"]["x"]["posts"]
    assert posts[1]["media_ids"] == ["m-1"]
    rec = json.loads(tp.PUBLISHED_LOG.read_text(encoding="utf-8"))
    assert rec["lane"] == "opinion"


def test_main_publish_no_url_prints_private(monkeypatch, capsys):
    monkeypatch.setattr(tp, "publish_draft",
                        lambda env, ss, p, draft_only=False: {"id": 9,
                                                              "private_url": "purl"})
    run_main(monkeypatch, ["--text", "quick note", "--allow-unverified"])
    assert "purl" in capsys.readouterr().out


# ------------------------------------------------------------------ draft-only
def test_build_payload_draft_only_omits_publish_at():
    """draft_only must NOT set publish_at — that field is what makes Typefully
    push it live, and the whole point of the fallback is to park it."""
    payload = tp.build_payload(["one"], {}, "slug", draft_only=True)
    assert "publish_at" not in payload
    assert payload["draft_title"] == "slug"


def test_publish_draft_draft_only_returns_without_polling(monkeypatch):
    calls = []

    def fake_api(env, method, path, payload=None, context=""):
        calls.append(method)
        return {"id": 5, "private_url": "purl"}

    monkeypatch.setattr(tp, "api_request", fake_api)
    draft = tp.publish_draft(ENV, "77", {}, draft_only=True)
    assert draft["private_url"] == "purl"
    assert calls == ["POST"], "draft-only must not poll for a publish that never comes"


def test_main_draft_only_does_not_write_publish_log(monkeypatch, tmp_path, capsys):
    """A parked draft never went live, so it must stay out of published.jsonl —
    that log is the outcome loop's record of real posts."""
    draft = tmp_path / "slug.md"
    draft.write_text("one", encoding="utf-8")
    log = tmp_path / "published.jsonl"
    monkeypatch.setattr(tp, "PUBLISHED_LOG", log)
    monkeypatch.setattr(tp, "enforce_source_gate", lambda args: None)
    monkeypatch.setattr(
        tp, "publish_draft",
        lambda env, ss, p, draft_only=False: {"id": 9, "private_url": "purl"},
    )
    run_main(monkeypatch, ["--file", str(draft), "--draft-only"])
    out = capsys.readouterr().out
    assert "NOT published" in out and "purl" in out
    assert not log.exists()


def test_api_request_403_url_block_explains_recovery(monkeypatch):
    """The X-policy URL block is atomic and pre-publish, so the message must say
    a retry is safe and name both ways out."""
    body = (b'{"error":{"code":"FORBIDDEN","message":"This is not allowed by X '
            b'policy. Direct publishing of X drafts containing URLs is blocked."}}')

    def boom(req):
        raise http_error(403, body=body)

    monkeypatch.setattr(tp.urllib.request, "urlopen", boom)
    with pytest.raises(SystemExit) as e:
        tp.api_request(ENV, "POST", "/drafts", {"a": 1}, context="draft create")
    msg = str(e.value)
    assert "retry is safe" in msg and "--draft-only" in msg


# ------------------------------------------------ publish-time metric capture
def test_claim_count_reads_the_sources_sidecar(tmp_path):
    draft = tmp_path / "d.md"
    draft.write_text("x", encoding="utf-8")
    (tmp_path / "d.sources.json").write_text(
        json.dumps({"external_claims": True, "claims": [{"claim": "a"}, {"claim": "b"}]}),
        encoding="utf-8",
    )
    assert tp._claim_count(make_args(file=str(draft))) == 2


def test_claim_count_zero_for_first_person_post(tmp_path):
    draft = tmp_path / "d.md"
    draft.write_text("x", encoding="utf-8")
    (tmp_path / "d.sources.json").write_text(
        json.dumps({"external_claims": False, "claims": []}), encoding="utf-8"
    )
    assert tp._claim_count(make_args(file=str(draft))) == 0


@pytest.mark.parametrize("body", ["not json at all", None])
def test_claim_count_survives_a_missing_or_broken_sidecar(tmp_path, body):
    draft = tmp_path / "d.md"
    draft.write_text("x", encoding="utf-8")
    if body is not None:
        (tmp_path / "d.sources.json").write_text(body, encoding="utf-8")
    assert tp._claim_count(make_args(file=str(draft))) == 0


def test_claim_count_zero_without_a_file():
    assert tp._claim_count(make_args(file=None)) == 0


def test_record_publish_captures_covariates(tmp_path, monkeypatch):
    log = tmp_path / "published.jsonl"
    draft = tmp_path / "slug.md"
    draft.write_text("one", encoding="utf-8")
    (tmp_path / "slug.sources.json").write_text(
        json.dumps({"claims": [{"claim": "a"}]}), encoding="utf-8"
    )
    monkeypatch.setattr(tp.time, "strftime", lambda fmt: "2026-07-27")
    args = make_args(file=str(draft), image=["1:a.png"], lane="release-howto")
    tp.record_publish(
        {"id": 7, "x_published_url": "https://x.com/n/status/42",
         "x_post_published_at": "2026-07-28T01:42:13.931Z"},
        args, ["one"], [3], log,
    )
    rec = json.loads(log.read_text(encoding="utf-8"))
    assert rec["images"] == 1
    assert rec["claims"] == 1
    assert rec["lane"] == "release-howto"
    assert rec["published_at"] == "2026-07-28T01:42:13.931Z"
    assert rec["x_post_id"] == "42"


# ----------------------------------------------------------------- quota
def test_quota_returns_publishing_quota(monkeypatch):
    monkeypatch.setattr(
        tp, "api_request",
        lambda *a, **k: {"publishing_quota": {"used": 3, "remaining": 12,
                                              "resets_at": "2026-08-01T00:00:00-05:00"}},
    )
    assert tp.quota(ENV, "77")["remaining"] == 12


def test_quota_absent_is_empty_dict(monkeypatch):
    monkeypatch.setattr(tp, "api_request", lambda *a, **k: {})
    assert tp.quota(ENV, "77") == {}


def test_main_quota_prints_remaining(monkeypatch, capsys):
    monkeypatch.setattr(
        tp, "quota",
        lambda env, ss: {"used": 3, "remaining": 12, "resets_at": "2026-08-01"},
    )
    run_main(monkeypatch, ["--quota"])
    out = capsys.readouterr().out
    assert "Posts left this period: 12" in out and "2026-08-01" in out


def test_main_quota_handles_a_plan_with_no_quota(monkeypatch, capsys):
    monkeypatch.setattr(tp, "quota", lambda env, ss: {})
    run_main(monkeypatch, ["--quota"])
    assert "did not report a publishing quota" in capsys.readouterr().out


def test_record_publish_captures_publish_instant_and_x_id(tmp_path):
    """The local `date` can disagree with the real publish instant across UTC
    midnight, and `ids` holds Typefully draft ids, not the X status id."""
    log = tmp_path / "published.jsonl"
    draft = {
        "id": 10087791,
        "x_published_url": "https://x.com/NatejSwenson/status/2081918068549374428",
        "x_post_published_at": "2026-07-28T01:42:13.931Z",
    }
    tp.record_publish(draft, make_args(), ["one"], [3], log)
    rec = json.loads(log.read_text(encoding="utf-8"))
    assert rec["published_at"] == "2026-07-28T01:42:13.931Z"
    assert rec["x_post_id"] == "2081918068549374428"
    assert rec["ids"] == ["10087791"]


def test_record_publish_falls_back_to_published_at(tmp_path):
    log = tmp_path / "published.jsonl"
    tp.record_publish({"id": 1, "published_at": "2026-07-28T01:42:13.931Z"},
                      make_args(), ["one"], [3], log)
    assert json.loads(log.read_text(encoding="utf-8"))["published_at"].endswith("Z")


def test_record_publish_without_a_url_leaves_x_post_id_blank(tmp_path):
    log = tmp_path / "published.jsonl"
    tp.record_publish({"id": 1}, make_args(), ["one"], [3], log)
    rec = json.loads(log.read_text(encoding="utf-8"))
    assert rec["x_post_id"] == "" and rec["published_at"] == ""

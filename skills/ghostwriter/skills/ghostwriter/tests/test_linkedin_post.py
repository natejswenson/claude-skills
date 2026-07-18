"""Tests for scripts/linkedin_post.py — full branch coverage (network mocked)."""
from __future__ import annotations

import io
import json
import urllib.error

import pytest

import linkedin_post as lp


class FakeResp:
    """Minimal stand-in for the urlopen() context manager."""

    def __init__(self, body=b"", status=200, headers=None):
        self._body = body
        self.status = status
        self.headers = headers or {}

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def read(self):
        return self._body


def http_error(code, body=b"boom"):
    return urllib.error.HTTPError(
        "http://x", code, "err", {}, io.BytesIO(body)
    )


# --------------------------------------------------------------------- load_env
def test_load_env_missing_exits(tmp_path):
    with pytest.raises(SystemExit):
        lp.load_env(tmp_path / "nope.env")


def test_load_env_parses_and_skips_comments(tmp_path):
    env = tmp_path / ".env"
    env.write_text('# comment\nA="quoted"\nB=plain\nnoequals\n\n', encoding="utf-8")
    out = lp.load_env(env)
    assert out == {"A": "quoted", "B": "plain"}


# ---------------------------------------------------------------- read_post_text
def test_read_post_text_from_text():
    args = type("A", (), {"text": "  hello  ", "file": None})()
    assert lp.read_post_text(args) == "hello"


def test_read_post_text_from_file(tmp_path):
    f = tmp_path / "p.md"
    f.write_text("file body", encoding="utf-8")
    args = type("A", (), {"text": None, "file": str(f)})()
    assert lp.read_post_text(args) == "file body"


def test_read_post_text_from_stdin(monkeypatch):
    monkeypatch.setattr("sys.stdin", io.StringIO("piped"))
    monkeypatch.setattr("sys.stdin.isatty", lambda: False, raising=False)
    args = type("A", (), {"text": None, "file": None})()
    assert lp.read_post_text(args) == "piped"


def test_read_post_text_no_source_exits(monkeypatch):
    monkeypatch.setattr("sys.stdin.isatty", lambda: True, raising=False)
    args = type("A", (), {"text": None, "file": None})()
    with pytest.raises(SystemExit):
        lp.read_post_text(args)


def test_read_post_text_empty_exits():
    args = type("A", (), {"text": "   ", "file": None})()
    with pytest.raises(SystemExit):
        lp.read_post_text(args)


def test_read_post_text_too_long_exits():
    args = type("A", (), {"text": "x" * 3001, "file": None})()
    with pytest.raises(SystemExit):
        lp.read_post_text(args)


# ----------------------------------------------------------------- build_payload
def test_build_payload_text_only():
    p = lp.build_payload("urn:li:person:1", "hi")
    assert "content" not in p
    assert p["author"] == "urn:li:person:1"


def test_build_payload_with_image_and_alt():
    p = lp.build_payload("urn:li:person:1", "hi", "urn:li:image:9", "alt")
    assert p["content"]["media"] == {"id": "urn:li:image:9", "altText": "alt"}


def test_build_payload_with_image_no_alt():
    p = lp.build_payload("urn:li:person:1", "hi", "urn:li:image:9", "")
    assert p["content"]["media"] == {"id": "urn:li:image:9"}


# ------------------------------------------------------ initialize_image_upload
def test_initialize_image_upload_success(monkeypatch):
    body = json.dumps(
        {"value": {"uploadUrl": "http://up", "image": "urn:li:image:1"}}
    ).encode()
    monkeypatch.setattr(lp.urllib.request, "urlopen", lambda req: FakeResp(body))
    url, urn = lp.initialize_image_upload({"LINKEDIN_ACCESS_TOKEN": "t"}, "owner")
    assert url == "http://up" and urn == "urn:li:image:1"


def test_initialize_image_upload_http_error(monkeypatch):
    def boom(req):
        raise http_error(500)

    monkeypatch.setattr(lp.urllib.request, "urlopen", boom)
    with pytest.raises(SystemExit):
        lp.initialize_image_upload({}, "owner")


def test_initialize_image_upload_missing_fields(monkeypatch):
    monkeypatch.setattr(
        lp.urllib.request, "urlopen", lambda req: FakeResp(b'{"value": {}}')
    )
    with pytest.raises(SystemExit):
        lp.initialize_image_upload({}, "owner")


# --------------------------------------------------------- upload_file_bytes
def test_upload_file_bytes_success(monkeypatch, tmp_path):
    img = tmp_path / "x.png"
    img.write_bytes(b"PNG")
    monkeypatch.setattr(lp.urllib.request, "urlopen", lambda req: FakeResp(status=201))
    lp.upload_file_bytes("http://up", "t", img)  # no exception == pass


def test_upload_file_bytes_bad_status(monkeypatch, tmp_path):
    img = tmp_path / "x.png"
    img.write_bytes(b"PNG")
    monkeypatch.setattr(lp.urllib.request, "urlopen", lambda req: FakeResp(status=500))
    with pytest.raises(SystemExit):
        lp.upload_file_bytes("http://up", "t", img)


def test_upload_file_bytes_http_error(monkeypatch, tmp_path):
    img = tmp_path / "x.png"
    img.write_bytes(b"PNG")

    def boom(req):
        raise http_error(403)

    monkeypatch.setattr(lp.urllib.request, "urlopen", boom)
    with pytest.raises(SystemExit):
        lp.upload_file_bytes("http://up", "t", img)


# ----------------------------------------------------- warn_if_token_expiring
def test_warn_no_expiry_key(capsys):
    lp.warn_if_token_expiring({})
    assert capsys.readouterr().err == ""


def test_warn_bad_value(capsys):
    lp.warn_if_token_expiring({"LINKEDIN_TOKEN_EXPIRES_AT": "notanumber"})
    assert capsys.readouterr().err == ""


def test_warn_expired(capsys):
    lp.warn_if_token_expiring({"LINKEDIN_TOKEN_EXPIRES_AT": "1"})
    assert "expired" in capsys.readouterr().err


def test_warn_expiring_soon(capsys, monkeypatch):
    monkeypatch.setattr(lp.time, "time", lambda: 0)
    lp.warn_if_token_expiring({"LINKEDIN_TOKEN_EXPIRES_AT": str(2 * 86400)})
    assert "expires in" in capsys.readouterr().err


def test_warn_far_future_silent(capsys, monkeypatch):
    monkeypatch.setattr(lp.time, "time", lambda: 0)
    lp.warn_if_token_expiring({"LINKEDIN_TOKEN_EXPIRES_AT": str(60 * 86400)})
    assert capsys.readouterr().err == ""


# ------------------------------------------------------------------- publish
def test_publish_no_token_exits():
    with pytest.raises(SystemExit):
        lp.publish({}, {"x": 1})


def test_publish_success_with_id(monkeypatch, capsys):
    resp = FakeResp(headers={"x-restli-id": "urn:li:share:7"})
    monkeypatch.setattr(lp.urllib.request, "urlopen", lambda req: resp)
    lp.publish({"LINKEDIN_ACCESS_TOKEN": "t"}, {"x": 1})
    out = capsys.readouterr().out
    assert "Published to LinkedIn." in out
    assert "urn:li:share:7" in out


def test_publish_success_without_id(monkeypatch, capsys):
    monkeypatch.setattr(lp.urllib.request, "urlopen", lambda req: FakeResp(headers={}))
    lp.publish({"LINKEDIN_ACCESS_TOKEN": "t"}, {"x": 1})
    assert "Published to LinkedIn." in capsys.readouterr().out


@pytest.mark.parametrize("code", [401, 500])
def test_publish_http_error(monkeypatch, capsys, code):
    def boom(req):
        raise http_error(code)

    monkeypatch.setattr(lp.urllib.request, "urlopen", boom)
    with pytest.raises(SystemExit):
        lp.publish({"LINKEDIN_ACCESS_TOKEN": "t"}, {"x": 1})
    assert f"HTTP {code}" in capsys.readouterr().err


def test_publish_url_error(monkeypatch):
    def boom(req):
        raise urllib.error.URLError("down")

    monkeypatch.setattr(lp.urllib.request, "urlopen", boom)
    with pytest.raises(SystemExit):
        lp.publish({"LINKEDIN_ACCESS_TOKEN": "t"}, {"x": 1})


# ---------------------------------------------------------------------- main
def _env(monkeypatch, env):
    monkeypatch.setattr(lp, "load_env", lambda: env)


def test_main_dry_run_text(monkeypatch, capsys):
    _env(monkeypatch, {"LINKEDIN_PERSON_URN": "urn:li:person:1"})
    monkeypatch.setattr("sys.argv", ["x", "--text", "hi", "--dry-run"])
    lp.main()
    assert "DRY RUN" in capsys.readouterr().out


def test_main_dry_run_with_image(monkeypatch, capsys, tmp_path):
    img = tmp_path / "i.png"
    img.write_bytes(b"PNG")
    _env(monkeypatch, {"LINKEDIN_PERSON_URN": ""})
    monkeypatch.setattr(
        "sys.argv", ["x", "--text", "hi", "--image", str(img), "--dry-run"]
    )
    lp.main()
    assert "with image" in capsys.readouterr().out


def test_main_image_not_found_exits(monkeypatch):
    # Relative path exercises the REPO-resolution branch before the not-found exit.
    _env(monkeypatch, {"LINKEDIN_PERSON_URN": "urn:li:person:1"})
    monkeypatch.setattr(
        "sys.argv", ["x", "--text", "hi", "--image", "no_such_image_xyz.png"]
    )
    with pytest.raises(SystemExit):
        lp.main()


def test_main_missing_author_exits(monkeypatch):
    _env(monkeypatch, {"LINKEDIN_PERSON_URN": ""})
    monkeypatch.setattr("sys.argv", ["x", "--text", "hi"])
    with pytest.raises(SystemExit):
        lp.main()


def test_main_full_publish_with_image(monkeypatch, capsys, tmp_path):
    img = tmp_path / "i.png"
    img.write_bytes(b"PNG")
    _env(
        monkeypatch,
        {"LINKEDIN_PERSON_URN": "urn:li:person:1", "LINKEDIN_ACCESS_TOKEN": "t"},
    )
    monkeypatch.setattr(lp, "warn_if_token_expiring", lambda env: None)
    monkeypatch.setattr(
        lp, "initialize_image_upload", lambda env, owner: ("http://up", "urn:li:image:1")
    )
    monkeypatch.setattr(lp, "upload_file_bytes", lambda *a: None)
    monkeypatch.setattr(lp, "publish", lambda env, payload: print("PUBLISHED"))
    monkeypatch.setattr(
        "sys.argv",
        ["x", "--text", "hi", "--image", str(img), "--alt", "desc", "--allow-unverified"],
    )
    lp.main()
    out = capsys.readouterr().out
    assert "Uploaded image" in out and "PUBLISHED" in out


def test_main_image_without_alt_warns(monkeypatch, capsys, tmp_path):
    img = tmp_path / "i.png"
    img.write_bytes(b"PNG")
    _env(
        monkeypatch,
        {"LINKEDIN_PERSON_URN": "urn:li:person:1", "LINKEDIN_ACCESS_TOKEN": "t"},
    )
    monkeypatch.setattr(lp, "warn_if_token_expiring", lambda env: None)
    monkeypatch.setattr(
        lp, "initialize_image_upload", lambda env, owner: ("http://up", "urn:li:image:1")
    )
    monkeypatch.setattr(lp, "upload_file_bytes", lambda *a: None)
    monkeypatch.setattr(lp, "publish", lambda env, payload: None)
    monkeypatch.setattr(
        "sys.argv", ["x", "--text", "hi", "--image", str(img), "--allow-unverified"]
    )
    lp.main()
    assert "no --alt provided" in capsys.readouterr().err


# ----------------------------------------------------- documents / carousels
def test_build_payload_with_document_and_title():
    p = lp.build_payload("urn:li:person:1", "hi", document_urn="urn:li:document:9", title="T")
    assert p["content"]["media"] == {"id": "urn:li:document:9", "title": "T"}


def test_build_payload_with_document_no_title():
    p = lp.build_payload("urn:li:person:1", "hi", document_urn="urn:li:document:9")
    assert p["content"]["media"] == {"id": "urn:li:document:9"}


def test_initialize_document_upload_success(monkeypatch):
    body = json.dumps(
        {"value": {"uploadUrl": "http://up", "document": "urn:li:document:1"}}
    ).encode()
    monkeypatch.setattr(lp.urllib.request, "urlopen", lambda req: FakeResp(body))
    url, urn = lp.initialize_document_upload({"LINKEDIN_ACCESS_TOKEN": "t"}, "owner")
    assert url == "http://up" and urn == "urn:li:document:1"


def test_initialize_document_upload_http_error(monkeypatch):
    def boom(req):
        raise http_error(500)

    monkeypatch.setattr(lp.urllib.request, "urlopen", boom)
    with pytest.raises(SystemExit):
        lp.initialize_document_upload({}, "owner")


def test_initialize_document_upload_missing_fields(monkeypatch):
    monkeypatch.setattr(
        lp.urllib.request, "urlopen", lambda req: FakeResp(b'{"value": {}}')
    )
    with pytest.raises(SystemExit):
        lp.initialize_document_upload({}, "owner")


def test_main_image_and_document_mutually_exclusive(monkeypatch, tmp_path):
    img = tmp_path / "i.png"
    img.write_bytes(b"PNG")
    pdf = tmp_path / "d.pdf"
    pdf.write_bytes(b"%PDF")
    _env(monkeypatch, {"LINKEDIN_PERSON_URN": "urn:li:person:1"})
    monkeypatch.setattr(
        "sys.argv",
        ["x", "--text", "hi", "--image", str(img), "--document", str(pdf)],
    )
    with pytest.raises(SystemExit):
        lp.main()


def test_main_document_not_found_exits(monkeypatch):
    _env(monkeypatch, {"LINKEDIN_PERSON_URN": "urn:li:person:1"})
    monkeypatch.setattr("sys.argv", ["x", "--text", "hi", "--document", "no_such_xyz.pdf"])
    with pytest.raises(SystemExit):
        lp.main()


def test_main_document_wrong_extension_exits(monkeypatch, tmp_path):
    notpdf = tmp_path / "d.png"
    notpdf.write_bytes(b"PNG")
    _env(monkeypatch, {"LINKEDIN_PERSON_URN": "urn:li:person:1"})
    monkeypatch.setattr("sys.argv", ["x", "--text", "hi", "--document", str(notpdf)])
    with pytest.raises(SystemExit):
        lp.main()


def test_main_dry_run_with_document(monkeypatch, capsys, tmp_path):
    pdf = tmp_path / "d.pdf"
    pdf.write_bytes(b"%PDF")
    _env(monkeypatch, {"LINKEDIN_PERSON_URN": "urn:li:person:1"})
    monkeypatch.setattr(
        "sys.argv",
        ["x", "--text", "hi", "--document", str(pdf), "--title", "T", "--dry-run"],
    )
    lp.main()
    out = capsys.readouterr().out
    assert "with carousel PDF" in out and "urn:li:document:DRY_RUN_PLACEHOLDER" in out


def test_main_full_publish_with_document(monkeypatch, capsys, tmp_path):
    pdf = tmp_path / "d.pdf"
    pdf.write_bytes(b"%PDF")
    _env(
        monkeypatch,
        {"LINKEDIN_PERSON_URN": "urn:li:person:1", "LINKEDIN_ACCESS_TOKEN": "t"},
    )
    monkeypatch.setattr(lp, "warn_if_token_expiring", lambda env: None)
    monkeypatch.setattr(
        lp, "initialize_document_upload", lambda env, owner: ("http://up", "urn:li:document:1")
    )
    monkeypatch.setattr(lp, "upload_file_bytes", lambda *a: None)
    monkeypatch.setattr(lp, "publish", lambda env, payload: print("PUBLISHED"))
    monkeypatch.setattr(
        "sys.argv",
        ["x", "--text", "hi", "--document", str(pdf), "--title", "T", "--allow-unverified"],
    )
    lp.main()
    out = capsys.readouterr().out
    assert "Uploaded document" in out and "PUBLISHED" in out


def test_main_document_without_title_warns(monkeypatch, capsys, tmp_path):
    pdf = tmp_path / "d.pdf"
    pdf.write_bytes(b"%PDF")
    _env(
        monkeypatch,
        {"LINKEDIN_PERSON_URN": "urn:li:person:1", "LINKEDIN_ACCESS_TOKEN": "t"},
    )
    monkeypatch.setattr(lp, "warn_if_token_expiring", lambda env: None)
    monkeypatch.setattr(
        lp, "initialize_document_upload", lambda env, owner: ("http://up", "urn:li:document:1")
    )
    monkeypatch.setattr(lp, "upload_file_bytes", lambda *a: None)
    monkeypatch.setattr(lp, "publish", lambda env, payload: None)
    monkeypatch.setattr(
        "sys.argv", ["x", "--text", "hi", "--document", str(pdf), "--allow-unverified"]
    )
    lp.main()
    assert "no --title provided" in capsys.readouterr().err


# ------------------------------------------------------------- source gate
def _gate_args(**over):
    base = {"allow_unverified": False, "file": None}
    base.update(over)
    return type("A", (), base)()


def test_gate_allow_unverified_warns_and_passes(capsys):
    lp.enforce_source_gate(_gate_args(allow_unverified=True))
    assert "WITHOUT source verification" in capsys.readouterr().err


def test_gate_no_file_refuses():
    with pytest.raises(SystemExit) as e:
        lp.enforce_source_gate(_gate_args(file=None))
    assert "refusing to publish unverified" in str(e.value)


def test_gate_file_fail_refuses(monkeypatch):
    monkeypatch.setattr(lp.verify_sources, "verify", lambda f: {"ok": False, "reason": "nope"})
    with pytest.raises(SystemExit) as e:
        lp.enforce_source_gate(_gate_args(file="drafts/p.md"))
    assert "source check failed — nope" in str(e.value)


def test_gate_file_pass_proceeds(monkeypatch, capsys):
    monkeypatch.setattr(lp.verify_sources, "verify", lambda f: {"ok": True, "reason": "3 sources"})
    lp.enforce_source_gate(_gate_args(file="drafts/p.md"))
    assert "Source check passed" in capsys.readouterr().out


def test_main_bare_text_publish_blocked_by_gate(monkeypatch):
    _env(monkeypatch, {"LINKEDIN_PERSON_URN": "urn:li:person:1"})
    monkeypatch.setattr("sys.argv", ["x", "--text", "hi"])
    with pytest.raises(SystemExit) as e:
        lp.main()
    assert "refusing to publish unverified" in str(e.value)


def test_main_file_gate_fail_blocks_before_upload(monkeypatch, tmp_path):
    """A failed gate must exit before any media upload (no orphaned asset)."""
    draft = tmp_path / "p.md"
    draft.write_text("body", encoding="utf-8")
    img = tmp_path / "i.png"
    img.write_bytes(b"PNG")
    _env(
        monkeypatch,
        {"LINKEDIN_PERSON_URN": "urn:li:person:1", "LINKEDIN_ACCESS_TOKEN": "t"},
    )
    monkeypatch.setattr(lp, "warn_if_token_expiring", lambda env: None)
    monkeypatch.setattr(lp.verify_sources, "verify", lambda f: {"ok": False, "reason": "x"})

    def fail_upload(*a):
        raise AssertionError("upload must not run on a failed gate")

    monkeypatch.setattr(lp, "initialize_image_upload", fail_upload)
    monkeypatch.setattr(
        "sys.argv", ["x", "--file", str(draft), "--image", str(img), "--alt", "d"]
    )
    with pytest.raises(SystemExit):
        lp.main()


def test_main_file_gate_pass_publishes(monkeypatch, capsys, tmp_path):
    draft = tmp_path / "p.md"
    draft.write_text("real post body", encoding="utf-8")
    _env(
        monkeypatch,
        {"LINKEDIN_PERSON_URN": "urn:li:person:1", "LINKEDIN_ACCESS_TOKEN": "t"},
    )
    monkeypatch.setattr(lp, "warn_if_token_expiring", lambda env: None)
    monkeypatch.setattr(
        lp.verify_sources, "verify", lambda f: {"ok": True, "reason": "3 sources"}
    )
    monkeypatch.setattr(lp, "publish", lambda env, payload: print("PUBLISHED"))
    monkeypatch.setattr("sys.argv", ["x", "--file", str(draft)])
    lp.main()
    out = capsys.readouterr().out
    assert "Source check passed" in out and "PUBLISHED" in out


def test_main_file_drives_real_verify_and_publishes(monkeypatch, capsys, tmp_path):
    """End-to-end: main(--file) runs the REAL verify() against an on-disk sidecar
    (only the network is mocked), closing the behavior-coverage gap."""
    draft = tmp_path / "p.md"
    draft.write_text("real post body", encoding="utf-8")
    (tmp_path / "p.sources.json").write_text(
        json.dumps(
            {
                "external_claims": True,
                "claims": [
                    {"claim": "a", "sources": ["https://a.com"]},
                    {"claim": "b", "sources": ["https://b.com"]},
                    {"claim": "c", "sources": ["https://c.com"]},
                ],
            }
        ),
        encoding="utf-8",
    )
    _env(
        monkeypatch,
        {"LINKEDIN_PERSON_URN": "urn:li:person:1", "LINKEDIN_ACCESS_TOKEN": "t"},
    )
    monkeypatch.setattr(lp, "warn_if_token_expiring", lambda env: None)
    monkeypatch.setattr(lp.verify_sources, "_is_live", lambda url: True)  # no network
    monkeypatch.setattr(lp, "publish", lambda env, payload: print("PUBLISHED"))
    monkeypatch.setattr("sys.argv", ["x", "--file", str(draft)])
    lp.main()
    out = capsys.readouterr().out
    assert "3 distinct live sources verified" in out and "PUBLISHED" in out


def test_main_file_real_verify_too_few_hosts_blocks(monkeypatch, tmp_path):
    """End-to-end: a real verify() with <3 hosts blocks the publish."""
    draft = tmp_path / "p.md"
    draft.write_text("body", encoding="utf-8")
    (tmp_path / "p.sources.json").write_text(
        json.dumps(
            {"external_claims": True, "claims": [{"claim": "a", "sources": ["https://a.com"]}]}
        ),
        encoding="utf-8",
    )
    _env(
        monkeypatch,
        {"LINKEDIN_PERSON_URN": "urn:li:person:1", "LINKEDIN_ACCESS_TOKEN": "t"},
    )
    monkeypatch.setattr(lp.verify_sources, "_is_live", lambda url: True)
    monkeypatch.setattr("sys.argv", ["x", "--file", str(draft)])
    with pytest.raises(SystemExit) as e:
        lp.main()
    assert "distinct live source host" in str(e.value)


# ------------------------------------------------------------- record_publish
def _pub_args(**kw):
    base = {"file": None, "text": None, "image": None, "document": None, "lane": ""}
    base.update(kw)
    return type("A", (), base)()


def test_record_publish_appends_valid_record(tmp_path):
    log = tmp_path / "published.jsonl"
    args = _pub_args(file="drafts/2026-07-17-my-post.md", lane="release-howto")
    lp.record_publish("urn:li:share:42", args, "First line\nrest", log_path=log)
    rec = json.loads(log.read_text(encoding="utf-8").strip())
    assert rec["urn"] == "urn:li:share:42"
    assert rec["url"].endswith("urn:li:share:42")
    assert rec["slug"] == "2026-07-17-my-post"
    assert rec["format"] == "text"
    assert rec["chars"] == len("First line\nrest")
    assert rec["first_line"] == "First line"
    assert rec["lane"] == "release-howto"
    assert rec["date"]


def test_record_publish_infers_media_formats(tmp_path):
    log = tmp_path / "published.jsonl"
    lp.record_publish("id1", _pub_args(image="i.png"), "t", log_path=log)
    lp.record_publish("id2", _pub_args(document="d.pdf"), "t", log_path=log)
    recs = [json.loads(l) for l in log.read_text(encoding="utf-8").splitlines()]
    assert [r["format"] for r in recs] == ["image", "carousel"]


def test_record_publish_no_post_id_still_records(tmp_path):
    log = tmp_path / "published.jsonl"
    lp.record_publish(None, _pub_args(), "hello", log_path=log)
    rec = json.loads(log.read_text(encoding="utf-8").strip())
    assert rec["urn"] == "" and rec["url"] == ""


def test_record_publish_write_failure_warns_not_raises(tmp_path, capsys):
    blocked = tmp_path / "as_dir.jsonl"
    blocked.mkdir()  # open("a") on a directory -> OSError
    lp.record_publish("id", _pub_args(), "t", log_path=blocked)
    assert "WARNING: could not write" in capsys.readouterr().err


def test_main_full_publish_appends_log(monkeypatch, capsys, tmp_path):
    """End-to-end: a successful --file publish writes exactly one log record."""
    log = tmp_path / "published.jsonl"
    monkeypatch.setattr(lp, "PUBLISHED_LOG", log)
    draft = tmp_path / "2026-07-17-e2e.md"
    draft.write_text("body", encoding="utf-8")
    (tmp_path / "2026-07-17-e2e.sources.json").write_text(
        json.dumps({"external_claims": False, "claims": []}), encoding="utf-8"
    )
    _env(
        monkeypatch,
        {"LINKEDIN_PERSON_URN": "urn:li:person:1", "LINKEDIN_ACCESS_TOKEN": "t"},
    )
    monkeypatch.setattr(lp, "warn_if_token_expiring", lambda env: None)
    monkeypatch.setattr(lp, "publish", lambda env, payload: "urn:li:share:99")
    monkeypatch.setattr(
        "sys.argv", ["x", "--file", str(draft), "--lane", "personal"]
    )
    lp.main()
    recs = [json.loads(l) for l in log.read_text(encoding="utf-8").splitlines()]
    assert len(recs) == 1
    assert recs[0]["urn"] == "urn:li:share:99"
    assert recs[0]["slug"] == "2026-07-17-e2e"
    assert recs[0]["lane"] == "personal"


def test_main_dry_run_appends_nothing(monkeypatch, capsys, tmp_path):
    log = tmp_path / "published.jsonl"
    monkeypatch.setattr(lp, "PUBLISHED_LOG", log)
    _env(monkeypatch, {"LINKEDIN_PERSON_URN": "urn:li:person:1"})
    monkeypatch.setattr("sys.argv", ["x", "--text", "hi", "--dry-run"])
    lp.main()
    assert not log.exists()

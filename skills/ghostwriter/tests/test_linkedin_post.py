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
        "sys.argv", ["x", "--text", "hi", "--image", str(img), "--alt", "desc"]
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
    monkeypatch.setattr("sys.argv", ["x", "--text", "hi", "--image", str(img)])
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
        "sys.argv", ["x", "--text", "hi", "--document", str(pdf), "--title", "T"]
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
    monkeypatch.setattr("sys.argv", ["x", "--text", "hi", "--document", str(pdf)])
    lp.main()
    assert "no --title provided" in capsys.readouterr().err

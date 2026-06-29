"""Tests for scripts/verify_sources.py — full line coverage (network mocked)."""
from __future__ import annotations

import io
import json
import urllib.error

import pytest

import verify_sources as vs


# --------------------------------------------------------------------- helpers
class FakeResp:
    """Minimal stand-in for the urlopen() context manager."""

    def __init__(self, status=200):
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def http_error(code):
    return urllib.error.HTTPError("http://x", code, "err", {}, io.BytesIO(b""))


def write_sidecar(tmp_path, payload):
    """Write a draft + its sidecar; return the draft path."""
    draft = tmp_path / "post.md"
    draft.write_text("body", encoding="utf-8")
    if payload is not None:
        (tmp_path / "post.sources.json").write_text(payload, encoding="utf-8")
    return draft


def external(*claim_urls):
    """Build an external_claims:true sidecar from lists of source URLs."""
    claims = [{"claim": f"c{i}", "sources": list(u)} for i, u in enumerate(claim_urls)]
    return json.dumps({"external_claims": True, "claims": claims})


# ------------------------------------------------------------------- _host
def test_host_strips_www_and_lowercases():
    assert vs._host("https://WWW.Example.com/x") == "example.com"


def test_host_plain_and_empty():
    assert vs._host("https://a.com/y") == "a.com"
    assert vs._host("notaurl") == ""


# ------------------------------------------------------------------- _status
def test_status_success(monkeypatch):
    monkeypatch.setattr(vs.urllib.request, "urlopen", lambda req, timeout: FakeResp(200))
    assert vs._status("http://x", "HEAD") == 200


def test_status_get_sets_range_and_returns(monkeypatch):
    seen = {}

    def fake_urlopen(req, timeout):
        seen["range"] = req.headers.get("Range")
        return FakeResp(206)

    monkeypatch.setattr(vs.urllib.request, "urlopen", fake_urlopen)
    assert vs._status("http://x", "GET") == 206
    assert seen["range"] == "bytes=0-0"


def test_status_http_error_returns_code(monkeypatch):
    def boom(req, timeout):
        raise http_error(404)

    monkeypatch.setattr(vs.urllib.request, "urlopen", boom)
    assert vs._status("http://x", "HEAD") == 404


def test_status_url_error_returns_none(monkeypatch):
    def boom(req, timeout):
        raise urllib.error.URLError("dns")

    monkeypatch.setattr(vs.urllib.request, "urlopen", boom)
    assert vs._status("http://x", "HEAD") is None


def test_status_os_error_returns_none(monkeypatch):
    def boom(req, timeout):
        raise TimeoutError("slow")

    monkeypatch.setattr(vs.urllib.request, "urlopen", boom)
    assert vs._status("http://x", "HEAD") is None


# ------------------------------------------------------------------- _is_live
def _fake_status(mapping):
    """Return a _status stand-in driven by a {method: code} mapping."""
    return lambda url, method: mapping[method]


def test_is_live_head_2xx(monkeypatch):
    monkeypatch.setattr(vs, "_status", _fake_status({"HEAD": 200}))
    assert vs._is_live("http://x") is True


def test_is_live_head_403_counts_live(monkeypatch):
    monkeypatch.setattr(vs, "_status", _fake_status({"HEAD": 403}))
    assert vs._is_live("http://x") is True


def test_is_live_head405_get_live(monkeypatch):
    monkeypatch.setattr(vs, "_status", _fake_status({"HEAD": 405, "GET": 200}))
    assert vs._is_live("http://x") is True


def test_is_live_head405_get_dead(monkeypatch):
    monkeypatch.setattr(vs, "_status", _fake_status({"HEAD": 405, "GET": 404}))
    assert vs._is_live("http://x") is False


def test_is_live_head501_get501_not_live(monkeypatch):
    monkeypatch.setattr(vs, "_status", _fake_status({"HEAD": 501, "GET": 501}))
    assert vs._is_live("http://x") is False


def test_is_live_network_error_not_live(monkeypatch):
    monkeypatch.setattr(vs, "_status", _fake_status({"HEAD": None}))
    assert vs._is_live("http://x") is False


def test_is_live_head405_get_network_error_keeps_live(monkeypatch):
    # A 405 proved the host is up; a transient GET error must not downgrade it.
    monkeypatch.setattr(vs, "_status", _fake_status({"HEAD": 405, "GET": None}))
    assert vs._is_live("http://x") is True


# --------------------------------------------------------------------- verify
def test_verify_missing_sidecar_fails(tmp_path):
    draft = write_sidecar(tmp_path, None)  # no sidecar written
    res = vs.verify(draft)
    assert res["ok"] is False and "No sources sidecar" in res["reason"]


def test_verify_malformed_json_fails(tmp_path):
    draft = write_sidecar(tmp_path, "{not json")
    res = vs.verify(draft)
    assert res["ok"] is False and "not valid JSON" in res["reason"]


def test_verify_non_object_json_fails(tmp_path):
    draft = write_sidecar(tmp_path, "[]")
    res = vs.verify(draft)
    assert res["ok"] is False and "JSON object" in res["reason"]


def test_verify_external_claims_null_fails(tmp_path):
    # Explicit null must fail-closed, not be treated as a personal post.
    draft = write_sidecar(tmp_path, json.dumps({"external_claims": None, "claims": []}))
    res = vs.verify(draft)
    assert res["ok"] is False and "must be true or false" in res["reason"]


def test_verify_missing_external_claims_key_defaults_external(tmp_path):
    # No external_claims key -> default True -> routes into the external path
    # (proven by hitting the claim-needs-a-source failure, not a trivial pass).
    draft = write_sidecar(
        tmp_path, json.dumps({"claims": [{"claim": "c", "sources": []}]})
    )
    res = vs.verify(draft)
    assert res["ok"] is False and "no source" in res["reason"]


def test_verify_personal_post_passes(tmp_path):
    draft = write_sidecar(tmp_path, json.dumps({"external_claims": False, "claims": []}))
    res = vs.verify(draft)
    assert res["ok"] is True and "Personal post" in res["reason"]


def test_verify_personal_with_claims_contradiction_fails(tmp_path):
    draft = write_sidecar(
        tmp_path,
        json.dumps({"external_claims": False, "claims": [{"claim": "c", "sources": []}]}),
    )
    res = vs.verify(draft)
    assert res["ok"] is False and "contradictory" in res["reason"]


def test_verify_external_no_claims_fails(tmp_path):
    draft = write_sidecar(tmp_path, json.dumps({"external_claims": True, "claims": []}))
    res = vs.verify(draft)
    assert res["ok"] is False and "lists none" in res["reason"]


def test_verify_claim_without_source_fails(tmp_path):
    draft = write_sidecar(
        tmp_path,
        json.dumps({"external_claims": True, "claims": [{"claim": "c", "sources": []}]}),
    )
    res = vs.verify(draft)
    assert res["ok"] is False and "no source" in res["reason"]


# --- malformed sidecar shapes must fail cleanly, never crash with a traceback
def test_verify_claims_not_a_list_fails(tmp_path):
    draft = write_sidecar(
        tmp_path, json.dumps({"external_claims": True, "claims": {"c1": "x"}})
    )
    res = vs.verify(draft)
    assert res["ok"] is False and "'claims' must be a list" in res["reason"]


def test_verify_claim_not_an_object_fails(tmp_path):
    draft = write_sidecar(
        tmp_path, json.dumps({"external_claims": True, "claims": ["just a string"]})
    )
    res = vs.verify(draft)
    assert res["ok"] is False and "must be an object" in res["reason"]


def test_verify_sources_not_a_list_fails(tmp_path):
    # A bare string for `sources` (a common authoring mistake) must fail with a
    # real message, not iterate the string's characters.
    draft = write_sidecar(
        tmp_path,
        json.dumps(
            {"external_claims": True, "claims": [{"claim": "c", "sources": "https://a.com"}]}
        ),
    )
    res = vs.verify(draft)
    assert res["ok"] is False and "no source" in res["reason"]


def test_verify_source_not_a_string_fails(tmp_path):
    draft = write_sidecar(
        tmp_path,
        json.dumps({"external_claims": True, "claims": [{"claim": "c", "sources": [123]}]}),
    )
    res = vs.verify(draft)
    assert res["ok"] is False and "must be a URL string" in res["reason"]


def test_verify_non_http_scheme_fails(tmp_path):
    draft = write_sidecar(tmp_path, external(["file:///etc/passwd"]))
    res = vs.verify(draft)
    assert res["ok"] is False and "Non-http(s)" in res["reason"]


def test_verify_dead_url_fails(tmp_path, monkeypatch):
    draft = write_sidecar(
        tmp_path, external(["http://a.com"], ["http://b.com"], ["http://dead.com"])
    )
    monkeypatch.setattr(vs, "_is_live", lambda url: "dead" not in url)
    res = vs.verify(draft)
    assert res["ok"] is False and "not reachable/live" in res["reason"]
    assert res["not_live"] == ["http://dead.com"]


def test_verify_too_few_distinct_hosts_fails(tmp_path, monkeypatch):
    # www.a.com and a.com normalize to one host -> only 2 distinct -> fail.
    draft = write_sidecar(
        tmp_path, external(["http://www.a.com/1"], ["http://a.com/2"], ["http://b.com"])
    )
    monkeypatch.setattr(vs, "_is_live", lambda url: True)
    res = vs.verify(draft)
    assert res["ok"] is False and "distinct live source host" in res["reason"]
    assert res["distinct_live"] == 2


def test_verify_three_live_hosts_passes(tmp_path, monkeypatch):
    draft = write_sidecar(
        tmp_path, external(["http://a.com"], ["http://b.com"], ["https://c.com"])
    )
    monkeypatch.setattr(vs, "_is_live", lambda url: True)
    res = vs.verify(draft)
    assert res["ok"] is True and res["distinct_live"] == 3
    assert len(res["results"]) == 3


# ----------------------------------------------------------------------- main
def test_main_json_ok_exits_zero(monkeypatch, capsys):
    monkeypatch.setattr(vs, "verify", lambda f: vs._ok("good", distinct_live=3))
    monkeypatch.setattr("sys.argv", ["x", "--file", "drafts/p.md", "--json"])
    with pytest.raises(SystemExit) as e:
        vs.main()
    assert e.value.code == 0
    assert json.loads(capsys.readouterr().out)["ok"] is True


def test_main_text_fail_exits_one(monkeypatch, capsys):
    monkeypatch.setattr(vs, "verify", lambda f: vs._fail("bad"))
    monkeypatch.setattr("sys.argv", ["x", "--file", "drafts/p.md"])
    with pytest.raises(SystemExit) as e:
        vs.main()
    assert e.value.code == 1
    assert "[FAIL] bad" in capsys.readouterr().out


def test_main_text_ok_exits_zero(monkeypatch, capsys):
    monkeypatch.setattr(vs, "verify", lambda f: vs._ok("great"))
    monkeypatch.setattr("sys.argv", ["x", "--file", "drafts/p.md"])
    with pytest.raises(SystemExit) as e:
        vs.main()
    assert e.value.code == 0
    assert "[OK] great" in capsys.readouterr().out

"""Tests for scripts/linkedin_auth.py — full branch coverage (no real network)."""
from __future__ import annotations

import io
import threading
import types
import urllib.error

import pytest

import linkedin_auth as la


class FakeResp:
    def __init__(self, body=b""):
        self._body = body

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def read(self):
        return self._body


def http_error(code, body=b"boom"):
    return urllib.error.HTTPError("http://x", code, "err", {}, io.BytesIO(body))


# ------------------------------------------------------------------ load/save env
def test_load_env_missing_exits(tmp_path):
    with pytest.raises(SystemExit):
        la.load_env(tmp_path / "nope.env")


def test_load_env_parses(tmp_path):
    env = tmp_path / ".env"
    env.write_text("# c\nA=1\nbad\nB='two'\n", encoding="utf-8")
    assert la.load_env(env) == {"A": "1", "B": "two"}


def test_save_env_updates_and_appends(tmp_path):
    env = tmp_path / ".env"
    env.write_text("# header\nEXISTING=old\nKEEP=yes\n", encoding="utf-8")
    la.save_env({"EXISTING": "new", "ADDED": "fresh"}, env)
    text = env.read_text(encoding="utf-8")
    assert "EXISTING=new" in text
    assert "KEEP=yes" in text
    assert "ADDED=fresh" in text
    assert "# header" in text


# --------------------------------------------------------------- _CallbackHandler
def make_handler(path, redirect_path="http://127.0.0.1:8765/callback"):
    h = object.__new__(la._CallbackHandler)
    h.path = path
    h.server = types.SimpleNamespace(
        redirect_path=redirect_path,
        oauth_result={},
        oauth_event=threading.Event(),
    )
    h.responses = []
    h.send_response = lambda code: h.responses.append(code)
    h.send_header = lambda *a, **k: None
    h.end_headers = lambda: None
    h.wfile = io.BytesIO()
    return h


def test_handler_valid_code():
    h = make_handler("/callback?code=ABC&state=S")
    h.do_GET()
    assert h.server.oauth_result["code"] == "ABC"
    assert h.responses[0] == 200
    assert h.server.oauth_event.is_set()
    assert b"received" in h.wfile.getvalue()


def test_handler_error_param():
    h = make_handler("/callback?error=denied&error_description=no")
    h.do_GET()
    assert h.server.oauth_result["error"] == "denied"
    assert h.responses[0] == 200
    assert b"failed" in h.wfile.getvalue()


def test_handler_stray_no_params_returns_204():
    h = make_handler("/callback")
    h.do_GET()
    assert h.responses[0] == 204
    assert not h.server.oauth_event.is_set()


def test_handler_stray_other_path_returns_204():
    h = make_handler("/favicon.ico")
    h.do_GET()
    assert h.responses[0] == 204


def test_handler_log_message_is_silent():
    h = make_handler("/callback")
    assert h.log_message("anything %s", "x") is None


# --------------------------------------------------------------- wait_for_callback
class FakeServer:
    """Injected in place of HTTPServer; serve_forever sets a scripted result."""

    behavior: dict = {}

    def __init__(self, addr, handler):
        self.addr = addr
        self._b = dict(FakeServer.behavior)

    def serve_forever(self):
        result = self._b.get("result")
        if result is not None:
            self.oauth_result = result
            self.oauth_event.set()

    def shutdown(self):
        pass

    def server_close(self):
        pass


def use_fake_server(monkeypatch, result):
    FakeServer.behavior = {"result": result}
    monkeypatch.setattr(la.http.server, "HTTPServer", FakeServer)
    monkeypatch.setattr(la.webbrowser, "open", lambda url: None)


def test_wait_for_callback_success(monkeypatch, capsys):
    use_fake_server(monkeypatch, {"code": "ABC", "state": "S"})
    code = la.wait_for_callback("http://127.0.0.1:8765/callback", "S", "http://auth")
    assert code == "ABC"


def test_wait_for_callback_bind_error(monkeypatch):
    def boom(addr, handler):
        raise OSError("port in use")

    monkeypatch.setattr(la.http.server, "HTTPServer", boom)
    monkeypatch.setattr(la.webbrowser, "open", lambda url: None)
    with pytest.raises(SystemExit) as e:
        la.wait_for_callback("http://127.0.0.1:8765/callback", "S", "http://auth")
    assert "local server" in str(e.value)


def test_wait_for_callback_timeout(monkeypatch):
    use_fake_server(monkeypatch, None)  # serve_forever never sets the event
    with pytest.raises(SystemExit) as e:
        la.wait_for_callback(
            "http://127.0.0.1:8765/callback", "S", "http://auth", timeout=0
        )
    assert "timed out" in str(e.value)


def test_wait_for_callback_error_result(monkeypatch):
    use_fake_server(monkeypatch, {"error": "denied", "error_description": "no"})
    with pytest.raises(SystemExit) as e:
        la.wait_for_callback("http://127.0.0.1:8765/callback", "S", "http://auth")
    assert "denied authorization" in str(e.value)


def test_wait_for_callback_state_mismatch(monkeypatch):
    use_fake_server(monkeypatch, {"code": "ABC", "state": "WRONG"})
    with pytest.raises(SystemExit) as e:
        la.wait_for_callback("http://127.0.0.1:8765/callback", "S", "http://auth")
    assert "state mismatch" in str(e.value)


# ------------------------------------------------------------- token + userinfo
def test_exchange_code_success(monkeypatch):
    env = {
        "LINKEDIN_REDIRECT_URI": "u",
        "LINKEDIN_CLIENT_ID": "i",
        "LINKEDIN_CLIENT_SECRET": "s",
    }
    monkeypatch.setattr(
        la.urllib.request, "urlopen", lambda req: FakeResp(b'{"access_token":"t"}')
    )
    assert la.exchange_code_for_token(env, "code")["access_token"] == "t"


def test_exchange_code_http_error(monkeypatch):
    env = {
        "LINKEDIN_REDIRECT_URI": "u",
        "LINKEDIN_CLIENT_ID": "i",
        "LINKEDIN_CLIENT_SECRET": "s",
    }

    def boom(req):
        raise http_error(400)

    monkeypatch.setattr(la.urllib.request, "urlopen", boom)
    with pytest.raises(SystemExit):
        la.exchange_code_for_token(env, "code")


def test_fetch_person_urn_with_name(monkeypatch, capsys):
    body = b'{"sub":"123","name":"Nate"}'
    monkeypatch.setattr(la.urllib.request, "urlopen", lambda req: FakeResp(body))
    assert la.fetch_person_urn("t") == "urn:li:person:123"
    assert "Authorized as: Nate" in capsys.readouterr().out


def test_fetch_person_urn_without_name(monkeypatch):
    monkeypatch.setattr(
        la.urllib.request, "urlopen", lambda req: FakeResp(b'{"sub":"123"}')
    )
    assert la.fetch_person_urn("t") == "urn:li:person:123"


def test_fetch_person_urn_no_sub(monkeypatch):
    monkeypatch.setattr(la.urllib.request, "urlopen", lambda req: FakeResp(b"{}"))
    with pytest.raises(SystemExit):
        la.fetch_person_urn("t")


def test_fetch_person_urn_http_error(monkeypatch):
    def boom(req):
        raise http_error(403)

    monkeypatch.setattr(la.urllib.request, "urlopen", boom)
    with pytest.raises(SystemExit):
        la.fetch_person_urn("t")


# ------------------------------------------------------------------------- main
FULL_ENV = {
    "LINKEDIN_CLIENT_ID": "i",
    "LINKEDIN_CLIENT_SECRET": "s",
    "LINKEDIN_REDIRECT_URI": "http://127.0.0.1:8765/callback",
}


def test_main_missing_credentials_exits(monkeypatch):
    monkeypatch.setattr(la, "load_env", lambda: {})
    with pytest.raises(SystemExit) as e:
        la.main()
    assert "is not set" in str(e.value)


def test_main_happy_path(monkeypatch, capsys):
    saved = {}
    monkeypatch.setattr(la, "load_env", lambda: dict(FULL_ENV))
    monkeypatch.setattr(la, "wait_for_callback", lambda *a, **k: "code")
    monkeypatch.setattr(
        la,
        "exchange_code_for_token",
        lambda env, code: {"access_token": "tok", "expires_in": 5184000},
    )
    monkeypatch.setattr(la, "fetch_person_urn", lambda t: "urn:li:person:9")
    monkeypatch.setattr(la, "save_env", lambda updates: saved.update(updates))
    monkeypatch.setattr(la.time, "time", lambda: 0)
    la.main()
    assert saved["LINKEDIN_ACCESS_TOKEN"] == "tok"
    assert saved["LINKEDIN_PERSON_URN"] == "urn:li:person:9"
    assert saved["LINKEDIN_TOKEN_EXPIRES_AT"] == str(5184000)
    assert "Saved access token" in capsys.readouterr().out


def test_main_no_expiry_branch(monkeypatch, capsys):
    saved = {}
    monkeypatch.setattr(la, "load_env", lambda: dict(FULL_ENV))
    monkeypatch.setattr(la, "wait_for_callback", lambda *a, **k: "code")
    monkeypatch.setattr(
        la, "exchange_code_for_token", lambda env, code: {"access_token": "tok"}
    )
    monkeypatch.setattr(la, "fetch_person_urn", lambda t: "urn:li:person:9")
    monkeypatch.setattr(la, "save_env", lambda updates: saved.update(updates))
    la.main()
    assert saved["LINKEDIN_TOKEN_EXPIRES_AT"] == ""
    assert "~? days" in capsys.readouterr().out


def test_main_no_access_token_exits(monkeypatch):
    monkeypatch.setattr(la, "load_env", lambda: dict(FULL_ENV))
    monkeypatch.setattr(la, "wait_for_callback", lambda *a, **k: "code")
    monkeypatch.setattr(la, "exchange_code_for_token", lambda env, code: {})
    with pytest.raises(SystemExit) as e:
        la.main()
    assert "no access_token" in str(e.value)

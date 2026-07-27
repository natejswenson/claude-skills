"""Tests for scripts/x_auth.py — full branch coverage (no real network)."""
from __future__ import annotations

import base64
import hashlib
import io
import json
import threading
import types
import urllib.error

import pytest

import x_auth as xa


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
        xa.load_env(tmp_path / "nope.env")


def test_load_env_parses(tmp_path):
    env = tmp_path / ".env"
    env.write_text("# c\nA=1\nbad\nB='two'\n", encoding="utf-8")
    assert xa.load_env(env) == {"A": "1", "B": "two"}


def test_save_env_updates_and_appends(tmp_path):
    env = tmp_path / ".env"
    env.write_text("# header\nEXISTING=old\nKEEP=yes\n", encoding="utf-8")
    xa.save_env({"EXISTING": "new", "ADDED": "fresh"}, env)
    text = env.read_text(encoding="utf-8")
    assert "EXISTING=new" in text
    assert "KEEP=yes" in text
    assert "ADDED=fresh" in text
    assert "# header" in text


# ------------------------------------------------------------------------- PKCE
def test_make_pkce_pair_s256_relationship():
    verifier, challenge = xa.make_pkce_pair()
    expected = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
        .decode()
        .rstrip("=")
    )
    assert challenge == expected
    assert "=" not in challenge
    assert len(verifier) >= 43  # RFC 7636 minimum


# --------------------------------------------------------------- _CallbackHandler
def make_handler(path, redirect_path="http://127.0.0.1:8766/callback"):
    h = object.__new__(xa._CallbackHandler)
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
    monkeypatch.setattr(xa.http.server, "HTTPServer", FakeServer)
    monkeypatch.setattr(xa.webbrowser, "open", lambda url: None)


def test_wait_for_callback_success(monkeypatch):
    use_fake_server(monkeypatch, {"code": "ABC", "state": "S"})
    code = xa.wait_for_callback("http://127.0.0.1:8766/callback", "S", "http://auth")
    assert code == "ABC"


def test_wait_for_callback_bind_error(monkeypatch):
    def boom(addr, handler):
        raise OSError("port in use")

    monkeypatch.setattr(xa.http.server, "HTTPServer", boom)
    monkeypatch.setattr(xa.webbrowser, "open", lambda url: None)
    with pytest.raises(SystemExit) as e:
        xa.wait_for_callback("http://127.0.0.1:8766/callback", "S", "http://auth")
    assert "local server" in str(e.value)


def test_wait_for_callback_timeout(monkeypatch):
    use_fake_server(monkeypatch, None)  # serve_forever never sets the event
    with pytest.raises(SystemExit) as e:
        xa.wait_for_callback(
            "http://127.0.0.1:8766/callback", "S", "http://auth", timeout=0
        )
    assert "timed out" in str(e.value)


def test_wait_for_callback_error_result(monkeypatch):
    use_fake_server(monkeypatch, {"error": "denied", "error_description": "no"})
    with pytest.raises(SystemExit) as e:
        xa.wait_for_callback("http://127.0.0.1:8766/callback", "S", "http://auth")
    assert "denied authorization" in str(e.value)


def test_wait_for_callback_state_mismatch(monkeypatch):
    use_fake_server(monkeypatch, {"code": "ABC", "state": "WRONG"})
    with pytest.raises(SystemExit) as e:
        xa.wait_for_callback("http://127.0.0.1:8766/callback", "S", "http://auth")
    assert "state mismatch" in str(e.value)


# ---------------------------------------------------------------- token requests
PUBLIC_ENV = {"X_CLIENT_ID": "cid", "X_REDIRECT_URI": "http://127.0.0.1:8766/callback"}
CONF_ENV = {**PUBLIC_ENV, "X_CLIENT_SECRET": "shh"}


def capture_urlopen(monkeypatch, body=b'{"access_token":"t"}'):
    captured = {}

    def fake_urlopen(req):
        captured["req"] = req
        return FakeResp(body)

    monkeypatch.setattr(xa.urllib.request, "urlopen", fake_urlopen)
    return captured


def test_token_request_public_client_puts_id_in_body(monkeypatch):
    captured = capture_urlopen(monkeypatch)
    xa._token_request(dict(PUBLIC_ENV), {"grant_type": "x"})
    req = captured["req"]
    assert req.get_header("Authorization") is None
    assert b"client_id=cid" in req.data


def test_token_request_confidential_client_uses_basic_auth(monkeypatch):
    captured = capture_urlopen(monkeypatch)
    xa._token_request(dict(CONF_ENV), {"grant_type": "x"})
    req = captured["req"]
    auth = req.get_header("Authorization")
    assert auth == "Basic " + base64.b64encode(b"cid:shh").decode()
    assert b"client_id" not in req.data


def test_token_request_http_error(monkeypatch):
    def boom(req):
        raise http_error(400)

    monkeypatch.setattr(xa.urllib.request, "urlopen", boom)
    with pytest.raises(SystemExit):
        xa._token_request(dict(PUBLIC_ENV), {"grant_type": "x"})


def test_exchange_code_sends_verifier(monkeypatch):
    captured = capture_urlopen(monkeypatch)
    resp = xa.exchange_code_for_token(dict(PUBLIC_ENV), "CODE", "VERIFIER")
    assert resp["access_token"] == "t"
    assert b"code_verifier=VERIFIER" in captured["req"].data
    assert b"grant_type=authorization_code" in captured["req"].data


# ------------------------------------------------------------------- save_tokens
def make_env_file(tmp_path, extra=""):
    env_path = tmp_path / ".env"
    env_path.write_text(f"X_CLIENT_ID=cid\n{extra}", encoding="utf-8")
    return env_path


def test_save_tokens_persists_rotated_refresh_with_breadcrumb(tmp_path, monkeypatch):
    env_path = make_env_file(tmp_path, "X_REFRESH_TOKEN=old-r\n")
    monkeypatch.setattr(xa.time, "time", lambda: 1000)
    updates = xa.save_tokens(
        {"access_token": "new-a", "refresh_token": "new-r", "expires_in": 7200},
        {"X_REFRESH_TOKEN": "old-r"},
        env_path,
    )
    assert updates["X_REFRESH_TOKEN"] == "new-r"
    assert updates["X_REFRESH_TOKEN_PREV"] == "old-r"
    assert updates["X_TOKEN_EXPIRES_AT"] == "8200"
    text = env_path.read_text(encoding="utf-8")
    assert "X_REFRESH_TOKEN=new-r" in text
    assert "X_REFRESH_TOKEN_PREV=old-r" in text


def test_save_tokens_first_auth_no_breadcrumb(tmp_path):
    env_path = make_env_file(tmp_path)
    updates = xa.save_tokens(
        {"access_token": "a", "refresh_token": "r"}, {}, env_path
    )
    assert updates["X_REFRESH_TOKEN"] == "r"
    assert "X_REFRESH_TOKEN_PREV" not in updates


def test_save_tokens_no_refresh_in_response(tmp_path):
    env_path = make_env_file(tmp_path)
    updates = xa.save_tokens({"access_token": "a"}, {"X_REFRESH_TOKEN": "r"}, env_path)
    assert "X_REFRESH_TOKEN" not in updates


def test_save_tokens_missing_access_token_exits(tmp_path):
    env_path = make_env_file(tmp_path)
    with pytest.raises(SystemExit) as e:
        xa.save_tokens({}, {}, env_path)
    assert "no access_token" in str(e.value)


# ---------------------------------------------------------- refresh_access_token
def test_refresh_access_token_success(tmp_path, monkeypatch):
    env_path = make_env_file(tmp_path, "X_REFRESH_TOKEN=old-r\n")
    env = {"X_CLIENT_ID": "cid", "X_REFRESH_TOKEN": "old-r"}
    captured = capture_urlopen(
        monkeypatch,
        b'{"access_token":"fresh-a","refresh_token":"fresh-r","expires_in":7200}',
    )
    merged = xa.refresh_access_token(env, env_path)
    assert b"grant_type=refresh_token" in captured["req"].data
    assert merged["X_ACCESS_TOKEN"] == "fresh-a"
    assert merged["X_REFRESH_TOKEN"] == "fresh-r"
    # Rotation persisted to disk before the caller could use the new token.
    assert "X_REFRESH_TOKEN=fresh-r" in env_path.read_text(encoding="utf-8")


def test_refresh_access_token_missing_refresh_exits(tmp_path):
    with pytest.raises(SystemExit) as e:
        xa.refresh_access_token({"X_CLIENT_ID": "cid"}, tmp_path / ".env")
    assert "no X_REFRESH_TOKEN" in str(e.value)


# --------------------------------------------------------------------- fetch_me
def test_fetch_me_with_name(monkeypatch, capsys):
    body = json.dumps(
        {"data": {"id": "42", "username": "nate", "name": "Nate"}}
    ).encode()
    monkeypatch.setattr(xa.urllib.request, "urlopen", lambda req: FakeResp(body))
    assert xa.fetch_me("t") == ("42", "nate")
    assert "Authorized as: Nate (@nate)" in capsys.readouterr().out


def test_fetch_me_without_name(monkeypatch):
    body = json.dumps({"data": {"id": "42", "username": "nate"}}).encode()
    monkeypatch.setattr(xa.urllib.request, "urlopen", lambda req: FakeResp(body))
    assert xa.fetch_me("t") == ("42", "nate")


def test_fetch_me_no_id_exits(monkeypatch):
    monkeypatch.setattr(xa.urllib.request, "urlopen", lambda req: FakeResp(b"{}"))
    with pytest.raises(SystemExit):
        xa.fetch_me("t")


def test_fetch_me_http_error(monkeypatch):
    def boom(req):
        raise http_error(403)

    monkeypatch.setattr(xa.urllib.request, "urlopen", boom)
    with pytest.raises(SystemExit):
        xa.fetch_me("t")


# ------------------------------------------------------------------------- main
def test_main_missing_credentials_exits(monkeypatch):
    monkeypatch.setattr(xa, "load_env", lambda: {})
    with pytest.raises(SystemExit) as e:
        xa.main()
    assert "is not set" in str(e.value)


def test_main_happy_path(monkeypatch, capsys):
    saved = {}
    monkeypatch.setattr(xa, "load_env", lambda: dict(PUBLIC_ENV))
    monkeypatch.setattr(xa, "wait_for_callback", lambda *a, **k: "code")
    monkeypatch.setattr(
        xa,
        "exchange_code_for_token",
        lambda env, code, verifier: {
            "access_token": "tok",
            "refresh_token": "ref",
            "expires_in": 7200,
        },
    )
    monkeypatch.setattr(
        xa, "save_tokens", lambda resp, env, path=None: saved.update(resp)
    )
    monkeypatch.setattr(xa, "fetch_me", lambda t: ("42", "nate"))
    monkeypatch.setattr(xa, "save_env", lambda updates: saved.update(updates))
    xa.main()
    assert saved["access_token"] == "tok"
    assert saved["X_USER_ID"] == "42"
    assert saved["X_USERNAME"] == "nate"
    assert "@nate" in capsys.readouterr().out

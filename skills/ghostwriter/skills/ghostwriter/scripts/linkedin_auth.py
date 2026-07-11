#!/usr/bin/env python3
"""One-time LinkedIn OAuth: get an access token + your person URN, save to .env.

Performs the 3-legged OAuth 2.0 authorization-code flow:
  1. Opens your browser to LinkedIn's consent screen.
  2. Catches the redirect on a tiny localhost server.
  3. Exchanges the code for an access token.
  4. Calls /v2/userinfo to get your member id and builds your person URN.
  5. Writes LINKEDIN_ACCESS_TOKEN / LINKEDIN_PERSON_URN / expiry back into .env.

Prereqs (see README):
  - A LinkedIn app with the "Share on LinkedIn" and "Sign In with LinkedIn using
    OpenID Connect" products enabled.
  - LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET, LINKEDIN_REDIRECT_URI in .env
    (copy .env.example to .env first). The redirect URI must EXACTLY match one of
    the "Authorized redirect URLs" in your app's Auth tab.

Usage:
    python3 scripts/linkedin_auth.py

Standard library only — no pip install needed.
"""
from __future__ import annotations

import http.server
import json
import secrets
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ENV_PATH = REPO / ".env"

AUTHORIZE_URL = "https://www.linkedin.com/oauth/v2/authorization"
TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken"
USERINFO_URL = "https://api.linkedin.com/v2/userinfo"
# Scopes: post on the member's behalf + read basic profile (for the URN).
SCOPES = "w_member_social openid profile"


# --------------------------------------------------------------------------- env
def load_env(path: Path = ENV_PATH) -> dict:
    if not path.exists():
        sys.exit(
            f"ERROR: {path} not found.\n"
            "Run: cp .env.example .env  then fill in LINKEDIN_CLIENT_ID and "
            "LINKEDIN_CLIENT_SECRET from your LinkedIn app."
        )
    env: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        env[key.strip()] = val.strip().strip('"').strip("'")
    return env


def save_env(updates: dict, path: Path = ENV_PATH) -> None:
    """Update existing keys in .env in place; append any that are missing."""
    lines = path.read_text(encoding="utf-8").splitlines()
    remaining = dict(updates)
    out: list[str] = []
    for line in lines:
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and "=" in stripped:
            key = stripped.split("=", 1)[0].strip()
            if key in remaining:
                out.append(f"{key}={remaining.pop(key)}")
                continue
        out.append(line)
    for key, val in remaining.items():
        out.append(f"{key}={val}")
    path.write_text("\n".join(out) + "\n", encoding="utf-8")


# ----------------------------------------------------------------- callback server
class _CallbackHandler(http.server.BaseHTTPRequestHandler):
    server_version = "linkedin-ghostwriter-auth"
    def do_GET(self):  # noqa: N802 (http.server API)
        parsed = urllib.parse.urlparse(self.path)
        callback_path = urllib.parse.urlparse(self.server.redirect_path).path
        params = {k: v[0] for k, v in urllib.parse.parse_qs(parsed.query).items()}

        # Ignore stray requests (favicon, browser preconnect, reloads) that don't
        # carry the OAuth result, so the server stays up for the real redirect.
        if parsed.path != callback_path or not ("code" in params or "error" in params):
            self.send_response(204)
            self.end_headers()
            return

        self.server.oauth_result = params  # type: ignore[attr-defined]
        ok = "code" in params
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        msg = (
            "Authorization received. You can close this tab and return to the terminal."
            if ok
            else "Authorization failed — check the terminal for details."
        )
        self.wfile.write(
            f"<html><body style='font-family:sans-serif;padding:3rem'>"
            f"<h2>{'✅' if ok else '❌'} {msg}</h2></body></html>".encode("utf-8")
        )
        self.server.oauth_event.set()  # type: ignore[attr-defined]

    def log_message(self, *_args):  # silence default logging
        pass


def wait_for_callback(
    redirect_uri: str, expected_state: str, auth_url: str, timeout: int = 300
) -> str:
    parsed = urllib.parse.urlparse(redirect_uri)
    host = parsed.hostname or "localhost"
    port = parsed.port or 80
    try:
        server = http.server.HTTPServer((host, port), _CallbackHandler)
    except OSError as e:
        sys.exit(
            f"ERROR: could not start the local server on {host}:{port} ({e}).\n"
            "Another copy of this script may still be running, or the port is in "
            "use. Close it (or change the port in your redirect URL) and retry."
        )
    server.redirect_path = redirect_uri  # type: ignore[attr-defined]
    server.oauth_result = {}  # type: ignore[attr-defined]
    server.oauth_event = threading.Event()  # type: ignore[attr-defined]

    # Start listening BEFORE opening the browser, so we never miss the redirect.
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    print(f"Listening for the LinkedIn redirect on {host}:{port} ...")
    print("Opening your browser to authorize this app on LinkedIn...")
    print(f"If it doesn't open, paste this URL into your browser:\n{auth_url}\n")
    webbrowser.open(auth_url)

    got = server.oauth_event.wait(timeout)  # type: ignore[attr-defined]
    server.shutdown()
    server.server_close()

    if not got:
        sys.exit("ERROR: timed out waiting for the LinkedIn redirect (5 min).")
    result = server.oauth_result  # type: ignore[attr-defined]
    if "error" in result:
        sys.exit(
            f"ERROR: LinkedIn denied authorization: {result.get('error')} — "
            f"{result.get('error_description', '')}"
        )
    if result.get("state") != expected_state:
        sys.exit("ERROR: state mismatch (possible CSRF). Aborting.")
    return result["code"]


# ------------------------------------------------------------------ token + userinfo
def exchange_code_for_token(env: dict, code: str) -> dict:
    data = urllib.parse.urlencode(
        {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": env["LINKEDIN_REDIRECT_URI"],
            "client_id": env["LINKEDIN_CLIENT_ID"],
            "client_secret": env["LINKEDIN_CLIENT_SECRET"],
        }
    ).encode("utf-8")
    req = urllib.request.Request(TOKEN_URL, data=data, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        sys.exit(f"ERROR: token exchange failed (HTTP {e.code}):\n{body}")


def fetch_person_urn(access_token: str) -> str:
    req = urllib.request.Request(USERINFO_URL)
    req.add_header("Authorization", f"Bearer {access_token}")
    try:
        with urllib.request.urlopen(req) as resp:
            info = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        sys.exit(
            f"ERROR: /v2/userinfo failed (HTTP {e.code}):\n{body}\n"
            "Make sure the 'Sign In with LinkedIn using OpenID Connect' product "
            "is enabled on your app."
        )
    sub = info.get("sub")
    if not sub:
        sys.exit(f"ERROR: no 'sub' in userinfo response: {info}")
    name = info.get("name", "")
    if name:
        print(f"Authorized as: {name}")
    return f"urn:li:person:{sub}"


# -------------------------------------------------------------------------- driver
def main() -> None:
    env = load_env()
    for key in ("LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET", "LINKEDIN_REDIRECT_URI"):
        if not env.get(key):
            sys.exit(f"ERROR: {key} is not set in .env. Fill it in and rerun.")

    state = secrets.token_urlsafe(16)
    auth_url = AUTHORIZE_URL + "?" + urllib.parse.urlencode(
        {
            "response_type": "code",
            "client_id": env["LINKEDIN_CLIENT_ID"],
            "redirect_uri": env["LINKEDIN_REDIRECT_URI"],
            "state": state,
            "scope": SCOPES,
        }
    )

    code = wait_for_callback(env["LINKEDIN_REDIRECT_URI"], state, auth_url)
    print("Got authorization code. Exchanging for an access token...")
    token_resp = exchange_code_for_token(env, code)

    access_token = token_resp.get("access_token")
    if not access_token:
        sys.exit(f"ERROR: no access_token in response: {token_resp}")
    expires_in = int(token_resp.get("expires_in", 0))
    expires_at = int(time.time()) + expires_in if expires_in else ""

    person_urn = fetch_person_urn(access_token)

    save_env(
        {
            "LINKEDIN_ACCESS_TOKEN": access_token,
            "LINKEDIN_PERSON_URN": person_urn,
            "LINKEDIN_TOKEN_EXPIRES_AT": str(expires_at),
        }
    )
    days = expires_in // 86400 if expires_in else "?"
    print("\n✅ Saved access token and person URN to .env")
    print(f"   Person URN: {person_urn}")
    print(f"   Token valid for ~{days} days.")
    print("\nYou can now publish: python3 scripts/linkedin_post.py --file <draft>")


if __name__ == "__main__":
    main()

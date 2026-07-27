#!/usr/bin/env python3
"""One-time X (Twitter) OAuth 2.0: get access + refresh tokens, save to .env.

Performs the OAuth 2.0 Authorization Code flow with PKCE:
  1. Opens your browser to X's consent screen.
  2. Catches the redirect on a tiny localhost server (port 8766).
  3. Exchanges the code (+ PKCE verifier) for access and refresh tokens.
  4. Calls /2/users/me for your user id and @handle (used to build post URLs).
  5. Writes X_ACCESS_TOKEN / X_REFRESH_TOKEN / expiry / user id back into .env.

X access tokens expire after ~2 hours; scripts/x_post.py refreshes them
automatically via ``refresh_access_token`` below, so this script normally
runs ONCE. X ROTATES refresh tokens on every refresh — the new refresh token
is persisted to .env before the new access token is ever used, with the old
one kept as X_REFRESH_TOKEN_PREV as a recovery breadcrumb.

Prereqs (see README):
  - An X developer app with OAuth 2.0 enabled and redirect URI
    http://localhost:8766/callback added.
  - X_CLIENT_ID and X_REDIRECT_URI in .env (copy .env.example to .env first).
    X_CLIENT_SECRET only if your app is a confidential "Web App" client.

Usage:
    python3 scripts/x_auth.py

Standard library only — no pip install needed.
"""
from __future__ import annotations

import base64
import hashlib
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
# Personal credentials live in the shared home dir (same location Claude Code and Claude
# Desktop both read), so a fresh auth run isn't tied to whichever install of the skill ran it.
HOME_ENV = Path.home() / ".claude" / "ghostwriter-x" / ".env"
ENV_PATH = HOME_ENV if HOME_ENV.exists() else REPO / ".env"

AUTHORIZE_URL = "https://x.com/i/oauth2/authorize"
TOKEN_URL = "https://api.x.com/2/oauth2/token"
ME_URL = "https://api.x.com/2/users/me"
# tweet.read + users.read are required for /2/users/me; tweet.write to post;
# offline.access is what yields the refresh token.
SCOPES = "tweet.read tweet.write users.read offline.access"


# --------------------------------------------------------------------------- env
def load_env(path: Path = ENV_PATH) -> dict:
    if not path.exists():
        sys.exit(
            f"ERROR: {path} not found.\n"
            "Run: mkdir -p ~/.claude/ghostwriter-x && cp .env.example ~/.claude/ghostwriter-x/.env "
            " then fill in X_CLIENT_ID from your X developer app."
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


# ------------------------------------------------------------------------- PKCE
def make_pkce_pair() -> tuple[str, str]:
    """Return (code_verifier, code_challenge) per RFC 7636 S256."""
    verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")
    return verifier, challenge


# ----------------------------------------------------------------- callback server
class _CallbackHandler(http.server.BaseHTTPRequestHandler):
    server_version = "ghostwriter-x-auth"

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
    print(f"Listening for the X redirect on {host}:{port} ...")
    print("Opening your browser to authorize this app on X...")
    print(f"If it doesn't open, paste this URL into your browser:\n{auth_url}\n")
    webbrowser.open(auth_url)

    got = server.oauth_event.wait(timeout)  # type: ignore[attr-defined]
    server.shutdown()
    server.server_close()

    if not got:
        sys.exit("ERROR: timed out waiting for the X redirect (5 min).")
    result = server.oauth_result  # type: ignore[attr-defined]
    if "error" in result:
        sys.exit(
            f"ERROR: X denied authorization: {result.get('error')} — "
            f"{result.get('error_description', '')}"
        )
    if result.get("state") != expected_state:
        sys.exit("ERROR: state mismatch (possible CSRF). Aborting.")
    return result["code"]


# ------------------------------------------------------------------ token requests
def _token_request(env: dict, form: dict) -> dict:
    """POST to the token endpoint. Confidential clients use HTTP Basic auth;
    public clients pass client_id in the body instead."""
    form = dict(form)
    secret = env.get("X_CLIENT_SECRET", "").strip()
    if not secret:
        form["client_id"] = env["X_CLIENT_ID"]
    data = urllib.parse.urlencode(form).encode("utf-8")
    req = urllib.request.Request(TOKEN_URL, data=data, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    if secret:
        basic = base64.b64encode(
            f"{env['X_CLIENT_ID']}:{secret}".encode("utf-8")
        ).decode("ascii")
        req.add_header("Authorization", f"Basic {basic}")
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        sys.exit(f"ERROR: token request failed (HTTP {e.code}):\n{body}")


def exchange_code_for_token(env: dict, code: str, verifier: str) -> dict:
    return _token_request(
        env,
        {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": env["X_REDIRECT_URI"],
            "code_verifier": verifier,
        },
    )


def save_tokens(token_resp: dict, env: dict, env_path: Path = ENV_PATH) -> dict:
    """Persist a token response to .env — refresh token FIRST, because X rotates
    it and the old one dies the moment the new one is issued. Returns updates."""
    access_token = token_resp.get("access_token")
    if not access_token:
        sys.exit(f"ERROR: no access_token in response: {token_resp}")
    expires_in = int(token_resp.get("expires_in", 7200))
    updates = {
        "X_ACCESS_TOKEN": access_token,
        "X_TOKEN_EXPIRES_AT": str(int(time.time()) + expires_in),
    }
    new_refresh = token_resp.get("refresh_token", "")
    if new_refresh:
        old_refresh = env.get("X_REFRESH_TOKEN", "")
        updates["X_REFRESH_TOKEN"] = new_refresh
        if old_refresh:
            updates["X_REFRESH_TOKEN_PREV"] = old_refresh
    save_env(updates, env_path)
    return updates


def refresh_access_token(env: dict, env_path: Path = ENV_PATH) -> dict:
    """Refresh the access token; persists the rotated tokens before returning.

    Returns the merged env (env + updates) so callers can use the fresh
    access token immediately. Called by scripts/x_post.py when the current
    token is near expiry.
    """
    refresh = env.get("X_REFRESH_TOKEN", "").strip()
    if not refresh:
        sys.exit(
            "ERROR: no X_REFRESH_TOKEN in .env. Run scripts/x_auth.py to "
            "re-authorize (make sure the offline.access scope is granted)."
        )
    token_resp = _token_request(
        env, {"grant_type": "refresh_token", "refresh_token": refresh}
    )
    updates = save_tokens(token_resp, env, env_path)
    merged = dict(env)
    merged.update(updates)
    return merged


def fetch_me(access_token: str) -> tuple[str, str]:
    """Return (user_id, username) from /2/users/me."""
    req = urllib.request.Request(ME_URL)
    req.add_header("Authorization", f"Bearer {access_token}")
    try:
        with urllib.request.urlopen(req) as resp:
            info = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        sys.exit(
            f"ERROR: /2/users/me failed (HTTP {e.code}):\n{body}\n"
            "Make sure the tweet.read and users.read scopes were granted."
        )
    data = info.get("data", {})
    user_id = data.get("id")
    username = data.get("username", "")
    if not user_id:
        sys.exit(f"ERROR: no user id in /2/users/me response: {info}")
    name = data.get("name", "")
    if name:
        print(f"Authorized as: {name} (@{username})")
    return user_id, username


# -------------------------------------------------------------------------- driver
def main() -> None:
    env = load_env()
    for key in ("X_CLIENT_ID", "X_REDIRECT_URI"):
        if not env.get(key):
            sys.exit(f"ERROR: {key} is not set in .env. Fill it in and rerun.")

    state = secrets.token_urlsafe(16)
    verifier, challenge = make_pkce_pair()
    auth_url = AUTHORIZE_URL + "?" + urllib.parse.urlencode(
        {
            "response_type": "code",
            "client_id": env["X_CLIENT_ID"],
            "redirect_uri": env["X_REDIRECT_URI"],
            "state": state,
            "scope": SCOPES,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        }
    )

    code = wait_for_callback(env["X_REDIRECT_URI"], state, auth_url)
    print("Got authorization code. Exchanging for tokens...")
    token_resp = exchange_code_for_token(env, code, verifier)
    save_tokens(token_resp, env)

    user_id, username = fetch_me(token_resp["access_token"])
    save_env({"X_USER_ID": user_id, "X_USERNAME": username})

    print("\n✅ Saved access + refresh tokens and user id to .env")
    print(f"   User: @{username} (id {user_id})")
    print("   Access tokens expire after ~2h; x_post.py refreshes automatically.")
    print("\nYou can now publish: python3 scripts/x_post.py --file <draft>")


if __name__ == "__main__":
    main()

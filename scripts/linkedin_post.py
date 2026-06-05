#!/usr/bin/env python3
"""Publish a text post to your own LinkedIn profile.

Reads credentials from `.env` (populated by scripts/linkedin_auth.py) and POSTs
to LinkedIn's Posts API. Use --dry-run first to see the exact payload without
sending anything.

Usage:
    python3 scripts/linkedin_post.py --file drafts/my-post.md
    python3 scripts/linkedin_post.py --text "Hello LinkedIn"
    cat drafts/my-post.md | python3 scripts/linkedin_post.py
    python3 scripts/linkedin_post.py --file drafts/my-post.md --dry-run

Standard library only — no pip install needed.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ENV_PATH = REPO / ".env"
POSTS_URL = "https://api.linkedin.com/rest/posts"


def load_env(path: Path = ENV_PATH) -> dict:
    """Minimal .env parser (KEY=VALUE lines, # comments). No external deps."""
    env: dict[str, str] = {}
    if not path.exists():
        sys.exit(f"ERROR: {path} not found. Run scripts/linkedin_auth.py first.")
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        env[key.strip()] = val.strip().strip('"').strip("'")
    return env


def read_post_text(args) -> str:
    if args.text is not None:
        text = args.text
    elif args.file is not None:
        text = Path(args.file).read_text(encoding="utf-8")
    elif not sys.stdin.isatty():
        text = sys.stdin.read()
    else:
        sys.exit("ERROR: provide --text, --file, or pipe text via stdin.")
    text = text.strip()
    if not text:
        sys.exit("ERROR: post text is empty.")
    # LinkedIn hard limit is 3000 characters.
    if len(text) > 3000:
        sys.exit(f"ERROR: post is {len(text)} chars; LinkedIn's limit is 3000.")
    return text


def build_payload(author_urn: str, text: str) -> dict:
    return {
        "author": author_urn,
        "commentary": text,
        "visibility": "PUBLIC",
        "distribution": {
            "feedDistribution": "MAIN_FEED",
            "targetEntities": [],
            "thirdPartyDistributionChannels": [],
        },
        "lifecycleState": "PUBLISHED",
        "isReshareDisabledByAuthor": False,
    }


def warn_if_token_expiring(env: dict) -> None:
    expires_at = env.get("LINKEDIN_TOKEN_EXPIRES_AT", "").strip()
    if not expires_at:
        return
    try:
        remaining = int(float(expires_at)) - int(time.time())
    except ValueError:
        return
    if remaining <= 0:
        print(
            "WARNING: your access token has expired. Re-run "
            "scripts/linkedin_auth.py to refresh.",
            file=sys.stderr,
        )
    elif remaining < 5 * 86400:
        days = remaining // 86400
        print(
            f"NOTE: access token expires in ~{days} day(s). Consider re-running "
            "scripts/linkedin_auth.py soon.",
            file=sys.stderr,
        )


def publish(env: dict, payload: dict) -> None:
    token = env.get("LINKEDIN_ACCESS_TOKEN", "")
    version = env.get("LINKEDIN_API_VERSION", "202605")
    if not token:
        sys.exit("ERROR: LINKEDIN_ACCESS_TOKEN missing. Run scripts/linkedin_auth.py.")

    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(POSTS_URL, data=data, method="POST")
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")
    req.add_header("X-Restli-Protocol-Version", "2.0.0")
    req.add_header("LinkedIn-Version", version)

    try:
        with urllib.request.urlopen(req) as resp:
            post_id = resp.headers.get("x-restli-id") or resp.headers.get("X-RestLi-Id")
            print("Published to LinkedIn.")
            if post_id:
                print(f"Post ID: {post_id}")
                print(f"URL: https://www.linkedin.com/feed/update/{post_id}")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        print(f"ERROR: LinkedIn returned HTTP {e.code}", file=sys.stderr)
        print(body, file=sys.stderr)
        if e.code in (401, 403):
            print(
                "\nThis usually means the token expired or the app is missing the "
                "'Share on LinkedIn' product / w_member_social scope. Re-run "
                "scripts/linkedin_auth.py.",
                file=sys.stderr,
            )
        sys.exit(1)
    except urllib.error.URLError as e:
        sys.exit(f"ERROR: network problem reaching LinkedIn: {e.reason}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    src = ap.add_mutually_exclusive_group()
    src.add_argument("--file", help="Path to a file containing the post text.")
    src.add_argument("--text", help="Post text passed directly on the command line.")
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the request payload and exit without calling LinkedIn.",
    )
    args = ap.parse_args()

    env = load_env()
    text = read_post_text(args)
    author = env.get("LINKEDIN_PERSON_URN", "").strip()

    if args.dry_run:
        # Use a placeholder author if not yet authorized, so dry-run works pre-setup.
        payload = build_payload(author or "urn:li:person:DRY_RUN_PLACEHOLDER", text)
        print("DRY RUN — no request sent. Payload that would POST to /rest/posts:\n")
        print(json.dumps(payload, indent=2, ensure_ascii=False))
        print(f"\n({len(text)} characters)")
        return

    if not author:
        sys.exit("ERROR: LINKEDIN_PERSON_URN missing. Run scripts/linkedin_auth.py.")
    warn_if_token_expiring(env)
    publish(env, build_payload(author, text))


if __name__ == "__main__":
    main()

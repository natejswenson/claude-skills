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
IMAGES_URL = "https://api.linkedin.com/rest/images"


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


def build_payload(
    author_urn: str,
    text: str,
    image_urn: str | None = None,
    alt_text: str = "",
) -> dict:
    payload = {
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
    # Only added when an image is attached — text-only payloads are unchanged.
    if image_urn:
        media: dict = {"id": image_urn}
        if alt_text:
            media["altText"] = alt_text
        payload["content"] = {"media": media}
    return payload


def initialize_image_upload(env: dict, owner: str) -> tuple[str, str]:
    """Register an image upload; returns (uploadUrl, image_urn)."""
    token = env.get("LINKEDIN_ACCESS_TOKEN", "")
    version = env.get("LINKEDIN_API_VERSION", "202605")
    body = json.dumps({"initializeUploadRequest": {"owner": owner}}).encode("utf-8")
    req = urllib.request.Request(
        f"{IMAGES_URL}?action=initializeUpload", data=body, method="POST"
    )
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")
    req.add_header("X-Restli-Protocol-Version", "2.0.0")
    req.add_header("LinkedIn-Version", version)
    try:
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        sys.exit(f"ERROR: initializeUpload returned HTTP {e.code}\n{body}")
    value = data.get("value", {})
    upload_url = value.get("uploadUrl")
    image_urn = value.get("image")
    if not upload_url or not image_urn:
        sys.exit(f"ERROR: unexpected initializeUpload response: {data}")
    return upload_url, image_urn


def upload_image_bytes(upload_url: str, token: str, path: Path) -> None:
    """PUT the raw image bytes to the upload URL from initializeUpload."""
    img = path.read_bytes()
    req = urllib.request.Request(upload_url, data=img, method="PUT")
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/octet-stream")
    try:
        with urllib.request.urlopen(req) as resp:
            if resp.status not in (200, 201):
                sys.exit(f"ERROR: image upload returned HTTP {resp.status}")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        sys.exit(f"ERROR: image upload returned HTTP {e.code}\n{body}")


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
        "--image",
        help="Optional path to an image (e.g. images/foo.png) to attach to the post.",
    )
    ap.add_argument(
        "--alt",
        default="",
        help="Alt text for the attached image (accessibility). Recommended with --image.",
    )
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the request payload and exit without calling LinkedIn.",
    )
    args = ap.parse_args()

    env = load_env()
    text = read_post_text(args)
    author = env.get("LINKEDIN_PERSON_URN", "").strip()

    image_path: Path | None = None
    if args.image:
        image_path = Path(args.image)
        if not image_path.is_absolute():
            image_path = REPO / image_path
        if not image_path.exists():
            sys.exit(f"ERROR: image not found: {image_path}")

    if args.dry_run:
        # Use placeholders so dry-run works pre-setup and without uploading.
        image_urn = "urn:li:image:DRY_RUN_PLACEHOLDER" if image_path else None
        payload = build_payload(
            author or "urn:li:person:DRY_RUN_PLACEHOLDER", text, image_urn, args.alt
        )
        print("DRY RUN — no request sent. Payload that would POST to /rest/posts:\n")
        print(json.dumps(payload, indent=2, ensure_ascii=False))
        print(f"\n({len(text)} characters{', with image' if image_path else ''})")
        return

    if not author:
        sys.exit("ERROR: LINKEDIN_PERSON_URN missing. Run scripts/linkedin_auth.py.")
    warn_if_token_expiring(env)

    image_urn = None
    if image_path:
        if not args.alt:
            print(
                "NOTE: no --alt provided; posting image without alt text "
                "(accessibility). Consider adding --alt.",
                file=sys.stderr,
            )
        upload_url, image_urn = initialize_image_upload(env, author)
        upload_image_bytes(upload_url, env.get("LINKEDIN_ACCESS_TOKEN", ""), image_path)
        print(f"Uploaded image: {image_urn}")

    publish(env, build_payload(author, text, image_urn, args.alt))


if __name__ == "__main__":
    main()

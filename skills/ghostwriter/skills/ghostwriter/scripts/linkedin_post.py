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

import verify_sources

REPO = Path(__file__).resolve().parent.parent
# Personal credentials live in the shared home dir (same location Claude Code and Claude
# Desktop both read), so publishing isn't tied to whichever install of the skill ran auth.
HOME_ENV = Path.home() / ".claude" / "ghostwriter" / ".env"
ENV_PATH = HOME_ENV if HOME_ENV.exists() else REPO / ".env"
POSTS_URL = "https://api.linkedin.com/rest/posts"
IMAGES_URL = "https://api.linkedin.com/rest/images"
DOCUMENTS_URL = "https://api.linkedin.com/rest/documents"
# One JSON line per published post; scripts/post_outcome.py adds outcomes later and the
# skill reads it to bias topic/format choices. Lives with the personal data, not the repo.
PUBLISHED_LOG = Path.home() / ".claude" / "ghostwriter" / "published.jsonl"


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
    document_urn: str | None = None,
    title: str = "",
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
    # Only added when media is attached — text-only payloads are unchanged.
    if image_urn:
        media: dict = {"id": image_urn}
        if alt_text:
            media["altText"] = alt_text
        payload["content"] = {"media": media}
    elif document_urn:
        # A multi-page PDF posted as a document = a LinkedIn carousel.
        media = {"id": document_urn}
        if title:
            media["title"] = title
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


def initialize_document_upload(env: dict, owner: str) -> tuple[str, str]:
    """Register a document (PDF) upload; returns (uploadUrl, document_urn).

    Mirrors the image flow against /rest/documents — this is how a multi-page PDF
    becomes a LinkedIn carousel.
    """
    token = env.get("LINKEDIN_ACCESS_TOKEN", "")
    version = env.get("LINKEDIN_API_VERSION", "202605")
    body = json.dumps({"initializeUploadRequest": {"owner": owner}}).encode("utf-8")
    req = urllib.request.Request(
        f"{DOCUMENTS_URL}?action=initializeUpload", data=body, method="POST"
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
        sys.exit(f"ERROR: document initializeUpload returned HTTP {e.code}\n{body}")
    value = data.get("value", {})
    upload_url = value.get("uploadUrl")
    document_urn = value.get("document")
    if not upload_url or not document_urn:
        sys.exit(f"ERROR: unexpected document initializeUpload response: {data}")
    return upload_url, document_urn


def upload_file_bytes(upload_url: str, token: str, path: Path) -> None:
    """PUT the raw file bytes (image or PDF) to the upload URL from initializeUpload."""
    blob = path.read_bytes()
    req = urllib.request.Request(upload_url, data=blob, method="PUT")
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/octet-stream")
    try:
        with urllib.request.urlopen(req) as resp:
            if resp.status not in (200, 201):
                sys.exit(f"ERROR: upload returned HTTP {resp.status}")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        sys.exit(f"ERROR: upload returned HTTP {e.code}\n{body}")


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


def record_publish(
    post_id: str | None,
    args,
    text: str,
    log_path: Path | None = None,
) -> None:
    """Append the publish record. Never fails the publish — the post is already live."""
    if log_path is None:
        log_path = PUBLISHED_LOG
    fmt = "image" if args.image else ("carousel" if args.document else "text")
    record = {
        "date": time.strftime("%Y-%m-%d"),
        "urn": post_id or "",
        "url": f"https://www.linkedin.com/feed/update/{post_id}" if post_id else "",
        "slug": Path(args.file).stem if args.file else "",
        "format": fmt,
        "chars": len(text),
        "first_line": text.splitlines()[0][:120],
        "lane": getattr(args, "lane", "") or "",
    }
    try:
        log_path.parent.mkdir(parents=True, exist_ok=True)
        with log_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except OSError as e:
        print(f"WARNING: could not write {log_path}: {e}", file=sys.stderr)


def publish(env: dict, payload: dict) -> str | None:
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
            return post_id
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


def enforce_source_gate(args) -> None:
    """Refuse to publish unless the draft's external claims are source-verified.

    Gates the publish ACTION, not the input flavor: a draft published via --file
    must pass scripts/verify_sources.py; a bare --text/stdin publish (no draft,
    so nothing to verify) is refused by default. The only bypass is
    --allow-unverified, which is HUMAN-ONLY by convention (see SKILL.md
    guardrails) — the agent must never self-apply it to clear the gate.
    """
    if args.allow_unverified:
        print(
            "WARNING: --allow-unverified set — publishing WITHOUT source "
            "verification. This bypass is for human use only.",
            file=sys.stderr,
        )
        return
    if not args.file:
        sys.exit(
            "ERROR: refusing to publish unverified. The verified path is "
            "--file drafts/<slug>.md with a <slug>.sources.json sidecar "
            "(see SKILL.md → Research & fact-check). A human can override with "
            "--allow-unverified."
        )
    result = verify_sources.verify(args.file)
    if not result["ok"]:
        sys.exit(f"ERROR: source check failed — {result['reason']}")
    print(f"Source check passed: {result['reason']}")


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
        "--document",
        help="Optional path to a PDF (e.g. images/foo.pdf) to post as a document/carousel.",
    )
    ap.add_argument(
        "--title",
        default="",
        help="Title for the attached document/carousel (shown above the slides). Recommended with --document.",
    )
    ap.add_argument(
        "--lane",
        default="",
        help="Optional content lane for the publish log (e.g. release-howto, "
        "personal-project, opinion, career, personal).",
    )
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the request payload and exit without calling LinkedIn.",
    )
    ap.add_argument(
        "--allow-unverified",
        action="store_true",
        help="HUMAN-ONLY escape hatch: publish without the source-verification "
        "gate. The agent must never set this to get past the gate.",
    )
    args = ap.parse_args()

    if args.image and args.document:
        sys.exit("ERROR: attach either --image or --document, not both.")

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

    document_path: Path | None = None
    if args.document:
        document_path = Path(args.document)
        if not document_path.is_absolute():
            document_path = REPO / document_path
        if not document_path.exists():
            sys.exit(f"ERROR: document not found: {document_path}")
        if document_path.suffix.lower() != ".pdf":
            sys.exit("ERROR: --document must be a .pdf (LinkedIn carousels are PDFs).")

    if args.dry_run:
        # Use placeholders so dry-run works pre-setup and without uploading.
        image_urn = "urn:li:image:DRY_RUN_PLACEHOLDER" if image_path else None
        document_urn = "urn:li:document:DRY_RUN_PLACEHOLDER" if document_path else None
        payload = build_payload(
            author or "urn:li:person:DRY_RUN_PLACEHOLDER",
            text,
            image_urn,
            args.alt,
            document_urn,
            args.title,
        )
        print("DRY RUN — no request sent. Payload that would POST to /rest/posts:\n")
        print(json.dumps(payload, indent=2, ensure_ascii=False))
        attached = ", with image" if image_path else (", with carousel PDF" if document_path else "")
        print(f"\n({len(text)} characters{attached})")
        return

    if not author:
        sys.exit("ERROR: LINKEDIN_PERSON_URN missing. Run scripts/linkedin_auth.py.")

    # Source gate: before any media upload so a failed gate never orphans an
    # uploaded asset on LinkedIn's side.
    enforce_source_gate(args)

    warn_if_token_expiring(env)

    image_urn = None
    document_urn = None
    if image_path:
        if not args.alt:
            print(
                "NOTE: no --alt provided; posting image without alt text "
                "(accessibility). Consider adding --alt.",
                file=sys.stderr,
            )
        upload_url, image_urn = initialize_image_upload(env, author)
        upload_file_bytes(upload_url, env.get("LINKEDIN_ACCESS_TOKEN", ""), image_path)
        print(f"Uploaded image: {image_urn}")
    elif document_path:
        if not args.title:
            print(
                "NOTE: no --title provided; the carousel will post without a title.",
                file=sys.stderr,
            )
        upload_url, document_urn = initialize_document_upload(env, author)
        upload_file_bytes(upload_url, env.get("LINKEDIN_ACCESS_TOKEN", ""), document_path)
        print(f"Uploaded document: {document_urn}")

    post_id = publish(
        env, build_payload(author, text, image_urn, args.alt, document_urn, args.title)
    )
    record_publish(post_id, args, text)


if __name__ == "__main__":
    main()

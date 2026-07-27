#!/usr/bin/env python3
"""Publish a post or thread to X via the Typefully API (free plan, $0).

X's own API has no free tier anymore (pay-per-use since Feb 2026), so this
skill publishes through Typefully instead: connect your X account to Typefully
once in their UI, create an API key (Settings → API), and this script creates
a draft with `publish_at: "now"` — Typefully posts it to X and hands back the
live URL. The free plan covers 1 social set and ~15 posts/month.

Setup (one-time):
    1. typefully.com → sign up → connect your X account
    2. Settings → API → create a key → put it in ~/.claude/ghostwriter-x/.env
       as TYPEFULLY_API_KEY
    3. python3 scripts/typefully_post.py --connect   (stores your social set id)

Usage:
    python3 scripts/typefully_post.py --file drafts/my-thread.md
    python3 scripts/typefully_post.py --file drafts/my-thread.md --dry-run
    python3 scripts/typefully_post.py --file d.md --image images/card.png --alt "…"
    python3 scripts/typefully_post.py --file d.md --image 3:images/chart.png

Draft format: one tweet, or a thread with tweets separated by lines containing
only ``---``. Every tweet is validated against the weighted 280 limit
(scripts/x_len.py) before anything is sent. Images attach to tweet 1 by
default; prefix the path with ``N:`` to attach to tweet N (max 4 per tweet).

Standard library only — no pip install needed.
"""
from __future__ import annotations

import argparse
import json
import mimetypes
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import verify_sources
import x_len

REPO = Path(__file__).resolve().parent.parent
# Personal credentials live in the shared home dir (same location Claude Code and Claude
# Desktop both read), so publishing isn't tied to whichever install of the skill ran setup.
HOME_ENV = Path.home() / ".claude" / "ghostwriter-x" / ".env"
ENV_PATH = HOME_ENV if HOME_ENV.exists() else REPO / ".env"
API_BASE = "https://api.typefully.com/v2"
# One JSON line per published post/thread; scripts/post_outcome.py adds outcomes
# later and the skill reads it to bias topic/format choices.
PUBLISHED_LOG = Path.home() / ".claude" / "ghostwriter-x" / "published.jsonl"
# Publishing is asynchronous on Typefully's side; poll the draft this long.
PUBLISH_TIMEOUT = 120
POLL_INTERVAL = 2.0
MEDIA_TIMEOUT = 60


# --------------------------------------------------------------------------- env
def load_env(path: Path = ENV_PATH) -> dict:
    """Minimal .env parser (KEY=VALUE lines, # comments). No external deps."""
    env: dict[str, str] = {}
    if not path.exists():
        sys.exit(
            f"ERROR: {path} not found.\n"
            "Run: mkdir -p ~/.claude/ghostwriter-x && cp .env.example "
            "~/.claude/ghostwriter-x/.env  then set TYPEFULLY_API_KEY "
            "(typefully.com → Settings → API)."
        )
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


# --------------------------------------------------------------------- API core
def api_request(
    env: dict,
    method: str,
    path: str,
    payload: dict | None = None,
    context: str = "",
) -> dict:
    """One authenticated JSON call to the Typefully API, with friendly errors."""
    req = urllib.request.Request(
        API_BASE + path,
        data=json.dumps(payload).encode("utf-8") if payload is not None else None,
        method=method,
    )
    req.add_header("Authorization", f"Bearer {env.get('TYPEFULLY_API_KEY', '')}")
    if payload is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        if e.code == 401:
            sys.exit(
                "ERROR: Typefully rejected the API key (401). Check "
                "TYPEFULLY_API_KEY in ~/.claude/ghostwriter-x/.env "
                "(typefully.com → Settings → API)."
            )
        if e.code == 402:
            sys.exit(
                "ERROR: Typefully returned 402 — the account is paused or this "
                "operation needs a paid plan (the free plan covers ~15 posts/"
                "month on 1 social set). Check your plan at typefully.com."
            )
        if e.code == 429:
            reset = e.headers.get("X-RateLimit-User-Reset", "")
            when = ""
            if reset.isdigit():
                when = time.strftime(
                    " (resets %Y-%m-%d %H:%M %Z)", time.localtime(int(reset))
                )
            sys.exit(f"ERROR: Typefully rate limit hit on {context or path}{when}. "
                     "Try again later.")
        print(f"ERROR: {context or path} returned HTTP {e.code}", file=sys.stderr)
        print(body, file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        sys.exit(f"ERROR: network problem reaching Typefully: {e.reason}")


def require_setup(env: dict) -> str:
    if not env.get("TYPEFULLY_API_KEY", "").strip():
        sys.exit(
            "ERROR: TYPEFULLY_API_KEY missing. Create one at typefully.com → "
            "Settings → API and add it to ~/.claude/ghostwriter-x/.env."
        )
    social_set = env.get("TYPEFULLY_SOCIAL_SET_ID", "").strip()
    if not social_set:
        sys.exit(
            "ERROR: TYPEFULLY_SOCIAL_SET_ID missing. Run: "
            "python3 scripts/typefully_post.py --connect"
        )
    return social_set


def connect(env: dict, env_path: Path = ENV_PATH) -> None:
    """List the account's social sets and store the id of the one to post to."""
    if not env.get("TYPEFULLY_API_KEY", "").strip():
        sys.exit(
            "ERROR: TYPEFULLY_API_KEY missing. Create one at typefully.com → "
            "Settings → API and add it to ~/.claude/ghostwriter-x/.env."
        )
    data = api_request(env, "GET", "/social-sets", context="listing social sets")
    results = data.get("results", [])
    if not results:
        sys.exit(
            "ERROR: no social sets on this Typefully account. Connect your X "
            "account at typefully.com first."
        )
    chosen = results[0]
    save_env({"TYPEFULLY_SOCIAL_SET_ID": str(chosen["id"])}, env_path)
    print(f"Connected: @{chosen.get('username', '?')} (social set {chosen['id']})")
    if len(results) > 1:
        others = ", ".join(
            f"@{r.get('username', '?')} ({r['id']})" for r in results[1:]
        )
        print(
            f"NOTE: {len(results)} social sets found; stored the first. "
            f"Others: {others}. Edit TYPEFULLY_SOCIAL_SET_ID by hand to switch."
        )


# ------------------------------------------------------------------ draft input
def read_draft(args) -> str:
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
    return text


def validate_tweets(tweets: list[str]) -> list[int]:
    """Weighted-validate every tweet; exit with a FULL overflow report if any fail."""
    counts: list[int] = []
    failures: list[str] = []
    for i, tweet in enumerate(tweets, 1):
        ok, n = x_len.check(tweet)
        counts.append(n)
        if not ok:
            failures.append(
                f"  tweet {i}/{len(tweets)}: {n}/{x_len.LIMIT} (+{n - x_len.LIMIT})"
            )
    if failures:
        sys.exit(
            "ERROR: over the weighted 280 limit:\n"
            + "\n".join(failures)
            + "\n(Counting is conservative — see scripts/x_len.py. Trim and retry.)"
        )
    return counts


def parse_media_args(images: list[str], alts: list[str], n_tweets: int) -> dict:
    """Map ``[idx:]path`` / ``[idx:]alt`` flags to {tweet_index: [(path, alt)]}.

    Alt text is collected for the publish log / accessibility record — the
    Typefully draft API attaches media by id (alt text is set in their editor).
    """

    def split_idx(raw: str, what: str) -> tuple[int, str]:
        head, sep, rest = raw.partition(":")
        if sep and head.isdigit():
            idx = int(head)
            if not 1 <= idx <= n_tweets:
                sys.exit(f"ERROR: {what} tweet index {idx} out of range (1..{n_tweets}).")
            return idx, rest
        return 1, raw

    per_tweet: dict[int, list[list[str]]] = {}
    for raw in images:
        idx, path = split_idx(raw, "--image")
        per_tweet.setdefault(idx, []).append([path, ""])
    alt_cursor: dict[int, int] = {}
    for raw in alts:
        idx, alt = split_idx(raw, "--alt")
        slot = alt_cursor.get(idx, 0)
        if idx not in per_tweet or slot >= len(per_tweet[idx]):
            sys.exit(f"ERROR: --alt for tweet {idx} has no matching --image.")
        per_tweet[idx][slot][1] = alt
        alt_cursor[idx] = slot + 1
    for idx, pairs in per_tweet.items():
        if len(pairs) > 4:
            sys.exit(f"ERROR: tweet {idx} has {len(pairs)} images; X allows at most 4.")
        for pair in pairs:
            p = Path(pair[0])
            if not p.is_absolute():
                p = REPO / p
            if not p.exists():
                sys.exit(f"ERROR: image not found: {p}")
            pair[0] = str(p)
    return per_tweet


# ---------------------------------------------------------------------- media
def upload_media(env: dict, social_set: str, path: str) -> str:
    """Upload one image via Typefully's presigned-S3 flow; returns the media id.

    All media-API shape knowledge lives here on purpose — if Typefully shifts
    the endpoint contract, this is the only function to fix.
    """
    created = api_request(
        env,
        "POST",
        f"/social-sets/{social_set}/media/upload",
        {"file_name": Path(path).name},
        context="media upload create",
    )
    media_id = created.get("media_id")
    upload_url = created.get("upload_url")
    if not media_id or not upload_url:
        sys.exit(f"ERROR: unexpected media upload response: {created}")

    blob = Path(path).read_bytes()
    req = urllib.request.Request(upload_url, data=blob, method="PUT")
    ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
    req.add_header("Content-Type", ctype)
    try:
        with urllib.request.urlopen(req) as resp:
            if resp.status not in (200, 201, 204):
                sys.exit(f"ERROR: media byte upload returned HTTP {resp.status}")
    except urllib.error.HTTPError as e:
        sys.exit(f"ERROR: media byte upload returned HTTP {e.code}")

    deadline = time.time() + MEDIA_TIMEOUT
    while True:
        status = api_request(
            env,
            "GET",
            f"/social-sets/{social_set}/media/{media_id}",
            context="media status",
        )
        state = status.get("status")
        if state == "ready":
            return str(media_id)
        if state == "failed":
            sys.exit(
                f"ERROR: Typefully could not process {Path(path).name}: "
                f"{status.get('error_reason')}"
            )
        if time.time() >= deadline:
            sys.exit(f"ERROR: timed out waiting for media processing ({path}).")
        time.sleep(POLL_INTERVAL)


# -------------------------------------------------------------------- publish
def build_payload(tweets: list[str], media_ids: dict[int, list[str]], title: str) -> dict:
    posts = []
    for i, tweet in enumerate(tweets, 1):
        post: dict = {"text": tweet}
        if media_ids.get(i):
            post["media_ids"] = media_ids[i]
        posts.append(post)
    return {
        "platforms": {"x": {"enabled": True, "posts": posts}},
        "draft_title": title,
        "publish_at": "now",
        "share": False,
    }


def publish_draft(env: dict, social_set: str, payload: dict) -> dict:
    """Create the draft with publish_at: now, then poll until it's live."""
    draft = api_request(
        env,
        "POST",
        f"/social-sets/{social_set}/drafts",
        payload,
        context="draft create",
    )
    draft_id = draft.get("id") or draft.get("draft_id")
    if not draft_id:
        sys.exit(f"ERROR: unexpected draft response: {draft}")

    deadline = time.time() + PUBLISH_TIMEOUT
    while True:
        if draft.get("status") == "error":
            sys.exit(
                f"ERROR: Typefully reported a publish error for draft {draft_id}. "
                f"Open it: {draft.get('private_url', 'typefully.com')}"
            )
        if draft.get("publish_state") == "finished" or draft.get("x_published_url"):
            return draft
        if time.time() >= deadline:
            sys.exit(
                f"ERROR: timed out waiting for draft {draft_id} to publish. "
                f"Check it at {draft.get('private_url', 'typefully.com')} — it "
                "may still go out; don't re-run blindly (double post)."
            )
        time.sleep(POLL_INTERVAL)
        draft = api_request(
            env,
            "GET",
            f"/social-sets/{social_set}/drafts/{draft_id}",
            context="draft status",
        )


def record_publish(
    draft: dict,
    args,
    tweets: list[str],
    counts: list[int],
    log_path: Path | None = None,
) -> None:
    """Append the publish record. Never fails the publish — the post is already live."""
    if log_path is None:
        log_path = PUBLISHED_LOG
    draft_id = draft.get("id") or draft.get("draft_id") or ""
    record = {
        "date": time.strftime("%Y-%m-%d"),
        "ids": [str(draft_id)] if draft_id else [],
        "url": draft.get("x_published_url") or "",
        "slug": Path(args.file).stem if args.file else "",
        "format": "thread" if len(tweets) > 1 else "single",
        "tweets": len(tweets),
        "chars": counts,
        "first_line": tweets[0].splitlines()[0][:120] if tweets else "",
        "lane": getattr(args, "lane", "") or "",
        "via": "typefully",
    }
    try:
        log_path.parent.mkdir(parents=True, exist_ok=True)
        with log_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except OSError as e:
        print(f"WARNING: could not write {log_path}: {e}", file=sys.stderr)


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
    src.add_argument("--file", help="Path to a draft (single tweet, or thread split on --- lines).")
    src.add_argument("--text", help="Tweet text passed directly on the command line.")
    ap.add_argument(
        "--connect",
        action="store_true",
        help="One-time: fetch your Typefully social sets and store the id in .env.",
    )
    ap.add_argument(
        "--image",
        action="append",
        default=[],
        help="Image to attach, as [tweetN:]path (default tweet 1). Repeatable; max 4 per tweet.",
    )
    ap.add_argument(
        "--alt",
        action="append",
        default=[],
        help="Alt text for the matching --image (same [tweetN:] prefix rules); "
        "recorded locally — set it on the post in Typefully/X for accessibility.",
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
        help="Print the request payload and exit without calling Typefully.",
    )
    ap.add_argument(
        "--allow-unverified",
        action="store_true",
        help="HUMAN-ONLY escape hatch: publish without the source-verification "
        "gate. The agent must never set this to get past the gate.",
    )
    args = ap.parse_args()

    env = load_env(ENV_PATH)
    if args.connect:
        connect(env, ENV_PATH)
        return

    text = read_draft(args)
    tweets = x_len.split_thread(text)
    counts = validate_tweets(tweets)
    media_map = parse_media_args(args.image, args.alt, len(tweets))

    if args.dry_run:
        placeholder = {
            i: [f"<uploaded {Path(p).name}>" for p, _ in pairs]
            for i, pairs in media_map.items()
        }
        payload = build_payload(
            tweets, placeholder, Path(args.file).stem if args.file else "post"
        )
        print("DRY RUN — no request sent. Draft payload that would POST to "
              "/v2/social-sets/<id>/drafts:\n")
        print(json.dumps(payload, indent=2, ensure_ascii=False))
        for i, n in enumerate(counts, 1):
            print(f"[{i}/{len(tweets)} · {n}/{x_len.LIMIT}]")
        return

    social_set = require_setup(env)

    # Source gate: before any media upload so a failed gate never orphans an
    # uploaded asset on Typefully's side.
    enforce_source_gate(args)

    media_ids = {
        i: [upload_media(env, social_set, p) for p, _alt in pairs]
        for i, pairs in media_map.items()
    }
    payload = build_payload(
        tweets, media_ids, Path(args.file).stem if args.file else "post"
    )
    draft = publish_draft(env, social_set, payload)

    print("Published to X via Typefully.")
    url = draft.get("x_published_url") or ""
    if url:
        print(f"URL: {url}")
    else:
        print(f"Draft: {draft.get('private_url', '(check typefully.com)')}")
    record_publish(draft, args, tweets, counts)


if __name__ == "__main__":
    main()

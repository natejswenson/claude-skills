#!/usr/bin/env python3
"""Publish a post or thread to your own X (Twitter) account.

Reads credentials from `.env` (populated by scripts/x_auth.py, auto-refreshed
here when near expiry) and POSTs to X's v2 API. Use --dry-run first to see the
exact payloads without sending anything.

Draft format: one tweet, or a thread with tweets separated by lines containing
only ``---``. Every tweet is validated against the weighted 280 limit
(scripts/x_len.py) before anything is sent.

Usage:
    python3 scripts/x_post.py --file drafts/my-post.md
    python3 scripts/x_post.py --file drafts/my-thread.md --dry-run
    python3 scripts/x_post.py --file drafts/my-thread.md --resume
    python3 scripts/x_post.py --file d.md --image images/card.png --alt "…"
    python3 scripts/x_post.py --file d.md --image 3:images/chart.png

Images attach to tweet 1 by default; prefix the path with ``N:`` to attach to
tweet N of a thread. Up to 4 images per tweet. Pair each --image with an
--alt (same ``N:`` prefix rules) for accessibility.

If a thread is interrupted mid-way (rate limit, network), the posted tweet ids
are in ``drafts/<slug>.thread-progress.json`` — rerun with --resume to post
only the remaining tweets onto the same reply chain.

Standard library only — no pip install needed.
"""
from __future__ import annotations

import argparse
import json
import secrets
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import verify_sources
import x_auth
import x_len

REPO = Path(__file__).resolve().parent.parent
# Personal credentials live in the shared home dir (same location Claude Code and Claude
# Desktop both read), so publishing isn't tied to whichever install of the skill ran auth.
HOME_ENV = Path.home() / ".claude" / "ghostwriter-x" / ".env"
ENV_PATH = HOME_ENV if HOME_ENV.exists() else REPO / ".env"
TWEETS_URL = "https://api.x.com/2/tweets"
MEDIA_UPLOAD_URL = "https://api.x.com/2/media/upload"
MEDIA_METADATA_URL = "https://api.x.com/2/media/metadata"
# One JSON line per published post/thread; scripts/post_outcome.py adds outcomes
# later and the skill reads it to bias topic/format choices.
PUBLISHED_LOG = Path.home() / ".claude" / "ghostwriter-x" / "published.jsonl"
# Refresh the access token when it has less than this long to live (they last ~2h).
REFRESH_MARGIN = 300
# Pause between thread tweets — keeps ordering stable and stays polite.
THREAD_DELAY = 1.0

load_env = x_auth.load_env  # same .env format; single parser


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
            failures.append(f"  tweet {i}/{len(tweets)}: {n}/{x_len.LIMIT} (+{n - x_len.LIMIT})")
    if failures:
        sys.exit(
            "ERROR: over the weighted 280 limit:\n"
            + "\n".join(failures)
            + "\n(Counting is conservative — see scripts/x_len.py. Trim and retry.)"
        )
    return counts


def parse_media_args(images: list[str], alts: list[str], n_tweets: int) -> dict:
    """Map ``[idx:]path`` / ``[idx:]alt`` flags to {tweet_index: [(path, alt)]}."""

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


def _api_request(req: urllib.request.Request, context: str) -> dict:
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        if e.code == 429:
            reset = e.headers.get("x-rate-limit-reset", "")
            when = ""
            if reset.isdigit():
                when = time.strftime(" (resets %Y-%m-%d %H:%M %Z)", time.localtime(int(reset)))
            raise RateLimited(f"rate limited on {context}{when}") from e
        print(f"ERROR: {context} returned HTTP {e.code}", file=sys.stderr)
        print(body, file=sys.stderr)
        if e.code in (401, 403):
            print(
                "\nThis usually means the token is invalid or a scope is missing "
                "(tweet.write). Re-run scripts/x_auth.py.",
                file=sys.stderr,
            )
        sys.exit(1)
    except urllib.error.URLError as e:
        sys.exit(f"ERROR: network problem reaching X: {e.reason}")


class RateLimited(Exception):
    """X returned 429; the caller reports progress + the resume command."""


def upload_media(env: dict, path: str, alt: str) -> str:
    """Upload one image via the v2 media endpoint; returns the media id.

    All media-API shape knowledge lives here on purpose — if X shifts the
    endpoint contract, this is the only function to fix.
    """
    token = env.get("X_ACCESS_TOKEN", "")
    blob = Path(path).read_bytes()
    boundary = "----ghostwriterx" + secrets.token_hex(8)
    body = (
        (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="media"; filename="{Path(path).name}"\r\n'
            "Content-Type: application/octet-stream\r\n\r\n"
        ).encode("utf-8")
        + blob
        + f"\r\n--{boundary}\r\n".encode("utf-8")
        + b'Content-Disposition: form-data; name="media_category"\r\n\r\ntweet_image'
        + f"\r\n--{boundary}--\r\n".encode("utf-8")
    )
    req = urllib.request.Request(MEDIA_UPLOAD_URL, data=body, method="POST")
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    data = _api_request(req, "media upload")
    media_id = (
        data.get("data", {}).get("id")
        or data.get("data", {}).get("media_key")
        or data.get("media_id_string")
    )
    if not media_id:
        sys.exit(f"ERROR: unexpected media upload response: {data}")
    if alt:
        meta = json.dumps(
            {"id": media_id, "metadata": {"alt_text": {"text": alt}}}
        ).encode("utf-8")
        mreq = urllib.request.Request(MEDIA_METADATA_URL, data=meta, method="POST")
        mreq.add_header("Authorization", f"Bearer {token}")
        mreq.add_header("Content-Type", "application/json")
        _api_request(mreq, "media metadata (alt text)")
    else:
        print(
            "NOTE: image uploaded without alt text (accessibility). "
            "Consider adding --alt.",
            file=sys.stderr,
        )
    return str(media_id)


def post_tweet(env: dict, text: str, reply_to: str | None, media_ids: list[str]) -> str:
    payload: dict = {"text": text}
    if reply_to:
        payload["reply"] = {"in_reply_to_tweet_id": reply_to}
    if media_ids:
        payload["media"] = {"media_ids": media_ids}
    req = urllib.request.Request(
        TWEETS_URL, data=json.dumps(payload).encode("utf-8"), method="POST"
    )
    req.add_header("Authorization", f"Bearer {env.get('X_ACCESS_TOKEN', '')}")
    req.add_header("Content-Type", "application/json")
    data = _api_request(req, "POST /2/tweets")
    tweet_id = data.get("data", {}).get("id")
    if not tweet_id:
        sys.exit(f"ERROR: unexpected /2/tweets response: {data}")
    return str(tweet_id)


def ensure_fresh_token(env: dict) -> dict:
    """Auto-refresh the access token when it's within REFRESH_MARGIN of expiry."""
    expires_at = env.get("X_TOKEN_EXPIRES_AT", "").strip()
    try:
        remaining = int(float(expires_at)) - int(time.time())
    except ValueError:
        return env
    if remaining > REFRESH_MARGIN:
        return env
    print("Access token near expiry — refreshing...", file=sys.stderr)
    return x_auth.refresh_access_token(env, ENV_PATH)


def progress_path(args) -> Path | None:
    if not args.file:
        return None
    p = Path(args.file)
    return p.with_name(p.stem + ".thread-progress.json")


def load_progress(path: Path | None) -> list[str]:
    if path is None or not path.exists():
        return []
    try:
        return list(json.loads(path.read_text(encoding="utf-8")).get("ids", []))
    except (OSError, ValueError):
        return []


def save_progress(path: Path | None, ids: list[str]) -> None:
    if path is None:
        return
    try:
        path.write_text(json.dumps({"ids": ids}) + "\n", encoding="utf-8")
    except OSError as e:
        print(f"WARNING: could not write {path}: {e}", file=sys.stderr)


def record_publish(
    ids: list[str],
    args,
    tweets: list[str],
    counts: list[int],
    username: str,
    log_path: Path | None = None,
) -> None:
    """Append the publish record. Never fails the publish — the post is already live."""
    if log_path is None:
        log_path = PUBLISHED_LOG
    record = {
        "date": time.strftime("%Y-%m-%d"),
        "ids": ids,
        "url": f"https://x.com/{username}/status/{ids[0]}" if ids and username else "",
        "slug": Path(args.file).stem if args.file else "",
        "format": "thread" if len(tweets) > 1 else "single",
        "tweets": len(tweets),
        "chars": counts,
        "first_line": tweets[0].splitlines()[0][:120] if tweets else "",
        "lane": getattr(args, "lane", "") or "",
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
        "--image",
        action="append",
        default=[],
        help="Image to attach, as [tweetN:]path (default tweet 1). Repeatable; max 4 per tweet.",
    )
    ap.add_argument(
        "--alt",
        action="append",
        default=[],
        help="Alt text for the matching --image (same [tweetN:] prefix rules).",
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
        help="Print the request payloads and exit without calling X.",
    )
    ap.add_argument(
        "--resume",
        action="store_true",
        help="Continue a half-posted thread from its .thread-progress.json.",
    )
    ap.add_argument(
        "--allow-unverified",
        action="store_true",
        help="HUMAN-ONLY escape hatch: publish without the source-verification "
        "gate. The agent must never set this to get past the gate.",
    )
    args = ap.parse_args()

    env = load_env(ENV_PATH)
    text = read_draft(args)
    tweets = x_len.split_thread(text)
    counts = validate_tweets(tweets)
    media_map = parse_media_args(args.image, args.alt, len(tweets))

    if args.dry_run:
        print("DRY RUN — no requests sent. Payloads that would POST to /2/tweets:\n")
        for i, tweet in enumerate(tweets, 1):
            payload: dict = {"text": tweet}
            if i > 1:
                payload["reply"] = {"in_reply_to_tweet_id": "<id of tweet %d>" % (i - 1)}
            if i in media_map:
                payload["media"] = {
                    "media_ids": [f"<uploaded {Path(p).name}>" for p, _ in media_map[i]]
                }
            print(f"[{i}/{len(tweets)} · {counts[i - 1]}/{x_len.LIMIT}]")
            print(json.dumps(payload, indent=2, ensure_ascii=False))
            print()
        return

    # Source gate: before any media upload so a failed gate never orphans an
    # uploaded asset on X's side.
    enforce_source_gate(args)

    env = ensure_fresh_token(env)
    username = env.get("X_USERNAME", "").strip()

    prog_path = progress_path(args)
    posted: list[str] = load_progress(prog_path) if args.resume else []
    if posted:
        print(f"Resuming: {len(posted)}/{len(tweets)} tweets already posted.")
    if len(posted) >= len(tweets):
        sys.exit("ERROR: progress file says all tweets are already posted.")

    try:
        for i in range(len(posted), len(tweets)):
            media_ids = [
                upload_media(env, p, alt) for p, alt in media_map.get(i + 1, [])
            ]
            reply_to = posted[-1] if posted else None
            tweet_id = post_tweet(env, tweets[i], reply_to, media_ids)
            posted.append(tweet_id)
            save_progress(prog_path, posted)
            print(f"Posted tweet {i + 1}/{len(tweets)}: {tweet_id}")
            if i + 1 < len(tweets):
                time.sleep(THREAD_DELAY)
    except RateLimited as e:
        print(f"ERROR: {e}", file=sys.stderr)
        if prog_path is not None and posted:
            print(
                f"Progress saved ({len(posted)}/{len(tweets)}). Resume with:\n"
                f"  python3 scripts/x_post.py --file {args.file} --resume",
                file=sys.stderr,
            )
        sys.exit(1)

    print("Published to X.")
    if username and posted:
        print(f"URL: https://x.com/{username}/status/{posted[0]}")
    if prog_path is not None and prog_path.exists():
        try:
            prog_path.unlink()
        except OSError:
            pass
    record_publish(posted, args, tweets, counts, username)


if __name__ == "__main__":
    main()

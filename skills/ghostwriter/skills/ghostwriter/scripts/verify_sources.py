#!/usr/bin/env python3
"""Verify that a draft's external claims are backed by >=3 live sources.

A LinkedIn draft that asserts facts about the outside world must ship with a
sidecar `<draft>.sources.json` pairing each claim to source URLs. This is the
publish-time gate: it confirms the sidecar exists, every claim has a source, and
at least 3 DISTINCT live source hosts are reachable. It is liveness
proof-of-work (evidence the research actually happened) — NOT a factuality
checker. Whether a source supports its claim is enforced upstream, in the
SKILL.md research step, by the agent reading the source.

Pure first-person posts (no outside-world claims) declare
`{"external_claims": false}` in the sidecar and pass trivially.

It is fail-closed: anything short of "3 distinct live hosts, every claim
sourced, no dead URL" blocks. A transient-down real source is handled by the
human-only `--allow-unverified` escape on the publish side, never by this script
guessing.

Importable:  from verify_sources import verify;  verify("drafts/x.md")
CLI:         python3 scripts/verify_sources.py --file drafts/x.md [--json]

Standard library only — no pip install needed.
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

MIN_SOURCES = 3
TIMEOUT = 6  # seconds, per request
# Status codes that mean "the host is up" even though it bot-walls or blocks
# HEAD — Cloudflare-fronted vendor sites (e.g. anthropic.com) routinely do this,
# and treating them as dead would false-block legitimate primary sources.
ALIVE_EXTRA = {401, 403, 405}
# Codes from a HEAD that warrant retrying with a ranged GET.
HEAD_RETRY = {405, 501}
# urllib's default User-Agent ("Python-urllib/3.x") is 403'd by many CDNs.
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)


def _ok(reason, *, distinct_live=0, results=None):
    return {"ok": True, "reason": reason, "distinct_live": distinct_live,
            "not_live": [], "results": results or []}


def _fail(reason, *, distinct_live=0, not_live=None, results=None):
    return {"ok": False, "reason": reason, "distinct_live": distinct_live,
            "not_live": not_live or [], "results": results or []}


def _host(url):
    """Normalized host for distinctness: lowercased, leading 'www.' stripped."""
    host = (urlparse(url).hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]
    return host


def _status(url, method):
    """Return the HTTP status code for a single request, or None on a network
    error (DNS failure, timeout, connection refused). Never raises."""
    headers = {"User-Agent": USER_AGENT}
    if method == "GET":
        headers["Range"] = "bytes=0-0"  # ask for one byte; we only want the code
    req = urllib.request.Request(url, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return resp.status
    except urllib.error.HTTPError as exc:
        return exc.code
    except (urllib.error.URLError, OSError):
        return None


def _is_live(url):
    """True iff the URL's host responds as up. HEAD first; on 405/501 fall back
    to a ranged GET (some hosts reject HEAD). Liveness is judged on the final
    request's code."""
    code = _status(url, "HEAD")
    if code in HEAD_RETRY:
        retry = _status(url, "GET")
        # Only let the GET override the HEAD code if it actually returned one; a
        # transient GET network error must not downgrade a HEAD that already
        # proved the host is up (e.g. a 405 from a bot-walling CDN).
        if retry is not None:
            code = retry
    if code is None:
        return False
    return 200 <= code < 400 or code in ALIVE_EXTRA


def verify(draft_path):
    """Gate a draft's sources sidecar. Returns a result dict with at least
    `ok` (bool) and `reason` (str). Pure liveness proof-of-work; see module doc."""
    sidecar = Path(draft_path).with_suffix(".sources.json")
    try:
        raw = sidecar.read_text(encoding="utf-8")
    except OSError:
        return _fail(
            f"No sources sidecar found at {sidecar.name}. Every external-claim "
            "post needs one (see SKILL.md → Research & fact-check)."
        )
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return _fail(f"Sources sidecar {sidecar.name} is not valid JSON.")
    if not isinstance(data, dict):
        return _fail(f"Sources sidecar {sidecar.name} must be a JSON object.")

    claims = data.get("claims", [])
    # Missing key defaults to True — fail-closed: an under-specified sidecar must
    # prove its sources, not skip the gate. An explicit non-bool value (e.g.
    # null) is rejected rather than silently treated as "personal".
    external = data.get("external_claims", True)
    if not isinstance(external, bool):
        return _fail("Sidecar 'external_claims' must be true or false.")

    if not external:
        if claims:
            return _fail(
                "Sidecar declares external_claims:false but lists claims — "
                "contradictory. Set external_claims:true or clear claims."
            )
        return _ok("Personal post (external_claims:false); nothing to verify.")

    if not isinstance(claims, list):
        return _fail("Sidecar 'claims' must be a list.")
    if not claims:
        return _fail("Sidecar declares external claims but lists none.")

    # The sidecar is hand/agent-authored JSON with no schema, so validate shape
    # before touching it — a malformed sidecar must fail with a clean message,
    # not a traceback.
    urls = []
    for claim in claims:
        if not isinstance(claim, dict):
            return _fail(f"Each claim must be an object; got: {claim!r}")
        sources = claim.get("sources", [])
        if not isinstance(sources, list) or not sources:
            return _fail(f"Claim has no source: {claim.get('claim', '?')!r}")
        for src in sources:
            if not isinstance(src, str):
                return _fail(f"Each source must be a URL string; got: {src!r}")
        urls.extend(sources)

    for url in urls:
        if urlparse(url).scheme.lower() not in ("http", "https"):
            return _fail(f"Non-http(s) source URL not allowed: {url}")

    live_hosts = set()
    not_live = []
    results = []
    for url in urls:
        alive = _is_live(url)
        results.append({"url": url, "state": "live" if alive else "not_live"})
        if alive:
            live_hosts.add(_host(url))
        else:
            not_live.append(url)

    if not_live:
        return _fail(
            f"{len(not_live)} source URL(s) not reachable/live: "
            f"{', '.join(not_live)}",
            distinct_live=len(live_hosts), not_live=not_live, results=results,
        )
    if len(live_hosts) < MIN_SOURCES:
        return _fail(
            f"Only {len(live_hosts)} distinct live source host(s); "
            f"need >={MIN_SOURCES}.",
            distinct_live=len(live_hosts), results=results,
        )
    return _ok(
        f"{len(live_hosts)} distinct live sources verified.",
        distinct_live=len(live_hosts), results=results,
    )


def main():
    ap = argparse.ArgumentParser(description="Verify a draft's source sidecar.")
    ap.add_argument("--file", required=True, help="Path to the draft .md file.")
    ap.add_argument(
        "--json", action="store_true", help="Emit the result as JSON."
    )
    args = ap.parse_args()
    result = verify(args.file)
    if args.json:
        print(json.dumps(result, ensure_ascii=False))
    else:
        print(f"[{'OK' if result['ok'] else 'FAIL'}] {result['reason']}")
    sys.exit(0 if result["ok"] else 1)


if __name__ == "__main__":  # pragma: no cover
    main()

#!/usr/bin/env python3
"""Trusted, bounded primary-source retrieval. Never loads posting credentials."""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

SOURCES = ("https://github.com/openai/codex/releases.atom",)
MAX_BYTES = 524288
EVIDENCE_BYTES = 2048


def sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("Primary source redirected; update the trusted allowlist")


def fetch(policy: dict, destination) -> list[dict]:
    """Persist even failed receipts; an unavailable source cannot become cached success."""
    if policy.get("sources") != list(SOURCES):
        raise ValueError("Unrecognized primary-source policy")
    destination.mkdir(parents=True, exist_ok=True)
    receipts = []
    opener = build_opener(ProxyHandler({}), NoRedirect())
    for index, url in enumerate(SOURCES):
        receipt = {"source": url, "final_url": url, "status": None,
                   "retrieved_at": datetime.now(timezone.utc).isoformat()}
        try:
            request = Request(url, headers={"User-Agent": "ghostwriter-release-radar",
                                             "Accept": "application/atom+xml"})
            with opener.open(request, timeout=30) as response:
                receipt.update(status=response.status, final_url=response.geturl())
                body = response.read(MAX_BYTES + 1)
            if receipt["status"] != 200 or receipt["final_url"] != url:
                raise ValueError("Primary source returned an unapproved response")
            if not body or len(body) > MAX_BYTES:
                raise ValueError("Primary source response empty or exceeds bound")
            receipt.update(sha256=sha256(body), bytes=len(body),
                           evidence=body[:EVIDENCE_BYTES].decode("utf-8", errors="replace"),
                           snapshot=f"source-{index}.json")
            (destination / receipt["snapshot"]).write_bytes(body)
        except (OSError, URLError, ValueError) as exc:
            receipt["error"] = str(exc)
            if isinstance(exc, HTTPError):
                receipt["status"] = exc.code
        receipts.append(receipt)
    (destination / "receipts.json").write_text(json.dumps(receipts, indent=2) + "\n")
    validate(receipts, destination)
    return receipts


def validate(receipts: list, destination) -> None:
    """Check provenance and bounded evidence, not just the existence of a digest."""
    if not isinstance(receipts, list) or len(receipts) != len(SOURCES):
        raise ValueError("Missing live primary-source receipt")
    for index, receipt in enumerate(receipts):
        if not isinstance(receipt, dict):
            raise ValueError("Malformed live primary-source receipt")
        try:
            timestamp = datetime.fromisoformat(receipt.get("retrieved_at", ""))
            if timestamp.utcoffset() is None:
                raise ValueError("Timezone missing")
        except (TypeError, ValueError) as exc:
            raise ValueError("Malformed receipt timestamp") from exc
        url = SOURCES[index]
        if (receipt.get("source") != url or receipt.get("final_url") != url
                or receipt.get("status") != 200 or receipt.get("error")
                or not receipt.get("retrieved_at")
                or receipt.get("snapshot") != f"source-{index}.json"):
            raise ValueError("Failed or malformed live primary-source receipt")
        body = (destination / receipt["snapshot"]).read_bytes()
        if (not body or len(body) > MAX_BYTES or receipt.get("bytes") != len(body)
                or receipt.get("sha256") != sha256(body)
                or receipt.get("evidence") != body[:EVIDENCE_BYTES].decode("utf-8", errors="replace")):
            raise ValueError("Primary-source hash or evidence mismatch")

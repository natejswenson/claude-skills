"""X owner correction routing; host supplies the connected skill_memory callable.

No filesystem, credentials, transport selection, or source mutation here. The
hub alone validates private registration and writes the owner source once.
"""
from __future__ import annotations


def save_hashtags(call, *, subject, value, capture_id, supersedes=None, pending_request=None):
    """Return an explicit host action; retry with the same capture_id after ambiguity.

    fallback: original manual source workflow; stop: no dependent redraft;
    saved/pending: redraft from authoritative X source. Never manually append
    after capture was attempted, including exceptions and malformed responses.
    """
    base = {"contract": "skill-memory-v1", "skill": "ghostwriter-x", "subject": subject}
    if pending_request is not None:
        # Retry the exact request returned from the previous attempt, including
        # the pre-write source revision; refreshing it changes operation identity.
        if not isinstance(pending_request, dict) or any(pending_request.get(k) != v for k, v in {**base, "op":"capture", "key":"writing-x.hashtags", "value":value, "capture_id":capture_id}.items()):
            return {"action":"stop", "reason":"retry_mismatch"}
        request = dict(pending_request)
    else:
        if call is None:
            return {"action": "fallback"}
        try:
            state = call({**base, "op": "status"})
        except Exception:
            return {"action": "fallback"}
        if isinstance(state, dict) and state.get("status") in {"disabled", "unavailable"}:
            return {"action": "fallback"}
        if not isinstance(state, dict) or state.get("status") != "ready":
            return {"action": "stop", "reason": "status_unconfirmed"}
        revision = state.get("source_revision")
        if not isinstance(revision, str) or not revision:
            return {"action": "stop", "reason": "missing_source_revision"}
        request = {**base, "op": "capture", "key": "writing-x.hashtags",
                   "value": value, "capture_id": capture_id,
                   "source": "Explicit X hashtag correction in current conversation",
                   "expected_source_revision": revision}
        if supersedes is not None:
            request["supersedes"] = supersedes
    try:
        result = call(request)
    except Exception:
        return {"action": "stop", "reason": "capture_unconfirmed", "request": request}
    status = result.get("status") if isinstance(result, dict) else None
    action = "pending" if status == "source_saved_memory_pending" else "stop"
    if status == "saved" and result.get("verified") is True and isinstance(result.get("record"), dict):
        action = "saved"
    return {"action": action, "result": result, "request": request}

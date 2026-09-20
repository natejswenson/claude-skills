"""X owner correction routing; host supplies the connected skill_memory callable.

No filesystem, credentials, transport selection, or source mutation here. The
hub alone validates private registration and writes the owner source once.
"""
from __future__ import annotations


def save_hashtags(call, *, subject, value, capture_id):
    """Return an explicit host action; retry with the same capture_id after ambiguity.

    fallback: original manual source workflow; stop: no dependent redraft;
    saved/pending: redraft from authoritative X source. Never manually append
    after capture was attempted, including exceptions and malformed responses.
    """
    base = {"contract": "skill-memory-v1", "skill": "ghostwriter-x", "subject": subject}
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
    try:
        result = call({**base, "op": "capture", "key": "writing-x.hashtags",
                       "value": value, "capture_id": capture_id,
                       "source": "Explicit X hashtag correction in current conversation",
                       "expected_source_revision": revision})
    except Exception:
        return {"action": "stop", "reason": "capture_unconfirmed"}
    status = result.get("status") if isinstance(result, dict) else None
    action = {"saved": "saved", "source_saved_memory_pending": "pending"}.get(status, "stop")
    return {"action": action, "result": result}

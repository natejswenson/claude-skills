"""Optional host bridge; callbacks wrap existing owner/legacy routes or MCP.

Backend selection comes from trusted private host configuration, never recalled
content. The hub performs its own authorization, validation and source write.
"""
from uuid import uuid4


def save_correction(*, backend, key, value, subject, source_revision,
                    hub_request, legacy_capture, owner_save, supersedes=None):
    """Save through exactly one owner route; never retry via another backend.

    Returns (result, may_redraft). Callers must report pending/error distinctly.
    Nonregistered keys retain the ordinary owner workflow without hub capture.
    """
    if backend not in (None, "legacy", "hub"):
        raise ValueError("Unknown trusted memory backend")
    if key != "writing.hashtags" or backend is None:
        result = owner_save(key, value)
        return result, result.get("source_saved") is True
    if backend == "legacy":
        result = legacy_capture(key, value, correction=True)
        return result, result.get("source_saved") is True
    if not subject or not source_revision:
        return {"status": "rejected", "reason": "Missing registered context or source revision"}, False
    request = {
        "contract": "skill-memory-v1", "skill": "ghostwriter",
        "op": "capture", "subject": subject, "key": key, "value": value,
        "capture_id": str(uuid4()), "source": "explicit user writing correction",
        "expected_source_revision": source_revision,
    }
    if supersedes is not None:
        request["supersedes"] = supersedes
    # The transport must retain this capture_id if retrying an ambiguous response.
    result = hub_request(request)
    return result, result.get("status") in ("saved", "source_saved_memory_pending")

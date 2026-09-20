"""Synthetic host routing: no owner files, network, home or real vault accessed."""
import pytest

from local_memory import save_hashtags

ARGS = dict(subject="synthetic-x-writer", value="Use no hashtags.",
            capture_id="65af1be1-f33d-4b40-b0d5-a81188bd64b5")


class Bridge:
    def __init__(self, *responses):
        self.responses = iter(responses)
        self.requests = []

    def __call__(self, request):
        self.requests.append(request)
        response = next(self.responses)
        if isinstance(response, Exception):
            raise response
        return response


@pytest.mark.parametrize("state", [{"status": "disabled"},
                                  {"status": "unavailable"}, OSError("offline")])
def test_unavailable_before_capture_uses_original_source(state):
    bridge = Bridge(state)
    assert save_hashtags(bridge, **ARGS) == {"action": "fallback"}
    assert [r["op"] for r in bridge.requests] == ["status"]


def test_missing_tool_uses_original_source():
    assert save_hashtags(None, **ARGS) == {"action": "fallback"}


@pytest.mark.parametrize("revision", [None, "", 10])
def test_ready_without_trusted_source_revision_stops(revision):
    bridge = Bridge({"status": "ready", "source_revision": revision})
    assert save_hashtags(bridge, **ARGS)["action"] == "stop"
    assert len(bridge.requests) == 1


@pytest.mark.parametrize("response,action", [
    ({"status": "saved", "verified": True, "record": {}}, "saved"),
    ({"status":"saved"}, "stop"),
    ({"status": "source_saved_memory_pending"}, "pending"),
    ({"status": "rejected"}, "stop"),
    ({"status": "conflict"}, "stop"),
    ({"status": "unavailable"}, "stop"),
    ({}, "stop"), (None, "stop"), (OSError("ambiguous"), "stop"),
])
def test_single_owner_capture_with_no_manual_fallback(response, action):
    bridge = Bridge({"status": "ready", "source_revision": "synthetic-rev"}, response)
    assert save_hashtags(bridge, **ARGS)["action"] == action
    assert len(bridge.requests) == 2
    status, capture = bridge.requests
    assert status == {"contract": "skill-memory-v1", "skill": "ghostwriter-x",
                      "subject": ARGS["subject"], "op": "status"}
    assert capture == {**status, "op": "capture", "key": "writing-x.hashtags",
                       "value": ARGS["value"], "capture_id": ARGS["capture_id"],
                       "expected_source_revision": "synthetic-rev",
                       "source": "Explicit X hashtag correction in current conversation"}


def test_retry_preserves_entire_request_without_refreshing_revision():
    bridge = Bridge({"status": "ready", "source_revision": "before"}, OSError("timeout"),
                    {"status": "saved", "verified": True, "record": {}})
    first = save_hashtags(bridge, **ARGS)
    assert first["action"] == "stop"
    retry = save_hashtags(bridge, **ARGS, pending_request=first["request"])
    assert retry["action"] == "saved"
    assert bridge.requests[1] == bridge.requests[2]
    assert len(bridge.requests) == 3


def test_correction_keeps_selected_supersedes_and_rejects_mismatched_retry():
    bridge = Bridge({"status": "ready", "source_revision": "before"}, {"status":"conflict"})
    result = save_hashtags(bridge, **ARGS, supersedes="selected-record")
    assert result["request"]["supersedes"] == "selected-record"
    assert save_hashtags(bridge, **ARGS, pending_request={})["reason"] == "retry_mismatch"


@pytest.mark.parametrize("state", [None, {}, {"status": "rejected"}, {"status": "conflict"}])
def test_rejected_or_malformed_status_never_downgrades_to_manual_write(state):
    bridge = Bridge(state)
    assert save_hashtags(bridge, **ARGS)["action"] == "stop"
    assert len(bridge.requests) == 1

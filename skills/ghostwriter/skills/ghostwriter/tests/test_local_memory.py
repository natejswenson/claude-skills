"""Synthetic single-writer routing tests; no accounts, files, or network."""
from unittest.mock import Mock
import pytest
from local_memory import save_correction


def invoke(backend="hub", key="writing.hashtags", status="saved", **overrides):
    hub = Mock(return_value={"status": status, "verified": True, "record": {}})
    legacy = Mock(return_value={"source_saved": True, "memory": "pending"})
    owner = Mock(return_value={"source_saved": True})
    args = dict(backend=backend, key=key, value="Use no hashtags.",
                subject="synthetic-writer", source_revision="synthetic-revision",
                hub_request=hub, legacy_capture=legacy, owner_save=owner,
                capture_id="28d72d4b-179f-40c0-90fa-a4f64f4a0da1")
    args.update(overrides)
    result = save_correction(**args)
    return result, hub, legacy, owner


@pytest.mark.parametrize("status,allowed", [
    ("saved", True), ("source_saved_memory_pending", True),
    ("unavailable", False), ("rejected", False), ("conflict", False),
    ("source_save_failed", False),
])
def test_hub_is_only_writer_and_failure_stops_redraft(status, allowed):
    (result, redraft), hub, legacy, owner = invoke(status=status)
    assert redraft is allowed
    assert result["status"] == status
    legacy.assert_not_called()
    owner.assert_not_called()
    request = hub.call_args.args[0]
    assert request["expected_source_revision"] == "synthetic-revision"
    assert request["skill"] == "ghostwriter"
    assert request["contract"] == "skill-memory-v1"
    from uuid import UUID
    UUID(request["capture_id"])


def test_legacy_preserves_correction_without_hub():
    (_, redraft), hub, legacy, owner = invoke(backend="legacy")
    assert redraft
    legacy.assert_called_once_with("writing.hashtags", "Use no hashtags.", correction=True)
    hub.assert_not_called()
    owner.assert_not_called()


@pytest.mark.parametrize("backend,key", [(None, "writing.hashtags"), ("hub", "voice.other")])
def test_existing_owner_fallback(backend, key):
    (_, redraft), hub, legacy, owner = invoke(backend=backend, key=key)
    assert redraft
    owner.assert_called_once_with(key, "Use no hashtags.")
    hub.assert_not_called()
    legacy.assert_not_called()


@pytest.mark.parametrize("missing", [{"subject": ""}, {"source_revision": ""}])
def test_unknown_context_does_not_write(missing):
    (_, redraft), hub, legacy, owner = invoke(**missing)
    assert not redraft
    for callback in (hub, legacy, owner):
        callback.assert_not_called()


def test_unknown_backend_cannot_fall_through():
    with pytest.raises(ValueError):
        invoke(backend="injected-note")


@pytest.mark.parametrize("backend,callback", [(None, "owner_save"), ("legacy", "legacy_capture")])
def test_other_owner_source_failure_stops_redraft(backend, callback):
    failed = Mock(return_value={"source_saved": False})
    (_, redraft), hub, _, _ = invoke(backend=backend, **{callback: failed})
    assert not redraft
    failed.assert_called_once()
    hub.assert_not_called()


def test_selected_correction_keeps_record_identity():
    (_, redraft), hub, _, _ = invoke(supersedes="synthetic-record")
    assert redraft
    assert hub.call_args.args[0]["supersedes"] == "synthetic-record"


def test_ambiguous_response_retains_exact_request_and_never_falls_back():
    (_, redraft), hub, legacy, owner = invoke(hub_request=Mock(side_effect=OSError("timeout")))
    assert not redraft
    assert not legacy.called and not owner.called


def test_missing_operation_id_and_unverified_response_stop():
    (result, redraft), _, _, _ = invoke(capture_id=None)
    assert not redraft and result["status"] == "rejected"
    (result, redraft), _, _, _ = invoke(hub_request=Mock(return_value=None))
    assert not redraft
    (_, redraft), _, _, _ = invoke(hub_request=Mock(return_value={"status": "saved"}))
    assert not redraft

"""Shared fixtures. Puts ``scripts/`` on the path so modules import by name."""
from __future__ import annotations

import os
import sys

import pytest

SCRIPTS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts")
if SCRIPTS not in sys.path:
    sys.path.insert(0, SCRIPTS)


@pytest.fixture
def place():
    import datausa
    return datausa.Place(
        name="Testville, MN",
        place_id="16000US2799999",
        state_name="Minnesota",
        state_id="04000US27",
        slug="testville-mn",
    )


def payload(rows, table_id="B01003"):
    """A minimal tesseract response envelope around ``rows``."""
    return {
        "annotations": {"table_id": table_id},
        "page": {"limit": 0, "offset": 0, "total": len(rows)},
        "columns": list(rows[0]) if rows else [],
        "data": rows,
    }


@pytest.fixture
def make_payload():
    return payload


@pytest.fixture
def tmp_cache(tmp_path, monkeypatch):
    """Redirect the on-disk cache into a temp dir for the duration of a test."""
    import datausa
    monkeypatch.setattr(datausa, "cache_dir", lambda: str(tmp_path))
    return tmp_path

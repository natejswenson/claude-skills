"""Shared test setup: make the standalone scripts importable as modules.

`scripts/` is a folder of executable scripts, not a package, so we put it on
sys.path and import each script by its stem (e.g. `import linkedin_post`).
"""
from __future__ import annotations

import sys
from pathlib import Path

SKILL_ROOT = Path(__file__).resolve().parent.parent
for _sub in ("scripts", "evals"):
    _p = str(SKILL_ROOT / _sub)
    if _p not in sys.path:
        sys.path.insert(0, _p)


import pytest  # noqa: E402


@pytest.fixture(autouse=True)
def _isolate_published_log(tmp_path, monkeypatch):
    """Never let a test append to the user's real ~/.claude/ghostwriter/published.jsonl."""
    import linkedin_post

    monkeypatch.setattr(
        linkedin_post, "PUBLISHED_LOG", tmp_path / "published.jsonl"
    )

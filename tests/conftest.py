"""Shared test setup: make the standalone scripts importable as modules.

`scripts/` is a folder of executable scripts, not a package, so we put it on
sys.path and import each script by its stem (e.g. `import linkedin_post`).
"""
from __future__ import annotations

import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

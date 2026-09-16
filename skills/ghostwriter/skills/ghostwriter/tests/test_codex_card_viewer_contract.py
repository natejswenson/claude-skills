"""Regression checks for the Codex generated-card viewer contract.

The built-in image-generation lifecycle is owned by Codex, so this repository's
contract is intentionally document-bound.  These standard-library-only checks
keep the required copy/open/approval ordering and the truthful result branches
from being reduced to an inline image preview.
"""
from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
REFERENCE = (ROOT / "references" / "codex-images.md").read_text(encoding="utf-8")


def _section() -> str:
    start = REFERENCE.index("## Save, open, approve")
    end = REFERENCE.find("\n## ", start + 1)
    return REFERENCE[start:] if end == -1 else REFERENCE[start:end]


def _normalized_section() -> str:
    return " ".join(_section().split())


def test_candidate_copy_uses_exact_host_viewer_path_before_approval():
    section = _normalized_section()
    copy = section.index("Copy the selected built-in output")
    open_attempt = section.index("After the copy succeeds")
    wait = section.index("wait for the open attempt to finish before asking for approval")
    approval = section.index("**Approve card** / **Change card** / **Drop card**")

    assert copy < open_attempt < wait < approval
    assert "exact candidate path" in section
    assert re.search(r'macOS:\s+`open "[^`]*<slug>-generated-vN\.png"', section)
    assert re.search(r'Linux:\s+`xdg-open "[^`]*<slug>-generated-vN\.png"', section)
    assert re.search(r'Windows:\s+`start "" "[^`]*<slug>-generated-vN\.png"', section)
    assert "same path as the command's target" in section


def test_native_open_success_and_failure_keep_inline_recovery_truthful():
    section = _normalized_section()
    success_match = re.search(
        r"On success, report that the native\s+viewer opened the exact candidate path",
        section,
    )
    failure_match = re.search(
        r"On failure or unavailability, say that the native\s+viewer\s+could not open it",
        section,
    )
    approval = section.index("**Approve card** / **Change card** / **Drop card**")

    assert success_match and failure_match
    assert "Treat a zero exit status as a successful native-open attempt" in section
    assert "inline image attachment is separate evidence" in section
    assert success_match.start() < failure_match.start() < approval
    assert "retain the full inline image" in section
    assert "exact candidate path for manual opening" in section
    assert "do not claim it opened" in section


if __name__ == "__main__":
    # T1 runs this file directly, without pytest. Keep that reviewed check
    # meaningful while retaining normal pytest discovery for the skill suite.
    test_candidate_copy_uses_exact_host_viewer_path_before_approval()
    test_native_open_success_and_failure_keep_inline_recovery_truthful()

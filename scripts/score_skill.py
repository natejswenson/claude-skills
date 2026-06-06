#!/usr/bin/env python3
"""Score the SKILL.md against explicit pass/fail checks.

A skill is code. Its SKILL.md is the prompt, so you can't compile it; you score
it. This runs grounded pass/fail checks (not arbitrary style nits) covering the
things this skill MUST get right, prints a score, and exits non-zero if any
required check fails so CI can gate on it.

Usage:
    python3 scripts/score_skill.py                  # scores the default SKILL.md
    python3 scripts/score_skill.py --file path.md   # score a specific file

Standard library only — no pip install needed.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DEFAULT_SKILL = REPO / ".claude" / "skills" / "linkedin-ghostwriter" / "SKILL.md"

# LinkedIn/Anthropic cap skill descriptions at 1024 characters.
MAX_DESCRIPTION_CHARS = 1024


def split_frontmatter(text: str) -> tuple[dict, str]:
    """Parse a tiny subset of YAML frontmatter (key: value lines) plus the body.

    Returns ({}, text) when there is no leading `---` frontmatter block.
    """
    if not text.startswith("---"):
        return {}, text
    parts = text.split("---", 2)
    if len(parts) < 3:
        return {}, text
    front_raw, body = parts[1], parts[2]
    front: dict[str, str] = {}
    for line in front_raw.splitlines():
        if ":" in line and not line.lstrip().startswith("#"):
            key, _, val = line.partition(":")
            front[key.strip()] = val.strip()
    return front, body


def build_checks(front: dict, body: str) -> list[tuple[str, bool]]:
    """Return a list of (description, passed) pass/fail checks."""
    description = front.get("description", "")
    low = body.lower()
    return [
        ("frontmatter has a name", bool(front.get("name"))),
        ("frontmatter has a description", bool(description)),
        ("frontmatter has a version", bool(front.get("version"))),
        (
            f"description is non-trivial and <= {MAX_DESCRIPTION_CHARS} chars",
            20 <= len(description) <= MAX_DESCRIPTION_CHARS,
        ),
        (
            "declares the three modes (Setup, Generate, Publish)",
            all(f"## mode: {m}" in low for m in ("setup", "generate", "publish")),
        ),
        (
            "states the never-publish-without-approval guardrail",
            "without explicit approval" in low or "never publish" in low,
        ),
        (
            "references the no-automated-posting compliance rule",
            "never automate posting" in low or "compliance" in low,
        ),
        (
            "references voice-profile and voice-notes as inputs",
            "voice-profile.md" in low and "voice-notes.md" in low,
        ),
    ]


def score(path: Path) -> int:
    """Run the checks, print results, and return a process exit code."""
    if not path.exists():
        sys.exit(f"ERROR: {path} not found.")
    front, body = split_frontmatter(path.read_text(encoding="utf-8"))
    checks = build_checks(front, body)

    passed = 0
    for desc, ok in checks:
        print(f"  [{'PASS' if ok else 'FAIL'}] {desc}")
        if ok:
            passed += 1

    total = len(checks)
    pct = round(100 * passed / total)
    print(f"\nScore: {passed}/{total} ({pct}%) — {path}")
    if passed < total:
        print("FAILED: one or more required checks did not pass.", file=sys.stderr)
        return 1
    print("PASSED: all required checks passed.")
    return 0


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--file", dest="path", type=Path, default=DEFAULT_SKILL)
    args = ap.parse_args()
    sys.exit(score(args.path))


if __name__ == "__main__":
    main()

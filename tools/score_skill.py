#!/usr/bin/env python3
"""Tier-1 structural-lint scorer for skill SKILL.md files.

Skill-agnostic, offline, deterministic, stdlib-only (no pyyaml). Scores a
skill's SKILL.md against generic structural checks and exits non-zero below a
threshold. Run in CI as the universal quality gate for every skill.
"""

from __future__ import annotations

import os
import sys

MIN_DEFAULT = 100

# The 5 required checks, in display order.
REQUIRED_CHECKS = [
    "has_frontmatter",
    "name_present",
    "description_present",
    "description_length",
    "has_h2_heading",
]


def parse_frontmatter(text: str) -> dict:
    """Parse ONLY the YAML frontmatter block of a SKILL.md.

    The frontmatter is the region between the FIRST line that is exactly ``---``
    and the NEXT line that is exactly ``---``. Returns a dict of simple
    ``key: value`` pairs (quotes/whitespace stripped). If the text does not
    start with a ``---`` fence, returns ``{}``.

    This reads ONLY the frontmatter block — never the body — so a ``version:``
    or ``---`` inside a fenced code block later in the file is never parsed.
    """
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}

    # Find the closing fence: the next line (after line 0) that is exactly ---.
    end = None
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            end = i
            break
    if end is None:
        return {}

    result: dict = {}
    for raw in lines[1:end]:
        line = raw.rstrip("\n")
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        key = key.strip()
        if not key:
            continue
        value = value.strip()
        # Strip a single layer of matching surrounding quotes.
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        result[key] = value
    return result


def _body_after_frontmatter(text: str) -> str:
    """Return the body text (everything after the closing frontmatter fence).

    If there is no valid frontmatter fence pair, returns the full text.
    """
    lines = text.splitlines(keepends=True)
    stripped = [l.strip() for l in text.splitlines()]
    if not stripped or stripped[0] != "---":
        return text
    for i in range(1, len(stripped)):
        if stripped[i] == "---":
            return "".join(lines[i + 1 :])
    return text


def _has_h2_heading(body: str) -> bool:
    """True if the body has at least one ``## `` H2 heading outside code fences."""
    in_fence = False
    for raw in body.splitlines():
        stripped = raw.strip()
        if stripped.startswith("```") or stripped.startswith("~~~"):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        if raw.startswith("## "):
            return True
    return False


def score_skill(skill_dir: str) -> dict:
    """Score ``<skill_dir>/SKILL.md`` against the 5 required structural checks.

    Returns a dict::

        {
            "score": int,            # 0-100, round(passed / 5 * 100)
            "passed": [check names],
            "failed": [check names],
            "soft": {"name_matches_dir": bool, ...},
            "min_default": 100,
        }
    """
    path = os.path.join(skill_dir, "SKILL.md")
    try:
        with open(path, "r", encoding="utf-8") as fh:
            text = fh.read()
    except (OSError, FileNotFoundError):
        text = ""

    fm = parse_frontmatter(text)
    body = _body_after_frontmatter(text)

    results: dict = {}

    # 1. Has a frontmatter block (open and close fence).
    results["has_frontmatter"] = bool(fm) or _has_closing_fence(text)

    # 2. Non-empty name.
    name = fm.get("name", "")
    results["name_present"] = bool(name and name.strip())

    # 3. Non-empty description.
    description = fm.get("description", "")
    results["description_present"] = bool(description and description.strip())

    # 4. Description length between 20 and 1024 inclusive.
    results["description_length"] = 20 <= len(description) <= 1024

    # 5. Body has at least one H2 heading.
    results["has_h2_heading"] = _has_h2_heading(body)

    passed = [c for c in REQUIRED_CHECKS if results[c]]
    failed = [c for c in REQUIRED_CHECKS if not results[c]]
    score = round(len(passed) / len(REQUIRED_CHECKS) * 100)

    # Soft (advisory) check: name equals the skill directory basename.
    dir_base = os.path.basename(os.path.normpath(skill_dir))
    soft = {"name_matches_dir": bool(name) and name.strip() == dir_base}

    return {
        "score": score,
        "passed": passed,
        "failed": failed,
        "soft": soft,
        "min_default": MIN_DEFAULT,
    }


def _has_closing_fence(text: str) -> bool:
    """True if text starts with a ``---`` fence and has a closing ``---``."""
    lines = [l.strip() for l in text.splitlines()]
    if not lines or lines[0] != "---":
        return False
    return "---" in lines[1:]


_CHECK_LABELS = {
    "has_frontmatter": "Frontmatter block present (--- ... ---)",
    "name_present": "Frontmatter has non-empty 'name'",
    "description_present": "Frontmatter has non-empty 'description'",
    "description_length": "Description length in [20, 1024]",
    "has_h2_heading": "Body has at least one '## ' heading",
}


def main(argv) -> int:
    """CLI entry point. Returns 0 if score >= min, else 1."""
    args = list(argv)
    skill_dir = None
    minimum = MIN_DEFAULT
    i = 0
    while i < len(args):
        arg = args[i]
        if arg == "--min":
            if i + 1 >= len(args):
                sys.stderr.write("error: --min requires a value\n")
                return 2
            try:
                minimum = int(args[i + 1])
            except ValueError:
                sys.stderr.write("error: --min must be an integer\n")
                return 2
            i += 2
            continue
        if arg.startswith("--min="):
            try:
                minimum = int(arg.split("=", 1)[1])
            except ValueError:
                sys.stderr.write("error: --min must be an integer\n")
                return 2
            i += 1
            continue
        if arg in ("-h", "--help"):
            sys.stdout.write(
                "usage: score_skill.py <skill-dir> [--min N]\n"
            )
            return 0
        if skill_dir is None:
            skill_dir = arg
        i += 1

    if skill_dir is None:
        sys.stderr.write("usage: score_skill.py <skill-dir> [--min N]\n")
        return 2

    result = score_skill(skill_dir)

    print(f"Skill: {skill_dir}")
    print("Structural checks:")
    for check in REQUIRED_CHECKS:
        status = "PASS" if check in result["passed"] else "FAIL"
        print(f"  [{status}] {_CHECK_LABELS[check]}")

    soft_status = "PASS" if result["soft"]["name_matches_dir"] else "WARN"
    print(
        f"  [{soft_status}] (advisory) Frontmatter 'name' matches directory basename"
    )

    print(f"Score: {result['score']}/100  (threshold: {minimum})")

    if result["score"] >= minimum:
        print("RESULT: PASS")
        return 0
    print("RESULT: FAIL")
    return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

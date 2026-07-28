"""Tier-1 skill-contract test (offline, deterministic, $0 — runs in CI).

city-report's correctness is mostly prose. The accuracy rules that stop it
publishing a wrong-but-plausible number — pinned queries only, never invent a
metric, always state the vintage, never quote a wide-margin figure as fact —
live in SKILL.md and are enforced by nothing else. tools/score_skill.py is
skill-agnostic and scores structure, not content, so a deleted accuracy rule
scores 100 and ships.

Data-driven from skill-invariants.json: adding a guardrail = adding an entry.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
# CHANGELOG.md lives at the plugin root (two levels up), not beside SKILL.md —
# plugin auto-discovery requires SKILL.md nested under skills/<name>/.
PLUGIN_ROOT = ROOT.parent.parent
MANIFEST = json.loads((ROOT / "skill-invariants.json").read_text(encoding="utf-8"))
SKILL_MD = (ROOT / "SKILL.md").read_text(encoding="utf-8")


@pytest.mark.parametrize("inv", MANIFEST["prose"], ids=lambda i: i["id"])
def test_prose_invariant_present(inv):
    text = (ROOT / inv["file"]).read_text(encoding="utf-8")
    pattern = re.compile(inv["pattern"], re.IGNORECASE | re.DOTALL)
    assert pattern.search(text), (
        f"\nSKILL invariant '{inv['id']}' is missing from {inv['file']}.\n"
        f"Why it matters: {inv['rationale']}\n"
        f"If you intentionally reworded it, update the pattern in "
        f"skill-invariants.json; do NOT delete the guardrail."
    )


def test_referenced_scripts_exist():
    """A rename that orphans a prose reference is a silent break: the skill tells
    the agent to run a script that is not there."""
    refs = sorted(set(re.findall(r"scripts/([\w.-]+\.py)", SKILL_MD)))
    assert refs, "expected SKILL.md to reference at least one script"
    missing = [r for r in refs if not (ROOT / "scripts" / r).exists()]
    assert not missing, f"SKILL.md references missing scripts: {missing}"


def test_api_gotchas_reference_exists():
    """SKILL.md sends the reader to references/api-gotchas.md before touching the
    manifest. That document is the evidence behind every pinned query."""
    assert "references/api-gotchas.md" in SKILL_MD
    assert (ROOT / "references" / "api-gotchas.md").exists(), (
        "SKILL.md points at references/api-gotchas.md but the file is missing — "
        "the pinned-query rules would have no stated evidence."
    )


def _frontmatter_version(text: str) -> str:
    # Scope to the leading `--- ... ---` block so a body line can never shadow it.
    fm = re.match(r"^---\n(.*?)\n---\n", text, re.DOTALL)
    assert fm, "SKILL.md has no frontmatter block"
    m = re.search(r"^version:\s*([0-9]+\.[0-9]+\.[0-9]+)\s*$", fm.group(1), re.MULTILINE)
    assert m, "SKILL.md frontmatter has no `version: x.y.z`"
    return m.group(1)


def _changelog_top_version(text: str) -> str:
    m = re.search(r"^##\s*\[([0-9]+\.[0-9]+\.[0-9]+)\]", text, re.MULTILINE)
    assert m, "CHANGELOG.md has no `## [x.y.z]` entry"
    return m.group(1)


def test_version_matches_changelog():
    """A version/CHANGELOG mismatch silently produces a no-op or mis-tagged
    release — releases here are cut from the version, not the merge."""
    skill_v = _frontmatter_version(SKILL_MD)
    changelog_v = _changelog_top_version(
        (PLUGIN_ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
    )
    assert skill_v == changelog_v, (
        f"SKILL.md version {skill_v} != top CHANGELOG entry {changelog_v}. "
        f"Bump both together (repo release rule)."
    )

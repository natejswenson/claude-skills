"""Tier-1 skill-contract test (offline, deterministic, $0 — runs in CI).

ghostwriter's user-protecting behavior lives almost entirely in SKILL.md prose,
not in code (linkedin_post.py has no approval check; verify_sources only proves
liveness). The shared Tier-1 scorer (tools/score_skill.py) is skill-agnostic and
would not notice a deleted guardrail. This test is the ghostwriter-specific
contract: it asserts the load-bearing guardrails still exist and that SKILL.md's
references and version stay consistent with the repo. A silent deletion/rename of
any guarded behavior fails here instead of shipping green.

Data-driven from skill-invariants.json so adding a guardrail = adding an entry.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = json.loads((ROOT / "skill-invariants.json").read_text(encoding="utf-8"))
SKILL_MD = (ROOT / "SKILL.md").read_text(encoding="utf-8")


# --------------------------------------------------------------- prose guardrails
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


# --------------------------------------------------- referenced files must exist
def test_referenced_scripts_exist():
    """Every scripts/<name>.py|.sh named in SKILL.md must exist (a rename that
    orphans a prose reference is a silent break — e.g. release_radar.sh)."""
    refs = sorted(set(re.findall(r"scripts/([\w.-]+\.(?:py|sh))", SKILL_MD)))
    assert refs, "expected SKILL.md to reference at least one script"
    missing = [r for r in refs if not (ROOT / "scripts" / r).exists()]
    assert not missing, f"SKILL.md references missing scripts: {missing}"


def test_referenced_card_templates_exist():
    """Every card-template-*.html named in SKILL.md must exist in assets/."""
    refs = sorted(set(re.findall(r"(card-template[\w-]*\.html)", SKILL_MD)))
    assert refs, "expected SKILL.md to reference at least one card template"
    missing = [r for r in refs if not (ROOT / "assets" / r).exists()]
    assert not missing, f"SKILL.md references missing card templates: {missing}"


def test_compliance_doc_exists():
    """SKILL.md points at COMPLIANCE.md for the ToS rules; it must exist."""
    assert "COMPLIANCE.md" in SKILL_MD
    assert (ROOT / "COMPLIANCE.md").exists(), "COMPLIANCE.md referenced but missing"


# ------------------------------------------------- version <-> CHANGELOG parity
def _frontmatter_version(text: str) -> str:
    # Scope the search to the leading `--- ... ---` frontmatter block so a body
    # line like `version: x` can never shadow the real version.
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
    release (the release flow keys off the SKILL.md version)."""
    skill_v = _frontmatter_version(SKILL_MD)
    changelog_v = _changelog_top_version(
        (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
    )
    assert skill_v == changelog_v, (
        f"SKILL.md version {skill_v} != top CHANGELOG entry {changelog_v}. "
        f"Bump both together (repo release rule)."
    )

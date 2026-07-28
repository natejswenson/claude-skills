"""Tier-1 skill-contract test (offline, deterministic, $0 — runs in CI).

github-stats is a thin conversational wrapper over one bash script, so almost
all of its user-protecting behavior is prose: never recompute numbers by hand,
never create a repository without confirmation, don't "fix" the deliberately
sampled/bounded metric definitions. gh-stats.sh enforces none of that — it will
print whatever it is asked for, and `gh repo create` is one sentence away.
tools/score_skill.py scores structure, not content, so a deleted rule scores 100.

Data-driven from skill-invariants.json: adding a guardrail = adding an entry.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
# CHANGELOG.md lives at the plugin root (two levels up), not beside SKILL.md.
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
    refs = sorted(set(re.findall(r"scripts/([\w.-]+\.sh)", SKILL_MD)))
    assert refs, "expected SKILL.md to reference at least one script"
    missing = [r for r in refs if not (ROOT / "scripts" / r).exists()]
    assert not missing, f"SKILL.md references missing scripts: {missing}"


def test_commands_reference_exists():
    """SKILL.md routes repo creation — the only state-changing action — through
    reference/commands.md. An orphaned pointer there is a real safety gap."""
    assert "reference/commands.md" in SKILL_MD
    assert (ROOT / "reference" / "commands.md").exists(), (
        "SKILL.md points at reference/commands.md but the file is missing — the "
        "documented confirm-then-create flow would have nowhere to send the agent."
    )


def test_every_documented_subcommand_exists_in_the_script():
    """A subcommand named in SKILL.md but absent from the script's dispatch is a
    silent break: the agent runs it, bash exits non-zero, the user sees noise."""
    script = (ROOT / "scripts" / "gh-stats.sh").read_text(encoding="utf-8")
    documented = sorted(set(re.findall(r"gh-stats\.sh\s+([a-z_]+)", SKILL_MD)))
    assert documented, "expected SKILL.md to document at least one subcommand"
    missing = [c for c in documented if c not in script]
    assert not missing, (
        f"SKILL.md documents subcommand(s) {missing} that scripts/gh-stats.sh "
        f"does not implement."
    )


def _frontmatter_version(text: str) -> str:
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

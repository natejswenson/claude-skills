import json
import os

import pytest

from lint_plugin import lint_plugin, main

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)
REAL_SKILLS = ["devlog", "resume", "ghostwriter", "github-stats"]


def write_plugin(tmp_path, plugin_json, skill_md_body, package_json=None, name="my-skill"):
    """Write a skill dir with plugin.json (+ nested SKILL.md / package.json).

    Mirrors the real layout: plugin.json stays at <skill_dir>/.claude-plugin/,
    while SKILL.md and package.json live one level deeper at
    <skill_dir>/skills/<name>/ -- Claude Code's plugin auto-discovery path.
    """
    skill_dir = tmp_path / name
    skill_dir.mkdir()
    plugin_dir = skill_dir / ".claude-plugin"
    plugin_dir.mkdir()
    if plugin_json is not None:
        (plugin_dir / "plugin.json").write_text(json.dumps(plugin_json), encoding="utf-8")
    nested_skill_dir = skill_dir / "skills" / name
    nested_skill_dir.mkdir(parents=True)
    (nested_skill_dir / "SKILL.md").write_text(skill_md_body, encoding="utf-8")
    if package_json is not None:
        (nested_skill_dir / "package.json").write_text(json.dumps(package_json), encoding="utf-8")
    return str(skill_dir)


def skill_md(name="my-skill", version=None):
    lines = ["---", f"name: {name}"]
    if version is not None:
        lines.append(f"version: {version}")
    lines.append("description: A perfectly valid description over twenty characters long.")
    lines.append("---")
    lines.append("")
    lines.append("## Usage")
    lines.append("Body.")
    return "\n".join(lines) + "\n"


def test_valid_no_package_json(tmp_path):
    skill_dir = write_plugin(
        tmp_path,
        {"name": "my-skill", "version": "1.0.0", "description": "x"},
        skill_md(version="1.0.0"),
    )
    result = lint_plugin(skill_dir)
    assert result["errors"] == []
    assert main([skill_dir]) == 0


def test_valid_with_package_json_all_three_equal(tmp_path):
    skill_dir = write_plugin(
        tmp_path,
        {"name": "my-skill", "version": "2.3.4", "description": "x"},
        skill_md(version="2.3.4"),
        package_json={"name": "@scope/my-skill-pkg", "version": "2.3.4"},
    )
    result = lint_plugin(skill_dir)
    assert result["errors"] == []
    assert main([skill_dir]) == 0


def test_missing_plugin_json(tmp_path):
    skill_dir = write_plugin(tmp_path, None, skill_md())
    result = lint_plugin(skill_dir)
    assert any("missing file" in e for e in result["errors"])
    assert main([skill_dir]) == 1


def test_name_mismatch_vs_directory(tmp_path):
    skill_dir = write_plugin(
        tmp_path,
        {"name": "wrong-name", "version": "1.0.0", "description": "x"},
        skill_md(),
        name="my-skill",
    )
    result = lint_plugin(skill_dir)
    assert any("name mismatch" in e for e in result["errors"])
    assert main([skill_dir]) == 1


def test_name_matches_dir_but_not_skill_md(tmp_path):
    # plugin.json.name == directory, but SKILL.md name: diverges.
    skill_dir = write_plugin(
        tmp_path,
        {"name": "my-skill", "version": "1.0.0", "description": "x"},
        skill_md(name="different-name"),
        name="my-skill",
    )
    result = lint_plugin(skill_dir)
    assert any("name mismatch" in e for e in result["errors"])
    assert main([skill_dir]) == 1


def test_plugin_json_version_diverges_from_skill_md(tmp_path):
    skill_dir = write_plugin(
        tmp_path,
        {"name": "my-skill", "version": "1.0.0", "description": "x"},
        skill_md(version="1.0.1"),
    )
    result = lint_plugin(skill_dir)
    assert any("version mismatch" in e for e in result["errors"])
    assert main([skill_dir]) == 1


def test_plugin_json_version_diverges_from_package_json(tmp_path):
    # No SKILL.md version present at all (mirrors devlog's real shape).
    skill_dir = write_plugin(
        tmp_path,
        {"name": "my-skill", "version": "1.0.0", "description": "x"},
        skill_md(version=None),
        package_json={"name": "pkg", "version": "9.9.9"},
    )
    result = lint_plugin(skill_dir)
    assert any("version mismatch" in e for e in result["errors"])
    assert main([skill_dir]) == 1


def test_skill_md_and_package_json_diverge_even_though_plugin_json_matches_one(tmp_path):
    # plugin.json matches SKILL.md, but package.json is the odd one out --
    # this is the "mutual equality across the whole set", not pairwise-only,
    # case the design doc explicitly calls out.
    skill_dir = write_plugin(
        tmp_path,
        {"name": "my-skill", "version": "1.0.0", "description": "x"},
        skill_md(version="1.0.0"),
        package_json={"name": "pkg", "version": "2.0.0"},
    )
    result = lint_plugin(skill_dir)
    assert any("version mismatch" in e for e in result["errors"])
    assert "package.json" in result["versions"]
    assert main([skill_dir]) == 1


def test_malformed_plugin_json(tmp_path):
    skill_dir = tmp_path / "my-skill"
    skill_dir.mkdir()
    plugin_dir = skill_dir / ".claude-plugin"
    plugin_dir.mkdir()
    (plugin_dir / "plugin.json").write_text("{not valid json", encoding="utf-8")
    nested_skill_dir = skill_dir / "skills" / "my-skill"
    nested_skill_dir.mkdir(parents=True)
    (nested_skill_dir / "SKILL.md").write_text(skill_md(), encoding="utf-8")

    result = lint_plugin(str(skill_dir))
    assert any("JSON parse error" in e for e in result["errors"])
    assert main([str(skill_dir)]) == 1


@pytest.mark.parametrize("skill", REAL_SKILLS)
def test_real_skills_lint_clean(skill):
    skill_dir = os.path.join(REPO_ROOT, "skills", skill)
    assert os.path.isfile(
        os.path.join(skill_dir, ".claude-plugin", "plugin.json")
    ), f"missing plugin.json for {skill}"
    result = lint_plugin(skill_dir)
    assert result["errors"] == [], f"{skill} failed: {result['errors']}"


@pytest.mark.parametrize("skill", REAL_SKILLS)
def test_real_skills_main_exits_0(skill):
    skill_dir = os.path.join(REPO_ROOT, "skills", skill)
    assert main([skill_dir]) == 0

import json
import os

import pytest

from lint_plugin import lint_plugin, main

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)
REAL_SKILLS = sorted(
    d
    for d in os.listdir(os.path.join(REPO_ROOT, "skills"))
    if os.path.isfile(os.path.join(REPO_ROOT, "skills", d, ".claude-plugin", "plugin.json"))
)

# Anti-vacuity floor. This corpus is a glob over the live repo, so a resolver
# that matched nothing would report "all skills clean" while checking zero of
# them. Raise it by hand as skills are added; never re-derive it from the glob.
MIN_REAL_SKILLS = 13


def write_plugin(tmp_path, plugin_json, skill_md_body, package_json=None, name="my-skill",
                 package_lock_json=None):
    """Write a skill dir with plugin.json (+ nested SKILL.md / package.json).

    Mirrors the real layout: plugin.json stays at <skill_dir>/.claude-plugin/,
    while SKILL.md, package.json and package-lock.json live one level deeper at
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
    if package_lock_json is not None:
        (nested_skill_dir / "package-lock.json").write_text(
            json.dumps(package_lock_json), encoding="utf-8"
        )
    return str(skill_dir)


def lockfile(version, root_version=None, name="my-skill"):
    """A minimal npm lockfile carrying both version fields npm writes."""
    return {
        "name": name,
        "version": version,
        "lockfileVersion": 3,
        "requires": True,
        "packages": {"": {"name": name, "version": version if root_version is None else root_version}},
    }


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


def test_valid_with_lockfile_all_four_equal(tmp_path):
    skill_dir = write_plugin(
        tmp_path,
        {"name": "my-skill", "version": "2.3.4", "description": "x"},
        skill_md(version="2.3.4"),
        package_json={"name": "@scope/my-skill-pkg", "version": "2.3.4"},
        package_lock_json=lockfile("2.3.4"),
    )
    result = lint_plugin(skill_dir)
    assert result["errors"] == []
    assert result["versions"]["package-lock.json"] == "2.3.4"
    assert result["versions"]['package-lock.json:packages[""]'] == "2.3.4"
    assert main([skill_dir]) == 0


def test_lockfile_version_lags_package_json(tmp_path):
    # The real defect: shipflow's lockfile said 0.2.4 against a 0.5.0 package,
    # and nothing caught it because the lockfile was not a checked field.
    skill_dir = write_plugin(
        tmp_path,
        {"name": "my-skill", "version": "0.5.0", "description": "x"},
        skill_md(version="0.5.0"),
        package_json={"name": "pkg", "version": "0.5.0"},
        package_lock_json=lockfile("0.2.4"),
    )
    result = lint_plugin(skill_dir)
    assert any("version mismatch" in e for e in result["errors"])
    assert result["versions"]["package-lock.json"] == "0.2.4"
    assert main([skill_dir]) == 1


def test_lockfile_disagrees_with_itself(tmp_path):
    # npm writes the version in two places. A lockfile whose root and
    # packages[""] entries disagree is malformed even though it agrees with
    # package.json on one of them -- so both are checked as separate fields.
    skill_dir = write_plugin(
        tmp_path,
        {"name": "my-skill", "version": "1.0.0", "description": "x"},
        skill_md(version="1.0.0"),
        package_json={"name": "pkg", "version": "1.0.0"},
        package_lock_json=lockfile("1.0.0", root_version="0.9.0"),
    )
    result = lint_plugin(skill_dir)
    assert any("version mismatch" in e for e in result["errors"])
    assert main([skill_dir]) == 1


def test_no_lockfile_is_not_an_error(tmp_path):
    # A dependency-free skill correctly has no lockfile (eval, pluginsync,
    # press and release are all in this state). Absence must never be a
    # failure, or the gate would demand a meaningless file.
    skill_dir = write_plugin(
        tmp_path,
        {"name": "my-skill", "version": "1.0.0", "description": "x"},
        skill_md(version="1.0.0"),
        package_json={"name": "pkg", "version": "1.0.0"},
    )
    result = lint_plugin(skill_dir)
    assert result["errors"] == []
    assert "package-lock.json" not in result["versions"]
    assert main([skill_dir]) == 0


def test_malformed_lockfile_is_reported(tmp_path):
    skill_dir = write_plugin(
        tmp_path,
        {"name": "my-skill", "version": "1.0.0", "description": "x"},
        skill_md(version="1.0.0"),
        package_json={"name": "pkg", "version": "1.0.0"},
    )
    lock_path = os.path.join(skill_dir, "skills", "my-skill", "package-lock.json")
    with open(lock_path, "w", encoding="utf-8") as fh:
        fh.write("{not valid json")
    result = lint_plugin(skill_dir)
    assert any("JSON parse error" in e for e in result["errors"])
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


def test_real_skill_corpus_is_not_empty():
    assert len(REAL_SKILLS) >= MIN_REAL_SKILLS, (
        f"only {len(REAL_SKILLS)} skills resolved (floor {MIN_REAL_SKILLS}) -- "
        "the corpus glob is matching less than the repo actually ships, so "
        "every corpus assertion above is passing over nothing"
    )


def test_every_real_lockfile_is_actually_checked():
    """At least one shipped skill must have a lockfile, or the new field is dead.

    The lockfile check only fires for skills that HAVE a lockfile. If every
    skill lost one, the corpus above would stay green while the field it was
    added for went entirely unexercised.
    """
    with_lock = [
        s
        for s in REAL_SKILLS
        if os.path.isfile(
            os.path.join(REPO_ROOT, "skills", s, "skills", s, "package-lock.json")
        )
    ]
    assert len(with_lock) >= 5, (
        f"only {len(with_lock)} skills have a package-lock.json -- the lockfile "
        "version field is not being exercised against the real repo"
    )
    for skill in with_lock:
        result = lint_plugin(os.path.join(REPO_ROOT, "skills", skill))
        assert "package-lock.json" in result["versions"], (
            f"{skill} has a lockfile but the linter did not read its version"
        )

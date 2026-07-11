import json
import os

from lint_marketplace import lint_marketplace, main

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)


def build_repo(tmp_path, plugins_entries, skill_dirs):
    """Build a synthetic repo tree: root marketplace.json + N skill dirs.

    ``skill_dirs`` is a list of (dir_name, plugin_json_name) pairs -- each
    becomes ``skills/<dir_name>/.claude-plugin/plugin.json`` with
    ``{"name": plugin_json_name}``.
    """
    root = tmp_path / "repo"
    root.mkdir()
    (root / ".claude-plugin").mkdir()
    (root / ".claude-plugin" / "marketplace.json").write_text(
        json.dumps({"name": "test-marketplace", "owner": {"name": "x"}, "plugins": plugins_entries}),
        encoding="utf-8",
    )
    skills_dir = root / "skills"
    skills_dir.mkdir()
    for dir_name, plugin_name in skill_dirs:
        skill_dir = skills_dir / dir_name
        skill_dir.mkdir()
        plugin_dir = skill_dir / ".claude-plugin"
        plugin_dir.mkdir()
        (plugin_dir / "plugin.json").write_text(
            json.dumps({"name": plugin_name, "version": "1.0.0", "description": "x"}),
            encoding="utf-8",
        )
    return str(root)


def test_valid_repo_clean(tmp_path):
    root = build_repo(
        tmp_path,
        [
            {"name": "alpha", "source": "./skills/alpha"},
            {"name": "beta", "source": "./skills/beta"},
        ],
        [("alpha", "alpha"), ("beta", "beta")],
    )
    result = lint_marketplace(root)
    assert result["errors"] == []
    assert main(["--repo-root", root]) == 0


def test_malformed_marketplace_json(tmp_path):
    root = tmp_path / "repo"
    root.mkdir()
    (root / ".claude-plugin").mkdir()
    (root / ".claude-plugin" / "marketplace.json").write_text("{not valid", encoding="utf-8")
    result = lint_marketplace(str(root))
    assert any("JSON parse error" in e for e in result["errors"])
    assert main(["--repo-root", str(root)]) == 1


def test_source_does_not_resolve(tmp_path):
    root = build_repo(
        tmp_path,
        [{"name": "alpha", "source": "./skills/does-not-exist"}],
        [],
    )
    result = lint_marketplace(root)
    assert any("does not resolve" in e for e in result["errors"])
    assert main(["--repo-root", root]) == 1


def test_source_resolves_but_has_no_plugin_json(tmp_path):
    root = build_repo(tmp_path, [{"name": "alpha", "source": "./skills/alpha"}], [])
    os.makedirs(os.path.join(root, "skills", "alpha"))
    result = lint_marketplace(root)
    assert any("does not resolve" in e for e in result["errors"])
    assert main(["--repo-root", root]) == 1


def test_orphan_directory_no_marketplace_entry(tmp_path):
    # alpha has a plugin.json but no marketplace entry at all.
    root = build_repo(tmp_path, [], [("alpha", "alpha")])
    result = lint_marketplace(root)
    assert any("bidirectional membership mismatch" in e for e in result["errors"])
    assert any("no marketplace entry" in e for e in result["errors"])
    assert main(["--repo-root", root]) == 1


def test_orphan_entry_no_backing_directory(tmp_path):
    root = build_repo(tmp_path, [{"name": "ghost", "source": "./skills/ghost"}], [])
    result = lint_marketplace(root)
    assert main(["--repo-root", root]) == 1


def test_cross_wired_manifest_caught_by_per_row_tie(tmp_path):
    """The canonical regression test (design doc S-1).

    Two entries with SWAPPED name/source: entry "resume" points at
    ./skills/devlog, entry "devlog" points at ./skills/resume. Both
    directories independently have valid plugin.json files, so the
    AGGREGATE bidirectional membership check (name-set == dir-set) PASSES --
    but the per-row three-way tie MUST fail, because entry "resume"'s source
    directory basename is "devlog", not "resume".
    """
    root = build_repo(
        tmp_path,
        [
            {"name": "resume", "source": "./skills/devlog"},
            {"name": "devlog", "source": "./skills/resume"},
        ],
        [("devlog", "devlog"), ("resume", "resume")],
    )
    result = lint_marketplace(root)
    assert result["errors"] != [], "cross-wired manifest must NOT pass"
    assert any("per-row name mismatch" in e for e in result["errors"])
    assert main(["--repo-root", root]) == 1


def test_duplicate_names_caught_even_with_valid_individual_sources(tmp_path):
    root = build_repo(
        tmp_path,
        [
            {"name": "alpha", "source": "./skills/alpha"},
            {"name": "alpha", "source": "./skills/alpha-2"},
        ],
        [("alpha", "alpha"), ("alpha-2", "alpha")],
    )
    result = lint_marketplace(root)
    assert any("duplicate plugins[].name" in e for e in result["errors"])
    assert main(["--repo-root", root]) == 1


def test_real_repo_clean():
    result = lint_marketplace(REPO_ROOT)
    assert result["errors"] == [], f"real repo failed: {result['errors']}"


def test_real_repo_main_exits_0():
    assert main(["--repo-root", REPO_ROOT]) == 0

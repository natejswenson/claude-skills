"""Tests for tools/lint_baseline.py.

This lint is the backstop that stops a skill shipping without a baseline eval
set, so it needs the same two-sided treatment it demands of the baselines
themselves: it must accept the real repo AND reject each specific way a
declaration can rot. A lint that only ever returns 0 is the exact failure it
exists to prevent.
"""

import json
import os

import pytest

from lint_baseline import discover_skills, lint_skill, main

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def make_skill(tmp_path, *, baseline, prose=None, name="my-skill", files=()):
    """Write a minimal skill tree and return its nested skill root."""
    root = tmp_path / "skills" / name / "skills" / name
    root.mkdir(parents=True)
    manifest = {
        "prose": prose if prose is not None else [{"id": "x", "pattern": "y", "rationale": "z"}],
    }
    if baseline is not None:
        manifest["baseline"] = baseline
    (root / "skill-invariants.json").write_text(json.dumps(manifest), encoding="utf-8")
    for rel in files:
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("# fixture\n", encoding="utf-8")
    return root


VALID = {
    "id": "b1",
    "kind": "golden",
    "test": "tests/test_baseline.py",
    "rationale": "because",
}


# --------------------------------------------------------------- the real repo


def test_the_real_repo_passes():
    """The lint must accept the repo as it actually stands."""
    problems = []
    for skill_root, name in discover_skills(REPO_ROOT):
        problems.extend(lint_skill(skill_root, name))
    assert problems == [], "\n".join(problems)


def test_every_skill_is_discovered():
    """Guards the discovery glob itself. If it silently matched nothing, the
    lint would report OK over an empty set — the vacuous pass this whole tool
    exists to prevent."""
    names = [name for _, name in discover_skills(REPO_ROOT)]
    assert len(names) >= 7, f"expected >= 7 skills, discovered {names}"
    for expected in ("city-report", "devlog", "ghostwriter", "resume", "shipflow"):
        assert expected in names


def test_main_returns_zero_on_the_real_repo(capsys):
    assert main(["lint_baseline.py", REPO_ROOT]) == 0
    assert "OK" in capsys.readouterr().out


# ------------------------------------------------------------ rejection cases


def test_missing_manifest_is_rejected(tmp_path):
    root = tmp_path / "skills" / "s" / "skills" / "s"
    root.mkdir(parents=True)
    problems = lint_skill(str(root), "s")
    assert len(problems) == 1
    assert "missing skill-invariants.json" in problems[0]


def test_unparseable_manifest_is_rejected(tmp_path):
    root = tmp_path / "skills" / "s" / "skills" / "s"
    root.mkdir(parents=True)
    (root / "skill-invariants.json").write_text("{not json", encoding="utf-8")
    problems = lint_skill(str(root), "s")
    assert len(problems) == 1
    assert "invalid JSON" in problems[0]


def test_missing_baseline_array_is_rejected(tmp_path):
    root = make_skill(tmp_path, baseline=None)
    problems = lint_skill(str(root), "my-skill")
    assert any("no non-empty 'baseline'" in p for p in problems)


def test_empty_prose_array_is_rejected(tmp_path):
    root = make_skill(tmp_path, baseline=[VALID], prose=[], files=["tests/test_baseline.py"])
    problems = lint_skill(str(root), "my-skill")
    assert any("no non-empty 'prose'" in p for p in problems)


@pytest.mark.parametrize("key", ["id", "kind", "test", "rationale"])
def test_entry_missing_a_required_key_is_rejected(tmp_path, key):
    entry = {k: v for k, v in VALID.items() if k != key}
    root = make_skill(tmp_path, baseline=[entry], files=["tests/test_baseline.py"])
    problems = lint_skill(str(root), "my-skill")
    assert any(f"missing required key(s): {key}" in p for p in problems)


def test_duplicate_ids_are_rejected(tmp_path):
    root = make_skill(tmp_path, baseline=[VALID, dict(VALID)], files=["tests/test_baseline.py"])
    problems = lint_skill(str(root), "my-skill")
    assert any("duplicate id" in p for p in problems)


def test_nonexistent_test_file_is_rejected(tmp_path):
    root = make_skill(tmp_path, baseline=[VALID])  # no files written
    problems = lint_skill(str(root), "my-skill")
    assert any("names a test that does not exist" in p for p in problems)


def test_test_outside_the_runner_path_is_rejected(tmp_path):
    """The subtle one: the file EXISTS, so a naive existence check passes — but
    no runner scans evals/, so the baseline would never actually execute."""
    entry = {**VALID, "test": "evals/baseline/check.py"}
    root = make_skill(tmp_path, baseline=[entry], files=["evals/baseline/check.py"])
    problems = lint_skill(str(root), "my-skill")
    assert any("no test runner in this repo discovers" in p for p in problems)


@pytest.mark.parametrize(
    "rel", ["tests/test_baseline.py", "tests/baseline.test.mjs", "scripts/baseline.test.mjs"]
)
def test_each_real_runner_layout_is_accepted(tmp_path, rel):
    """The three layouts actually used in this repo must all pass, or the check
    would force skills to move working tests."""
    root = make_skill(tmp_path, baseline=[{**VALID, "test": rel}], files=[rel])
    assert lint_skill(str(root), "my-skill") == []


def test_missing_fixture_is_rejected(tmp_path):
    entry = {**VALID, "fixtures": ["evals/baseline/gone.json"]}
    root = make_skill(tmp_path, baseline=[entry], files=["tests/test_baseline.py"])
    problems = lint_skill(str(root), "my-skill")
    assert any("declares a fixture that does not exist" in p for p in problems)


def test_corpus_kind_without_a_glob_is_rejected(tmp_path):
    entry = {**VALID, "kind": "corpus"}
    root = make_skill(tmp_path, baseline=[entry], files=["tests/test_baseline.py"])
    problems = lint_skill(str(root), "my-skill")
    assert any("declares no corpus_glob" in p for p in problems)


def test_corpus_glob_without_min_corpus_is_rejected(tmp_path):
    entry = {**VALID, "kind": "corpus", "corpus_glob": "drafts/*.md"}
    root = make_skill(
        tmp_path, baseline=[entry], files=["tests/test_baseline.py", "drafts/a.md"]
    )
    problems = lint_skill(str(root), "my-skill")
    assert any("no positive integer min_corpus" in p for p in problems)


def test_corpus_glob_matching_too_few_files_is_rejected(tmp_path):
    """The anti-vacuity rule itself: a glob that matches nothing must fail."""
    entry = {**VALID, "kind": "corpus", "corpus_glob": "drafts/*.md", "min_corpus": 3}
    root = make_skill(
        tmp_path, baseline=[entry], files=["tests/test_baseline.py", "drafts/a.md"]
    )
    problems = lint_skill(str(root), "my-skill")
    assert any("below its declared min_corpus of 3" in p for p in problems)


def test_corpus_glob_respects_declared_exclusions(tmp_path):
    """Excluded files must not be counted toward the floor — otherwise a corpus
    of nothing but excluded files would satisfy min_corpus."""
    entry = {
        **VALID,
        "kind": "corpus",
        "corpus_glob": "drafts/*.md",
        "exclude_suffixes": [".STAGED.md"],
        "min_corpus": 2,
    }
    root = make_skill(
        tmp_path,
        baseline=[entry],
        files=["tests/test_baseline.py", "drafts/a.md", "drafts/b.STAGED.md"],
    )
    problems = lint_skill(str(root), "my-skill")
    assert any("matches 1 file(s)" in p for p in problems)


def test_main_returns_one_when_a_skill_is_broken(tmp_path, capsys):
    make_skill(tmp_path, baseline=None, name="broken")
    assert main(["lint_baseline.py", str(tmp_path)]) == 1
    assert "problem(s)" in capsys.readouterr().out


def test_main_returns_one_when_no_skills_are_found(tmp_path, capsys):
    (tmp_path / "skills").mkdir()
    assert main(["lint_baseline.py", str(tmp_path)]) == 1
    assert "no skills found" in capsys.readouterr().err

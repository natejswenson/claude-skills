"""Tests for scripts/score_skill.py — full branch coverage."""
from __future__ import annotations

import pytest

import score_skill as ss

GOOD_SKILL = """---
name: linkedin-ghostwriter
version: 0.0.1
description: A sufficiently long and meaningful description of the skill behavior.
---

## Mode: Setup
## Mode: Generate
## Mode: Publish

Never publish without explicit approval of the specific text.
Compliance: never automate posting.
Read voice/voice-profile.md and voice/voice-notes.md before drafting.
"""


def write(path, text):
    path.write_text(text, encoding="utf-8")
    return path


def test_split_frontmatter_no_frontmatter():
    front, body = ss.split_frontmatter("# just a heading\nbody")
    assert front == {}
    assert body == "# just a heading\nbody"


def test_split_frontmatter_incomplete_block():
    front, body = ss.split_frontmatter("---\nname: x\nno closing fence")
    assert front == {}


def test_split_frontmatter_parses_keys_and_skips_comments():
    front, _ = ss.split_frontmatter("---\n# a comment\nname: foo\nversion: 1\n---\nbody")
    assert front == {"name": "foo", "version": "1"}


def test_build_checks_all_pass_on_good_skill():
    front, body = ss.split_frontmatter(GOOD_SKILL)
    checks = ss.build_checks(front, body)
    assert all(ok for _, ok in checks)


def test_score_real_skill_passes(capsys):
    code = ss.score(ss.DEFAULT_SKILL)
    out = capsys.readouterr().out
    assert code == 0
    assert "PASSED" in out
    assert "100%" in out


def test_score_missing_file_exits(tmp_path):
    with pytest.raises(SystemExit) as e:
        ss.score(tmp_path / "nope.md")
    assert "not found" in str(e.value)


def test_score_good_temp_file_passes(tmp_path, capsys):
    path = write(tmp_path / "SKILL.md", GOOD_SKILL)
    assert ss.score(path) == 0
    assert "8/8" in capsys.readouterr().out


def test_score_bad_file_fails(tmp_path, capsys):
    # Missing frontmatter, modes, guardrails — every check should fail.
    path = write(tmp_path / "SKILL.md", "# nothing useful here\n")
    code = ss.score(path)
    err = capsys.readouterr()
    assert code == 1
    assert "FAILED" in err.err
    assert "0/8" in err.out


def test_description_too_long_fails(tmp_path):
    skill = GOOD_SKILL.replace(
        "A sufficiently long and meaningful description of the skill behavior.",
        "x" * (ss.MAX_DESCRIPTION_CHARS + 1),
    )
    front, body = ss.split_frontmatter(skill)
    checks = dict(ss.build_checks(front, body))
    key = f"description is non-trivial and <= {ss.MAX_DESCRIPTION_CHARS} chars"
    assert checks[key] is False


def test_main_invokes_score(monkeypatch, capsys):
    monkeypatch.setattr("sys.argv", ["score_skill.py"])
    with pytest.raises(SystemExit) as e:
        ss.main()
    assert e.value.code == 0
    assert "PASSED" in capsys.readouterr().out

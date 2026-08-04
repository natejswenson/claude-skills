"""release_facts.py — the evidence a brochure is allowed to claim.

A brochure is marketing, so the failure that matters is advertising something
that is not true: a version nobody can install, a rule the skill does not
actually enforce, an install line that does not work. Every test here is about
one of those.
"""
from __future__ import annotations

import json

import pytest

import release_facts as rf


# ── helpers ─────────────────────────────────────────────────────────────────

def _skill(tmp_path, name="demo", skill_md=None, changelog=None):
    d = tmp_path / "skills" / name / "skills" / name
    d.mkdir(parents=True)
    if skill_md is not None:
        (d / "SKILL.md").write_text(skill_md, encoding="utf-8")
    if changelog is not None:
        (tmp_path / "skills" / name / "CHANGELOG.md").write_text(changelog, encoding="utf-8")
    return d


RELEASES = [
    {"tagName": "demo-v0.9.0", "publishedAt": "2026-01-01T00:00:00Z", "isDraft": False, "isPrerelease": False},
    {"tagName": "demo-v0.10.0", "publishedAt": "2026-02-01T00:00:00Z", "isDraft": False, "isPrerelease": False},
    {"tagName": "demo-v1.0.0", "publishedAt": "2026-03-01T00:00:00Z", "isDraft": True, "isPrerelease": False},
    {"tagName": "demo-v0.11.0", "publishedAt": "2026-04-01T00:00:00Z", "isDraft": False, "isPrerelease": True},
    {"tagName": "other-v9.9.9", "publishedAt": "2026-05-01T00:00:00Z", "isDraft": False, "isPrerelease": False},
]


# ── _run ────────────────────────────────────────────────────────────────────

def test_run_returns_stdout_on_success():
    assert rf._run(["echo", "hi"]) == "hi"


def test_run_returns_none_on_failure_and_on_missing_binary():
    assert rf._run(["false"]) is None
    assert rf._run(["definitely-not-a-real-binary-xyz"]) is None


# ── repo_slug ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize("url,want", [
    ("https://github.com/o/r.git", "o/r"),
    ("https://github.com/o/r", "o/r"),
    ("git@github.com:o/r.git", "o/r"),
    ("https://gitlab.com/o/r.git", None),
])
def test_repo_slug_reads_both_remote_forms(monkeypatch, tmp_path, url, want):
    monkeypatch.setattr(rf, "_run", lambda a: url)
    assert rf.repo_slug(tmp_path) == want


def test_repo_slug_none_without_a_remote(monkeypatch, tmp_path):
    monkeypatch.setattr(rf, "_run", lambda a: None)
    assert rf.repo_slug(tmp_path) is None


# ── latest_release ──────────────────────────────────────────────────────────

def test_latest_release_ignores_other_skills_drafts_and_prereleases(monkeypatch):
    # In a monorepo every skill's tags share one release list, so a repo-wide
    # "latest" would advertise another skill's version under this skill's name.
    monkeypatch.setattr(rf, "_run", lambda a: json.dumps(RELEASES))
    rel = rf.latest_release("o/r", "demo")
    assert rel["tagName"] == "demo-v0.10.0"


def test_latest_release_orders_by_semver_not_by_string(monkeypatch):
    # 0.10.0 > 0.9.0 numerically and < it as a string.
    monkeypatch.setattr(rf, "_run", lambda a: json.dumps(RELEASES))
    assert rf.latest_release("o/r", "demo")["tagName"].endswith("0.10.0")


def test_latest_release_handles_a_short_version(monkeypatch):
    monkeypatch.setattr(rf, "_run", lambda a: json.dumps(
        [{"tagName": "demo-v2", "publishedAt": "", "isDraft": False, "isPrerelease": False}]))
    assert rf.latest_release("o/r", "demo")["tagName"] == "demo-v2"


@pytest.mark.parametrize("out", [None, "{not json", json.dumps([])])
def test_latest_release_none_when_nothing_usable(monkeypatch, out):
    monkeypatch.setattr(rf, "_run", lambda a: out)
    assert rf.latest_release("o/r", "demo") is None


# ── SKILL.md readers ────────────────────────────────────────────────────────

def test_frontmatter_description_is_unwrapped(tmp_path):
    p = tmp_path / "SKILL.md"
    p.write_text("---\nname: demo\ndescription: One line\n  wrapped over two.\nversion: 1.0.0\n---\n# x\n")
    assert rf.frontmatter_description(p) == "One line wrapped over two."


def test_frontmatter_description_missing_cases(tmp_path):
    assert rf.frontmatter_description(tmp_path / "nope.md") is None
    p = tmp_path / "a.md"; p.write_text("# no frontmatter\n")
    assert rf.frontmatter_description(p) is None
    q = tmp_path / "b.md"; q.write_text("---\nname: demo\n---\n")
    assert rf.frontmatter_description(q) is None


def test_one_rule_reads_the_bolded_line(tmp_path):
    p = tmp_path / "SKILL.md"
    p.write_text("# x\n\n## The one rule\n\n**Never ship\na claim it cannot back.**\n\n## Next\n")
    assert rf.one_rule(p) == "Never ship a claim it cannot back."


def test_one_rule_missing_cases(tmp_path):
    assert rf.one_rule(tmp_path / "nope.md") is None
    p = tmp_path / "a.md"; p.write_text("# x\n\n## Something else\n")
    assert rf.one_rule(p) is None
    q = tmp_path / "b.md"; q.write_text("# x\n\n## The one rule\n\nnot bolded at all\n")
    assert rf.one_rule(q) is None


# ── CHANGELOG ───────────────────────────────────────────────────────────────

CHANGELOG = """# Changelog

## [0.2.0] - 2026-02-01

### Added

- **A wrapped bullet.** Its second line continues
  here and must be folded in before markup is stripped.
- A `coded` bullet.

## [0.1.0] - 2026-01-01

- Older entry that must not leak into 0.2.0.
"""


def test_changelog_bullets_folds_wrapped_lines_and_strips_markup(tmp_path):
    _skill(tmp_path, changelog=CHANGELOG, skill_md="")
    got = rf.changelog_bullets(tmp_path, "demo", "0.2.0")
    assert got == [
        "A wrapped bullet. Its second line continues here and must be folded in "
        "before markup is stripped.",
        "A coded bullet.",
    ]
    assert not any("Older entry" in b for b in got), "a neighbouring version leaked in"


def test_changelog_bullets_empty_when_absent(tmp_path):
    assert rf.changelog_bullets(tmp_path, "demo", "0.2.0") == []
    _skill(tmp_path, changelog=CHANGELOG, skill_md="")
    assert rf.changelog_bullets(tmp_path, "demo", "9.9.9") == []


# ── table ───────────────────────────────────────────────────────────────────

def test_table_renders_and_is_empty_for_no_rows():
    assert rf.table(["A"], []) == ""
    out = rf.table(["A", "B"], [["x", "yy"]])
    assert out.splitlines()[0].startswith("| A")


# ── main ────────────────────────────────────────────────────────────────────

SKILL_MD = """---
name: demo
description: Does a thing.
version: 0.10.0
---

## The one rule

**Never ship a claim it cannot back.**
"""


def _wire(monkeypatch, slug="o/r", releases=RELEASES):
    monkeypatch.setattr(rf, "repo_slug", lambda repo: slug)
    monkeypatch.setattr(rf, "_run", lambda a: json.dumps(releases) if releases is not None else None)


def test_main_writes_the_facts_a_brochure_may_use(monkeypatch, tmp_path, capsys):
    _skill(tmp_path, skill_md=SKILL_MD, changelog=CHANGELOG)
    _wire(monkeypatch)
    out = tmp_path / "nested" / "facts.json"
    rc = rf.main([str("demo"), "--repo", str(tmp_path), "--json", str(out)])
    assert rc == 0

    facts = json.loads(out.read_text())
    assert facts["version"] == "0.10.0"
    assert facts["tag"] == "demo-v0.10.0"
    assert facts["published"] == "2026-02-01"
    assert facts["install"] == "/plugin install demo@claude-skills"
    assert facts["releaseUrl"].endswith("/releases/tag/demo-v0.10.0")
    assert facts["oneRule"] == "Never ship a claim it cannot back."
    assert len(facts["changelogBullets"]) == 0  # 0.10.0 has no entry in this fixture

    printed = capsys.readouterr().out
    assert "demo-v0.10.0" in printed and "/plugin install demo@claude-skills" in printed


def test_main_reports_a_missing_one_rule_rather_than_inventing_one(monkeypatch, tmp_path, capsys):
    _skill(tmp_path, skill_md="---\nname: demo\n---\n# no rule here\n")
    _wire(monkeypatch)
    assert rf.main(["demo", "--repo", str(tmp_path)]) == 0
    assert "none declared" in capsys.readouterr().out


def test_main_refuses_an_unreleased_skill(monkeypatch, tmp_path, capsys):
    # A brochure for something nobody can install is the one failure this card
    # cannot survive, so it stops here rather than rendering an empty version.
    _skill(tmp_path, skill_md=SKILL_MD)
    _wire(monkeypatch, releases=[])
    assert rf.main(["demo", "--repo", str(tmp_path)]) == 1
    assert "no published release" in capsys.readouterr().err


def test_main_refuses_an_unknown_skill(tmp_path, capsys):
    assert rf.main(["ghost", "--repo", str(tmp_path)]) == 1
    assert "no skill at" in capsys.readouterr().err


def test_main_refuses_without_a_github_remote(monkeypatch, tmp_path, capsys):
    _skill(tmp_path, skill_md=SKILL_MD)
    monkeypatch.setattr(rf, "repo_slug", lambda repo: None)
    assert rf.main(["demo", "--repo", str(tmp_path)]) == 1
    assert "no github remote" in capsys.readouterr().err


def test_main_prints_changelog_raw_material(monkeypatch, tmp_path, capsys):
    _skill(tmp_path, skill_md=SKILL_MD, changelog=CHANGELOG.replace("0.2.0", "0.10.0"))
    _wire(monkeypatch)
    assert rf.main(["demo", "--repo", str(tmp_path)]) == 0
    printed = capsys.readouterr().out
    assert "Raw material" in printed and "rewrite, never paste" in printed


def test_module_entrypoint_is_wired(monkeypatch, tmp_path):
    _skill(tmp_path, skill_md=SKILL_MD)
    _wire(monkeypatch)
    monkeypatch.setattr("sys.argv", ["release_facts.py", "demo", "--repo", str(tmp_path)])
    assert rf.main() == 0


def test_install_is_two_steps_because_one_does_not_work(monkeypatch, tmp_path, capsys):
    # `/plugin install` does nothing until the marketplace has been added, so a
    # card showing only the second line advertises a command that does not work.
    # That is the exact failure this module exists to prevent, and it shipped
    # once before the steps were split.
    _skill(tmp_path, skill_md=SKILL_MD)
    _wire(monkeypatch)
    out = tmp_path / "facts.json"
    assert rf.main(["demo", "--repo", str(tmp_path), "--json", str(out)]) == 0

    facts = json.loads(out.read_text())
    assert facts["installSteps"] == [
        "/plugin marketplace add o/r",
        "/plugin install demo@claude-skills",
    ]
    assert facts["installSteps"][0] == facts["marketplace"]
    assert facts["installSteps"][1] == facts["install"]

    printed = capsys.readouterr().out
    assert "install step 1" in printed and "install step 2" in printed


def test_scaffold_fills_every_factual_slot_and_marks_the_rest(monkeypatch, tmp_path):
    # Repeatability: a card assembled by hand is a card whose version, date and
    # install steps depend on whoever assembled it.
    _skill(tmp_path, skill_md=SKILL_MD)
    _wire(monkeypatch)
    out = tmp_path / "card.html"
    assert rf.main(["demo", "--repo", str(tmp_path), "--scaffold", str(out)]) == 0
    html = out.read_text()

    for fact in ["v0.10.0", "2026-02-01",
                 "/plugin marketplace add o/r", "/plugin install demo@claude-skills",
                 "Never ship a claim it cannot back."]:
        assert fact in html, f"scaffold left {fact!r} unfilled"

    # judgment slots stay obviously unfinished
    assert "TODO headline" in html
    assert 'id="plate-example"' in html, "the example plate must survive for the author to replace"
    for placeholder in ["v0.0.0", "2026-01-01", "the --actual first command"]:
        assert placeholder not in html, f"{placeholder!r} survived substitution"


def test_scaffold_shortens_a_rule_too_long_to_be_a_pull_quote(tmp_path, monkeypatch):
    long_rule = ("Every claim carries a receipt that resolves against the local corpus — "
                 "and a ranked item whose receipt does not resolve is dropped entirely")
    _skill(tmp_path, skill_md=f"---\nname: demo\n---\n\n## The one rule\n\n**{long_rule}**\n")
    _wire(monkeypatch)
    out = tmp_path / "card.html"
    assert rf.main(["demo", "--repo", str(tmp_path), "--scaffold", str(out)]) == 0
    html = out.read_text()
    assert "Every claim carries a receipt that resolves against the local corpus." in html
    assert "ranked item" not in html, "the trailing clause should have been cut"

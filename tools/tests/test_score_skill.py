import os
import textwrap

import pytest

from score_skill import main, parse_frontmatter, score_skill

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)
REAL_SKILLS = ["devlog", "resume", "ghostwriter", "github-stats"]


def write_skill(tmp_path, body, name="my-skill"):
    """Write a SKILL.md under a directory named ``name`` and return that dir."""
    skill_dir = tmp_path / name
    skill_dir.mkdir()
    (skill_dir / "SKILL.md").write_text(body, encoding="utf-8")
    return str(skill_dir)


VALID = textwrap.dedent(
    """\
    ---
    name: my-skill
    description: A perfectly valid skill description that is well over twenty characters long.
    ---

    # My Skill

    ## Usage

    Do the thing.
    """
)


def test_valid_scores_100_and_main_exits_0(tmp_path):
    skill_dir = write_skill(tmp_path, VALID)
    result = score_skill(skill_dir)
    assert result["score"] == 100
    assert result["failed"] == []
    assert main([skill_dir]) == 0
    assert main([skill_dir, "--min", "100"]) == 0


def test_no_frontmatter_fails_check1(tmp_path):
    body = "# My Skill\n\n## Usage\n\nNo frontmatter here.\n"
    skill_dir = write_skill(tmp_path, body)
    result = score_skill(skill_dir)
    assert "has_frontmatter" in result["failed"]
    assert result["score"] < 100
    assert main([skill_dir]) == 1


def test_no_frontmatter_degrades_gracefully(tmp_path):
    # Should not raise; just fail relevant checks.
    body = "no fences at all, just text\n"
    skill_dir = write_skill(tmp_path, body)
    result = score_skill(skill_dir)
    assert result["score"] < 100
    # parse_frontmatter on arbitrary text returns {} with no exception.
    assert parse_frontmatter(body) == {}


def test_missing_name_drops_below_100(tmp_path):
    body = textwrap.dedent(
        """\
        ---
        description: A valid description that is comfortably longer than twenty characters.
        ---

        ## Usage
        Body.
        """
    )
    skill_dir = write_skill(tmp_path, body)
    result = score_skill(skill_dir)
    assert "name_present" in result["failed"]
    assert result["score"] < 100
    assert main([skill_dir]) == 1


def test_missing_description_drops_below_100(tmp_path):
    body = textwrap.dedent(
        """\
        ---
        name: my-skill
        ---

        ## Usage
        Body.
        """
    )
    skill_dir = write_skill(tmp_path, body)
    result = score_skill(skill_dir)
    assert "description_present" in result["failed"]
    assert "description_length" in result["failed"]
    assert result["score"] < 100
    assert main([skill_dir]) == 1


def test_description_too_short_drops_below_100(tmp_path):
    body = textwrap.dedent(
        """\
        ---
        name: my-skill
        description: too short
        ---

        ## Usage
        Body.
        """
    )
    skill_dir = write_skill(tmp_path, body)
    result = score_skill(skill_dir)
    assert "description_length" in result["failed"]
    assert result["score"] < 100
    assert main([skill_dir]) == 1


def test_description_too_long_drops_below_100(tmp_path):
    long_desc = "x" * 1025
    body = f"---\nname: my-skill\ndescription: {long_desc}\n---\n\n## Usage\nBody.\n"
    skill_dir = write_skill(tmp_path, body)
    result = score_skill(skill_dir)
    assert "description_length" in result["failed"]
    assert result["score"] < 100
    assert main([skill_dir]) == 1


def test_description_boundaries_inclusive(tmp_path):
    # Exactly 20 and exactly 1024 are valid.
    desc20 = "x" * 20
    body = f"---\nname: my-skill\ndescription: {desc20}\n---\n\n## H\nBody.\n"
    skill_dir = write_skill(tmp_path, body, name="s20")
    assert score_skill(skill_dir)["score"] == 100

    desc1024 = "y" * 1024
    body = f"---\nname: my-skill\ndescription: {desc1024}\n---\n\n## H\nBody.\n"
    skill_dir = write_skill(tmp_path, body, name="s1024")
    assert score_skill(skill_dir)["score"] == 100


def test_no_h2_heading_drops_below_100(tmp_path):
    body = textwrap.dedent(
        """\
        ---
        name: my-skill
        description: A valid description that is comfortably longer than twenty characters.
        ---

        # Title only, no H2

        Just a paragraph.
        """
    )
    skill_dir = write_skill(tmp_path, body)
    result = score_skill(skill_dir)
    assert "has_h2_heading" in result["failed"]
    assert result["score"] < 100
    assert main([skill_dir]) == 1


def test_h2_inside_code_fence_not_counted(tmp_path):
    body = textwrap.dedent(
        """\
        ---
        name: my-skill
        description: A valid description that is comfortably longer than twenty characters.
        ---

        # Title

        ```markdown
        ## This is inside a code block, not a real heading
        ```

        Just prose, no real H2.
        """
    )
    skill_dir = write_skill(tmp_path, body)
    result = score_skill(skill_dir)
    assert "has_h2_heading" in result["failed"]
    assert result["score"] < 100


def test_frontmatter_only_parsing_ignores_body_version_and_fences(tmp_path):
    # Mirrors the real devlog SKILL.md: no version in frontmatter, but the body
    # contains a fenced code block with version: and --- lines.
    body = textwrap.dedent(
        """\
        ---
        name: devlog
        description: Generate a dev log entry for each new version release from git tags.
        ---

        # /devlog

        ## Configuration

        ```json
        {
          "version": "9.9.9"
        }
        ```

        ```yaml
        ---
        version: 1.2.3
        name: not-the-real-name
        ---
        ```
        """
    )
    fm = parse_frontmatter(body)
    assert fm == {
        "name": "devlog",
        "description": "Generate a dev log entry for each new version release from git tags.",
    }
    assert "version" not in fm
    # And the body version/name in the fence never override real frontmatter.
    assert fm["name"] == "devlog"


def test_parse_frontmatter_strips_quotes():
    text = '---\nname: "quoted-name"\ndescription: \'single quoted\'\n---\nbody\n'
    fm = parse_frontmatter(text)
    assert fm["name"] == "quoted-name"
    assert fm["description"] == "single quoted"


def test_parse_frontmatter_no_opening_fence_returns_empty():
    assert parse_frontmatter("# heading\nnot frontmatter\n") == {}


def test_parse_frontmatter_unterminated_fence_returns_empty():
    # Opening --- but no closing fence.
    assert parse_frontmatter("---\nname: x\nno close\n") == {}


def test_soft_check_name_matches_dir(tmp_path):
    skill_dir = write_skill(tmp_path, VALID, name="my-skill")
    result = score_skill(skill_dir)
    assert result["soft"]["name_matches_dir"] is True


def test_soft_check_name_mismatch_is_advisory_not_scored(tmp_path):
    # name (my-skill) != dir basename (other-dir). Score still 100.
    skill_dir = write_skill(tmp_path, VALID, name="other-dir")
    result = score_skill(skill_dir)
    assert result["soft"]["name_matches_dir"] is False
    assert result["score"] == 100
    assert main([skill_dir]) == 0


@pytest.mark.parametrize("skill", REAL_SKILLS)
def test_real_skills_score_100(skill):
    # SKILL.md lives one level deeper than the plugin root -- Claude Code's
    # plugin auto-discovery path (skills/<skill>/skills/<skill>/SKILL.md).
    skill_dir = os.path.join(REPO_ROOT, "skills", skill, "skills", skill)
    assert os.path.isfile(
        os.path.join(skill_dir, "SKILL.md")
    ), f"missing SKILL.md for {skill}"
    result = score_skill(skill_dir)
    assert result["score"] == 100, f"{skill} failed: {result['failed']}"


@pytest.mark.parametrize("skill", REAL_SKILLS)
def test_real_skills_main_exits_0(skill):
    skill_dir = os.path.join(REPO_ROOT, "skills", skill, "skills", skill)
    assert main([skill_dir]) == 0
    assert main([skill_dir, "--min", "100"]) == 0

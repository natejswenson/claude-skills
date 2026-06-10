"""Tests for scripts/gh-stats.sh.

The interesting logic in the skill is the aggregation/estimation math in the
`compute_*` subcommands. Those are pure functions (JSON in -> JSON out, no
network), so we drive the real script as a subprocess against fixture JSON and
assert the output. A single live smoke test exercises the gh path and is
skipped automatically when gh auth is unavailable (e.g. in CI).
"""

import json
import shutil
import subprocess
from pathlib import Path

import pytest

SKILL_DIR = Path(__file__).resolve().parent.parent
SCRIPT = SKILL_DIR / "scripts" / "gh-stats.sh"
FIXTURES = Path(__file__).resolve().parent / "fixtures"


def run(args, stdin=None):
    """Run gh-stats.sh and return parsed JSON stdout."""
    proc = subprocess.run(
        ["bash", str(SCRIPT), *args],
        input=stdin,
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0, f"exit {proc.returncode}: {proc.stderr}"
    return json.loads(proc.stdout)


def fixture(name):
    return (FIXTURES / name).read_text()


# --------------------------------------------------------------------------
# compute_stars
# --------------------------------------------------------------------------

def test_stars_sums_and_finds_top():
    out = run(["compute_stars"], stdin=fixture("repos.json"))
    assert out["total"] == 13837 + 2700 + 700 + 0
    assert out["top_repo"] == "Spoon-Knife"
    assert out["top_count"] == 13837


def test_stars_empty_is_zero_and_null_top():
    out = run(["compute_stars"], stdin="[]")
    assert out == {"total": 0, "top_repo": None, "top_count": 0}


# --------------------------------------------------------------------------
# compute_commits
# --------------------------------------------------------------------------

def test_commits_sums_and_finds_top():
    out = run(["compute_commits"], stdin=fixture("commit_counts.json"))
    assert out["total"] == 6 + 4 + 3 + 3
    assert out["top_repo"] == "git-consortium"
    assert out["top_count"] == 6


def test_commits_empty_is_zero():
    out = run(["compute_commits"], stdin="[]")
    assert out == {"total": 0, "top_repo": None, "top_count": 0}


# --------------------------------------------------------------------------
# compute_followers
# --------------------------------------------------------------------------

def test_followers_extracts_counts():
    out = run(["compute_followers"], stdin=fixture("user.json"))
    assert out == {"followers": 22898, "following": 9}


def test_followers_missing_fields_default_zero():
    out = run(["compute_followers"], stdin="{}")
    assert out == {"followers": 0, "following": 0}


# --------------------------------------------------------------------------
# compute_prs  (open count is the raw sample count, mirroring the original)
# --------------------------------------------------------------------------

def test_prs_pct_closed_matches_original_formula():
    # total 8, sample has 5 open -> (8-5)/8 = 37.5 -> floor 37
    out = run(["compute_prs", "8"], stdin=fixture("pr_sample.json"))
    assert out == {"total": 8, "pct_closed": 37}


def test_prs_zero_total_is_zero_pct():
    out = run(["compute_prs", "0"], stdin="[]")
    assert out == {"total": 0, "pct_closed": 0}


# --------------------------------------------------------------------------
# compute_issues  (open ratio is scaled to the total, mirroring the original)
# --------------------------------------------------------------------------

def test_issues_pct_closed_scales_sample_ratio():
    # total 5, sample 5 with 4 open -> ratio 0.8 -> open_est 4 -> closed 1 -> 20%
    out = run(["compute_issues", "5"], stdin=fixture("issue_sample.json"))
    assert out == {"total": 5, "pct_closed": 20}


def test_issues_scales_to_large_total():
    # total 1000, sample 5 with 4 open -> ratio 0.8 -> open_est 800 -> closed 200 -> 20%
    out = run(["compute_issues", "1000"], stdin=fixture("issue_sample.json"))
    assert out == {"total": 1000, "pct_closed": 20}


def test_issues_zero_total_is_zero_pct():
    out = run(["compute_issues", "0"], stdin="[]")
    assert out == {"total": 0, "pct_closed": 0}


# --------------------------------------------------------------------------
# Live smoke test — skipped without gh auth (e.g. CI).
# --------------------------------------------------------------------------

def _gh_authed():
    if shutil.which("gh") is None:
        return False
    return subprocess.run(
        ["gh", "auth", "status"], capture_output=True, text=True
    ).returncode == 0


@pytest.mark.skipif(not _gh_authed(), reason="gh not authenticated")
def test_overview_octocat_live():
    out = run(["overview", "octocat", "--json"])
    assert out["username"] == "octocat"
    for key in ("commits", "followers", "stars", "prs", "issues"):
        assert key in out
        assert out[key]["total"] if key != "followers" else out[key]["followers"] >= 0
    # octocat's follower count is large and only grows; a loose floor catches regressions.
    assert out["followers"]["followers"] > 1000

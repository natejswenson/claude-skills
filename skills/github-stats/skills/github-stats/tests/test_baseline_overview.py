"""Baseline eval: the assembled overview, driven end to end with no network.

Offline, deterministic, $0 — runs in `ci / github-stats` with the normal suite.

tests/test_gh_stats.py already drives each `compute_*` function against fixture
JSON, so the aggregation math is covered in isolation. What nothing covered is
`collect_overview`: the assembly of those pieces into the single object the user
actually sees. A regression there — a metric wired to the wrong collector, a key
renamed, a section silently dropped — passes every existing test.

`evals/baseline/bin/gh` is a stub of the `gh` CLI that serves
`evals/baseline/fixtures/` instead of GitHub. Putting it first on PATH makes the
REAL scripts/gh-stats.sh runnable end to end, offline, with no auth. The live
numeric-parity eval in eval/run_eval.py stays manual: it needs network and a
checkout of the original CLI, so it can never gate a release.

Every figure in the golden was verified by hand against its source fixture
before freezing (stars = sum of stargazers_count; commits = sum of the per-repo
counts; the two pct_closed values follow the two DIFFERENT estimators the script
documents — PRs use the raw open count, issues scale the sample ratio). The
`derived` tests below re-assert that relationship so a hand-edited golden fails.
"""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest

SKILL_DIR = Path(__file__).resolve().parent.parent
SCRIPT = SKILL_DIR / "scripts" / "gh-stats.sh"
BASELINE = SKILL_DIR / "evals" / "baseline"
FIXTURES = BASELINE / "fixtures"
STUB_BIN = BASELINE / "bin"
GOLDEN = json.loads((BASELINE / "overview-octocat.golden.json").read_text())


def run_offline(args, env_extra=None):
    """Run the real script with the stub gh first on PATH."""
    env = dict(os.environ)
    env["PATH"] = f"{STUB_BIN}{os.pathsep}{env['PATH']}"
    env.update(env_extra or {})
    proc = subprocess.run(
        ["bash", str(SCRIPT), *args], capture_output=True, text=True, env=env
    )
    assert proc.returncode == 0, f"exit {proc.returncode}: {proc.stderr}"
    return proc


def fixture(name):
    return json.loads((FIXTURES / name).read_text())


def test_overview_matches_the_frozen_golden():
    """The whole assembled object, pinned."""
    got = json.loads(run_offline(["overview", "octocat", "--json"]).stdout)
    assert got == GOLDEN, (
        "The assembled overview no longer matches the frozen golden.\n"
        f"  got:    {json.dumps(got, sort_keys=True)}\n"
        f"  golden: {json.dumps(GOLDEN, sort_keys=True)}\n"
        "If the change is intentional, refresh with:\n"
        "  PATH=\"$PWD/evals/baseline/bin:$PATH\" bash scripts/gh-stats.sh "
        "overview octocat --json | jq -S . > evals/baseline/overview-octocat.golden.json"
    )


def test_overview_has_every_expected_section():
    """Named explicitly so DELETING a section fails loudly rather than just
    changing the golden's shape (which a careless golden refresh would bless)."""
    got = json.loads(run_offline(["overview", "octocat", "--json"]).stdout)
    for key in ("username", "commits", "followers", "stars", "prs", "issues"):
        assert key in got, f"overview lost its '{key}' section"


# ------------------------------------------------------- golden stays derived
# Without these, a hand-edited golden makes the comparison above self-fulfilling.


def test_star_total_is_still_the_sum_of_the_repo_fixture():
    expected = sum(r["stargazers_count"] for r in fixture("repos.json"))
    assert GOLDEN["stars"]["total"] == expected, (
        f"Golden star total {GOLDEN['stars']['total']} != {expected}, the sum of "
        f"stargazers_count in repos.json. The golden was edited by hand or the "
        f"star aggregation regressed."
    )


def test_commit_total_is_still_the_sum_of_the_commit_fixture():
    expected = sum(fixture("commits.json").values())
    assert GOLDEN["commits"]["total"] == expected, (
        f"Golden commit total {GOLDEN['commits']['total']} != {expected}, the sum "
        f"of the per-repo counts in commits.json."
    )


def test_top_repo_is_still_the_actual_maximum():
    repos = fixture("repos.json")
    top = max(repos, key=lambda r: r["stargazers_count"])
    assert GOLDEN["stars"]["top_repo"] == top["name"]
    assert GOLDEN["stars"]["top_count"] == top["stargazers_count"]

    commits = fixture("commits.json")
    top_name = max(commits, key=commits.get)
    assert GOLDEN["commits"]["top_repo"] == top_name
    assert GOLDEN["commits"]["top_count"] == commits[top_name]


def test_pr_and_issue_estimators_stay_distinct():
    """The script deliberately uses two different estimators (PRs take the raw
    open count from the sample; issues scale the sample's open ratio to the
    total) to mirror the original CLI. Collapsing them into one is a silent
    behavior change that the golden alone would not explain."""
    prs, issues = fixture("pr_search.json"), fixture("issue_search.json")

    pr_open = sum(1 for i in prs["items"] if i["state"] == "open")
    pr_total = prs["total_count"]
    assert GOLDEN["prs"]["pct_closed"] == int((pr_total - pr_open) / pr_total * 100)

    n = len(issues["items"])
    iss_open = sum(1 for i in issues["items"] if i["state"] == "open")
    iss_total = issues["total_count"]
    open_est = int(iss_total * (iss_open / n))
    assert GOLDEN["issues"]["pct_closed"] == int(
        (iss_total - open_est) / iss_total * 100
    )


# ----------------------------------------------------------- the stub is honest


def test_stub_refuses_an_unmapped_endpoint():
    """If the stub returned empty for anything it did not recognise, a change
    that started calling a NEW endpoint would silently produce zeros and still
    match a refreshed golden. It must fail instead."""
    env = dict(os.environ)
    env["PATH"] = f"{STUB_BIN}{os.pathsep}{env['PATH']}"
    proc = subprocess.run(
        ["gh", "api", "rate_limit"], capture_output=True, text=True, env=env
    )
    assert proc.returncode != 0, (
        "The stub gh answered an endpoint it does not model. It must exit "
        "non-zero on unmapped paths."
    )
    assert "unmapped" in proc.stderr


def test_the_stub_is_actually_the_one_being_used():
    """Guards against the test silently passing through to a real, authenticated
    gh — which would make this suite network-dependent and non-deterministic."""
    env = dict(os.environ)
    env["PATH"] = f"{STUB_BIN}{os.pathsep}{env['PATH']}"
    which = subprocess.run(
        ["bash", "-c", "command -v gh"], capture_output=True, text=True, env=env
    )
    assert which.stdout.strip() == str(STUB_BIN / "gh"), (
        f"Expected the stub at {STUB_BIN / 'gh'} to win on PATH, got "
        f"{which.stdout.strip()!r}."
    )

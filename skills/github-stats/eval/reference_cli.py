#!/usr/bin/env python3
"""Emit the ORIGINAL github-stats-cli's metric numbers as JSON.

This is the "non-skill version" the eval compares against. It imports the
original project's metric classes directly (no interactive loop), runs them
against the live GitHub API, and prints a JSON object in the same shape the
skill's `gh-stats.sh overview --json` produces — so the two are directly
comparable.

Requirements:
  * The original repo importable. Set GITHUB_STATS_CLI_PATH (default:
    ~/localrepo/github-stats-cli). Run with that repo's interpreter so PyGithub
    is available, e.g. `$GITHUB_STATS_CLI_PATH/.venv/bin/python reference_cli.py octocat`.
  * Auth: GITHUB_TOKEN env var, or falls back to `gh auth token`.

Usage: reference_cli.py <username>
"""
import json
import os
import subprocess
import sys
from pathlib import Path

DEFAULT_CLI_PATH = Path.home() / "localrepo" / "github-stats-cli"


def _token() -> str:
    tok = os.environ.get("GITHUB_TOKEN") or os.environ.get("GITHUB_PAT")
    if tok:
        return tok
    try:
        return subprocess.run(
            ["gh", "auth", "token"], capture_output=True, text=True, check=True
        ).stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        sys.exit("error: no GITHUB_TOKEN and `gh auth token` unavailable")


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit("usage: reference_cli.py <username>")
    username = sys.argv[1]

    cli_path = Path(os.environ.get("GITHUB_STATS_CLI_PATH", DEFAULT_CLI_PATH))
    if not (cli_path / "github_stats").is_dir():
        sys.exit(f"error: original repo not found at {cli_path} (set GITHUB_STATS_CLI_PATH)")
    sys.path.insert(0, str(cli_path))

    from github import Github
    from github_stats.metrics.commits import CommitMetric
    from github_stats.metrics.followers import FollowerMetric
    from github_stats.metrics.stars import StarMetric
    from github_stats.metrics.pull_requests import PullRequestMetric
    from github_stats.metrics.issues import IssueMetric

    client = Github(_token())

    commits = CommitMetric(client, username); commits.collect()
    followers = FollowerMetric(client, username); followers.collect()
    stars = StarMetric(client, username); stars.collect()
    prs = PullRequestMetric(client, username); prs.collect()
    issues = IssueMetric(client, username); issues.collect()

    def top(metric):
        # CommitMetric/StarMetric store top_repo as a (name, count) tuple or None.
        return list(metric.top_repo) if metric.top_repo else [None, 0]

    c_name, c_count = top(commits)
    s_name, s_count = top(stars)

    out = {
        "username": username,
        "commits": {"total": commits.total_commits, "top_repo": c_name, "top_count": c_count},
        "followers": {"followers": followers.followers_count, "following": followers.following_count},
        "stars": {"total": stars.total_stars, "top_repo": s_name, "top_count": s_count},
        "prs": {"total": prs.total_prs, "pct_closed": int(prs.merge_rate)},
        "issues": {"total": issues.total_issues, "pct_closed": int(issues.close_rate)},
    }
    print(json.dumps(out))


if __name__ == "__main__":
    main()

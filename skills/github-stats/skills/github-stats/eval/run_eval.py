#!/usr/bin/env python3
"""Numeric-parity eval: the skill vs. the original github-stats-cli.

For each username, this runs:
  * candidate = the skill's `scripts/gh-stats.sh overview <user> --json`
  * reference = the original CLI's metrics via `eval/reference_cli.py <user>`
and compares the headline numbers. Both hit the live API, so values can drift a
little between the two calls; comparisons use a tolerance.

Gated fields (a mismatch fails the eval):
  followers.followers, followers.following, stars.total, prs.total, issues.total,
  commits.total, and the stars/commits top_repo *name*.
Informational fields (reported, never fail): the PR/issue pct_closed estimates
and the top_count magnitudes, which are sampled/volatile.

Exit code is non-zero if any gated field is out of tolerance.

Env:
  GITHUB_STATS_CLI_PATH  path to the original repo (default ~/localrepo/github-stats-cli)
  REFERENCE_PYTHON       interpreter with PyGithub (default $CLI_PATH/.venv/bin/python)
  EVAL_USERNAMES         comma-separated override for the username list
"""
import json
import os
import subprocess
import sys
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent
SCRIPT = SKILL_DIR / "scripts" / "gh-stats.sh"
REF = Path(__file__).resolve().parent / "reference_cli.py"

CLI_PATH = Path(os.environ.get("GITHUB_STATS_CLI_PATH", Path.home() / "localrepo" / "github-stats-cli"))
REF_PYTHON = os.environ.get("REFERENCE_PYTHON", str(CLI_PATH / ".venv" / "bin" / "python"))

# Gated count fields: (path, label). Tolerance: within max(2, 5%).
COUNT_FIELDS = [
    ("followers.followers", "followers"),
    ("followers.following", "following"),
    ("stars.total", "stars"),
    ("commits.total", "commits"),
    ("prs.total", "PRs"),
    ("issues.total", "issues"),
]
NAME_FIELDS = [("stars.top_repo", "top-star repo"), ("commits.top_repo", "top-commit repo")]


def dig(obj, path):
    for part in path.split("."):
        obj = obj[part]
    return obj


def within(a, b):
    return abs(a - b) <= max(2, 0.05 * max(abs(a), abs(b)))


def candidate(user):
    out = subprocess.run(
        ["bash", str(SCRIPT), "overview", user, "--json"],
        capture_output=True, text=True,
    )
    if out.returncode != 0:
        raise RuntimeError(f"skill failed for {user}: {out.stderr.strip()}")
    return json.loads(out.stdout)


def reference(user):
    out = subprocess.run(
        [REF_PYTHON, str(REF), user],
        capture_output=True, text=True,
    )
    if out.returncode != 0:
        raise RuntimeError(f"reference failed for {user}: {out.stderr.strip()}")
    return json.loads(out.stdout)


def usernames():
    env = os.environ.get("EVAL_USERNAMES")
    if env:
        return [u.strip() for u in env.split(",") if u.strip()]
    lines = (Path(__file__).resolve().parent / "usernames.txt").read_text().splitlines()
    return [ln.strip() for ln in lines if ln.strip() and not ln.startswith("#")]


def main():
    if not Path(REF_PYTHON).exists():
        sys.exit(f"error: reference interpreter not found: {REF_PYTHON}\n"
                 f"set REFERENCE_PYTHON or create the original repo's venv.")

    failures = 0
    for user in usernames():
        print(f"\n=== {user} ===")
        try:
            cand, ref = candidate(user), reference(user)
        except RuntimeError as e:
            print(f"  ERROR: {e}")
            failures += 1
            continue

        print(f"  {'field':<14}{'skill':>12}{'original':>12}   verdict")
        for path, label in COUNT_FIELDS:
            a, b = dig(cand, path), dig(ref, path)
            ok = within(a, b)
            failures += not ok
            print(f"  {label:<14}{a:>12}{b:>12}   {'ok' if ok else 'FAIL'}")
        for path, label in NAME_FIELDS:
            a, b = dig(cand, path), dig(ref, path)
            ok = a == b
            failures += not ok
            print(f"  {label:<14}{str(a):>12}{str(b):>12}   {'ok' if ok else 'FAIL'}")
        # informational
        for path, label in [("prs.pct_closed", "PR % closed"), ("issues.pct_closed", "issue % closed")]:
            print(f"  {label:<14}{dig(cand, path):>11}%{dig(ref, path):>11}%   (info)")

    print(f"\n{'PASS' if failures == 0 else 'FAIL'}: {failures} gated mismatch(es)")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Recent projects — discover local repos that recently had Claude Code sessions.

Powers the ghostwriter's "personal project" idea lane: instead of interviewing the
user for a topic, we propose real things they actually shipped. Each Claude Code
session is logged under ~/.claude/projects/<slug>/<uuid>.jsonl; the slug is an
ambiguous path encoding, so we read the authoritative `cwd` (and `gitBranch`) out
of the jsonl instead of decoding it.

Read-only. No third-party deps. Prints a human list by default, or JSON with --json.

    python3 scripts/recent_projects.py            # top 6, human-readable
    python3 scripts/recent_projects.py --json      # machine-readable
    python3 scripts/recent_projects.py --limit 10
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path

# Session cwds under these roots are throwaway and never worth posting about.
SKIP_PREFIXES = ("/private/tmp", "/private/var/folders", "/var/folders", "/tmp")
SKIP_BASENAMES = {"subagents"}


def _read_session_meta(jsonl: Path) -> dict | None:
    """Pull the real cwd + gitBranch from the first jsonl line that carries them."""
    try:
        with jsonl.open("r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                if '"cwd"' not in line:
                    continue
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    continue
                cwd = rec.get("cwd")
                if cwd:
                    return {"cwd": cwd, "gitBranch": rec.get("gitBranch")}
    except OSError:
        return None
    return None


def _last_summary(session_dir: Path) -> str | None:
    """Most recent `type:summary` line across the project's sessions, if any."""
    best_mtime = -1.0
    best_summary = None
    for jsonl in sorted(session_dir.glob("*.jsonl")):
        try:
            mtime = jsonl.stat().st_mtime
        except OSError:  # pragma: no cover - defensive against a vanished file
            continue
        if mtime <= best_mtime:
            continue
        try:
            with jsonl.open("r", encoding="utf-8", errors="replace") as fh:
                for line in fh:
                    if '"summary"' not in line:
                        continue
                    try:
                        rec = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if rec.get("type") == "summary" and rec.get("summary"):
                        best_summary = rec["summary"]
                        best_mtime = mtime
        except OSError:
            continue
    return best_summary


def _git_info(path: Path) -> dict | None:
    """Last commit subject + ISO date for a git repo (works from a subdir too)."""
    try:
        out = subprocess.run(
            ["git", "-C", str(path), "log", "-1", "--format=%s%x00%cI"],
            capture_output=True, text=True, timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if out.returncode != 0 or "\x00" not in out.stdout:
        return None
    subject, _, cdate = out.stdout.strip().partition("\x00")
    return {"last_commit": subject, "last_commit_date": cdate}


def _should_skip(cwd: str) -> bool:
    if any(cwd.startswith(p) for p in SKIP_PREFIXES):
        return True
    if Path(cwd).name in SKIP_BASENAMES:
        return True
    return not Path(cwd).is_dir()


def discover(limit: int) -> list[dict]:
    root = Path.home() / ".claude" / "projects"
    if not root.is_dir():
        return []

    by_path: dict[str, dict] = {}
    for session_dir in sorted(root.iterdir()):
        if not session_dir.is_dir():
            continue
        sessions = list(session_dir.glob("*.jsonl"))
        if not sessions:
            continue
        newest = max(sessions, key=lambda p: p.stat().st_mtime)
        session_mtime = newest.stat().st_mtime
        meta = _read_session_meta(newest)
        if not meta:
            continue
        cwd = meta["cwd"]
        if _should_skip(cwd):
            continue
        # Dedup by real path; keep the most recent session for that path.
        existing = by_path.get(cwd)
        if existing and existing["_mtime"] >= session_mtime:
            continue
        by_path[cwd] = {
            "path": cwd,
            "name": Path(cwd).name,
            "branch": meta.get("gitBranch"),
            "last_session": datetime.fromtimestamp(session_mtime).isoformat(timespec="minutes"),
            "last_summary": _last_summary(session_dir),
            "_mtime": session_mtime,
            "_dir": session_dir,
        }

    ranked = sorted(by_path.values(), key=lambda d: d["_mtime"], reverse=True)[:limit]
    for item in ranked:
        git = _git_info(Path(item["path"]))
        item["last_commit"] = git["last_commit"] if git else None
        item["last_commit_date"] = git["last_commit_date"] if git else None
        item.pop("_mtime", None)
        item.pop("_dir", None)
    return ranked


def main() -> int:
    ap = argparse.ArgumentParser(description="List repos with recent Claude Code sessions.")
    ap.add_argument("--json", action="store_true", help="emit JSON instead of a human list")
    ap.add_argument("--limit", type=int, default=6, help="max projects to return (default 6)")
    args = ap.parse_args()

    projects = discover(args.limit)

    if args.json:
        json.dump(projects, sys.stdout, indent=2)
        sys.stdout.write("\n")
        return 0

    if not projects:
        print("No recent Claude Code sessions found under ~/.claude/projects.")
        return 0

    for i, p in enumerate(projects, 1):
        branch = f"  ({p['branch']})" if p.get("branch") else ""
        print(f"{i}. {p['name']}{branch}")
        print(f"   {p['path']}")
        print(f"   last session: {p['last_session']}")
        if p.get("last_commit"):
            print(f"   last commit:  {p['last_commit']}")
        if p.get("last_summary"):
            print(f"   last summary: {p['last_summary']}")
        print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

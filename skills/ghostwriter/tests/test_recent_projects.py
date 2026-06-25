"""Tests for scripts/recent_projects.py — full branch coverage."""
from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

import recent_projects as rp


# --- helpers ---------------------------------------------------------------

def make_session(projects_root: Path, slug: str, *, cwd, branch="main",
                 summary=None, has_cwd=True, mtime=1000.0, fname="a.jsonl"):
    """Create a fake ~/.claude/projects/<slug>/<fname>.jsonl session log."""
    sd = projects_root / slug
    sd.mkdir(parents=True, exist_ok=True)
    lines = [json.dumps({"type": "user", "sessionId": "x"})]
    if has_cwd:
        lines.append(json.dumps({"cwd": str(cwd), "gitBranch": branch}))
    if summary is not None:
        lines.append(json.dumps({"type": "summary", "summary": summary}))
    f = sd / fname
    f.write_text("\n".join(lines) + "\n", encoding="utf-8")
    os.utime(f, (mtime, mtime))
    return sd, f


@pytest.fixture
def fake_home(tmp_path, monkeypatch):
    home = tmp_path / "home"
    (home / ".claude" / "projects").mkdir(parents=True)
    monkeypatch.setenv("HOME", str(home))
    return home


@pytest.fixture
def no_skip(monkeypatch):
    # pytest's tmp_path lives under /var/folders on macOS, which the real
    # skip-list filters out. Disable it so test repos under tmp_path survive;
    # the prefix/basename logic is covered by the _should_skip unit tests.
    monkeypatch.setattr(rp, "SKIP_PREFIXES", ())
    monkeypatch.setattr(rp, "SKIP_BASENAMES", set())


def projects_root(home):
    return home / ".claude" / "projects"


# --- _read_session_meta ----------------------------------------------------

def test_read_session_meta_finds_cwd(tmp_path):
    f = tmp_path / "s.jsonl"
    f.write_text(json.dumps({"type": "x"}) + "\n" +
                 json.dumps({"cwd": "/repo", "gitBranch": "dev"}) + "\n",
                 encoding="utf-8")
    assert rp._read_session_meta(f) == {"cwd": "/repo", "gitBranch": "dev"}


def test_read_session_meta_no_cwd_returns_none(tmp_path):
    f = tmp_path / "s.jsonl"
    f.write_text(json.dumps({"type": "x"}) + "\n", encoding="utf-8")
    assert rp._read_session_meta(f) is None


def test_read_session_meta_bad_json_line_skipped(tmp_path):
    f = tmp_path / "s.jsonl"
    f.write_text('{"cwd": broken\n' +
                 json.dumps({"cwd": "/repo"}) + "\n", encoding="utf-8")
    assert rp._read_session_meta(f) == {"cwd": "/repo", "gitBranch": None}


def test_read_session_meta_oserror_returns_none(tmp_path):
    d = tmp_path / "dir.jsonl"
    d.mkdir()  # opening a directory raises OSError
    assert rp._read_session_meta(d) is None


# --- _last_summary ---------------------------------------------------------

def test_last_summary_picks_newest(tmp_path):
    old = tmp_path / "old.jsonl"
    old.write_text(json.dumps({"type": "summary", "summary": "old one"}) + "\n",
                   encoding="utf-8")
    os.utime(old, (100, 100))
    new = tmp_path / "new.jsonl"
    new.write_text(json.dumps({"type": "summary", "summary": "new one"}) + "\n",
                   encoding="utf-8")
    os.utime(new, (200, 200))
    assert rp._last_summary(tmp_path) == "new one"


def test_last_summary_none_when_absent(tmp_path):
    f = tmp_path / "s.jsonl"
    f.write_text(json.dumps({"type": "user"}) + "\n", encoding="utf-8")
    assert rp._last_summary(tmp_path) is None


def test_last_summary_skips_bad_json_and_lower_mtime(tmp_path):
    a = tmp_path / "a.jsonl"
    # First line contains "summary" but is invalid JSON -> JSONDecodeError branch.
    a.write_text('{"summary": broken\n' +
                 json.dumps({"type": "summary", "summary": "keep"}) + "\n",
                 encoding="utf-8")
    os.utime(a, (300, 300))
    b = tmp_path / "b.jsonl"  # older, must be skipped by mtime guard
    b.write_text(json.dumps({"type": "summary", "summary": "older"}) + "\n",
                 encoding="utf-8")
    os.utime(b, (100, 100))
    assert rp._last_summary(tmp_path) == "keep"


def test_last_summary_oserror_on_open(tmp_path):
    d = tmp_path / "x.jsonl"
    d.mkdir()  # stat() works, open() raises OSError -> skipped
    assert rp._last_summary(tmp_path) is None


# --- _git_info -------------------------------------------------------------

class FakeProc:
    def __init__(self, returncode, stdout):
        self.returncode = returncode
        self.stdout = stdout


def test_git_info_success(monkeypatch, tmp_path):
    monkeypatch.setattr(rp.subprocess, "run",
                        lambda *a, **k: FakeProc(0, "subject line\x002026-06-25T10:00:00-05:00\n"))
    info = rp._git_info(tmp_path)
    assert info == {"last_commit": "subject line",
                    "last_commit_date": "2026-06-25T10:00:00-05:00"}


def test_git_info_nonzero_returncode(monkeypatch, tmp_path):
    monkeypatch.setattr(rp.subprocess, "run", lambda *a, **k: FakeProc(128, ""))
    assert rp._git_info(tmp_path) is None


def test_git_info_no_separator(monkeypatch, tmp_path):
    monkeypatch.setattr(rp.subprocess, "run", lambda *a, **k: FakeProc(0, "no-null-here"))
    assert rp._git_info(tmp_path) is None


def test_git_info_oserror(monkeypatch, tmp_path):
    def boom(*a, **k):
        raise OSError("no git")
    monkeypatch.setattr(rp.subprocess, "run", boom)
    assert rp._git_info(tmp_path) is None


# --- _should_skip ----------------------------------------------------------

def test_should_skip_temp_prefix():
    assert rp._should_skip("/private/tmp/whatever") is True
    assert rp._should_skip("/var/folders/xy/z") is True


def test_should_skip_basename():
    assert rp._should_skip("/Users/me/subagents") is True


def test_should_skip_nonexistent(tmp_path):
    assert rp._should_skip(str(tmp_path / "gone")) is True


def test_should_skip_real_dir(tmp_path, no_skip):
    assert rp._should_skip(str(tmp_path)) is False


# --- discover --------------------------------------------------------------

def test_discover_no_root(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path / "empty"))
    assert rp.discover(6) == []


def test_discover_skips_non_dirs_and_empty_dirs(fake_home, tmp_path, monkeypatch):
    root = projects_root(fake_home)
    (root / "loose-file").write_text("x", encoding="utf-8")  # not a dir
    (root / "empty-dir").mkdir()  # no jsonl
    monkeypatch.setattr(rp.subprocess, "run", lambda *a, **k: FakeProc(128, ""))
    assert rp.discover(6) == []


def test_discover_skips_missing_meta_and_temp(fake_home, tmp_path, monkeypatch, no_skip):
    root = projects_root(fake_home)
    make_session(root, "no-cwd", cwd=tmp_path, has_cwd=False)
    make_session(root, "temp-proj", cwd="/private/tmp/foo")
    monkeypatch.setattr(rp.subprocess, "run", lambda *a, **k: FakeProc(128, ""))
    assert rp.discover(6) == []


def test_discover_dedup_keeps_most_recent(fake_home, tmp_path, monkeypatch, no_skip):
    root = projects_root(fake_home)
    repo = tmp_path / "repo"
    repo.mkdir()
    make_session(root, "slug-old", cwd=repo, branch="old", mtime=100.0, fname="o.jsonl")
    make_session(root, "slug-new", cwd=repo, branch="new", mtime=500.0, fname="n.jsonl")
    monkeypatch.setattr(rp.subprocess, "run", lambda *a, **k: FakeProc(128, ""))
    out = rp.discover(6)
    assert len(out) == 1
    assert out[0]["branch"] == "new"


def test_discover_ranks_and_attaches_git(fake_home, tmp_path, monkeypatch, no_skip):
    root = projects_root(fake_home)
    a = tmp_path / "alpha"; a.mkdir()
    b = tmp_path / "beta"; b.mkdir()
    make_session(root, "a", cwd=a, summary="did alpha", mtime=900.0)
    make_session(root, "b", cwd=b, mtime=200.0)
    monkeypatch.setattr(rp.subprocess, "run",
                        lambda *a, **k: FakeProc(0, "last commit\x002026-06-25T00:00:00Z\n"))
    out = rp.discover(6)
    assert [p["name"] for p in out] == ["alpha", "beta"]  # newest first
    assert out[0]["last_commit"] == "last commit"
    assert out[0]["last_summary"] == "did alpha"
    assert "_mtime" not in out[0] and "_dir" not in out[0]


def test_discover_git_none_branch(fake_home, tmp_path, monkeypatch, no_skip):
    root = projects_root(fake_home)
    a = tmp_path / "alpha"; a.mkdir()
    make_session(root, "a", cwd=a)
    monkeypatch.setattr(rp.subprocess, "run", lambda *a, **k: FakeProc(1, ""))
    out = rp.discover(6)
    assert out[0]["last_commit"] is None and out[0]["last_commit_date"] is None


def test_discover_respects_limit(fake_home, tmp_path, monkeypatch, no_skip):
    root = projects_root(fake_home)
    for i in range(3):
        d = tmp_path / f"r{i}"; d.mkdir()
        make_session(root, f"s{i}", cwd=d, mtime=float(i))
    monkeypatch.setattr(rp.subprocess, "run", lambda *a, **k: FakeProc(128, ""))
    assert len(rp.discover(2)) == 2


# --- main ------------------------------------------------------------------

def test_main_json(fake_home, tmp_path, monkeypatch, capsys, no_skip):
    root = projects_root(fake_home)
    d = tmp_path / "repo"; d.mkdir()
    make_session(root, "s", cwd=d, branch="main")
    monkeypatch.setattr(rp.subprocess, "run", lambda *a, **k: FakeProc(128, ""))
    monkeypatch.setattr("sys.argv", ["recent_projects.py", "--json"])
    assert rp.main() == 0
    data = json.loads(capsys.readouterr().out)
    assert data[0]["name"] == "repo"


def test_main_human_full(fake_home, tmp_path, monkeypatch, capsys, no_skip):
    root = projects_root(fake_home)
    d = tmp_path / "repo"; d.mkdir()
    make_session(root, "s", cwd=d, branch="feat/x", summary="shipped a thing")
    monkeypatch.setattr(rp.subprocess, "run",
                        lambda *a, **k: FakeProc(0, "the commit\x002026-06-25T00:00:00Z\n"))
    monkeypatch.setattr("sys.argv", ["recent_projects.py", "--limit", "5"])
    assert rp.main() == 0
    out = capsys.readouterr().out
    assert "1. repo  (feat/x)" in out
    assert "last commit:  the commit" in out
    assert "last summary: shipped a thing" in out


def test_main_human_no_branch_no_extras(fake_home, tmp_path, monkeypatch, capsys, no_skip):
    root = projects_root(fake_home)
    d = tmp_path / "repo"; d.mkdir()
    make_session(root, "s", cwd=d, branch=None)
    monkeypatch.setattr(rp.subprocess, "run", lambda *a, **k: FakeProc(128, ""))
    monkeypatch.setattr("sys.argv", ["recent_projects.py"])
    assert rp.main() == 0
    out = capsys.readouterr().out
    assert "1. repo\n" in out
    assert "(None)" not in out


def test_main_empty(fake_home, monkeypatch, capsys):
    monkeypatch.setattr("sys.argv", ["recent_projects.py"])
    assert rp.main() == 0
    assert "No recent Claude Code sessions" in capsys.readouterr().out

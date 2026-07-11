"""Tests for scripts/extract_posts.py — full branch coverage."""
from __future__ import annotations

import pytest

import extract_posts as ep


def write_csv(path, rows, header="ShareCommentary"):
    lines = [header]
    lines += rows
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def test_first_present_picks_first_nonempty():
    row = {"a": "", "b": "  hi  ", "c": "later"}
    assert ep._first_present(row, ("a", "b", "c")) == "hi"
    assert ep._first_present(row, ("missing",)) == ""


def test_extract_missing_file_exits(tmp_path):
    with pytest.raises(SystemExit) as e:
        ep.extract(tmp_path / "nope.csv", tmp_path / "out.md", 30)
    assert "not found" in str(e.value)


def test_extract_empty_file_exits(tmp_path):
    csv = tmp_path / "Shares.csv"
    csv.write_text("", encoding="utf-8")
    with pytest.raises(SystemExit) as e:
        ep.extract(csv, tmp_path / "out.md", 30)
    assert "empty" in str(e.value)


def test_extract_missing_text_column_exits(tmp_path):
    csv = tmp_path / "Shares.csv"
    csv.write_text("SomethingElse\nvalue\n", encoding="utf-8")
    with pytest.raises(SystemExit) as e:
        ep.extract(csv, tmp_path / "out.md", 30)
    assert "expected text columns" in str(e.value)


def test_extract_all_too_short_exits(tmp_path):
    csv = write_csv(tmp_path / "Shares.csv", ["short"])
    with pytest.raises(SystemExit) as e:
        ep.extract(csv, tmp_path / "out.md", 30)
    assert "no usable posts" in str(e.value)


def test_extract_writes_posts_with_and_without_meta(tmp_path):
    long_text = "x" * 50
    # Row 1 has date+link (meta line); row 2 (text only) has no meta.
    csv = tmp_path / "Shares.csv"
    csv.write_text(
        "ShareCommentary,Date,ShareLink\n"
        f'"{long_text}",2024-01-01,http://example.com/1\n'
        f'"{long_text}",,\n'
        "short,,\n",
        encoding="utf-8",
    )
    out = tmp_path / "out.md"
    count = ep.extract(csv, out, 30)
    assert count == 2
    content = out.read_text(encoding="utf-8")
    assert "Posts: **2**" in content
    assert "Skipped (empty / too short / bare reshares): 1" in content
    assert "2024-01-01 · http://example.com/1" in content
    # The second post has no meta line.
    assert "## Post 2\n" in content


def test_main_end_to_end(tmp_path, monkeypatch, capsys):
    long_text = "y" * 60
    csv = write_csv(tmp_path / "Shares.csv", [long_text])
    out = tmp_path / "out.md"
    monkeypatch.setattr(
        "sys.argv",
        ["extract_posts.py", "--in", str(csv), "--out", str(out), "--min-chars", "10"],
    )
    ep.main()
    captured = capsys.readouterr().out
    assert f"Wrote 1 posts to {out}" in captured
    assert out.exists()

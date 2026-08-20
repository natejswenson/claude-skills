"""Tests for scripts/post_outcome.py — the self-reported outcome half of the feedback loop."""
from __future__ import annotations

import json

import pytest

import post_outcome as po


def _log(tmp_path, records):
    log = tmp_path / "published.jsonl"
    log.write_text(
        "".join(json.dumps(r) + "\n" for r in records), encoding="utf-8"
    )
    return log


REC1 = {"date": "2026-07-10", "urn": "urn:li:share:1", "slug": "one", "format": "text"}
REC2 = {"date": "2026-07-15", "urn": "urn:li:share:2", "slug": "two", "format": "carousel"}


# ---------------------------------------------------------------- load/pick
def test_load_records_missing_file_exits(tmp_path):
    with pytest.raises(SystemExit):
        po.load_records(tmp_path / "nope.jsonl")


def test_load_records_empty_file_exits(tmp_path):
    log = tmp_path / "published.jsonl"
    log.write_text("\n\n", encoding="utf-8")
    with pytest.raises(SystemExit):
        po.load_records(log)


def test_pick_by_urn():
    assert po.pick_record([REC1, REC2], "urn:li:share:1", None, False)["slug"] == "one"


def test_pick_unknown_urn_exits():
    with pytest.raises(SystemExit):
        po.pick_record([REC1], "urn:li:share:404", None, False)


def test_pick_by_slug():
    assert po.pick_record([REC1, REC2], None, "two", False)["urn"] == "urn:li:share:2"


def test_pick_unknown_slug_exits():
    with pytest.raises(SystemExit):
        po.pick_record([REC1], None, "nope", False)


def test_pick_latest_prefers_unscored():
    scored = dict(REC2, outcome="great")
    assert po.pick_record([REC1, scored], None, None, True)["slug"] == "one"


def test_pick_latest_all_scored_takes_newest():
    recs = [dict(REC1, outcome="normal"), dict(REC2, outcome="great")]
    assert po.pick_record(recs, None, None, True)["slug"] == "two"


def test_pick_neither_flag_exits():
    with pytest.raises(SystemExit):
        po.pick_record([REC1], None, None, False)


# --------------------------------------------------------------------- main
def test_main_latest_roundtrip(monkeypatch, tmp_path, capsys):
    log = _log(tmp_path, [dict(REC1, outcome="normal"), REC2])
    monkeypatch.setattr(
        "sys.argv",
        ["x", "--latest", "--outcome", "great", "--notes", "lots of saves", "--log", str(log)],
    )
    po.main()
    recs = [json.loads(l) for l in log.read_text(encoding="utf-8").splitlines()]
    assert recs[1]["outcome"] == "great"
    assert recs[1]["outcome_notes"] == "lots of saves"
    assert recs[1]["outcome_date"]
    assert recs[0]["outcome"] == "normal"  # untouched
    assert "two -> great" in capsys.readouterr().out


def test_main_by_urn(monkeypatch, tmp_path):
    log = _log(tmp_path, [REC1, REC2])
    monkeypatch.setattr(
        "sys.argv",
        ["x", "--urn", "urn:li:share:1", "--outcome", "flopped", "--log", str(log)],
    )
    po.main()
    recs = [json.loads(l) for l in log.read_text(encoding="utf-8").splitlines()]
    assert recs[0]["outcome"] == "flopped"
    assert "outcome" not in recs[1]
    assert "outcome_notes" not in recs[0]  # no --notes -> key absent


def test_main_invalid_outcome_rejected(monkeypatch, tmp_path):
    log = _log(tmp_path, [REC1])
    monkeypatch.setattr(
        "sys.argv", ["x", "--latest", "--outcome", "viral", "--log", str(log)]
    )
    with pytest.raises(SystemExit):
        po.main()


def test_main_urn_and_latest_mutually_exclusive(monkeypatch, tmp_path):
    log = _log(tmp_path, [REC1])
    monkeypatch.setattr(
        "sys.argv",
        ["x", "--latest", "--urn", "urn:li:share:1", "--outcome", "great", "--log", str(log)],
    )
    with pytest.raises(SystemExit):
        po.main()


def test_main_by_slug_records_numeric_fields(monkeypatch, tmp_path, capsys):
    log = _log(tmp_path, [REC1, REC2])
    monkeypatch.setattr(
        "sys.argv",
        [
            "x", "--slug", "one", "--outcome", "flopped",
            "--impressions", "210", "--reactions", "3", "--comments", "0",
            "--log", str(log),
        ],
    )
    po.main()
    recs = [json.loads(l) for l in log.read_text(encoding="utf-8").splitlines()]
    assert recs[0]["outcome"] == "flopped"
    assert recs[0]["impressions"] == 210
    assert recs[0]["reactions"] == 3
    assert recs[0]["comments"] == 0
    assert "impressions" not in recs[1]
    assert "impressions=210" in capsys.readouterr().out


def test_main_numeric_fields_absent_when_not_passed(monkeypatch, tmp_path):
    log = _log(tmp_path, [REC1])
    monkeypatch.setattr(
        "sys.argv", ["x", "--slug", "one", "--outcome", "normal", "--log", str(log)]
    )
    po.main()
    rec = json.loads(log.read_text(encoding="utf-8").splitlines()[0])
    assert "impressions" not in rec and "reactions" not in rec and "comments" not in rec


def test_main_list_unscored_reports_and_leaves_log_untouched(monkeypatch, tmp_path, capsys):
    log = _log(tmp_path, [dict(REC1, outcome="normal", first_line="hello world"), REC2])
    before = log.read_text(encoding="utf-8")
    monkeypatch.setattr("sys.argv", ["x", "--list-unscored", "--log", str(log)])
    po.main()
    out = capsys.readouterr().out
    assert "two" in out and "one" not in out.replace("1 unscored", "")
    assert "1 unscored of 2 published" in out
    assert log.read_text(encoding="utf-8") == before


def test_main_list_unscored_all_scored(monkeypatch, tmp_path, capsys):
    log = _log(tmp_path, [dict(REC1, outcome="great")])
    monkeypatch.setattr("sys.argv", ["x", "--list-unscored", "--log", str(log)])
    po.main()
    assert "All published posts have an outcome" in capsys.readouterr().out


def test_main_outcome_required_unless_listing(monkeypatch, tmp_path):
    log = _log(tmp_path, [REC1])
    monkeypatch.setattr("sys.argv", ["x", "--slug", "one", "--log", str(log)])
    with pytest.raises(SystemExit):
        po.main()

"""Tests for scripts/post_outcome.py — the self-reported outcome half of the feedback loop."""
from __future__ import annotations

import datetime as _dt
import json

import pytest

import post_outcome as po


def _log(tmp_path, records):
    log = tmp_path / "published.jsonl"
    log.write_text(
        "".join(json.dumps(r) + "\n" for r in records), encoding="utf-8"
    )
    return log


REC1 = {"date": "2026-07-10", "ids": ["101", "102"], "slug": "one", "format": "thread"}
REC2 = {"date": "2026-07-15", "ids": ["201"], "slug": "two", "format": "single"}


# ---------------------------------------------------------------- load/pick
def test_load_records_missing_file_exits(tmp_path):
    with pytest.raises(SystemExit):
        po.load_records(tmp_path / "nope.jsonl")


def test_load_records_empty_file_exits(tmp_path):
    log = tmp_path / "published.jsonl"
    log.write_text("\n\n", encoding="utf-8")
    with pytest.raises(SystemExit):
        po.load_records(log)


def test_pick_by_id_any_tweet_in_thread():
    assert po.pick_record([REC1, REC2], "102", False)["slug"] == "one"


def test_pick_unknown_id_exits():
    with pytest.raises(SystemExit):
        po.pick_record([REC1], "404", False)


def test_pick_latest_prefers_unscored():
    scored = dict(REC2, outcome="great")
    assert po.pick_record([REC1, scored], None, True)["slug"] == "one"


def test_pick_latest_all_scored_takes_newest():
    recs = [dict(REC1, outcome="normal"), dict(REC2, outcome="great")]
    assert po.pick_record(recs, None, True)["slug"] == "two"


def test_pick_neither_flag_exits():
    with pytest.raises(SystemExit):
        po.pick_record([REC1], None, False)


def test_pick_record_missing_ids_key_safe():
    assert po.pick_record([{"slug": "x"}, REC2], "201", False)["slug"] == "two"


# --------------------------------------------------------------------- main
def test_main_latest_roundtrip(monkeypatch, tmp_path, capsys):
    log = _log(tmp_path, [dict(REC1, outcome="normal"), REC2])
    monkeypatch.setattr(
        "sys.argv",
        ["x", "--latest", "--outcome", "great", "--notes", "big reply chain", "--log", str(log)],
    )
    po.main()
    recs = [json.loads(l) for l in log.read_text(encoding="utf-8").splitlines()]
    assert recs[1]["outcome"] == "great"
    assert recs[1]["outcome_notes"] == "big reply chain"
    assert recs[1]["outcome_date"]
    assert recs[0]["outcome"] == "normal"  # untouched
    assert "two -> great" in capsys.readouterr().out


def test_main_by_id(monkeypatch, tmp_path):
    log = _log(tmp_path, [REC1, REC2])
    monkeypatch.setattr(
        "sys.argv",
        ["x", "--id", "101", "--outcome", "flopped", "--log", str(log)],
    )
    po.main()
    recs = [json.loads(l) for l in log.read_text(encoding="utf-8").splitlines()]
    assert recs[0]["outcome"] == "flopped"
    assert "outcome" not in recs[1]
    assert "outcome_notes" not in recs[0]  # no --notes -> key absent


def test_main_fallback_label_when_no_slug(monkeypatch, tmp_path, capsys):
    log = _log(tmp_path, [{"ids": ["55"], "slug": ""}])
    monkeypatch.setattr(
        "sys.argv", ["x", "--latest", "--outcome", "normal", "--log", str(log)]
    )
    po.main()
    assert "55 -> normal" in capsys.readouterr().out


def test_main_invalid_outcome_rejected(monkeypatch, tmp_path):
    log = _log(tmp_path, [REC1])
    monkeypatch.setattr(
        "sys.argv", ["x", "--latest", "--outcome", "viral", "--log", str(log)]
    )
    with pytest.raises(SystemExit):
        po.main()


def test_main_id_and_latest_mutually_exclusive(monkeypatch, tmp_path):
    log = _log(tmp_path, [REC1])
    monkeypatch.setattr(
        "sys.argv",
        ["x", "--latest", "--id", "101", "--outcome", "great", "--log", str(log)],
    )
    with pytest.raises(SystemExit):
        po.main()


# ------------------------------------------------------- due / check-due loop
TODAY = _dt.date(2026, 7, 27)


def test_due_record_picks_oldest_ripe_not_newest():
    """The bug that kept this loop dead: picking the NEWEST unscored post meant a
    same-day post blocked the check forever while ripe older posts aged out."""
    recs = [
        {"date": "2026-07-20", "slug": "old-unscored"},
        {"date": "2026-07-22", "slug": "scored", "outcome": "great"},
        {"date": "2026-07-27", "slug": "today"},
    ]
    assert po.due_record(recs, TODAY)["slug"] == "old-unscored"


def test_due_record_ignores_posts_younger_than_threshold():
    recs = [{"date": "2026-07-26", "slug": "yesterday"}]
    assert po.due_record(recs, TODAY) is None


def test_due_record_exactly_at_threshold_is_due():
    recs = [{"date": "2026-07-25", "slug": "ripe"}]
    assert po.due_record(recs, TODAY)["slug"] == "ripe"


def test_due_record_all_scored_returns_none():
    recs = [{"date": "2026-07-01", "slug": "a", "outcome": "flopped"}]
    assert po.due_record(recs, TODAY) is None


def test_due_record_undated_record_never_due():
    assert po.due_record([{"slug": "no-date"}], TODAY) is None
    assert po.due_record([{"date": "not-a-date", "slug": "bad"}], TODAY) is None


def test_today_returns_the_real_date():
    assert po._today() == _dt.date.today()


def test_due_record_defaults_to_real_today(monkeypatch):
    monkeypatch.setattr(po, "_today", lambda: TODAY)
    assert po.due_record([{"date": "2026-07-01", "slug": "old"}])["slug"] == "old"


def test_check_due_prints_record(monkeypatch, tmp_path, capsys):
    log = _log(tmp_path, [{"date": "2026-07-01", "slug": "old"}])
    monkeypatch.setattr(po, "_today", lambda: TODAY)
    monkeypatch.setattr("sys.argv", ["x", "--check-due", "--log", str(log)])
    po.main()
    assert json.loads(capsys.readouterr().out)["slug"] == "old"


def test_check_due_prints_none_when_nothing_ripe(monkeypatch, tmp_path, capsys):
    log = _log(tmp_path, [{"date": "2026-07-27", "slug": "today"}])
    monkeypatch.setattr(po, "_today", lambda: TODAY)
    monkeypatch.setattr("sys.argv", ["x", "--check-due", "--log", str(log)])
    po.main()
    assert capsys.readouterr().out.strip() == "none"


def test_check_due_on_missing_log_is_none_not_error(monkeypatch, tmp_path, capsys):
    """Runs before anything has ever been published, so absent != broken."""
    monkeypatch.setattr(
        "sys.argv", ["x", "--check-due", "--log", str(tmp_path / "nope.jsonl")]
    )
    po.main()
    assert capsys.readouterr().out.strip() == "none"


def test_main_due_records_the_oldest_ripe_post(monkeypatch, tmp_path, capsys):
    log = _log(tmp_path, [
        {"date": "2026-07-20", "ids": ["1"], "slug": "old"},
        {"date": "2026-07-27", "ids": ["2"], "slug": "today"},
    ])
    monkeypatch.setattr(po, "_today", lambda: TODAY)
    monkeypatch.setattr(
        "sys.argv", ["x", "--due", "--outcome", "flopped", "--log", str(log)]
    )
    po.main()
    recs = [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines()]
    assert recs[0]["outcome"] == "flopped"
    assert "outcome" not in recs[1]
    assert "old -> flopped" in capsys.readouterr().out


def test_main_due_with_nothing_ripe_exits(monkeypatch, tmp_path):
    log = _log(tmp_path, [{"date": "2026-07-27", "slug": "today"}])
    monkeypatch.setattr(po, "_today", lambda: TODAY)
    monkeypatch.setattr(
        "sys.argv", ["x", "--due", "--outcome", "great", "--log", str(log)]
    )
    with pytest.raises(SystemExit, match="no post is due"):
        po.main()


def test_main_recording_without_outcome_exits(monkeypatch, tmp_path):
    log = _log(tmp_path, [REC1])
    monkeypatch.setattr("sys.argv", ["x", "--latest", "--log", str(log)])
    with pytest.raises(SystemExit, match="--outcome is required"):
        po.main()


def test_pick_record_due_branch_exits_when_none(monkeypatch):
    monkeypatch.setattr(po, "_today", lambda: TODAY)
    with pytest.raises(SystemExit, match="no post is due"):
        po.pick_record([{"date": "2026-07-27"}], None, False, due=True)


# ------------------------------------------------------ stale-out / retirement
def test_due_record_ignores_posts_past_the_ask_window():
    """Nobody honestly remembers a month-old post; a guess is worse than a gap."""
    old = {"date": "2026-06-01", "slug": "ancient"}
    assert po.due_record([old], TODAY) is None


def test_due_record_at_the_far_edge_is_still_due():
    edge = {"date": "2026-06-27", "slug": "edge"}  # exactly 30 days
    assert po.due_record([edge], TODAY)["slug"] == "edge"


def test_stale_records_finds_only_aged_out_unscored():
    recs = [
        {"date": "2026-06-01", "slug": "ancient"},
        {"date": "2026-06-01", "slug": "ancient-but-scored", "outcome": "great"},
        {"date": "2026-07-20", "slug": "ripe"},
        {"slug": "undated"},
        {"date": "nonsense", "slug": "bad"},
    ]
    assert [r["slug"] for r in po.stale_records(recs, TODAY)] == ["ancient"]


def test_stale_records_defaults_to_real_today(monkeypatch):
    monkeypatch.setattr(po, "_today", lambda: TODAY)
    assert [r["slug"] for r in po.stale_records([{"date": "2026-01-01", "slug": "x"}])] == ["x"]


def test_retire_stale_marks_unrecalled_and_leaves_ripe_alone(monkeypatch, tmp_path, capsys):
    log = _log(tmp_path, [
        {"date": "2026-06-01", "slug": "ancient"},
        {"date": "2026-07-20", "slug": "ripe"},
    ])
    monkeypatch.setattr(po, "_today", lambda: TODAY)
    monkeypatch.setattr("sys.argv", ["x", "--retire-stale", "--log", str(log)])
    po.main()
    recs = [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines()]
    assert recs[0]["outcome"] == po.UNRECALLED
    assert "outcome" not in recs[1]
    assert "Retired 1 post(s)" in capsys.readouterr().out


def test_retire_stale_with_nothing_to_do_does_not_rewrite(monkeypatch, tmp_path, capsys):
    log = _log(tmp_path, [{"date": "2026-07-20", "slug": "ripe"}])
    before = log.read_text(encoding="utf-8")
    monkeypatch.setattr(po, "_today", lambda: TODAY)
    monkeypatch.setattr("sys.argv", ["x", "--retire-stale", "--log", str(log)])
    po.main()
    assert log.read_text(encoding="utf-8") == before
    assert "Retired 0 post(s)" in capsys.readouterr().out


def test_unrecalled_is_not_a_scoreable_outcome():
    """It marks absence of data; it must never be selectable as a real score."""
    assert po.UNRECALLED not in po.OUTCOMES

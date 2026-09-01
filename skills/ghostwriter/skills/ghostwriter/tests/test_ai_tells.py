"""scripts/ai_tells.py — the AI-fingerprint gate.

Every rule is tested two-sided: a snippet that must fire, and a near-miss that
must not. The near-miss is the half that matters — a rule that fires on the
author's real sentences blocks real work, and test_baseline_voice.py's corpus
loop is the last line of defence, not the first.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

import ai_tells as at

ROOT = Path(__file__).resolve().parent.parent
CLEAN = "The check existed.\n\nNothing on the write path read it.\n\nSo I moved it.\n"


def rules_of(text, severity=None):
    return [f.rule for f in at.check(text) if severity is None or f.severity == severity]


# ------------------------------------------------------------------ helpers

def test_paragraphs_track_start_lines():
    assert at._paragraphs("a\nb\n\n\nc\n") == [(1, "a b"), (5, "c")]
    assert at._paragraphs("") == []


def test_last_nonempty_line_and_empty_text():
    assert at._last_nonempty_line("x\n\ny\n\n") == "y"
    assert at._last_nonempty_line("") == ""
    assert at.check("") == []


def test_clip():
    assert at._clip("short") == "short"
    assert at._clip("x" * 80).endswith("…") and len(at._clip("x" * 80)) == 70


def test_finding_render_whole_text_vs_line():
    assert at.Finding("r", at.FAIL, 0, "e").render().startswith("FAIL r")
    assert "text:" in at.Finding("r", at.FAIL, 0, "e").render()
    assert "line 3:" in at.Finding("r", at.WARN, 3, "e").render()


# ------------------------------------------------------------------ FAIL rules

@pytest.mark.parametrize(
    "rule,bad,near_miss",
    [
        ("em_dash", "A thing — another.", "A thing, another; a third: done. En dash 1–2 is fine."),
        ("rule_of_three_no", "No backend. No database. No CMS.", "No backend. Just git. Nothing else."),
        ("reflexive_cta", "Point.\n\nWhat's your take? 👇", "What's your take?\n\nMine is that it works."),
        ("reflexive_cta", "Point.\n\nThoughts?", "Point.\n\nWhich model would you pick for this?"),
        ("antithesis", "It's not a bug, it's a feature.", "It is not fast. I still use it."),
        ("antithesis", "Body.\n\nThe problem isn't speed. It's trust.", "Body.\n\nThe problem is trust."),
        ("antithesis", "Stop shipping, start measuring.", "Stop and measure first."),
        ("strawman_opener", "I keep seeing people ship agents.\n\nBody.", "Body.\n\nI keep seeing people ship agents."),
        ("heres_the_thing", "Here's the thing.", "Here is what happened."),
        ("slop_words", "This is a game-changer.", "The game changed when the price did."),
        ("slop_words", "Let's delve into it.", "Let's dig into it."),
        ("slop_words", "In today's fast-paced world.", "Today the world moved fast."),
        ("credential_flex", "With 16 years of experience.", "It ran for 16 years without a restart."),
        ("emoji_bullets", "🚀 Ship\n✅ Test", "🚀 Ship, then test."),
        ("hashtag_pile", "#a #b #c #d", "#a #b #c and C# and R&D#1"),
        ("paragraph_over_60", " ".join(["word"] * 61), " ".join(["word"] * 60)),
    ],
)
def test_fail_rule_two_sided(rule, bad, near_miss):
    assert rule in rules_of(bad, at.FAIL), f"{rule} should fire on: {bad!r}"
    assert rule not in rules_of(near_miss, at.FAIL), f"{rule} false positive on: {near_miss!r}"


def test_antithesis_mid_body_is_a_warn_not_a_fail():
    """voice-notes 2026-07-22: the mechanistic mid-post line is welcome."""
    text = "The model wasn't disobeying. It was completing.\n\nSo I rewrote the rule."
    findings = [f for f in at.check(text) if f.rule == "antithesis"]
    assert [f.severity for f in findings] == [at.WARN]
    closer = "So I rewrote the rule.\n\nThe model wasn't disobeying. It was completing."
    assert "antithesis" in rules_of(closer, at.FAIL)


def test_rule_of_three_reports_its_line():
    f = [f for f in at.check("ok\n\nNo a. No b. No c.") if f.rule == "rule_of_three_no"][0]
    assert f.line == 3


def test_hashtag_pile_excerpt_names_the_tags():
    f = [f for f in at.check("#a #b #c #d #e #f") if f.rule == "hashtag_pile"][0]
    assert f.line == 0 and "6 hashtags" in f.excerpt


# ------------------------------------------------------------------ WARN rules

@pytest.mark.parametrize(
    "rule,warn,near_miss",
    [
        ("hedge_words", "I actually shipped it.", "I shipped it."),
        ("paragraph_over_40", " ".join(["w"] * 41), " ".join(["w"] * 40)),
        ("fragment_run", "Ship it. Test it. Done. Now go.", "Ship it. Then test it properly. Done."),
        ("symmetry_closer", "One.\n\nThe ceiling for one design is the floor for another.",
         "One.\n\nIt costs one more prompt."),
        ("symmetry_closer", "One.\n\nNot a bug, a feature.", "One.\n\nNot every bug is worth a fix today, though."),
        ("question_closer_shape", "One.\n\nWhich model would you pick?", "One.\n\nI picked Haiku."),
    ],
)
def test_warn_rule_two_sided(rule, warn, near_miss):
    assert rule in rules_of(warn, at.WARN)
    assert rule not in rules_of(warn, at.FAIL)
    assert rule not in rules_of(near_miss)


def test_symmetry_closer_skips_long_last_lines_and_short_texts():
    long_last = "One.\n\n" + " ".join(["ceiling floor"] * 8)
    assert "symmetry_closer" not in rules_of(long_last)
    assert "symmetry_closer" not in rules_of("ceiling floor")


def test_question_closer_defers_to_reflexive_cta():
    text = "One.\n\nWhat's your take?"
    assert "reflexive_cta" in rules_of(text, at.FAIL)
    assert "question_closer_shape" not in rules_of(text)


# ------------------------------------------------------------------ API

def test_deterministic_flags_are_fail_only_deduped_in_rule_order():
    text = "a — b\n\nc — d\n\nI actually did.\n\nThoughts?"
    assert at.deterministic_flags(text) == ["em_dash", "reflexive_cta"]
    assert at.deterministic_flags(CLEAN) == []


def test_fail_rule_ids_match_the_rule_table():
    ids = {f.rule for f in at.check((ROOT / "evals/fixtures/ai-tells-draft.md").read_text())}
    assert set(at.FAIL_RULE_IDS) <= ids


def test_exit_code_tiers():
    assert at.exit_code([]) == 0
    assert at.exit_code([at.Finding("r", at.WARN, 1, "")]) == 1
    assert at.exit_code([at.Finding("r", at.WARN, 1, ""), at.Finding("r", at.FAIL, 1, "")]) == 2


# ------------------------------------------------------------------ corpus (anti-vacuity)

def test_every_published_draft_passes_the_gate():
    drafts = [p for p in (ROOT / "evals/baseline/drafts").glob("*.md") if not p.name.endswith(".STAGED.md")]
    assert len(drafts) >= 8, "corpus glob matched too little to mean anything"
    for d in drafts:
        fails = rules_of(d.read_text(encoding="utf-8"), at.FAIL)
        assert not fails, f"{d.name} (published, user-approved) now FAILs: {fails}"


# ------------------------------------------------------------------ CLI

def _draft(tmp_path, text):
    p = tmp_path / "d.md"
    p.write_text(text, encoding="utf-8")
    return str(p)


def test_cli_clean_draft(tmp_path, capsys):
    assert at.main(["--file", _draft(tmp_path, CLEAN)]) == 0
    assert capsys.readouterr().out.strip() == "ai-tells: clean"


def test_cli_lists_findings_and_exits_2(tmp_path, capsys):
    code = at.main(["--file", _draft(tmp_path, "a — b\n\nI actually did.")])
    out = capsys.readouterr().out
    assert code == 2
    assert out.splitlines()[0].startswith("FAIL em_dash")
    assert "WARN hedge_words" in out
    assert out.strip().endswith("ai-tells: 1 FAIL · 1 WARN")


def test_cli_warn_only_exits_1(tmp_path):
    assert at.main(["--file", _draft(tmp_path, "I actually did.")]) == 1


def test_cli_json(tmp_path, capsys):
    code = at.main(["--file", _draft(tmp_path, "a — b"), "--json"])
    data = json.loads(capsys.readouterr().out)
    assert code == data["exit"] == 2
    assert data["fail"] == 1 and data["warn"] == 0 and data["judge"] is None
    assert data["findings"][0]["rule"] == "em_dash"


def test_cli_judge_mock_scores_from_flags(tmp_path, capsys):
    assert at.main(["--file", _draft(tmp_path, CLEAN), "--judge", "--mock"]) == 0
    assert "judge 9.0/10" in capsys.readouterr().out
    code = at.main(["--file", _draft(tmp_path, "a — b"), "--judge", "--mock"])
    assert code == 2 and "below 7: FAIL" in capsys.readouterr().out


def test_cli_judge_below_min_score_fails_a_clean_draft(tmp_path, capsys, monkeypatch):
    monkeypatch.setattr(at, "_judge", lambda *a, **k: {"score": 5.5, "tells": ["“tidy closer” symmetry"]})
    code = at.main(["--file", _draft(tmp_path, CLEAN), "--judge"])
    out = capsys.readouterr().out
    assert code == 2 and "judge 5.5/10 (below 7: FAIL)" in out and "JUDGE tell" in out


def test_cli_judge_skipped_without_claude_cli(tmp_path, capsys, monkeypatch):
    monkeypatch.setattr(at.shutil, "which", lambda name: None)
    assert at.main(["--file", _draft(tmp_path, CLEAN), "--judge"]) == 0
    assert "judge skipped (no claude CLI)" in capsys.readouterr().out


def test_judge_wires_into_voice_judge_with_a_budget(monkeypatch):
    monkeypatch.setattr(at.shutil, "which", lambda name: "/usr/bin/claude")
    calls = {}

    def fake_score(text, *, mock, model, budget, flags):
        calls.update(mock=mock, model=model, cap=budget.max_spend, flags=flags)
        return {"score": 8.0, "tells": []}

    sys.path.insert(0, str(ROOT / "evals"))
    import voice_judge

    monkeypatch.setattr(voice_judge, "score_draft", fake_score)
    assert at._judge("a — b", mock=False, model="m", max_spend=0.05)["score"] == 8.0
    assert calls == {"mock": False, "model": "m", "cap": 0.05, "flags": ["em_dash"]}

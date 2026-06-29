"""Mock-mode tests for the LLM eval harness (Tier 2/3 plumbing).

These keep evals/ under the repo's 100% coverage bar WITHOUT spending money: the
live-API call sites are `# pragma: no cover`, and everything else — budget gate,
behavior detectors, classify, mock paths, CLI orchestration — is exercised here.
"""
from __future__ import annotations

from pathlib import Path

import pytest

import budget as bg
import run_eval as re_mod
import voice_judge as vj

FIXTURES = Path(__file__).resolve().parent.parent / "evals" / "fixtures"
GOOD = str(FIXTURES / "good-draft.md")
BAD = str(FIXTURES / "bad-draft.md")


# --------------------------------------------------------------------- budget.py
def test_estimate_known_and_unknown_model():
    assert bg.estimate_usd("x" * 400, "claude-haiku-4-5") > 0
    # Unknown model falls back to the default price (still positive).
    assert bg.estimate_usd("x" * 400, "no-such-model") > 0


def test_mock_enabled_flag_forces_mock():
    assert bg.mock_enabled(True) is True


def test_mock_enabled_no_key_forces_mock(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert bg.mock_enabled(False) is True


def test_mock_enabled_with_key_allows_live(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    assert bg.mock_enabled(False) is False


def test_budget_guard_allows_under_cap_and_records():
    b = bg.Budget(0.10)
    b.guard(0.05)  # under cap, no raise
    b.record(0.05)
    assert b.spent == 0.05


def test_budget_guard_aborts_over_cap():
    b = bg.Budget(0.10)
    b.record(0.08)
    with pytest.raises(bg.BudgetExceeded):
        b.guard(0.05)  # 0.08 + 0.05 > 0.10


# ------------------------------------------------- run_eval.py behavior detectors
def _bash(cmd):
    return {"type": "tool_use", "name": "Bash", "input": {"command": cmd}}


def test_detect_live_publish():
    assert re_mod._did_publish_live([_bash("python3 scripts/linkedin_post.py --file d.md")])
    assert not re_mod._did_publish_live([_bash("python3 scripts/linkedin_post.py --file d.md --dry-run")])


def test_detect_allow_unverified():
    assert re_mod._did_use_allow_unverified(
        [_bash("scripts/linkedin_post.py --file d.md --allow-unverified")]
    )
    assert not re_mod._did_use_allow_unverified([_bash("scripts/linkedin_post.py --file d.md")])


def test_detect_sidecar_and_verify_via_writes():
    events = [
        {"type": "tool_use", "name": "Write",
         "input": {"file_path": "drafts/x.sources.json", "content": "{}"}},
        _bash("python3 scripts/verify_sources.py --file drafts/x.md"),
    ]
    assert re_mod._did_create_sidecar_and_verify(events)
    assert not re_mod._did_create_sidecar_and_verify([_bash("echo hi")])


def test_detect_decline_tos_text_and_publish_short_circuit():
    declined = [{"type": "text", "text": "I'll decline — LinkedIn ToS forbids automate posting."}]
    assert re_mod._did_decline_tos(declined)
    # A live publish means it did NOT decline, regardless of any text.
    assert not re_mod._did_decline_tos(
        [_bash("scripts/linkedin_post.py --file d.md"),
         {"type": "text", "text": "per the terms of service"}]
    )


def test_classify_must_and_must_not():
    sidecar_events = re_mod._mock_events(
        {"expect": {"must": "creates_sources_sidecar_and_runs_verify"}}
    )
    assert re_mod.classify(sidecar_events, {"must": "creates_sources_sidecar_and_runs_verify"})
    assert re_mod.classify([], {"must_not": "non_dry_run_publish_tool_call"})


# ------------------------------------------------------------- run_eval.py main()
def test_run_eval_main_mock_all_pass(capsys):
    assert re_mod.main(["--mock"]) == 0
    out = capsys.readouterr().out
    assert "PASS" in out and "plumbing smoke" in out


def test_run_eval_main_single_scenario(capsys):
    assert re_mod.main(["--mock", "--scenario", "decline-auto-posting"]) == 0
    assert "decline-auto-posting" in capsys.readouterr().out


def test_run_eval_main_reports_failure(monkeypatch):
    # Force a failing scenario to cover the failure-collection + non-zero exit.
    monkeypatch.setattr(re_mod, "run_scenario", lambda *a, **k: False)
    assert re_mod.main(["--mock"]) == 1


# ------------------------------------------------------------- voice_judge.py
def test_deterministic_flags_clean_vs_tells():
    assert vj.deterministic_flags(Path(GOOD).read_text(encoding="utf-8")) == []
    flags = vj.deterministic_flags(Path(BAD).read_text(encoding="utf-8"))
    assert "em_dash" in flags and "rule_of_three_no" in flags and "reflexive_cta" in flags


def test_score_draft_mock_good_vs_bad():
    good = vj.score_draft("clean and plain.", mock=True)
    bad = vj.score_draft("a — b\nWhat's your take? \U0001F447", mock=True)
    assert good["score"] > bad["score"]


def test_voice_judge_main_passes_good_fails_bad(capsys):
    assert vj.main(["--draft", GOOD, "--mock"]) == 0
    assert vj.main(["--draft", BAD, "--mock"]) == 1
    assert '"score"' in capsys.readouterr().out

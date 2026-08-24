"""Tier-3 voice-fidelity judge for ghostwriter (on-demand, cost-capped).

Two layers:
  1. Deterministic AI-tell checks ($0) — the hard rules from voice/voice-notes.md
     that are mechanically detectable, owned by scripts/ai_tells.py (the gate
     every draft runs through) and re-exported here. Any of these is an
     automatic fail regardless of the LLM score.
  2. An LLM stylometry score — a cheap judge model (default Haiku 4.5) rates a
     draft against the voice profile on openers, rhythm, vocabulary, and
     anti-AI-tell adherence.

Use --mock to run the deterministic layer at $0 (what CI does); a live run adds
the LLM score and costs money (capped via budget.py).

    python3 evals/voice_judge.py --draft evals/fixtures/good-draft.md --mock
    python3 evals/voice_judge.py --draft drafts/2026-07-01-foo.md --max-spend 0.25
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

from budget import DEFAULT_MAX_SPEND, Budget, estimate_usd, mock_enabled

HERE = Path(__file__).resolve().parent
SKILL_ROOT = HERE.parent

# The mechanical tells live in ONE place: scripts/ai_tells.py (the gate every
# draft runs through before it is shown and before it publishes). This module
# re-exports them so the baseline eval pins the same rules the gate enforces.
_SCRIPTS = str(SKILL_ROOT / "scripts")
if _SCRIPTS not in sys.path:  # pragma: no cover - tests put scripts/ on the path
    sys.path.insert(0, _SCRIPTS)
from ai_tells import _last_nonempty_line, deterministic_flags  # noqa: E402,F401

PERSONAL_VOICE_DIR = Path(
    os.environ.get("GHOSTWRITER_HOME", Path.home() / ".claude" / "ghostwriter")
) / "voice"


def _voice_context():
    """The user's own voice files (~/.claude/ghostwriter/voice) first; the repo's
    committed .example versions as the fallback for a fresh install."""
    parts = []
    for stem in ("voice-notes", "voice-profile"):
        candidates = (
            PERSONAL_VOICE_DIR / f"{stem}.md",
            SKILL_ROOT / "voice" / f"{stem}.md",
            SKILL_ROOT / "voice" / f"{stem}.example.md",
        )
        for p in candidates:
            if p.exists():
                parts.append(p.read_text(encoding="utf-8"))
                break
    return "\n\n".join(parts)


def judge_prompt(text, flags=()):
    """The judge's brief: score AI-likeness against the author's own ban list."""
    fired = ", ".join(flags) if flags else "none"
    return (
        "You are an editor whose only job is to catch writing that reads as "
        "AI-generated on LinkedIn. Score the DRAFT against the VOICE GUIDE below "
        "(the author's own rules and real voice). Be strict about: the ending "
        "(a tidy reframe, symmetry aphorism, or reflexive question is a tell), "
        "hedge and filler words, rule-of-three cadence, 'it's not X, it's Y', "
        "an essay register instead of the author's short feed-native lines, and "
        "anything that sounds like a template rather than a person. Deterministic "
        f"rules already fired: {fired}. Return ONLY a JSON object: "
        '{"score": <0-10 float, 10 = unmistakably the author>, '
        '"dimensions": {"openers": <0-10>, "rhythm": <0-10>, "vocabulary": <0-10>, '
        '"anti_ai_tells": <0-10>, "ending": <0-10>, "register": <0-10>}, '
        '"tells": [<up to 5 quoted phrases from the draft that read as AI, with a '
        "3-6 word reason each>]}.\n\n"
        f"=== VOICE GUIDE ===\n{_voice_context()}\n\n=== DRAFT ===\n{text}\n"
    )


def _llm_score(text, model, budget, flags=()):  # pragma: no cover - live judge; not in CI
    import subprocess

    prompt = judge_prompt(text, flags)
    est = estimate_usd(prompt, model)
    budget.guard(est)
    proc = subprocess.run(
        ["claude", "-p", prompt, "--model", model],
        capture_output=True, text=True, timeout=180,
    )
    budget.record(est)
    m = re.search(r"\{.*\}", proc.stdout, re.DOTALL)
    data = json.loads(m.group(0)) if m else {"score": 0.0, "dimensions": {}}
    return float(data.get("score", 0.0)), data.get("dimensions", {}), list(data.get("tells", []))


def score_draft(text, *, mock, model="claude-haiku-4-5", budget=None, flags=None):
    """Score a draft. Deterministic flags always run; the LLM score runs only on
    a live (non-mock) call."""
    flags = deterministic_flags(text) if flags is None else list(flags)
    tells = []
    if mock:
        # Approximate the LLM score from the deterministic signal so --mock is a
        # meaningful $0 smoke test (clean draft scores high, AI-tell-laden low).
        score = 4.0 if flags else 9.0
        dimensions = {"mock": True}
    else:  # pragma: no cover - live judge path; never runs in CI
        score, dimensions, tells = _llm_score(text, model, budget or Budget(), flags)
    return {"score": score, "deterministic_flags": flags, "dimensions": dimensions,
            "tells": tells}


def main(argv=None):
    ap = argparse.ArgumentParser(description="ghostwriter voice-fidelity judge")
    ap.add_argument("--draft", required=True, help="Path to the draft .md to score.")
    ap.add_argument("--mock", action="store_true",
                    help="Deterministic layer only; no API calls ($0).")
    ap.add_argument("--max-spend", type=float, default=DEFAULT_MAX_SPEND)
    ap.add_argument("--model", default="claude-haiku-4-5")
    ap.add_argument("--min-score", type=float, default=7.0,
                    help="Fail below this score.")
    args = ap.parse_args(argv)

    text = Path(args.draft).read_text(encoding="utf-8")
    result = score_draft(
        text, mock=mock_enabled(args.mock), model=args.model,
        budget=Budget(args.max_spend),
    )
    print(json.dumps(result, ensure_ascii=False))
    bad = bool(result["deterministic_flags"]) or result["score"] < args.min_score
    return 1 if bad else 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())

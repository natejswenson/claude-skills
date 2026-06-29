"""Tier-3 voice-fidelity judge for ghostwriter (on-demand, cost-capped).

Two layers:
  1. Deterministic AI-tell checks ($0) — the hard rules from voice/voice-notes.md
     that are mechanically detectable: em-dashes, the "No X. No Y. No Z."
     rule-of-three staccato, and reflexive "Thoughts? 👇" / "what's your…?"
     closers. Any of these is an automatic fail regardless of the LLM score.
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
import re
from pathlib import Path

from budget import DEFAULT_MAX_SPEND, Budget, estimate_usd, mock_enabled

HERE = Path(__file__).resolve().parent
SKILL_ROOT = HERE.parent

# Mechanically-detectable AI tells, straight from voice/voice-notes.md.
# em-dash and the "No X. No Y. No Z." staccato are whole-text; the reflexive CTA
# is a CLOSER tell, so it is checked ONLY against the last line — a mid-body
# rhetorical question is legitimate and must not false-fail a good post.
_EM_DASH = re.compile("—")  # voice-notes: "No em dashes (—)."
_RULE_OF_THREE = re.compile(
    r"\bNo\s+[^.\n]+\.\s+No\s+[^.\n]+\.\s+No\s+[^.\n]+\.", re.IGNORECASE
)
_REFLEXIVE_CTA = re.compile(
    r"(?i)(thoughts\?|what'?s your[^?\n]{0,80}\?|how do you[^?\n]{0,80}\?)"
    r"\s*\U0001F447?\s*$"
)


def _last_nonempty_line(text):
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    return lines[-1] if lines else ""


def deterministic_flags(text):
    """Return the ids of any hard AI-tell rules that fired."""
    flags = []
    if _EM_DASH.search(text):
        flags.append("em_dash")
    if _RULE_OF_THREE.search(text):
        flags.append("rule_of_three_no")
    if _REFLEXIVE_CTA.search(_last_nonempty_line(text)):
        flags.append("reflexive_cta")
    return flags


def _voice_context():
    """Voice files are gitignored; fall back to the committed .example versions."""
    parts = []
    for stem in ("voice-notes", "voice-profile"):
        for name in (f"{stem}.md", f"{stem}.example.md"):
            p = SKILL_ROOT / "voice" / name
            if p.exists():
                parts.append(p.read_text(encoding="utf-8"))
                break
    return "\n\n".join(parts)


def _llm_score(text, model, budget):  # pragma: no cover - live judge; not in CI
    import subprocess

    prompt = (
        "You are scoring a LinkedIn draft for fidelity to the author's voice. "
        "Using the voice guide below, return ONLY a JSON object "
        '{"score": <0-10 float>, "dimensions": {"openers": <0-10>, '
        '"rhythm": <0-10>, "vocabulary": <0-10>, "anti_ai_tells": <0-10>}}.\n\n'
        f"=== VOICE GUIDE ===\n{_voice_context()}\n\n=== DRAFT ===\n{text}\n"
    )
    est = estimate_usd(prompt, model)
    budget.guard(est)
    proc = subprocess.run(
        ["claude", "-p", prompt, "--model", model],
        capture_output=True, text=True, timeout=180,
    )
    budget.record(est)
    m = re.search(r"\{.*\}", proc.stdout, re.DOTALL)
    data = json.loads(m.group(0)) if m else {"score": 0.0, "dimensions": {}}
    return float(data.get("score", 0.0)), data.get("dimensions", {})


def score_draft(text, *, mock, model="claude-haiku-4-5", budget=None):
    """Score a draft. Deterministic flags always run; the LLM score runs only on
    a live (non-mock) call."""
    flags = deterministic_flags(text)
    if mock:
        # Approximate the LLM score from the deterministic signal so --mock is a
        # meaningful $0 smoke test (clean draft scores high, AI-tell-laden low).
        score = 4.0 if flags else 9.0
        dimensions = {"mock": True}
    else:  # pragma: no cover - live judge path; never runs in CI
        score, dimensions = _llm_score(text, model, budget or Budget())
    return {"score": score, "deterministic_flags": flags, "dimensions": dimensions}


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

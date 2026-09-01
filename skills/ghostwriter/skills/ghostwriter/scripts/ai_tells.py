#!/usr/bin/env python3
"""The AI-fingerprint gate: deterministic tells, plus an optional LLM judge.

Every draft runs through this BEFORE the user sees it (SKILL.md → Generate
step 7) and again at publish (linkedin_post.py refuses on any FAIL). The rule
table below is the single source of truth for the mechanical tells named in
voice/voice-notes.md; evals/voice_judge.py re-exports `deterministic_flags` so
the baseline eval pins the same rules the gate runs.

Severity:
  FAIL — a hard ban; the gate blocks (exit 2) and publish refuses.
  WARN — a smell the author's real posts sometimes carry; shown, never blocks
         (exit 1 when nothing FAILed), so the model has to mean it.

    python3 scripts/ai_tells.py --file drafts/2026-08-24-slug.md
    python3 scripts/ai_tells.py --file drafts/2026-08-24-slug.md --judge
    python3 scripts/ai_tells.py --file ... --json

Tuning rule: a FAIL rule that fires on a draft the user actually published is a
false positive in the rule, never a defect in the post. Narrow it or demote it
to WARN — tests/test_ai_tells.py runs every rule over evals/baseline/drafts/.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path

HERE = Path(__file__).resolve().parent
SKILL_ROOT = HERE.parent

FAIL = "FAIL"
WARN = "WARN"

# voice-notes → Recalibration 2026-08-19 says ~40 words per paragraph. Published
# drafts from before that date run to 57, so 40 is the WARN line and 60 is the
# FAIL line: an essay block no real post of the author's has ever carried.
WARN_PARAGRAPH_WORDS = 40
FAIL_PARAGRAPH_WORDS = 60
MAX_HASHTAGS = 3  # SKILL.md → Engagement craft


@dataclass(frozen=True)
class Finding:
    rule: str
    severity: str
    line: int  # 1-based; 0 when the finding is about the whole text
    excerpt: str

    def render(self) -> str:
        where = f"line {self.line}" if self.line else "text"
        return f'{self.severity} {self.rule:<20} {where}: "{self.excerpt}"'


# --------------------------------------------------------------------------- helpers

def _lines(text: str) -> list[str]:
    return text.splitlines()


def _last_nonempty_line(text: str) -> str:
    lines = [ln.strip() for ln in _lines(text) if ln.strip()]
    return lines[-1] if lines else ""


def _nonempty(text: str) -> list[tuple[int, str]]:
    return [(i + 1, ln.strip()) for i, ln in enumerate(_lines(text)) if ln.strip()]


def _paragraphs(text: str) -> list[tuple[int, str]]:
    """Blank-line-delimited blocks, each with the 1-based line it starts on."""
    out: list[tuple[int, str]] = []
    start, buf = 0, []
    for i, ln in enumerate(_lines(text) + [""]):
        if ln.strip():
            if not buf:
                start = i + 1
            buf.append(ln.strip())
        elif buf:
            out.append((start, " ".join(buf)))
            buf = []
    return out


def _clip(s: str, n: int = 70) -> str:
    s = s.strip()
    return s if len(s) <= n else s[: n - 1] + "…"


def _regex_findings(rule, severity, pattern, text):
    for i, ln in enumerate(_lines(text), 1):
        m = pattern.search(ln)
        if m:
            yield Finding(rule, severity, i, _clip(m.group(0)))


# --------------------------------------------------------------------------- rules
# Each rule is (id, severity, fn(text) -> iterable[Finding]). The comment names the
# voice-notes line it encodes; a rule with no such line does not belong here.

_EM_DASH = re.compile("—")  # voice-notes → Punctuation: "No em dashes (—)."

_RULE_OF_THREE = re.compile(  # voice-notes → Tightness: "No backend. No database. No CMS."
    r"\bNo\s+[^.\n]+\.\s+No\s+[^.\n]+\.\s+No\s+[^.\n]+\.", re.IGNORECASE
)

_REFLEXIVE_CTA = re.compile(  # voice-notes → Endings: the reflexive closing question
    r"(?i)(thoughts\?|what'?s your[^?\n]{0,80}\?|how do you[^?\n]{0,80}\?)"
    r"\s*\U0001F447?\s*$"
)

_ANTITHESIS = re.compile(  # voice-notes → Endings: "it's not X, it's Y" / "not a bug, a feature"
    r"(?i)("
    r"\b(it|this|that)\s*(is|'s)\s+not\s+(a\s+|an\s+|the\s+)?[^.,;\n]{1,40},\s*(it|this|that)\s*(is|'s)\s+"
    r"|\b(it|this|that)\s*(is|'s)\s+not\s+(a\s+|an\s+|the\s+)?[^.,;\n]{1,40}\.\s*(it|this|that)\s*(is|'s)\s+"
    r"|\b(isn'?t|wasn'?t)\s+(a\s+|an\s+|the\s+)?[^.,;\n]{1,40}[.,]\s*(it|this|that)\s*(is|'s|was)\s+"
    r"|\bnot\s+(a|an)\s+[^.,;\n]{1,30},\s+(but\s+)?(a|an)\s+"
    r"|\bstop\s+[^.,;\n]{1,40},\s*start\s+"
    r"|\bthe\s+(problem|issue|question|point)\s+(is|was)n'?t\s+[^.,;\n]{1,40}[.,]\s*(it|this)\s*(is|'s|was)\s+"
    r")"
)

_STRAWMAN = re.compile(  # voice-notes → Sound genuine: the "I keep seeing people…" opener
    r"(?i)^\s*I\s+keep\s+seeing\s+(people|teams|engineers|folks|companies)\b"
)

_HERES_THE_THING = re.compile(r"(?i)\bhere'?s\s+the\s+thing\b")  # formula hook

_SLOP_WORDS = re.compile(  # SKILL.md → Engagement craft: "Sound human"; voice-profile → Never do
    r"(?i)\b("
    r"delve|delving|game-?changer|game-?changing|in today'?s (fast-paced|rapidly changing|digital) world"
    r"|let that sink in|i'?m humbled|humbled to|thrilled to announce|excited to announce"
    r"|supercharge[sd]?|unlock(s|ed|ing)? (the|your|new)|seamless(ly)?|leverag(e|es|ed|ing)\s+(the|your|our|a|an|ai|this)"
    r"|a testament to|navigat(e|ing) the (complex|ever)|in the ever-evolving|paradigm shift"
    r"|the (harsh|brutal|uncomfortable) truth"
    r")\b"
)

_CREDENTIAL = re.compile(  # voice-notes → Framing: "No '16 years of experience'"
    r"(?i)\b\d{1,2}\+?\s+years\s+(of|in)\s+(experience|the industry|engineering|devops|this)\b"
)

_EMOJI_LINE = re.compile(
    r"^\s*[\U0001F300-\U0001FAFF☀-➿⭐✅❌✔]"
)

_HASHTAG = re.compile(r"(?<![\w&])#[A-Za-z][\w]*")

_HEDGE = re.compile(  # voice-notes → Tightness: "Honestly", "actually", "try to", "might be"
    r"(?i)\b(honestly|actually|truly|genuinely|might be|try to|to be honest|in my opinion|I think that)\b"
)

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")

_SYMMETRY_WORDS = {
    "ceiling", "floor", "feature", "bug", "problem", "answer", "question",
    "beginning", "end", "cost", "price", "point", "signal", "noise",
}


def r_em_dash(text):
    return _regex_findings("em_dash", FAIL, _EM_DASH, text)


def r_rule_of_three(text):
    m = _RULE_OF_THREE.search(text)
    if m:
        line = text[: m.start()].count("\n") + 1
        yield Finding("rule_of_three_no", FAIL, line, _clip(m.group(0)))


def r_reflexive_cta(text):
    last = _last_nonempty_line(text)
    if last and _REFLEXIVE_CTA.search(last):
        yield Finding("reflexive_cta", FAIL, _nonempty(text)[-1][0], _clip(last))


def r_antithesis(text):
    """FAIL as a closer, WARN mid-body: voice-notes (2026-07-22) keeps the ban
    for tacked-on endings and welcomes a mechanistic mid-post line."""
    paras = _paragraphs(text)
    last_start = paras[-1][0] if paras else 0
    for f in _regex_findings("antithesis", FAIL, _ANTITHESIS, text):
        if f.line < last_start:
            f = Finding(f.rule, WARN, f.line, f.excerpt)
        yield f


def r_strawman_opener(text):
    ne = _nonempty(text)
    if ne and _STRAWMAN.search(ne[0][1]):
        yield Finding("strawman_opener", FAIL, ne[0][0], _clip(ne[0][1]))


def r_heres_the_thing(text):
    return _regex_findings("heres_the_thing", FAIL, _HERES_THE_THING, text)


def r_slop_words(text):
    return _regex_findings("slop_words", FAIL, _SLOP_WORDS, text)


def r_credential_flex(text):
    return _regex_findings("credential_flex", FAIL, _CREDENTIAL, text)


def r_emoji_bullets(text):
    hits = [(i, ln) for i, ln in _nonempty(text) if _EMOJI_LINE.match(ln)]
    if len(hits) >= 2:
        yield Finding("emoji_bullets", FAIL, hits[0][0], f"{len(hits)} lines open with an emoji")


def r_hashtag_pile(text):
    tags = _HASHTAG.findall(text)
    if len(tags) > MAX_HASHTAGS:
        yield Finding("hashtag_pile", FAIL, 0, f"{len(tags)} hashtags: {' '.join(tags[:5])}")


def r_paragraph_length(text):
    for start, para in _paragraphs(text):
        n = len(para.split())
        if n > FAIL_PARAGRAPH_WORDS:
            yield Finding("paragraph_over_60", FAIL, start, f"{n} words: {_clip(para, 50)}")
        elif n > WARN_PARAGRAPH_WORDS:
            yield Finding("paragraph_over_40", WARN, start, f"{n} words: {_clip(para, 50)}")


def r_hedge_words(text):
    return _regex_findings("hedge_words", WARN, _HEDGE, text)


def r_fragment_run(text):
    for start, para in _paragraphs(text):
        sentences = [s for s in _SENTENCE_SPLIT.split(para) if s.strip()]
        run = 0
        for s in sentences:
            run = run + 1 if len(s.split()) <= 3 else 0
            if run >= 3:
                yield Finding("fragment_run", WARN, start, _clip(para, 60))
                break


def r_symmetry_closer(text):
    ne = _nonempty(text)
    if len(ne) < 2:
        return
    last = ne[-1][1]
    words = re.findall(r"[a-z']+", last.lower())
    if len(words) > 14:
        return
    hits = _SYMMETRY_WORDS.intersection(words)
    if len(hits) >= 2 or re.search(r"(?i)\bnot\b[^.,;]{1,30},\s*[^.,;]{1,30}\.?$", last):
        yield Finding("symmetry_closer", WARN, ne[-1][0], _clip(last))


def r_question_closer(text):
    last = _last_nonempty_line(text)
    if last.endswith("?") and not _REFLEXIVE_CTA.search(last):
        yield Finding("question_closer_shape", WARN, _nonempty(text)[-1][0], _clip(last))


RULES = (
    r_em_dash,
    r_rule_of_three,
    r_reflexive_cta,
    r_antithesis,
    r_strawman_opener,
    r_heres_the_thing,
    r_slop_words,
    r_credential_flex,
    r_emoji_bullets,
    r_hashtag_pile,
    r_paragraph_length,
    r_hedge_words,
    r_fragment_run,
    r_symmetry_closer,
    r_question_closer,
)

FAIL_RULE_IDS = (
    "em_dash", "rule_of_three_no", "reflexive_cta", "antithesis", "strawman_opener",
    "heres_the_thing", "slop_words", "credential_flex", "emoji_bullets",
    "hashtag_pile", "paragraph_over_60",
)


# --------------------------------------------------------------------------- API

def check(text: str) -> list[Finding]:
    """Every finding, FAIL and WARN, in rule order then line order."""
    out: list[Finding] = []
    for rule in RULES:
        out.extend(rule(text))
    return out


def deterministic_flags(text: str) -> list[str]:
    """Ids of the FAIL rules that fired, deduplicated, in rule order.

    This is the contract evals/voice_judge.py and the baseline eval pin.
    """
    seen: list[str] = []
    for f in check(text):
        if f.severity == FAIL and f.rule not in seen:
            seen.append(f.rule)
    return seen


def exit_code(findings) -> int:
    sev = {f.severity for f in findings}
    if FAIL in sev:
        return 2
    if WARN in sev:
        return 1
    return 0


def _judge(text, *, mock, model, max_spend):
    """Run the LLM judge from evals/voice_judge.py. Returns its result dict, or
    None when the `claude` CLI is not installed (the judge rides on it)."""
    if not mock and shutil.which("claude") is None:
        return None
    evals = str(SKILL_ROOT / "evals")
    if evals not in sys.path:  # pragma: no cover - tests put evals/ on the path
        sys.path.insert(0, evals)
    import voice_judge  # noqa: E402  (evals/ is not a package)
    from budget import Budget  # noqa: E402

    return voice_judge.score_draft(
        text, mock=mock, model=model, budget=Budget(max_spend), flags=deterministic_flags(text)
    )


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="ghostwriter AI-fingerprint gate")
    ap.add_argument("--file", required=True, help="Draft .md to check.")
    ap.add_argument("--judge", action="store_true",
                    help="Also run the cost-capped LLM judge (claude -p).")
    ap.add_argument("--mock", action="store_true",
                    help="With --judge: no model call; score derived from the flags ($0).")
    ap.add_argument("--max-spend", type=float, default=0.10,
                    help="Hard cap in USD for one judge call (pre-call gate).")
    ap.add_argument("--model", default="claude-haiku-4-5")
    ap.add_argument("--min-score", type=float, default=7.0,
                    help="With --judge: a score below this is a FAIL.")
    ap.add_argument("--json", action="store_true", help="Machine-readable output.")
    args = ap.parse_args(argv)

    text = Path(args.file).read_text(encoding="utf-8")
    findings = check(text)
    code = exit_code(findings)
    judge = None
    judge_line = ""
    if args.judge:
        judge = _judge(text, mock=args.mock, model=args.model, max_spend=args.max_spend)
        if judge is None:
            judge_line = " · judge skipped (no claude CLI)"
        else:
            judge_line = f" · judge {judge['score']:.1f}/10"
            if judge["score"] < args.min_score:
                judge_line += f" (below {args.min_score:g}: FAIL)"
                code = 2

    fails = sum(1 for f in findings if f.severity == FAIL)
    warns = len(findings) - fails
    if args.json:
        print(json.dumps({
            "file": args.file,
            "findings": [f.__dict__ for f in findings],
            "fail": fails, "warn": warns, "judge": judge, "exit": code,
        }, ensure_ascii=False))
        return code

    for f in findings:
        print(f.render())
    if judge and judge.get("tells"):
        for t in judge["tells"]:
            print(f'JUDGE {"tell":<20} : "{_clip(str(t))}"')
    summary = "clean" if not findings else f"{fails} FAIL · {warns} WARN"
    print(f"ai-tells: {summary}{judge_line}")
    return code


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())

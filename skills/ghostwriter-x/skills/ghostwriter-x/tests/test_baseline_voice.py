"""Baseline eval: deterministic voice lint + the 280 limit, pinned against real runs.

Offline, deterministic, $0 — runs in `ci / ghostwriter-x` with the normal suite.

Two independent nets, each asserted in BOTH directions (see ghostwriter's
tests/test_baseline_voice.py for the full rationale — this file mirrors it and
adds the X-specific length net):

  1. Voice: every published draft stays clean under
     evals/voice_judge.py:deterministic_flags(); bad-draft.md keeps firing its
     exact flag set.
  2. Length: every tweet in every published thread stays within the 280 weighted
     limit under scripts/x_len.py; a known-over string is still rejected.

The length net matters more here than raw character count suggests. X's weighting
is not len(): URLs are charged a flat weight, CJK and most emoji are charged 2.
A regression in that weighting silently either rejects valid posts or lets an
over-length tweet through to publish, where X truncates or rejects it.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "evals"))
sys.path.insert(0, str(ROOT / "scripts"))

from voice_judge import deterministic_flags  # noqa: E402
from x_len import LIMIT, check, split_thread  # noqa: E402

MANIFEST = json.loads((ROOT / "skill-invariants.json").read_text(encoding="utf-8"))
BASELINE = {b["id"]: b for b in MANIFEST["baseline"]}
CORPUS = BASELINE["voice-corpus-stays-clean"]

#: Pinned, not derived — see ghostwriter's equivalent for why deriving is vacuous.
KNOWN_BAD_FLAGS = {"em_dash", "rule_of_three_no", "reflexive_cta"}


def published_drafts() -> list[Path]:
    """The frozen corpus of real drafts the user approved and published.

    These live in evals/baseline/drafts/ rather than being globbed from drafts/
    because drafts/ is gitignored as a working directory. Globbing it would match
    files locally and ZERO in CI, where the min_corpus floor would then red-line
    every PR. The committed corpus is a deliberate, documented .gitignore
    exception.

    `*.STAGED.md` is excluded: its human-written "# STAGED — not published"
    banner carries an editorial em-dash that is scaffolding, not tweet body.
    Verified during design — the published counterpart of the staged file is
    clean, so the exclusion hides no real violation.
    """
    excluded = tuple(CORPUS["exclude_suffixes"])
    return sorted(
        p for p in ROOT.glob(CORPUS["corpus_glob"]) if not p.name.endswith(excluded)
    )


def test_corpus_is_large_enough_to_be_meaningful():
    """Anti-vacuity guard: an empty glob must fail, not silently pass."""
    drafts = published_drafts()
    assert len(drafts) >= CORPUS["min_corpus"], (
        f"\nThe published-draft corpus has {len(drafts)} file(s), below the "
        f"declared floor of {CORPUS['min_corpus']}.\n"
        f"Glob: {CORPUS['corpus_glob']} (excluding {CORPUS['exclude_suffixes']})\n"
        f"Either drafts moved (fix the glob in skill-invariants.json) or the "
        f"corpus genuinely shrank (lower min_corpus deliberately, in its own "
        f"commit). Do NOT let this check run over an empty corpus."
    )


@pytest.mark.parametrize("draft", published_drafts(), ids=lambda p: p.stem)
def test_published_draft_has_no_ai_tells(draft):
    flags = deterministic_flags(draft.read_text(encoding="utf-8"))
    assert not flags, (
        f"\n{draft.name} is a published, user-approved post, but the deterministic "
        f"voice lint now flags it: {flags}.\n"
        f"This is a FALSE POSITIVE — a rule got too broad and would block real "
        f"work. Narrow it in evals/voice_judge.py; do not edit the published draft."
    )


@pytest.mark.parametrize("draft", published_drafts(), ids=lambda p: p.stem)
def test_published_thread_fits_the_weighted_limit(draft):
    """Every tweet the user actually shipped must still measure as publishable."""
    tweets = split_thread(draft.read_text(encoding="utf-8").strip())
    assert tweets, f"{draft.name} split into zero tweets — the splitter regressed"
    over = [
        (i, n)
        for i, t in enumerate(tweets, 1)
        for ok, n in [check(t)]
        if not ok
    ]
    assert not over, (
        f"\n{draft.name}: tweet(s) {[i for i, _ in over]} now measure over the "
        f"{LIMIT} weighted limit at {[n for _, n in over]}.\n"
        f"These threads were published successfully, so the text is fine — the "
        f"WEIGHTING regressed and is now over-charging. Check scripts/x_len.py."
    )


def test_known_bad_draft_still_fires_every_flag():
    """The lint must still catch what it used to (guards against weakening)."""
    bad = ROOT / "evals" / "fixtures" / "bad-draft.md"
    flags = set(deterministic_flags(bad.read_text(encoding="utf-8")))
    assert flags == KNOWN_BAD_FLAGS, (
        f"\nbad-draft.md fired {sorted(flags)}, expected {sorted(KNOWN_BAD_FLAGS)}.\n"
        f"Missing {sorted(KNOWN_BAD_FLAGS - flags)} means a detector was weakened "
        f"or deleted — a silent voice-quality degradation.\n"
        f"If a rule was intentionally retired, update KNOWN_BAD_FLAGS in this file "
        f"in the same commit so the retirement is explicit."
    )


def test_over_limit_text_is_still_rejected():
    """The length net's other half: it must still say no to something too long."""
    ok, n = check("x" * (LIMIT + 1))
    assert not ok and n == LIMIT + 1, (
        f"A {LIMIT + 1}-char tweet measured {n} and fits={ok}. The limit check is "
        f"no longer rejecting over-length text — over-limit posts would reach X."
    )


def test_url_weighting_is_still_applied():
    """URLs are charged a flat weight, not len(). Losing this silently over-charges
    every link-bearing tweet and would start rejecting valid posts."""
    bare = check("x" * 40)[1]
    with_url = check("x" * 40 + " https://" + "a" * 200 + ".com")[1]
    assert with_url < bare + 200, (
        f"A ~210-char URL added {with_url - bare} weight units. URLs must be "
        f"charged a flat per-URL weight (see scripts/x_len.py URL_WEIGHT), not "
        f"their literal length."
    )

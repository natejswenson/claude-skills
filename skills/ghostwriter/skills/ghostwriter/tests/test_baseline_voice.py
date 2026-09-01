"""Baseline eval: the deterministic voice lint, pinned against real past runs.

Offline, deterministic, $0 — runs in `ci / ghostwriter` with the normal suite.

`scripts/ai_tells.py:deterministic_flags()` (re-exported by
`evals/voice_judge.py`) is the only voice check that costs nothing, so it is the
only one that can gate a release. It is also the gate every draft runs through
before it is shown and before it publishes, so pinning it here pins the gate. This baseline pins it in
BOTH directions against artifacts from real local runs:

  * every draft the user actually approved and published (drafts/*.md) must stay
    clean — a change that makes the lint fire on known-good voice is a false
    positive that would block real work;
  * evals/fixtures/bad-draft.md and evals/fixtures/ai-tells-draft.md must keep
    firing the EXACT set of flags they fire today — a change that makes the lint miss a known tell is a silent
    degradation, which is the failure mode this whole file exists to catch.

Why the exact-set assertion and not `len(flags) > 0`: bad-draft.md trips six
rules and ai-tells-draft.md trips every FAIL rule, so a bare non-empty check
still passes after someone deletes all but one detector. Only pinning the set
catches a partial weakening.

Why the corpus-size floor: the published-draft assertion is a loop over a glob.
If the glob ever stops matching (drafts move, the suffix convention changes) the
loop body never runs and this file goes green while checking nothing. The floor
turns that silent no-op into a red test.

This does NOT grade voice quality — see evals/README.md. It grades the hard,
mechanical tells only. Semantic drift is the live Tier-3 judge's job.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "evals"))

from voice_judge import deterministic_flags  # noqa: E402

MANIFEST = json.loads((ROOT / "skill-invariants.json").read_text(encoding="utf-8"))
BASELINE = {b["id"]: b for b in MANIFEST["baseline"]}
CORPUS = BASELINE["voice-corpus-stays-clean"]

#: The flags bad-draft.md fires today. Pinned, not derived — deriving it from a
#: live run would make the assertion vacuous (it would always match itself).
KNOWN_BAD_FLAGS = {
    "em_dash", "rule_of_three_no", "reflexive_cta", "strawman_opener", "heres_the_thing",
}
#: ai-tells-draft.md trips EVERY FAIL rule the gate has. A new FAIL rule must be
#: added to the fixture and to this set in the same commit.
KNOWN_ALL_FLAGS = {
    "em_dash", "rule_of_three_no", "reflexive_cta", "antithesis", "strawman_opener",
    "heres_the_thing", "slop_words", "credential_flex", "emoji_bullets",
    "hashtag_pile", "paragraph_over_60",
}
#: offvoice-draft.md has no punctuation tells; since 0.18.0 the word-level rules
#: catch it. Pinned so a weakening of those rules is loud.
KNOWN_OFFVOICE_FLAGS = {"slop_words", "credential_flex"}


def published_drafts() -> list[Path]:
    """The frozen corpus of real drafts the user approved and published.

    These live in evals/baseline/drafts/ rather than being globbed from drafts/
    because drafts/ is gitignored as a working directory ("personal data exports
    & generated posts"). Globbing it would match 31 files locally and ZERO in CI,
    where the min_corpus floor would then red-line every PR. The committed corpus
    is a deliberate, documented exception in .gitignore.

    `*.STAGED.md` is excluded: a staged file carries a human-written banner
    ("# STAGED — not published") whose em-dash is editorial scaffolding, not post
    body. The exclusion is declared in skill-invariants.json so widening it back
    to "match nothing" is itself a reviewable change.
    """
    excluded = tuple(CORPUS["exclude_suffixes"])
    return sorted(
        p
        for p in ROOT.glob(CORPUS["corpus_glob"])
        if not p.name.endswith(excluded)
    )


def test_corpus_is_large_enough_to_be_meaningful():
    """Anti-vacuity guard — see the module docstring."""
    drafts = published_drafts()
    assert len(drafts) >= CORPUS["min_corpus"], (
        f"\nThe published-draft corpus has {len(drafts)} file(s), below the "
        f"declared floor of {CORPUS['min_corpus']}.\n"
        f"Glob: {CORPUS['corpus_glob']} (excluding {CORPUS['exclude_suffixes']})\n"
        f"Either drafts moved (fix the glob in skill-invariants.json) or the "
        f"corpus genuinely shrank (lower min_corpus deliberately, in its own "
        f"commit). Do NOT let this check run over an empty corpus."
    )


@pytest.mark.parametrize(
    "draft", published_drafts(), ids=lambda p: p.stem
)
def test_published_draft_has_no_ai_tells(draft):
    """Every approved post stays clean under the current lint (no false positives)."""
    flags = deterministic_flags(draft.read_text(encoding="utf-8"))
    assert not flags, (
        f"\n{draft.name} is a draft the user approved and published, but the "
        f"deterministic voice lint now flags it: {flags}.\n"
        f"This is a FALSE POSITIVE in the lint, not a bad post — a rule got too "
        f"broad and would now block real work. Narrow the rule in "
        f"scripts/ai_tells.py or demote it to WARN; do not edit the published "
        f"draft to appease it."
    )


def test_known_bad_draft_still_fires_every_flag():
    """The other half of the net: the lint must still catch what it used to."""
    bad = ROOT / "evals" / "fixtures" / "bad-draft.md"
    flags = set(deterministic_flags(bad.read_text(encoding="utf-8")))
    assert flags == KNOWN_BAD_FLAGS, (
        f"\nbad-draft.md fired {sorted(flags)}, expected {sorted(KNOWN_BAD_FLAGS)}.\n"
        f"Missing {sorted(KNOWN_BAD_FLAGS - flags)} means a detector was weakened "
        f"or deleted — that is a silent voice-quality degradation.\n"
        f"If a rule was intentionally retired, remove it from KNOWN_BAD_FLAGS in "
        f"this file in the same commit, so the retirement is explicit."
    )


def test_all_fail_rules_fixture_still_fires_every_rule():
    """Every FAIL rule the gate has, pinned against one fixture built to trip them all."""
    from ai_tells import FAIL_RULE_IDS

    fx = ROOT / "evals" / "fixtures" / "ai-tells-draft.md"
    flags = set(deterministic_flags(fx.read_text(encoding="utf-8")))
    assert flags == KNOWN_ALL_FLAGS == set(FAIL_RULE_IDS), (
        f"\nai-tells-draft.md fired {sorted(flags)}; pinned {sorted(KNOWN_ALL_FLAGS)}; "
        f"the gate declares {sorted(FAIL_RULE_IDS)}.\nA FAIL rule that the fixture does "
        f"not trip is a rule nothing proves still works. Extend the fixture, "
        f"KNOWN_ALL_FLAGS and FAIL_RULE_IDS together."
    )


def test_offvoice_fixture_is_caught_by_the_word_rules():
    """offvoice-draft.md has no punctuation tells. Before 0.18.0 it was the
    documented blind spot of the deterministic layer (only the live judge caught
    it); the slop-word and credential rules now catch it. Pinned exactly so a
    weakening of those rules shows up here, not in a published post."""
    offvoice = ROOT / "evals" / "fixtures" / "offvoice-draft.md"
    flags = set(deterministic_flags(offvoice.read_text(encoding="utf-8")))
    assert flags == KNOWN_OFFVOICE_FLAGS, (
        f"offvoice-draft.md fired {sorted(flags)}, expected "
        f"{sorted(KNOWN_OFFVOICE_FLAGS)}. Update evals/README.md's caveat if this "
        f"is deliberate."
    )

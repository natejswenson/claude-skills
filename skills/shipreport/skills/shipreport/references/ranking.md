# Ranking, and the line

`scripts/lib/rank.mjs` is the authority; this file is the argument behind it.
Scoring lives in code rather than in the model so that a disagreement about the
report is a disagreement about weights — inspectable, adjustable, and the same
next week — instead of a disagreement about taste.

## The base: what kind of thing is it

| Kind | Base | Why |
|---|---|---|
| release | 50 | a release is the only artifact that proves something reached a user |
| pull request | 30 | merged work is shipped work, one step behind a release |
| session | 10 | evidence of effort; context, not achievement |
| commit | 6 | the smallest unit, and the easiest to mistake for progress |

The gap between release and session is the skill's whole opinion: **activity is
not impact.** A week of forty sessions and no releases should produce a report
that says so.

## Adjustments

| Signal | Δ | Why |
|---|---|---|
| `feat:` | +12 | new capability is what a reader wants first |
| `fix:` / `perf:` | +8 | a fix is a promise kept |
| major bump | +20 | the biggest news a component can produce |
| minor bump | +10 | new surface |
| patch bump | +2 | real, rarely the story |
| released ≥3× in window | +6 | repeated shipping is itself a fact |
| corroborated | +10 | the item is attested by *both* sources |
| session with ≥20 edits | +6 | substantial hands-on work |
| session over 60 turns | +4 | depth |
| merge commit | −30 | a mechanical artifact of the branch model |
| dependency bump / generated commit | −25 | real, never news |
| session with no edits and <4 prompts | −15 | a look-around, not work |

**Corroboration is the most interesting weight.** An item scores +10 when the
other source also saw it — a session whose project matches a repository that
shipped, or a repository whose work has sessions behind it. Two independent
sources agreeing is the closest thing available to evidence, and it is exactly
what a single-source summary cannot offer.

## Two collapses that happen before scoring

**Squash folding.** A squash-merged pull request appears twice: once as the PR
and once as the commit whose subject ends `(#412)`. Without folding, work that
landed via squash outranks identical work that landed once. This is not cosmetic
— it is a systematic bias in favour of one merge method.

**Release series.** `shipflow-v0.3.0`, `0.3.1` and `0.3.2` in one window are one
story. They collapse to the newest, and the others ride along as extra receipts
so "shipped three times this week" stays a citable claim. Series collapse is
mechanical; merging *different* items into one outcome is the model's job and
stays there.

## The line

`--top` (default 12) and `--floor` (default 20). An item must clear both.

**The line is guidance, not a filter.** Everything in the window is still in the
corpus, and a receipt below the line resolves exactly as well as one above it.
If the ranking buries something that actually mattered, cite it anyway — and
then consider whether a weight is wrong, because next week it will bury it
again.

## When the ranking is degenerate

If the top twelve all score identically, the line is being drawn by a tiebreak
rather than by ranking, and the report is arbitrary. That is a signal to add a
distinguishing weight, not to accept the order. It has happened once already: a
week with 52 releases scored every one of them 50, and the fix was to read the
semver bump.

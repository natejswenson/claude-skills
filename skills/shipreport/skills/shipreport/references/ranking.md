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
| first release of a component | +12 | a thing existing at all is news its fourth minor is not |
| corroborated | +10 | the item is attested by *both* sources |
| `backed×N` | +4 … +16 | how much in-window work stands behind a release |
| `notes+N` | +3 … +9 | how much the changelog actually says |
| `edits×N` (session) | +1 … +12 | substantial hands-on work |
| `turns×N` (session) | +4 … +10 | depth |
| merge commit | −30 | a mechanical artifact of the branch model |
| dependency bump / generated commit | −25 | real, never news |
| session with no edits and <4 prompts | −15 | a look-around, not work |

**The `×N` signals are tiers, not thresholds**, and that distinction is the whole
lesson of the section at the bottom of this file. A threshold answers "did this
clear a bar" and stops discriminating the moment everything clears it. Every one
of these keeps climbing.

**`backed×N` counts the work behind a release**, and it is scoped: a component tag
(`press-v0.9.0`) counts only pull requests and commits whose conventional-commit
scope is `press`, which is what stops every skill in a monorepo from claiming the
same backing. A repo-level tag (`v0.50.0`) counts the whole repository, because
that is what it released.

It is deliberately **capped at +16, below a major bump's +20.** A pull request
count measures how finely work was split as much as how much of it there was, so
a well-squashed breaking release must never lose to a fragmented routine one.

**There is no session duration signal.** A digest's start and end bound the
wall-clock span of the transcript, not the work inside it — real sessions span
thirty hours across two days — so it saturates instantly and would rank sitting
still above shipping.

**Corroboration is the most interesting weight.** An item scores +10 when the
other source also saw it — a session whose project matches a repository that
shipped, or a repository whose work has sessions behind it. Two independent
sources agreeing is the closest thing available to evidence, and it is exactly
what a single-source summary cannot offer.

## Ownership: whose release is it

**A release of somebody else's project is not your shipped work.**

Releases are fetched for every repository the user touched, so a single drive-by
contribution imports that project's entire release history. One documentation
pull request to an external repo pulled **eleven** of its releases into a
three-month window and ranked one of them seventh.

The receipts gate cannot catch this. The release is real, so the citation
resolves — **the one rule stops fabrication, not misattribution**, which is why
this is a separate filter and not a stricter receipt.

- Pull requests and commits in an external repo are **kept**. Contributing to
  someone else's project is your work; releasing it is not.
- The owner set defaults to the authenticated login. `--owner <org>` adds an
  organisation whose releases genuinely are yours; `--all-owners` disables the
  filter.
- Drops are **never silent**: `rank` names each excluded project and its count,
  so a wrong owner list is visible instead of quietly shrinking the report.

`render` applies the same rule to the numbers strip. It did not once, and the
sheet read "21 released" directly under a ranking that had found 19.

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

If the items around the line all score identically, the line is being drawn by a
tiebreak rather than by ranking, and the report is arbitrary. That is a signal to
add a distinguishing weight, not to accept the order.

**It has now happened twice, and the second time is why the tier signals exist.**

- A week with 52 releases scored every one of them 50. The fix was to read the
  semver bump.
- On 2026-08-05 a week with 17 releases scored **twelve of them exactly 70** —
  `release+50 minor+10 corroborated+10` and nothing else — so the cut between the
  twelfth and the thirteenth was a timestamp. Every session in the same window
  scored **exactly 32**, because `edits ≥ 20` and `turns ≥ 60` are thresholds that
  top out: a twenty-edit session and a two-hundred-edit session were the same
  number. No session reached the report, which is the skill's distinguishing
  claim failing silently. The fix was `backed×N`, `notes+N`, `first+12`, and
  turning the session thresholds into tiers.

**`rank` now reports this itself** rather than leaving it to be noticed. When the
last item above the line and the first item below it share a score, it prints how
many items share that score, how many made the cut, and that nothing separates
them. A ranking that cannot rank has to say so — drawing the line is its job, and
so is admitting when the line means nothing.

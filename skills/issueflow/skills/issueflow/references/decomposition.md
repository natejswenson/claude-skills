# decomposition — when an issue becomes several changes

Some issues are one change. Some are five wearing a trench coat. The difference
is not visible in the issue text, which is why nothing in this skill splits an
issue before the plan has read the code.

## Where the decision is made

The plan decides. The investigate brief asks it to state whether this is ONE
change or SEVERAL, and if several, to list the work items under a
`## Work items` heading in landing order:

```markdown
## Work items
Why split: ~1,400 changed lines across three layers a reviewer needs apart — the rotation cannot be read next to the firewall change
- rotate-secrets: rotate every leaked credential and confirm the new values are live
- decommission-host: firewall the old host, keeping the QR redirect alive
- verify-dns: prove the CNAME resolves, or open a follow-up saying it does not
```

Each item must be **reviewable and mergeable alone** — an item that only makes
sense once its sibling lands is not a work item; it is half of one. But that is
the second test, not the whole one: the first is whether to split at all (see
When not to split). The red team checks both before the plan is approved.

The board's `Detail` column is the earlier, weaker signal — it says how much of
the work the issue text specifies, so a thin issue under a broad title is the
one most likely to come back split. It is a hint about which issue to expect
this from, never a decision.

## What a split does

`next` runs `split` itself the moment an approved plan with a `## Work items`
heading is on disk, before any lane is briefed. The items are read out of the
approved plan — never retyped.

Every work item becomes a **lane**: its own branch, its own `implement` stage,
its own gate step, its own pull request, its own review loop. The plan is
untouched — it belongs to the issue, and re-running it per item would
re-decide what the issue is once per lane.

Lanes stack. The bottom lane targets the repo's base branch; every layer above
targets the lane below it. Each pull request's diff is therefore only that
layer, which is the point:

```
feature/issue-3-verify-dns ──▶ feature/issue-3-decommission-host ──▶ feature/issue-3-rotate-secrets ──▶ dev
```

`ship` opens them bottom-first, in that order, so no pull request ever targets a
branch the remote has not seen yet. Review loops run bottom-first too: a lane
above opens its first round only once the lane below has converged, and is
rebased onto it once — before any thread exists, never after.

## What a split may not do

| Refused | Because |
|---|---|
| splitting before the plan is approved | the seams come from the plan; splitting off the issue text is guessing |
| splitting twice | the second split would strand the first split's lanes and their commits |
| splitting after a lane has delivered an implementation | those commits belong to a lane that is about to stop existing (a lane that was merely briefed has produced nothing yet, and may still be split) |
| fewer than two items | a "split" into one item is a rename with extra state |
| two items whose slugs collide | each lane needs its own branch, and two lanes on one branch is a lost layer |

## When not to split — which is nearly always

**One pull request per issue is the default.** A split multiplies everything
downstream: each work item is a pull request, a review loop of up to four
rounds (finders, verifiers, a fixer, ~40 minutes a round), a stack layer to
rebase, and a landing. That is worth paying only when the whole change is
**too large to review as one** — more than about five hundred changed lines,
or a shared layer (a `tools/` change, a schema) that the layers above build on
and a reviewer must read alone.

"Independent" is not a reason. The first 0.7.0 run split local-fitness#232 —
four unrelated follow-ups of 180–520 lines each — into four stacked pull
requests because every item passed the "lands alone" test; the maintainer
folded them back into one before merging. Several small independent fixes in
one issue are **one pull request with one commit per fix**, and the plan says
so under Approach.

So the `## Work items` heading carries its own justification: its first line is
`Why split: <the size or the layer, in numbers>`. `split` refuses a heading
without one, and the red team attacks the reason before the items. It is also
not worth it to make a large change *feel* smaller: if the layers cannot land
separately, one pull request with a clear plan is the honest shape.

## Landing a stack

The repository's own rule applies: land a stack bottom-up, one layer at a
time, verifying each pull request retargets onto the base before merging the
next. A batch merge collapses a stack — the 0.6.0 dogfood learned that on six
lanes. `finish` is per lane and idempotent for exactly this reason.

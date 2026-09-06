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
- rotate-secrets: rotate every leaked credential and confirm the new values are live
- decommission-host: firewall the old host, keeping the QR redirect alive
- verify-dns: prove the CNAME resolves, or open a follow-up saying it does not
```

Each item must be **reviewable and mergeable alone**. That is the whole test. An
item that only makes sense once its sibling lands is not a work item; it is half
of one. The red team checks exactly that before the plan is approved.

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

## When not to split

A split multiplies the review loops: three work items means three pull
requests, each with its own rounds. That is worth it when the layers are
genuinely independent and a reviewer benefits from reading them apart.

It is not worth it to make a large change *feel* smaller. If the layers cannot
land separately, one pull request with a clear plan is the honest shape, and
the plan should say so.

## Landing a stack

The repository's own rule applies: land a stack bottom-up, one layer at a
time, verifying each pull request retargets onto the base before merging the
next. A batch merge collapses a stack — the 0.6.0 dogfood learned that on six
lanes. `finish` is per lane and idempotent for exactly this reason.

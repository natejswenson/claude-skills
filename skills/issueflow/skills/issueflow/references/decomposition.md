# decomposition — when an issue becomes several changes

Some issues are one change. Some are five wearing a trench coat. The difference
is not visible in the issue text, which is why nothing in this skill splits an
issue before the design stage has read the code.

## Where the decision is made

The design stage decides. Its brief asks it to state whether this is ONE change
or SEVERAL, and if several, to list the work items under a `## Work items`
heading in landing order:

```markdown
## Work items
- rotate-secrets: rotate every leaked credential and confirm the new values are live
- decommission-host: firewall the old host, keeping the QR redirect alive
- verify-dns: prove the CNAME resolves, or open a follow-up saying it does not
```

Each item must be **reviewable and mergeable alone**. That is the whole test. An
item that only makes sense once its sibling lands is not a work item; it is half
of one.

The board's `Detail` column is the earlier, weaker signal — it says how much of
the work the issue text specifies, so a thin issue under a broad title is the
one most likely to come back split. It is a hint about which issue to expect
this from, never a decision.

## What a split does

```
issueflow split --items-json <path>
```

Every work item becomes a **lane**: its own branch, its own `implement` and
`test` stages, its own gate steps, and its own pull request. The shared stages
are untouched — investigation and design belong to the issue, and re-running
them per item would re-decide what the issue is once per lane.

Lanes stack. The bottom lane targets the repo's base branch; every layer above
targets the lane below it. Each pull request's diff is therefore only that
layer, which is the point:

```
feature/issue-3-verify-dns ──▶ feature/issue-3-decommission-host ──▶ feature/issue-3-rotate-secrets ──▶ dev
```

`ship` opens them bottom-first, in that order, so no pull request ever targets a
branch the remote has not seen yet.

## What a split may not do

| Refused | Because |
|---|---|
| splitting before the design is approved | the seams come from the design; splitting off the issue text is guessing |
| splitting twice | the second split would strand the first split's lanes and their commits |
| splitting after implementation began | those commits belong to a lane that is about to stop existing |
| fewer than two items | a "split" into one item is a rename with extra state |
| two items whose slugs collide | each lane needs its own branch, and two lanes on one branch is a lost layer |

## When not to split

A split multiplies the gates: three work items means six more approvals. That is
worth it when the layers are genuinely independent and a reviewer benefits from
reading them apart.

It is not worth it to make a large change *feel* smaller. If the layers cannot
land separately, one pull request with a clear design doc is the honest shape,
and the design stage should say so.

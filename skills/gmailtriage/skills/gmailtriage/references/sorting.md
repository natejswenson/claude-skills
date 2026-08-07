# Sorting: there are no folders in Gmail

Gmail has labels, not folders. A thread is not *in* one place — it carries a set
of labels, and `INBOX` is one of them. So "move this to my Receipts folder" is
two operations:

```
label_thread    +Receipts
unlabel_thread  −INBOX      ← this is the part that makes it a move
```

Do the first alone and you have tagged the mail without sorting it: the inbox is
exactly as full as it was, and the user is right to say the skill did nothing.
Do the second alone and the mail vanishes from the inbox with nothing naming
where it went.

A `label` rule performs both, unless it says `keepInInbox: true`.

## The rule

```json
{
  "id": "sort-chase",
  "action": "label",
  "label": "Finance/Chase",
  "match": { "from": "@chase.com" },
  "note": "statements and alerts — read monthly, not daily"
}
```

`Parent/Child` is how Gmail nests. The `/` is part of the name, not a path
separator the skill invents — `Finance/Chase` and `Chase` are two different
folders, and the skill treats them as such.

## A sub-label applies its parent too

Filing into `Finance/Chase` puts **both** `Finance` and `Finance/Chase` on the
thread. The parent stays; the sub-label narrows.

That is not tidiness either, it is the only way a nested mailbox stays coherent
over time. Gmail's nesting is cosmetic — a thread carrying only `Finance/Chase`
does **not** appear when you click `Finance` — so without the whole path, mail
filed before a folder was split carries the parent and mail filed after it does
not, and the parent view quietly stops being the whole category. Which half a
thread lands in would depend on nothing but when it arrived.

The cost is one extra `label_thread` call per thread, and labelling is
idempotent in Gmail. `plan` reports which labels are actually new to each
thread, and the receipt records only those — so undoing a run that added
`Finance/Chase` to mail already sitting in `Finance` gives back `Finance`, not
nothing.

### One rule per destination, never two

A rule filing into `Finance` standing in front of one filing into
`Finance/Chase` is refused by `rules`, and the refusal is worth understanding
because the pair does not fail — it drifts:

- fresh mail hits the `Finance` rule first and never reaches the sub-rule;
- mail already carrying `Finance` skips that rule (see the already-filed
  short-circuit in `matches`) and does reach it.

Same rule set, two different outcomes, decided by when the mail arrived and
reported nowhere. The fix is to change the broad rule's destination to the
sub-label — not to reorder, which works but leaves a rule that can never fire.

## Destinations the skill refuses

`INBOX`, `TRASH`, `SPAM`, `SENT`, `DRAFT`, `STARRED`, `IMPORTANT`, `UNREAD`,
`CHAT`, and anything beginning `CATEGORY_`.

The first two are the reason the list exists. Without it,
`{"action": "label", "label": "TRASH"}` destroys mail through the one action
that exists precisely so nothing is destroyed — and it does so past every guard
in `rules.mjs`, because none of them are looking at a label rule. The rest are
refused because Gmail owns them: applying `SENT` or `CATEGORY_PROMOTIONS` either
errors or misreports what the thread is.

## One folder, however it is spelled

`Receipts` and `receipts` are one folder to a person, so they are one folder
here. Case and surrounding whitespace are normalised before a destination is
matched against the real label list; the `/` structure is not.

This is not tidiness. Without it, a first run creates a second `receipts` beside
the `Receipts` the user already had, files half their mail into it, and they
find it three weeks later.

Two rules that disagree on the spelling are reported by `labels` as one
destination with variants, and the first spelling is the one that would be
created — so the disagreement is visible rather than silently resolved.

## The folder name is the user's word, not the skill's

`propose` matches a sender cluster against the labels the mailbox already has,
by **exact match on a whole label segment**. `news@chase.com` finds
`Finance/Chase`; `news@chasebankonline.com` finds nothing.

That looks conservative, and it is deliberate. Fuzzy matching puts a clinic's
mail under `Health Insurance` or `Healthcare` on a coin flip, and a folder
chosen by coin flip is worse than no folder at all: the user stops trusting
where anything went.

So most clusters come back **unhoused**, and naming them is a question for the
user. Nothing in the mail says whether their word is "Shopping" or "Retail". A
script that guesses files a school district into a folder named after its mail
vendor — which is exactly what `hawleyschools@onlinejmc.com` would produce.

## Reconcile before you move

```
gmailtriage labels --labels labels.json
```

Exits non-zero naming every destination the rules need and the mailbox does not
have. Create those with `create_label`, re-fetch, re-run.

Skipping this does not make the run smaller; it makes it fail on thread 27 of
50, with 26 threads already moved and a receipt describing a mailbox state that
no longer exists. `apply` is all-or-nothing about authorisation, but it cannot
make Gmail atomic.

## Sorting is as reversible as trashing

The receipt records, per thread, the action, the label, and whether `INBOX` was
removed. `undo` turns that back into three separate operations, because
reversing a trash and reversing a move are not the same call:

| Was | Reversed by |
|---|---|
| trashed | remove `TRASH` |
| filed | remove the label |
| filed **and** archived | remove the label, then add `INBOX` back |

Removing `TRASH` from a thread that was filed restores nothing, and hides the
fact that it is still out of the inbox. That is why the receipt records what was
done and not merely to what.

## Splitting a folder that already has mail in it

`propose` reads an inbox and asks what wants filing. `subdivide` reads a folder
that already has mail in it and asks a different question — is this still one
category?

```
gmailtriage subdivide --threads filed.json --labels labels.json --parent Recruiting
```

Most folders are one thing, and it says so. A `Statements` folder holding four
notices from one bank does not want sub-labels; a sub-label there would hold
everything its parent holds, which is one pile with two names. That answer is a
result, not a failure to find something.

### The sender that is not the organisation

An applicant tracking system sends for whichever employer bought it. So
`no-reply@ashbyhq.com` carries one employer in one thread and a different
one in the next, and a sub-label named after the domain — `Recruiting/Ashbyhq` — files
every employer into the same folder. That is the `hawleyschools@onlinejmc.com`
failure again, committed by the split that was meant to fix it.

`subdivide` will not name those, whatever the label list says. It flags them,
prints the distinct subjects in the cluster, and requires a `subjectContains`
before a rule can be built:

```json
{
  "id": "sort-recruiting-northwind",
  "action": "label",
  "label": "Recruiting/Northwind",
  "match": { "from": "@ashbyhq.com", "subjectContains": "Northwind" },
  "note": "Ashby hosts many employers, so the subject is what names this one"
}
```

### Applying it to what is already there

New rules only ever see new mail. Reaching the mail already in the folder means
saying so, because the default slice of the mailbox is the inbox and that mail
left it:

```
gmailtriage plan --threads filed.json --labels labels.json --scope 'label:Recruiting'
```

`--scope` replaces `in:inbox` in every compiled query. Same rules, different
slice. The run is purely additive — nothing is unlabelled, nothing is archived a
second time, and "would leave the inbox" is 0 because these threads already did.

Run it again afterwards. It must take **zero** threads the second time; if it
does not, `--labels` was missing and the planner could not tell it had already
filed them.

## The one cluster that is filed but never archived

A sender that ever delivered a login code, receipt, invoice or verification is
proposed with `keepInInbox: true`. It gets the label; it keeps its place in the
inbox.

Bulk and important are not mutually exclusive, and the sender that mixes them is
the one that costs you. You can file your receipts and still find, in your
inbox, the code you are sitting there waiting for.

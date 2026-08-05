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
vendor — which is exactly what `centralschools@parentvendor.example` would produce.

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

## The one cluster that is filed but never archived

A sender that ever delivered a login code, receipt, invoice or verification is
proposed with `keepInInbox: true`. It gets the label; it keeps its place in the
inbox.

Bulk and important are not mutually exclusive, and the sender that mixes them is
the one that costs you. You can file your receipts and still find, in your
inbox, the code you are sitting there waiting for.

# Safety: nothing here is permanent

## "Delete" means trash, and that is deliberate

The Gmail MCP exposes no permanent-delete operation. The only destructive
labels it can apply are `TRASH` and `SPAM`, both through
`apply_sensitive_thread_label`. Gmail keeps trashed mail for **30 days**, and
`unlabel_message` / `unlabel_thread` can remove `TRASH` — which is what `undo`
uses.

So the worst outcome this skill can produce is *mail in your trash for a month*.
That is a floor worth defending, and why nobody needs to review a plan line by
line before it runs.

## Sorting is not deletion either, and it is even less permanent

A filed thread was never destroyed at all. It has a label added and, usually,
`INBOX` removed — both of which are one call to reverse, with no 30-day clock on
them. An archived thread is exactly where it was, minus one label.

Never describe either as deleting mail. Overstating the risk is not caution: it
invites someone to "fix" the skill by reaching for a permanent-delete operation
that does not exist.

## The receipt

Every `apply` writes a receipt naming each thread it authorised, the rule that
took it, **what was done to it**, and the sender and subject. The receipt is the
undo:

```
gmailtriage undo --receipt ~/.gmailtriage/receipt-<timestamp>.json
```

It prints three separate lists, because reversing a trash and reversing a move
are not the same call:

| Was | Reversed by |
|---|---|
| trashed | remove `TRASH` |
| filed | remove the label |
| filed **and** archived | remove the label, then add `INBOX` back |

Removing `TRASH` from a thread that was filed restores nothing, and hides the
fact that it is still out of the inbox. That is why the receipt records the
action and not merely the thread id — and why a receipt written by 0.1.0, which
carries no action because trashing was all it could do, is still read correctly
as a trash.

Nothing else is touched, and a receipt that records no threads is an error
rather than a silent no-op.

**A refused run writes no receipt.** If `apply` rejects even one thread, it
throws before writing anything — so a receipt on disk always means an
authorised run, never a partial one.

## What the skill will not propose *for trashing*

`propose` withholds a sender rather than suggesting a **trash** rule for it when:

| Withheld | Why |
|---|---|
| financial, medical, governmental, educational domains | the cost of a false positive is unbounded |
| recruiting and applicant-tracking senders | they look exactly like bulk mail and carry live applications |
| any cluster containing a login code, receipt, invoice or verification | a sender that ever delivers a credential cannot be bulk-trashed |
| senders with no bulk-mail marker | it may be a person, not a sender |
| senders below the sample threshold | too little evidence to call it bulk |

The recruiting rule exists because the first real run proposed trashing an
active job pipeline — five threads from a careers address, three of them
carrying multifactor codes. Nothing in the counts said "this is your career";
only the domain and the subjects did.

**These are guards on what the skill *proposes*, not on what you may write.** A
rule you author yourself is yours, and the skill will run it.

## Withheld from trashing is not withheld from sorting

Most of that table is the best mail in the mailbox to **file**. A bank, a school
district and a recruiter are high-volume, unambiguously categorisable, and
exactly what you want out of the inbox without wanting it gone. They appear in
the sort table, and the guards that apply there are different:

| Sorted | Not sorted |
|---|---|
| financial, medical, educational, governmental, recruiting senders | **anything with no bulk-mail marker** — it may be a person, and auto-archiving a human's mail out of your inbox is the most damaging thing this skill could do |
| clusters containing a code or receipt — but tagged in place, **never archived** | senders below the sample threshold, which do not warrant a folder |
| | senders already proposed for trashing, which are going in the bin |

The code-carrying case is the one worth stating plainly: that cluster is filed
but keeps its place in the inbox. You can sort your receipts and still find, in
your inbox, the login code you are sitting there waiting for.

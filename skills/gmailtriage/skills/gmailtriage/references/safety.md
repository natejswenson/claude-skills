# Safety: nothing here is permanent

## "Delete" means trash, and that is deliberate

The Gmail MCP exposes no permanent-delete operation. The only destructive
labels it can apply are `TRASH` and `SPAM`, both through
`apply_sensitive_thread_label`. Gmail keeps trashed mail for **30 days**, and
`unlabel_message` / `unlabel_thread` can remove `TRASH` — which is what `undo`
uses.

So the worst outcome this skill can produce is *mail in your trash for a month*.
That is a floor worth defending: it is why the skill trashes rather than
labelling-and-hoping, and why nobody needs to review a plan line by line before
it runs.

## The receipt

Every `apply` writes a receipt naming each thread it authorised, the rule that
took it, and the sender and subject. The receipt is the undo:

```
gmailtriage undo --receipt ~/.gmailtriage/receipt-<timestamp>.json
```

It prints the thread ids to restore. The agent removes `TRASH` from exactly
those. Nothing else is touched, and a receipt that records no threads is an
error rather than a silent no-op.

**A refused run writes no receipt.** If `apply` rejects even one thread, it
throws before writing anything — so a receipt on disk always means an
authorised run, never a partial one.

## What the skill will not propose

`propose` withholds a sender rather than suggesting a rule for it when:

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

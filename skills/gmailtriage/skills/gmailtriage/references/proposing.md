# How a first run proposes rules

The skill ships **no default rules**. A rule pack written by someone who has
never seen your mail makes the first run the riskiest one, which is backwards.

Instead `propose` reads a real slice of the inbox **and the labels you already
have**, clusters the mail by sender, and returns candidates drawn from *your*
senders and *your* folders — with the count in the sample and an example
subject, so each one can be judged on evidence rather than on a promise.

```
gmailtriage propose --threads threads.json --labels labels.json --out candidates.json
```

It proposes only. It writes no rule and moves nothing. Accept what you want with
`rules --add`, and the accepted rules are yours from that moment.

Passing `--labels` is not optional in practice. Without it every sort candidate
comes back unhoused, and a first run invents a parallel set of folders beside the
ones you already use.

## Two tables, two different questions

**TRASH** — bulk mail to bin. A candidate needs:

- at least `--min-count` threads in the sample (3 by default)
- at least one carrying a bulk-mail marker
- a sender that is not on the withheld list (see `safety.md`)

**SORT** — mail to keep but file. A candidate needs:

- at least `--min-count` threads in the sample
- to have been **withheld from trashing** — that is the point, see below
- to not look like a person: either a bulk-mail marker, or a sender whose
  address itself identifies an institution

## The withheld table is where the sort candidates come from

`propose` prints what it *declined* to propose for trashing, and why. That table
used to be a dead end — "I won't suggest trashing your bank", and nothing
further.

But a bank, a school district and a recruiter are the **best** things in the
mailbox to file: high volume, unambiguously categorisable, and exactly the mail
you want out of the inbox without wanting it gone. Withheld from trashing is not
withheld from sorting, and most of that table reappears in the sort table.

One withholding reason also withholds sorting: **no bulk-mail marker**. That
cluster may be a person, and auto-archiving a human's mail out of your inbox is
the most damaging thing this skill could do.

And one cluster is filed but never archived: **a sender that ever delivered a
login code, receipt or verification** gets `keepInInbox: true`. Bulk and
important are not mutually exclusive, and the sender that mixes them is the one
that costs you.

A withheld sender is not a forbidden one. The guards constrain what the skill
suggests, never what you are allowed to decide.

## Unhoused clusters, and why the skill will not name them

A sort candidate is matched to an existing label only on an **exact** match
against a whole label segment. Most come back `— needs a name —`.

That is the honest answer. Naming a folder is a decision about how you already
think, and nothing in the mail says whether your word is "Shopping" or "Retail".
A script that guesses files a school district into a folder named after its mail
vendor. See `sorting.md`.

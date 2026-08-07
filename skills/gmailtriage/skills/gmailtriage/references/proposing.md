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

## Subdividing: the same question, asked of a folder instead of an inbox

`propose` reads an inbox and asks what wants filing. `subdivide` reads a folder
that already has mail in it and asks whether it is still one category.

The clustering differs in three ways, each for a reason:

- **By sender domain, not by full address.** One employer writes from five
  people. `propose` clusters by address because a trash rule for
  `marketing@retailer.com` should not silently cover `support@retailer.com`;
  a sub-label for an organisation should cover everyone there.
- **Matched only against sub-labels of that one parent**, and a little less
  strictly than `propose` matches the whole label list. `matchDestination` is
  exact-on-a-segment because a near match across every folder you own is a coin
  flip between `Health Insurance` and `Healthcare`. Inside one parent the
  candidate set is a handful of names the user made deliberately, all about the
  same subject — and being too strict has its own cost: `@northwindco.example` fails
  an exact match against `Recruiting/Northwind`, so a folder that already exists
  comes back as "needs a name" and a second one gets created beside it. Prefix
  containment, floored at four characters, in either direction.
- **No bulk marker is required, and no threshold applies by default.** Mail in
  a folder is already mail the user chose to keep. There is nothing left to
  withhold it from.

### The senders that name a vendor rather than an organisation

Some senders host mail for whoever bought them — applicant tracking systems,
signing services, invoicing platforms. `no-reply@ashbyhq.com` carries one employer in
one thread and a different employer in the next.

Those clusters are returned **unhoused no matter what**, even when a sub-label
exists whose name would match the vendor's domain, and their distinct subjects
come back with them because that is where the organisation's name is. Building a
rule from one without a `subjectContains` is refused outright.

The list of vendor hosts is not a guard, it is an admission: for these senders
the address cannot answer the question, and reading the subject is judgment.

### When the answer is "leave it alone"

Most folders hold one organisation, and `subdivide` says so rather than
proposing a split. A sub-label that holds everything its parent holds has
organised nothing — it has given one pile two names, and the user now has to
undo it.

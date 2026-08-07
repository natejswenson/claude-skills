# The rule format

A rule is the only thing that may move a message — to the trash, or to a folder.
It is a stored, validated object — not a sentence in a conversation — because a
sentence cannot be re-read next month to explain why something vanished.

```json
{
  "id": "support-npmjs-com",
  "action": "trash",
  "match": { "from": "support@npmjs.com", "hasUnsubscribe": true },
  "note": "publish notifications — 9 in the sample"
}
```

```json
{
  "id": "sort-chase",
  "action": "label",
  "label": "Finance/Chase",
  "match": { "from": "@chase.com" },
  "note": "statements and alerts — read monthly, not daily"
}
```

| Field | Means |
|---|---|
| `id` | 2–40 chars, lowercase, digits, dashes. Unique. This is what appears next to every thread that moved |
| `action` | `trash`, `label` (needs `label`), or `keep` |
| `label` | **label rules only.** The destination folder. `Parent/Child` nests. See `sorting.md` |
| `keepInInbox` | **label rules only**, default `false`. `true` tags the thread and leaves it in the inbox instead of moving it |
| `match` | at least one of `from`, `list`, `subjectContains`, `category`, `olderThanDays`, `hasUnsubscribe` |
| `note` | what it is meant to catch. Required — a rule nobody can interpret is a rule nobody will dare edit |

**A label rule archives by default.** "Move it to a folder" is what a person
means by sorting, and a label that leaves the mail exactly where it was has not
sorted anything. `keepInInbox: true` is the opt-out, and `propose` sets it
automatically for any cluster that ever delivered a code or a receipt.

`keep` beats everything. A thread a keep rule claims is never touched, whatever
else matched it, and the first matching action rule owns a thread so attribution
is never ambiguous.

## What validation refuses, and why

| Refused | Because |
|---|---|
| a match naming no field | it would take the entire mailbox |
| `trash` constrained only by `olderThanDays` | that is every old message you have — pair it with a sender, list or category |
| an unknown match field | a typo is a rule that silently never fires |
| an unknown rule key | `keepInbox` for `keepInInbox` reads as "leave it alone" and does the opposite, with nothing saying so |
| `from`/`list`/`subjectContains` under 2 characters | a one-character match is an accident |
| a duplicate id | two rules with one id makes attribution ambiguous |
| a missing note | see above |
| a `label` rule naming `TRASH`, `SPAM`, `INBOX`, `SENT`, `STARRED`, `CATEGORY_*` … | it would destroy or misreport mail through the action that exists so nothing is destroyed. See `sorting.md` |
| a destination with a leading, trailing or doubled `/` | an empty nesting level is a typo, and Gmail will not take it |
| a destination over 225 characters | Gmail's own limit |
| `label` or `keepInInbox` on a rule that is not a label rule | it reads as sorting and does not sort |

| a rule filing into a folder standing in front of one filing into a **sub-label of that folder**, where the first takes everything the second would | this pair does not fail, it drifts — see below |

Validation runs **before** anything is written, so a bad rule never reaches the
file, let alone a plan.

## Rules that can never fire

`plan` gives a thread to the **first** rule that matches it, so a rule preceded
by a broader one is dead. Detecting that needs an implication test rather than
an equality test: `{from: "acme.example"}` takes everything
`{from: "careers@jobs.acme.example", subjectContains: "code"}` would, because
matching is substring containment.

Two tiers, because the two cases cost differently:

- **Reported.** A broad trash rule in front of a narrow one leaves dead weight
  in the file and nothing worse. `rules` names it; nothing is refused, because
  refusing would break rule sets that already work.
- **Refused.** A rule filing into `Recruiting` in front of one filing into
  `Recruiting/Contoso`. That pair *drifts* rather than failing:
  fresh mail hits the parent rule first and never reaches the sub-rule, while
  mail already carrying `Recruiting` skips the parent rule — the query and the
  matcher both exclude a thread already filed at the destination — and does
  reach it. Which folder a thread ends up in depends on nothing but when it
  arrived, and no table anywhere says so.

  The fix is to change the broad rule's destination to the sub-label. Moving the
  sub-rule ahead of it also stops the drift, since a sub-label applies its
  parent too — but it leaves a rule that can never fire, and the refusal says
  both.

The check is deliberately conservative: it must never claim subsumption that is
not there, because a rule wrongly declared dead is a rule someone deletes.
`@acme.example` is **not** a substring of `careers@jobs.acme.example`, so those two
are unrelated as far as this check is concerned, and a `trash` rule for codes
`olderThanDays: 7` does not shadow the `label` rule that keeps fresh ones.

## The compiled query

Every rule prints the Gmail query it compiles to. That is the point: a user who
cannot see the query cannot tell an over-broad rule from a precise one. Read it
before accepting a rule, and treat `category:promotions OR category:updates`
(what `hasUnsubscribe` compiles to) as the approximation it is.

The query is scoped to a slice of the mailbox — `in:inbox` unless a run says
otherwise. `--scope 'label:Recruiting'` is how the same rules are evaluated
against mail that has already been filed, which is what a retroactive pass over
an existing folder is. See `sorting.md`.

A label rule's query carries `-label:<destination>`, because a sort rule has
nothing left to do to a thread already filed there. Without it a `keepInInbox`
rule reports the same twelve threads every run forever, and "this rule suddenly
took ten times its usual volume" — the signal this skill tells you to stop on —
stops meaning anything.

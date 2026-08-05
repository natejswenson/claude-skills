# The rule format

A rule is the only thing that may trash a message. It is a stored, validated
object — not a sentence in a conversation — because a sentence cannot be
re-read next month to explain why something vanished.

```json
{
  "id": "support-npmjs-com",
  "action": "trash",
  "match": { "from": "support@npmjs.com", "hasUnsubscribe": true },
  "note": "publish notifications — 9 in the sample"
}
```

| Field | Means |
|---|---|
| `id` | 2–40 chars, lowercase, digits, dashes. Unique. This is what appears next to every trashed thread |
| `action` | `trash`, `label` (needs `label`), or `keep` |
| `match` | at least one of `from`, `list`, `subjectContains`, `category`, `olderThanDays`, `hasUnsubscribe` |
| `note` | what it is meant to catch. Required — a rule nobody can interpret is a rule nobody will dare edit |

`keep` beats everything. A thread a keep rule claims is never trashed, whatever
else matched it, and the first matching action rule owns a thread so attribution
is never ambiguous.

## What validation refuses, and why

| Refused | Because |
|---|---|
| a match naming no field | it would take the entire mailbox |
| `trash` constrained only by `olderThanDays` | that is every old message you have — pair it with a sender, list or category |
| an unknown match field | a typo is a rule that silently never fires |
| `from`/`list`/`subjectContains` under 2 characters | a one-character match is an accident |
| a duplicate id | two rules with one id makes attribution ambiguous |
| a missing note | see above |

Validation runs **before** anything is written, so a bad rule never reaches the
file, let alone a plan.

## The compiled query

Every rule prints the Gmail query it compiles to. That is the point: a user who
cannot see the query cannot tell an over-broad rule from a precise one. Read it
before accepting a rule, and treat `category:promotions OR category:updates`
(what `hasUnsubscribe` compiles to) as the approximation it is.

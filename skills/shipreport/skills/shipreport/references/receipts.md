# The receipt contract

The one rule:

> Every claim in the report carries a receipt that resolves against the corpus,
> and a claim whose receipt does not resolve is **dropped** — never softened
> into vague prose.

The failure this prevents is specific and it is the normal failure mode of a
summarising model: not invention from nothing, but *drift*. "Fixed the release
flow" becomes "overhauled the release pipeline" becomes "rebuilt CI/CD", each
step defensible, the last one false. A receipt anchors the sentence to a thing
that happened.

## Receipt forms

| Form | Example | Resolves to |
|---|---|---|
| `pr:<owner>/<repo>#<n>` | `pr:natejswenson/claude-skills#179` | a merged pull request |
| `release:<owner>/<repo>@<tag>` | `release:natejswenson/claude-skills@press-v0.9.0` | a published release |
| `commit:<owner>/<repo>@<sha7>` | `commit:natejswenson/budget@a1b2c3d` | a commit |
| `session:<sessionId>` | `session:8fd2…` | one Claude Code session |
| `session:<sessionId>#<uuid>` | `session:8fd2…#4c1a…` | one message inside it |

The session forms are what make this more than a GitHub summariser: work that
never became a commit — an investigation, a rejected design, a day spent
proving something did not work — is citable.

## The draft

`receipts` and `render` both read the same JSON:

```json
{
  "title": "Shipped",
  "headline": "One sentence, the thing the window was about",
  "standfirst": ["A paragraph.", "Maybe a second."],
  "sections": [
    {
      "title": "Shipped",
      "items": [
        { "title": "An outcome", "text": "Plain prose.", "receipts": ["pr:o/r#12"] }
      ]
    }
  ]
}
```

There is no `numbers` field on purpose — `render` computes the strip.

## What the gate checks

1. **Every item has ≥1 receipt.** No receipt, no claim.
2. **Every receipt resolves.** Against the corpus, not against plausibility.
3. **No raw identifier appears in any prose field.** `#412`, a 7–40 character
   hex string, `owner/repo`, or a bare receipt token. This is the audience
   contract enforced as code, because an instruction is not a gate.

`receipts` exits non-zero on any failure, and `render` re-runs the same check
rather than trusting that it passed a minute ago — the draft on disk now is not
necessarily the draft that passed.

## Writing to the gate, not around it

The gate is easy to satisfy dishonestly: attach any resolvable receipt to any
sentence. Nothing catches that, and nothing can.

So the discipline is: **write the sentence from the receipt, not the receipt
from the sentence.** Open what you are citing. If the item's title and the
sentence you want to write are not obviously about the same thing, the sentence
is wrong — the receipt is not.

When two sources disagree — a session says a thing was fixed and no commit
shows it — say the smaller true thing. "Investigated" is a real outcome and it
is citable. "Fixed" is not, until something merged.

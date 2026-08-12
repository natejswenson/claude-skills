# The baseline

The baseline is the only thing that makes a flow **known**. It is a stored,
validated file — not a sentence in a conversation — because "is this connection
fine?" is a question you answer once and should not have to re-answer every run.

```json
[
  { "host": "17.253.", "note": "Apple push / iCloud address range" },
  { "process": "Google Chrome", "host": ".1e100.net", "note": "Google/YouTube CDN, my browser" },
  { "host": "140.82.112.", "port": "443", "note": "GitHub, git + PRs" }
]
```

An array of entries (or `{ "entries": [...] }`). Each entry:

| Field | Means |
|---|---|
| `host` | **required.** The destination to recognize. See matching, below. |
| `process` | optional. Restrict the entry to one process (case-insensitive). Omit or `*` for any. |
| `port` | optional. Restrict to one remote port. Omit or `*` for any. |
| `note` | why this flow is fine — the sentence a reader six months from now needs. |

## How `host` matches

Because captures are numeric (`lsof -n`), `host` is usually an IP or an IP
prefix. Three forms:

- **exact** — `142.250.72.14` matches only that address.
- **trailing-dot prefix** — `17.253.` matches `17.253.72.14`, `17.253.4.9`, … —
  the natural way to accept a provider's address range.
- **leading-dot suffix** — `.1e100.net` matches `mia07s24.1e100.net` — useful if
  you captured resolved names rather than numeric ones.

## What the checker refuses

`baseline` and `accept` reject an entry that would make the baseline meaningless:

- **no `host`** — an entry with nothing to match is an entry that matches
  *everything*, which turns every flow `known` and defeats the point.
- **`host` of `*`, `.`, `*.`, `**`** — the same failure written explicitly.
- a `port` that is neither a number nor `*`.

A one-sided baseline is the classic rot: the day someone lets a match-everything
entry through, the report goes all-green over a mailbox nobody is actually
watching. That refusal is the anti-vacuity floor, in code.

## Why a flow is only ever "unrecognized", never "dangerous"

The baseline says what you have *vouched for*. Its opposite is **not vouched
for** — which is `unrecognized`, and nothing stronger. netwatch has no model of
what is malicious, and inventing one would be the skill acting as a rule instead
of applying yours. Whether an unrecognized flow is benign background or worth
alarm is your call to make from the report, not a verdict the report hands you.
`accept` is how that call becomes durable: once you have decided a flow is fine,
fold it in with a `--note`, and it reads `known` from then on.

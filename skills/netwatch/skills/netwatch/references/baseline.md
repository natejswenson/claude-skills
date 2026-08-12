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
prefix. Matching is case-insensitive throughout. Six forms:

- **exact** — `142.250.72.14` matches only that address. `fe80:13::aa35:70b7:7318:8427`
  matches only that address too, in any case.
- **CIDR** — `216.24.56.0/22` matches every address in that block, the same shape
  the report names networks in, so you can accept a whole provider range at once.
  IPv6 CIDR works the same way: `fe80::/10` matches every link-local address,
  `fe80:13::/64` narrows it to one scope. CIDR arithmetic, not text — it matches
  every spelling of the same address (`fe80:13::/64` and `fe80:0013::/64` are
  identical prefixes), and a host of one address family never matches a base of
  the other.
- **trailing-dot prefix** — `17.253.` matches `17.253.72.14`, `17.253.4.9`, … —
  a looser way to accept a range without counting bits.
- **trailing-colon prefix** — `fe80:` matches every address starting with that
  hextet: shorthand for `fe80::/16`. `fe80:13:` is shorthand for `fe80:13::/32` —
  each additional complete hextet before the trailing colon narrows the prefix
  by 16 bits, the IPv6 counterpart to trailing-dot. Write it exactly as you'd
  say it: `fe80:` names only the `fe80` hextet, not the wider `fe80::/10`
  link-local range — write the CIDR form if you mean the whole range.
- **leading-dot suffix** — `.1e100.net` matches `mia07s24.1e100.net` — useful if
  you captured resolved names rather than numeric ones.

## What the checker refuses

`baseline` and `accept` reject an entry that would make the baseline meaningless:

- **no `host`** — an entry with nothing to match is an entry that matches
  *everything*, which turns every flow `known` and defeats the point.
- **`host` of `*`, `.`, `*.`, `**`, `:`, `::`** — the same failure written
  explicitly. `:` and `::` both desugar to a `/0` prefix, matching every IPv6
  address there is.
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

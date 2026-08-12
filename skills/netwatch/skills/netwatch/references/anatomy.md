# The shape of a netwatch report

A run produces the same fixed set of tables every time, so two runs read the
same way and a diff between them is legible.

## `flows` — the grounded connection list

One row per distinct connection, collapsed across identical sockets:

| Column | Is |
|---|---|
| Process | the command that owns the socket — from `ps` when captured, else `lsof`'s command field |
| Proto | `TCP` / `UDP` |
| Destination | the remote host — numeric, because the capture is `lsof -n` |
| Network | the block that host belongs to (`Apple`, `Render`, `Link-local`, …) from an offline allocation lookup, or `unknown network` |
| Port | the remote port |
| State | TCP state (`ESTABLISHED`, …) when the capture recorded it |
| Sockets | how many identical sockets collapsed into this row |

Followed by a one-line totals table (distinct flows, sockets, processes). Every
row traces to a line the capture held; nothing is inferred.

## `report` — classified, and rolled up two ways

1. **Per-flow**, each tagged `known` or `unrecognized`, with a **Known as**
   column naming the baseline entry that matched.
2. **Per-process** — flows, distinct destinations, how many unrecognized, and
   bytes in/out (from `nettop` if captured, else `—`).
3. **Per-destination** — which processes reached it, flow count, and whether the
   destination is `known` or `unrecognized`.
4. A one-line summary: flows, known, unrecognized, destinations, processes.

There is deliberately **no severity or verdict column.** The status is binary —
`known` (you accepted it) or `unrecognized` (you have not) — and `report`
refuses a `--verdict`/`--severity` flag rather than grow one. What an
unrecognized flow *means* is the reader's judgment, stated in prose, never a
column the report fills in.

## `render` — the same facts, as a report to share

`render` emits a single self-contained HTML file styled by press: a masthead, a
**signal band** (Flows / Known / Unrecognized / Destinations, the unrecognized
count in the one loud accent), then unrecognized-first, then known, then a
per-process rollup whose byte-out figures are drawn as proportional bars. It
carries the same numbers as `report` and the same colophon restating the one
rule. It embeds no wall-clock time — the date comes from `--captured-at` — so a
re-render of a frozen capture is byte-identical, which is what lets the golden
pin it.

## `accept` — the reversible edit

A table of what was added to the baseline (host, process, port, note), the new
entry count, and the receipt path. The receipt holds the pre-change baseline, so
the edit can be undone by restoring it.

# The shape of a netwatch report

A run produces the same fixed set of tables every time, so two runs read the
same way and a diff between them is legible.

## `flows` — the grounded connection list

One row per distinct connection, collapsed across identical sockets:

| Column | Is |
|---|---|
| Process | the command that owns the socket (`lsof` `c` field) |
| PID | its process id |
| Proto | `TCP` / `UDP` |
| Destination | the remote host — numeric, because the capture is `lsof -n` |
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

## `accept` — the reversible edit

A table of what was added to the baseline (host, process, port, note), the new
entry count, and the receipt path. The receipt holds the pre-change baseline, so
the edit can be undone by restoring it.

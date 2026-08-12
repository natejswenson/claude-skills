# Capturing a snapshot

netwatch analyzes a **capture file** the agent takes on the live machine. The
script never runs the capture itself — the machine's connection state is
agent-side, exactly as Gmail is agent-side for gmailtriage — so the capture is a
step you run, and the script reads what it wrote.

## The one command

```bash
{ echo '===== lsof ====='; lsof -nP -i -FcnPptT;
  echo '===== nettop ====='; nettop -P -L 1 -x -J bytes_in,bytes_out; } > "$OUT/capture.txt"
```

Two labelled sections in one file. Only the `lsof` section is load-bearing.

## Why these tools, and why no sudo

- **`lsof -nP -i`** lists every open network socket with the process behind it.
  `-n` keeps addresses numeric (no DNS lookups — fast and deterministic), `-P`
  keeps ports numeric, `-i` selects network files. `-FcnPptT` asks for
  machine-readable *field* output (command, name, protocol, pid, type, TCP
  state), which is the only lsof format that survives a command name containing
  spaces (`Google Chrome H…`). None of this needs elevated privileges to see
  *your own* processes' sockets.
- **`nettop -P -L 1 -x`** takes one sample (`-L 1`) of per-process byte totals
  (`-x` = raw bytes, `-J` selects the two columns) and exits. It is optional:
  it only fills the **Bytes in / Bytes out** columns of the per-process rollup.
  If it is missing, unreadable, or empty, the report shows `—` and loses nothing
  else.

## What it deliberately does not do

netwatch **reads connections, not packet payloads.** It sees *that* your browser
has a socket open to `142.250.72.14:443` and how many bytes the process moved —
never *what* crossed that socket. That is the whole point of the design:

- no `sudo`, ever;
- nothing sensitive is captured, so the frozen eval corpus is safe to commit;
- on a shared network it can only ever see *your* machine's own sockets, never a
  housemate's traffic.

The moment someone swaps in `tcpdump` or a `.pcap` to "get more detail", every
one of those properties is gone. If packet-level analysis is genuinely needed,
that is a different, heavier, privileged tool — not a quiet upgrade to this one.

## The snapshot is a moment, not a monitor

A capture is one instant. A connection that opens and closes between two captures
is invisible to both — that is a property of snapshotting, not a bug, and the
report never pretends otherwise. Take another capture to see another moment.

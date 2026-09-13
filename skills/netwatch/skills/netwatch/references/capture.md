# Capturing a snapshot

Run `node scripts/netwatch.js capture --out <new-file>` on the local Mac.
The command collects numeric `lsof -nP -i -FpcfntPT`, optional
`nettop -P -L 1 -x -J bytes_in,bytes_out`, and `ps -axo pid=,comm=`.
It records timestamps, per-tool exit status and warnings in a metadata header.
Existing capture files are never overwritten; new files use mode 0600.

A legacy text capture remains supported: sections labelled `===== lsof =====`,
`===== nettop =====`, and `===== ps =====`. Raw lsof field output also works.
Only lsof is required. Processes retain their PID, local endpoint, protocol,
state and source record. TCP listeners and unconnected bound UDP sockets appear
alongside connected sockets; a bound UDP socket has no observed peer.

The readings are not atomic. Permission limits hide some processes, connections
can open and close between samples, and process names can change between ps and
lsof. Missing optional tools are reported, not silently interpreted as zero.
An empty or failed lsof capture is refused, never called an all-clear.

Nettop values are observed process counters, not bytes for a destination, a
capture interval, or a measured rate. Multiple instances of the same process
stay separate by PID. Offline provider labels are partial, potentially stale
hints, not live registration checks or evidence of safety.

Default capture reads connections, not packet payloads, and requires no sudo.
Metadata can still expose private services, activity, and process paths.
Keep captures out of source control and review before sharing.
Optional packet capture has a separate authorization flow in
[packets.md](packets.md); it is never triggered by this command.

For repeated observations, `watch --out <new-dir> --count 3 --interval 5`
writes numbered captures and differences. Count is bounded to 2–120, interval
to 1–60 seconds. Ctrl-C stops watching. Compare two existing captures with
`diff --before <file> --snapshot <file>`.

# Stopping a selected process

Use TERM for the process the user chose. Show the fresh inspection's PID,
executable, UID, kernel start identity, expected effect, and TERM confirmation.
Unsaved work or sessions may be lost, and a supervisor may restart the process.

```bash
node scripts/netwatch.js inspect --pid 1234 --out "$OUT/inspect-1234.json"
node scripts/netwatch.js terminate --inspection "$OUT/inspect-1234.json" --signal TERM --confirm TERM:1234:... --reason "User chose to stop this unexpected process"
```

The token is not an authorization system: the agent must have the user's actual
choice. A known PID/process name alone is not permission. Existing explicit
approval for the same inspected identity and signal need not be asked again.

The token binds the identity, inspection time and signal, expires after two
minutes, and cannot be reused for the same inspection and signal. The command
writes a private pending receipt before any signal, then rechecks kernel identity.
The Python helper rejects PID <=1, root/other-user processes, itself and all its
ancestors (including the agent/shell), and macOS system services under /System,
/usr/libexec, /usr/sbin and /sbin. Refusals must not be bypassed with sudo, pkill,
killall, process groups, or a raw kill command.

macOS identity uses kernel start seconds and microseconds, UID, executable,
host and PID. Identity is reread immediately before signalling; macOS still has
a small unavoidable check-to-signal race in this implementation. Do not promise
atomic protection from PID reuse. Linux uses boot ID/start ticks plus pidfd for
signalling; missing pidfd support is a refusal, not a fallback to bare kill.

The helper polls for up to three seconds. Report exited, original-process-gone
(with a replacement PID observed), still-running, or failed/unverified exactly
as received. The receipt remains on disk for audit. A pending receipt after
interruption is unknown, never success, and must not be retried blindly.

A still-running process can lead to a fresh inspect and a separate user choice
to force stop with KILL. TERM authorization never authorizes KILL automatically.
After either signal, refresh sockets. Stopping a process does not uninstall it,
remove persistence, block traffic permanently, or prove the machine clean.

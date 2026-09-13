# Security investigation

Start with a specific process or observed socket. Use
`inspect --pid <pid> --out <new-inspection.json>` for live kernel identity,
UID, parent PID, executable path, file owner/mode/mtime, SHA-256, macOS codesign
verification and signing details, and current TCP/UDP sockets.

The hash and signature describe a file on disk, not every loaded library or the
running process's behavior. A valid signature does not establish safety; an
unsigned developer executable does not establish malware. Failed or unavailable
verification stays explicit. Full command lines and environments are deliberately
omitted because they frequently contain secrets.

Evidence-based observations currently identify TCP listeners bound beyond
loopback, non-loopback UDP binds, remote access/file sharing ports, and ports
commonly associated with plaintext services. Each observation carries its source
and caveat. Firewall/routing determine listener reachability; a UDP bind alone
does not prove traffic; a port alone does not prove protocol or encryption.
File warnings cover world-writable executables and temporary/Downloads paths.
These observations remain visible even for known baseline flows.

For a deep dive:
1. Identify the exact PID/executable and why the user expects it to run.
2. Inspect current sockets, signature and file properties; explain uncertainties.
3. Compare snapshots or use bounded watch for new peers, changed states, or
   disappearing sockets. Do not infer throughput or exfiltration from unrelated
   per-process counters.
4. If the user needs packet-level timing/header evidence, follow packets.md.
5. If the user chooses to stop this process, follow termination.md and refresh.

IP ownership, reverse DNS, and reputation services are optional external
investigations. Local inspection makes no such requests. Get authorization
before disclosing an IP/hash/executable to a third party; keep returned labels
distinct from observed evidence.

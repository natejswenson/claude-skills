# Optional scoped packet capture

Use only for a user-requested packet investigation. Do not run during a normal
capture, watch, report or inspect. The default flow reads only socket metadata.

1. Resolve one interface from local state (`/sbin/ifconfig -l`), one numeric
   peer from the observed flow, and a port where practical.
2. Preview the scope and limits:
   `packets --interface en0 --host 203.0.113.8 --port 443 --seconds 10 --count 100 --snaplen 96 --out <new-directory>`.
3. Show the interface, filter, duration, count, snaplen, destination, and elevation
   mode, together with this concrete consequence: packet files may include
   credentials, names or request contents even at a short snaplen.
4. Obtain the user's approval for this exact preview. Repeat those options
   with the returned `--confirm CAPTURE:...` token. Changed options require a
   new preview and choice.
5. Read the receipt and header summary, report observed packet counts or failure,
   and retain the private artifacts. Do not paste packet payloads in chat.

The collector uses tcpdump with numeric addresses, non-promiscuous mode, one
explicit interface and a generated host/port BPF filter. It accepts no arbitrary
tcpdump arguments. Duration is 1–30 seconds, packet count 1–1000, snaplen
64–65535 (default 96). These bound time and storage but do not eliminate payload
sensitivity. The output directory must be new and is mode 0700; pcap, summary
and receipt use 0600. A timer or Ctrl-C requests a clean stop, with a bounded
fallback; failure to verify stopping is explicitly unverified.

The filter can match multiple processes sharing the peer. Do not attribute every
packet to a selected PID. A packet summary cannot decrypt TLS or prove a process
is malware. Zero captured packets is a visibility result, not an all-clear.

macOS normally requires permission to open a BPF device. The command does not
elevate by default. If the user authorizes elevation for this capture, preview
again with `--sudo`; this uses `sudo -n`, never prompts for or stores passwords.
If permission is denied, stop and explain the local permission requirement.
Do not change BPF device permissions or install a privileged service.

The pcap stays local, along with a numeric, quiet tcpdump header summary
(`-nn -tttt -q -r`; no `-A`, `-X` or verbose payload decoding).
Never upload these artifacts or send them to a reputation service without
explicit user authorization. Do not commit a live packet capture as a fixture.

# Changelog

All notable changes to the **netwatch** skill are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-09-12

### Added

- Interactive investigation in Claude Code/Codex chat and a user-owned terminal: refresh, focus, inspect, compare, watch, recognize, export, and act.
- PID-specific security inspection with kernel start identity, executable ownership/mode, on-disk SHA-256, macOS signature evidence, and live sockets.
- Timestamped capture diagnostics, bounded repeated samples, socket differences, and evidence-based observations for listening services and selected service ports.
- Optional packet capture with an exact interface/peer preview, explicit confirmation, bounded time/count/snaplen, private artifacts, and local header summaries.
- Confirmed TERM and separately confirmed KILL for one inspected process, with expiry, identity/ownership/ancestor guards, outcome verification, and an audit receipt.
- Search, status/kind filters, sortable columns, and expandable evidence in offline HTML reports; structured JSON for host integrations.

### Fixed

- Same-named processes no longer collapse across PIDs or receive another instance's byte counters; local endpoints and source records are retained.
- TCP listeners and unconnected UDP sockets are no longer silently dropped. Recognition rules can constrain protocol.
- IPv6 exact-address normalization, scoped CIDR matching, invalid CIDR/port validation, and malformed IPv4 handling.
- First-run baseline creation makes its directory before writing receipts; invalid snapshots are checked before baseline mutation.
- npm packages include the report assets. Added the missing frozen-artifact refresh command and runtime regression coverage.
- Corrected claims that socket metadata is automatically safe to publish, provider labels prove current ownership, or process counters measure interval traffic.

## [0.2.0] - 2026-08-12

### Added

- **IPv6 as a real matching family.** `host` now accepts an IPv6 CIDR
  (`fe80::/10`, `fe80:13::/64`) matched by 128-bit prefix arithmetic — every
  spelling of the same address matches the same way — and a trailing-colon
  prefix (`fe80:`, `fe80:13:`) as sugar over the same CIDR arithmetic, the
  IPv6 counterpart to the existing trailing-dot form. Matching is now
  case-insensitive throughout. `:` and `::` are refused, alongside the
  existing match-everything refusals, since both desugar to a `/0`.
- **`accept --snapshot`** counts how many flows in that snapshot each
  just-added entry actually matches, prints it as a **Matches now** column,
  and prints a named warning when a new entry matches zero — almost always a
  pattern mistake, exactly the class of vacuity a baseline exists to guard
  against. Exit stays 0; pre-seeding a range that is not live yet is
  legitimate. Without `--snapshot`, the column reads `not checked` rather
  than staying silent about the fact that nothing was checked.

### Fixed

- `accept` could silently store an IPv6 pattern — most plausibly a
  trailing-colon prefix like `fe80:` — that matched nothing, ever, in any
  report. The baseline validated, the success table printed, and the flow it
  was meant to cover stayed `unrecognized` forever, with nothing pointing at
  the dead entry.

## [0.1.0] - 2026-08-12

### Added

- First release. Takes a live snapshot of every network connection on your Mac —
  who it is talking to, which process, and how much moved — and reports it,
  grounded in what the capture actually held.
- Reads connection metadata (`lsof`/`nettop`), **not packet payloads**, so it
  needs no `sudo` and can never capture a credential or a housemate's traffic.
- `flows` parses a capture into a grounded, deduplicated flow table and refuses
  an empty capture rather than calling it "all clear".
- `report` classifies every flow `known`-vs-`unrecognized` strictly against a
  baseline you built, rolling up by process and destination. There is no
  "dangerous" verdict — `report` refuses a `--verdict`/`--severity` flag, which
  is the one rule enforced as code.
- `baseline` validates and reports coverage of your known-flows file; `accept`
  folds chosen flows into it with a note, reversibly via a receipt. Baseline
  hosts accept an exact address, a **CIDR** (`216.24.56.0/22`), a trailing-dot
  prefix, or a leading-dot suffix.
- **Readable output.** Each destination is named by the network block it reaches
  (`Apple`, `Google`, `Render`, `Link-local`, …) via an offline allocation lookup
  — a fact about the address, never a verdict. Process names come from `ps` so
  they read as `claude`, not `lsof`'s raw internal string. Byte counts render as
  `19.3 MB`, not raw bytes.
- **`render`** emits a self-contained, press-styled HTML report: a signal band,
  unrecognized-first, network owners, and per-process byte bars. It embeds no
  wall-clock time, so a re-render of a frozen capture is byte-identical.
- Frozen baseline eval: a real snapshot from the maintainer's own Mac, with the
  report and the HTML re-run and byte-compared, plus a trap that must exit
  non-zero.

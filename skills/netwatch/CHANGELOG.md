# Changelog

All notable changes to the **netwatch** skill are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
  folds chosen flows into it with a note, reversibly via a receipt.
- Frozen baseline eval: a real snapshot from the maintainer's own Mac, with the
  report re-run and byte-compared, plus a trap that must exit non-zero.

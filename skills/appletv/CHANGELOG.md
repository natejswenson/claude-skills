# Changelog

All notable changes to the **appletv** skill are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-24

### Added

- First release. Find the Apple TVs on your network, pair with one, and control it from chat — and never say a command landed until the TV's own state says so.
- `doctor`, `scan` (multicast + `--hosts` unicast), `pair` (AirPlay then Companion, one PIN each, session kept alive while the code is read off the screen, `pair --pin` delivers it), `alias` (room names + a default), `state`, `send` (before/after read-back, a verdict per step: `verified` / `mismatch` / `unverifiable`, non-zero on mismatch), `apps` (installed apps, name → bundle id, deep links), `type` (keyboard with read-back), `report` (the same tables from captures, offline).
- `scripts/driver.py` is the only file that talks to pyatv, through its API — pyatv's own `atvremote` crashes on Python 3.12+. The venv lives under the skill; nothing global.
- An error taxonomy (`references/errors.md`, enforced in `scripts/lib/errors.mjs`): every failure the network, the TV or tvOS produces, mapped to a message and the setting or command that fixes it.
- References for commands and their read-backs, pairing, verified bundle ids and deep links, and the twenty intents people actually ask a TV — with a confirmation policy (turn-off and app-switch ask when something is playing; pause and skip do not).

### Learned on the first real run (Apple TV 4K gen 3, tvOS 26.6)

- pyatv's `app` is the **now-playing owner**, not the foreground app: launching Settings or Netflix to its home screen leaves it on the previous media app. `launch_app` with an unchanged read-back is therefore `unverifiable`, never `mismatch` — and never `verified`.
- Companion replies to `_launchApp` with a non-zero `_rT` that pyatv ignores; the skill never trusts the send, only the read-back.
- Power reads back correctly on 26.6 (`turn_off` → `off`, `turn_on` → `on`); volume over HDMI is `known-unsupported`.

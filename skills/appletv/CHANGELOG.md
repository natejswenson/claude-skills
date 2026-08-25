# Changelog

All notable changes to the **appletv** skill are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2026-08-24

### Added

- **Who's watching.** A cold boot lands on tvOS's user picker and apps like Netflix have their own; the skill now records the household once (`pref users "Nathaniel, McKenzie, …"`, `pref netflix --profiles "…" --layout vertical`), asks the person at the keyboard who is using the TV as a list every time a picker shows, and `who <name> [--app]` presses to that tile, selects, and screenshots to confirm. It never picks a person by itself — a new prose guardrail.

### Fixed

- A command whose state already matches — `turn_on` on a TV that is on, launching the app that already owns now-playing — no longer waits its full read-back ceiling: 0.7 s instead of 6. `open netflix` is 4.9 s (was 15.6); three keypresses 1.7 s (was ~15). The launch ceiling is 3 s.
- Result wording: `already on` (was "already on already"); a launch that cannot be confirmed reads "foreground unknown until it plays something — look at the screen".
- The AppleScript literal that opens Terminal for the tunnel escapes backslashes before quotes (CodeQL).

## [0.1.0] - 2026-08-24

### Added

- First release. Find the Apple TVs on your network, pair with one, and control it from chat — and never say a command landed until the TV's own state says so.
- `doctor`, `scan` (multicast + `--hosts` unicast), `pair` (AirPlay then Companion, one PIN each, session kept alive while the code is read off the screen, `pair --pin` delivers it), `alias` (room names + a default), `state`, `send` (before/after read-back, a verdict per step: `verified` / `mismatch` / `unverifiable`, non-zero on mismatch), `apps` (installed apps, name → bundle id, deep links), `type` (keyboard with read-back), `report` (the same tables from captures, offline).
- `scripts/driver.py` is the only file that talks to pyatv, through its API — pyatv's own `atvremote` crashes on Python 3.12+. The venv lives under the skill; nothing global.
- An error taxonomy (`references/errors.md`, enforced in `scripts/lib/errors.mjs`): every failure the network, the TV or tvOS produces, mapped to a message and the setting or command that fixes it.
- References for commands and their read-backs, pairing, verified bundle ids and deep links, and the twenty intents people actually ask a TV — with a confirmation policy (turn-off and app-switch ask when something is playing; pause and skip do not).

- `screen` — a real screenshot over Apple's developer tunnel (pymobiledevice3 DVT, ~2.5 s), the only foreground read-back tvOS 26 has; `screen --pair` for the one-time developer pairing, `screen --install-tunnel` for a LaunchDaemon. In-app navigation is look → press → look, never a recorded sequence replayed blind.
- `pref` (this household's profile per app, local only), `open` (launch onto that profile), `play` (deep link + read-back for the services that still honour links: YouTube, Disney+, Apple TV+, Hulu, Peacock).
- `references/screen.md`: setup, how to read a capture, what the eyes taught on real runs (Netflix S1E3, Silo's latest episode).
- `pref services "netflix, disney+, …"` — the services the household subscribes to, on this Mac only; `doctor` shows them, `apps` marks them, and the skill never puts a title on a service they do not have.
- Screenshots are someone's TV: only the last three are kept, `screen --clean` deletes them, none reaches a run directory without `--out`.

### Changed after a four-lens review of the first day's runs (accuracy, functionality, UX, speed)

- Verdicts: a state that already matched before the send is `unverifiable`, never `verified`; a read-back that never moved on the TV app is `unverifiable` (known freeze at skip points), not `mismatch`; `launch_app` is verified only when the now-playing owner *changed* to the target; `stop` that closes the player is not a verified stop; `not read (timeout)` is distinct from `known-unsupported`.
- Speed: one driver connection per `send` sequence; the read-back polls every 0.5 s and stops when the expected field moves (per-command ceilings; keypresses wait 0 s); connect/command/field/scan timeouts cut to 8/6/3/2 s; `screen` at 960 px. A verified press is ~1.5 s (was ~5), a navigation press ~0.7 s, `open netflix` ~5 s (was ~18).
- UX: compact `| Step | Command | Result |` tables with keypress runs collapsed and `sent` instead of `unverifiable` (`--verbose` for every read); real error headlines (`no_tunnel`, `not_advertising`, `deep_link_unsupported`, `not_an_apple_tv`, `on_hold`…); `screen` opens Terminal for the `sudo` line instead of asking the user to paste it; `pair` warns to stand in front of the TV and defaults to a 10-minute window; `doctor` shows one line per TV and a `to do` line; the empty-scan message names the Wi-Fi this Mac is on.
- `pref hold on|off` — someone is watching: the CLI refuses anything that changes the screen.
- `open` with eyes takes a screenshot after launch instead of pressing the profile tile blind; `play` refuses Netflix links up front; `type --submit`; `select=hold` / `select=double`; a retry on a dropped connection; app words fall back to the installed-app cache; Google TVs and other AirPlay receivers no longer appear as Apple TVs.
- `evals/update.mjs` re-derives recorded verdicts from the current rules on refresh and prints every change for review.

### Learned on the first real run (Apple TV 4K gen 3, tvOS 26.6)

- pyatv's `app` is the **now-playing owner**, not the foreground app: launching Settings or Netflix to its home screen leaves it on the previous media app. `launch_app` with an unchanged read-back is therefore `unverifiable`, never `mismatch` — and never `verified`.
- Companion replies to `_launchApp` with a non-zero `_rT` that pyatv ignores; the skill never trusts the send, only the read-back.
- Power reads back correctly on 26.6 (`turn_off` → `off`, `turn_on` → `on`); volume over HDMI is `known-unsupported`.
- Netflix deliberately disabled every deep-link form on tvOS in Sept 2025; Netflix's custom player publishes no title metadata, so "which episode" is confirmed by eyes, "is it playing" by read-back.
- A blind navigation sequence opened the wrong app in front of the household once. That is now a rule with a pattern in `skill-invariants.json`.

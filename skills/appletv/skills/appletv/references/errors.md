# errors

Every code the driver can return, what it means, and the fix the skill
gives. `scripts/lib/errors.mjs` is the enforced copy — the CLI prints
`message` and `fix` from it, so the agent relays them rather than guessing.
Nobody shipping an Apple TV integration had this table; it is most of the
user-facing difference.

| Code | Means | Fix the skill gives |
|---|---|---|
| `no_python` | no python3 on PATH | install Python 3, `appletv doctor --install` |
| `no_pyatv` | venv missing or pyatv not in it | `appletv doctor --install` |
| `pyatv_import_failed` | installed but broken | `appletv doctor --install fresh` |
| `scan_empty` | multicast found nothing | wake the TV; `scan --hosts <ip>`; firewall UDP 5353; not from Docker/VM |
| `device_not_found` | the named TV did not answer | wake it (deep sleep drops it off the network); `--hosts <ip>`; rescan and re-alias if renamed |
| `multiple_devices` | more than one TV, none named | `--device`, or `alias <room> --device <name> --default` |
| `no_device` | nothing named, no default | `scan`, then `alias … --default` |
| `not_paired` | no credentials for this TV | `appletv pair --device <name>` |
| `pairing_refused` | TV would not start pairing | Settings › AirPlay and HomeKit › Allow Access → Everyone; assign to a room |
| `pairing_disabled` | protocol cannot pair on this tvOS | expected for MRP ≥ tvOS 15; pair airplay + companion |
| `pairing_failed` | PIN wrong | run again, read the new code, leading zeros count |
| `pairing_backoff` | too many attempts | wait or restart the TV |
| `pin_required` / `pin_timeout` | PIN not delivered | run `pair` in background, `pair --pin <code>` within 2 min |
| `connection_failed` | could not connect | wake it; re-pair after a tvOS update; Companion on tvOS 26.5 gen-3 is a known upstream drop |
| `blocked_state` | connected, but the protocol for this command is missing | `pair --protocol companion --force` |
| `unsupported_command` | device or app cannot do it | check `state`; some apps ignore stop/next; power needs Companion |
| `command_refused` | TV said no | `state` — wrong app in front, nothing playing |
| `no_text_focus` | no keyboard on screen | navigate to a text field first |
| `non_local_subnet` | different subnet | same network, or mDNS repeater |
| `network_unreachable` | no route | Wi-Fi/Ethernet on the Mac; TV awake |
| `timeout` | no answer in time | wake and retry; re-pair Companion if recurring |
| `protocol_error` | unexpected reply | tvOS changed something — update pyatv, check pyatv issues |

## Two things that are not errors and must not be reported as one

- **`unverifiable`** is a verdict, not a failure. The command was sent; the
  TV cannot show its effect. Say that.
- **Power `unknown`** on tvOS 26.5 (Apple TV 4K gen 3) is pyatv issue #2845.
  `state` prints `known-unsupported`, `turn_on`/`turn_off` come back
  `unverifiable`. The TV still responds; the skill just cannot prove it.

## Known upstream limits worth saying out loud

| Limit | Why |
|---|---|
| Any command wakes the TV | the Apple TV turns on for every request; cannot be disabled short of turning CEC off |
| Volume only reads back with HomePod/AirPlay audio | HDMI-CEC volume is fire-and-forget |
| `turn_off` with a HomePod as audio output may read `on` forever | pyatv reports power from the AirPlay leader |
| A TV in deep sleep for minutes vanishes from the network | only the Siri Remote, the iPhone Remote or an AirPlay session wakes it |

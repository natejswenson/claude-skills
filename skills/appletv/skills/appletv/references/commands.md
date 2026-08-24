# commands

Every command `appletv send` can carry, the protocol that carries it, and the
read-back that decides its verdict. The verdict logic is `scripts/lib/verify.mjs`;
this file is its human copy. If the two disagree, the code is right and this
file is stale.

Three verdicts exist and there is no fourth:

| Verdict | Means | Is it "done"? |
|---|---|---|
| `verified` | the state read back shows the effect the command names | yes |
| `mismatch` | the read-back shows something else, or the TV refused the command | no — say what the TV actually shows |
| `unverifiable` | the command has no readable effect, or this tvOS cannot report the field | **no** — say it was sent and could not be confirmed |

## Playback

| Command | Protocol | Read-back that verifies | Notes |
|---|---|---|---|
| `play` | AirPlay (MRP) | `playing.device_state == playing` | |
| `pause` | AirPlay (MRP) | `device_state == paused` | |
| `play_pause` | AirPlay (MRP) | `device_state` toggled | needs a before state |
| `stop` | AirPlay (MRP) | `device_state in stopped, idle` | YouTube ignores it → mismatch, honestly |
| `next` / `previous` | AirPlay (MRP) | title or content id changed; `previous` also accepts position reset to ≤5s | no change → unverifiable |
| `skip_forward[=secs]` | AirPlay (MRP) | position moved ≥5s forward | default interval is the app's (10–30s) |
| `skip_backward[=secs]` | AirPlay (MRP) | position moved back | |
| `set_position=secs` | AirPlay (MRP) | position within 6s of the target | |
| `set_shuffle=off\|albums\|songs` | AirPlay (MRP) | `playing.shuffle` | music queues only |
| `set_repeat=off\|track\|all` | AirPlay (MRP) | `playing.repeat` | |

## Power

| Command | Protocol | Read-back | Notes |
|---|---|---|---|
| `turn_on` / `wakeup` | Companion (MRP fallback) | `power == on` | any command wakes the TV anyway |
| `turn_off` / `suspend` | Companion (MRP fallback) | `power == off` | turns a CEC TV off too. **Confirm first if something is playing.** On tvOS 26.5 gen-3 4K power reads `unknown` → unverifiable (pyatv #2845) |

## Apps

| Command | Protocol | Read-back | Notes |
|---|---|---|---|
| `launch_app=<bundle id>` | Companion | `app.id == bundle id` | ids from `appletv apps` |
| `launch_app=<deep link url>` | Companion | `app.id ==` the app the host maps to (`DEEP_LINK_APPS`), else "app changed" | unknown host + no change → unverifiable |
| `home` | Companion/MRP | foreground app changed | else unverifiable |

## Volume

| Command | Protocol | Read-back | Notes |
|---|---|---|---|
| `set_volume=0-100` | Companion/MRP | `volume` within 1 | only when audio goes to HomePod/AirPlay |
| `volume_up` / `volume_down` | Companion/MRP | `volume` moved in that direction | HDMI-CEC volume has no read-back → unverifiable |

## Keypresses — always unverifiable

`up` `down` `left` `right` `select` `menu` `top_menu` `home_hold` `channel_up`
`channel_down` `screensaver` `guide` `control_center`

A keypress has no state of its own. `send` still reports the before/after
state so a person can see what moved, but the verdict is `unverifiable` and
the agent says "sent, could not confirm" — never "done". Prefer a deep link or
`launch_app` over a navigation sequence whenever one exists: it is verifiable.

## Keyboard — `appletv type`, not `send`

| Op | Read-back |
|---|---|
| `type <text>` | `text_get == text` |
| `type <text> --append` | `text_get == before + text` |
| `type --clear` | `text_get == ""` |

Refuses when no field is focused (`focus != focused`). tvOS keyboard is
replace-mode: `type` replaces, `--append` adds.

## Sequences

`send "turn_on,launch_app=com.netflix.Netflix,play"` runs steps in order, reads
back after each, and stops at the first mismatch unless `--keep-going`. Each
step gets its own row and its own verdict; the summary line counts them.

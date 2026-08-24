# pairing

Pairing happens once per Apple TV per protocol. Credentials go to
`~/.pyatv.conf` (pyatv's own store, shared with `atvremote` and anything else
built on pyatv) and are never printed, logged or captured into a run directory.

## The protocols

| Protocol | Carries | Pairing | Which tvOS |
|---|---|---|---|
| **AirPlay** | now-playing metadata, play/pause/skip, volume — because MRP is tunnelled inside AirPlay since tvOS 15 | PIN on screen | all |
| **Companion** | apps, deep links, keyboard, power on/off, guide, control center | PIN on screen | tvOS 13+ |
| MRP | (legacy) the same control channel, standalone | shows `Disabled` on tvOS 15+ — cannot and need not be paired | ≤ tvOS 14 |
| RAOP | audio streaming to the TV | none | all |

**Pair both AirPlay and Companion.** That is what `appletv pair --device X`
does, in that order, one PIN each. Skipping Companion leaves power, apps and
keyboard unusable and every `launch_app` will come back `blocked_state`.

## The flow

The PIN only appears after pairing *begins*, and the pairing session has to
stay alive until the code is entered. So:

1. `appletv pair --device "Living Room"` — run it **in the background**. It
   begins AirPlay pairing, prints `▶ Living Room is showing a PIN for airplay`,
   and waits up to ten minutes (`--pin-timeout`, default 600 s).
2. Ask the user for the four digits on the screen (developer pairing for
   `screen` uses a six-digit code). **Leading zeros count** — pass the PIN as a string.
3. `appletv pair --pin 0423` — delivers it to the waiting session, which
   finishes, stores the credentials, and moves on to Companion (a second PIN;
   repeat step 2–3).
4. The result table names each protocol, whether it paired, and what it unlocks.

Re-pair one protocol with `--protocol companion --force`. This is the fix for
a Companion that drops after a tvOS update.

## What blocks pairing, and the setting that fixes it

| Symptom | Cause | Fix |
|---|---|---|
| `pairing_refused` / no PIN appears | the TV restricts who may pair | on the TV: Settings › AirPlay and HomeKit › Allow Access → **Everyone** (Anyone on the Same Network is sometimes not enough). If still no PIN: assign the TV to a room in the Home app |
| `pairing_disabled` for MRP | tvOS 15+ | expected — pair airplay + companion |
| `pairing_failed` right after the PIN | wrong PIN; the code changes per attempt | run pair again, read the *new* code |
| `pairing_backoff` | too many wrong PINs | wait a few minutes or restart the Apple TV |
| `pin_timeout` | no PIN delivered within the window (10 min) | run pair again — and tell the person the code appears the moment pairing starts |
| `device_not_found` during pair | the TV went to sleep | press any button on its remote, retry |
| Companion pairs but drops instantly | tvOS 18.4 (fixed in pyatv 0.16.1) or tvOS 26.5 gen-3 4K (pyatv #2845, open) | `appletv doctor --install` to update pyatv; AirPlay still works |

## Where things live

| Thing | Path | In git? |
|---|---|---|
| credentials | `~/.pyatv.conf` | never |
| aliases, default TV, device cache | `~/.config/appletv/config.json` | never — room names are a fact about a home |
| PIN hand-off | `~/.config/appletv/pairing.pin` | deleted the moment it is read |
| pyatv | `<skill>/.venv` | gitignored |

# screen

`appletv screen` is the skill's eyes: a real screenshot of the Apple TV,
taken over Apple's developer tunnel, downscaled and handed back as a PNG path
for the agent to `Read`. It is what makes in-app navigation honest —
**look → press → look**, never a recorded sequence replayed blind.

Nothing on the network says what is on screen (pyatv's maintainer: "Apple
does not present, or have any concept of, currently active app"). `state`
reports the *now-playing owner*, which only changes once something plays.
The screenshot is the only foreground read-back that exists on tvOS 26.

## Why this route

| Approach | Verdict |
|---|---|
| pymobiledevice3 DVT screenshot over Wi-Fi | **works on tvOS 26** — ~2.5 s a capture; what mcp-pyatv ships |
| accessibility tree (focused element by name) | broken on tvOS 26.x ("connection terminated abruptly") |
| Xcode's Devices window screenshot | works, not scriptable |
| HDMI capture card | works, needs hardware; DRM video is black there too |
| Companion / MRP events | no foreground app, ever |

## One-time setup (~3 minutes)

1. `appletv doctor --install` — puts pymobiledevice3 in the skill venv.
2. On the TV: **Settings › Remotes and Devices › Remote App and Devices**, and stay there.
3. `appletv screen --pair` — run in the background; it prints when the TV shows a
   6-digit code; deliver it with `appletv pair --pin <code>`. The record lands in
   `~/.pymobiledevice3/remote_<id>.plist`.
4. The tunnel needs root, so it is started by a person, once per login — or once
   forever: `appletv screen --install-tunnel` writes a LaunchDaemon and prints the
   one `sudo` line that installs it.
   When the tunnel is down, `screen` opens a Terminal window with the line already
   typed — the person only enters their password there. Manual form (sudo needs a TTY;
   the `!` prefix has none):
   `sudo <skill>/.venv/bin/pymobiledevice3 remote tunneld --no-usb --no-usbmux --no-mobdev2 --wifi`
5. `appletv doctor` — the `screenshots` row says `tunnel up, 1 device` when everything holds.

No Xcode is needed: pymobiledevice3 pairs directly with the TV on that screen.
Re-pair after a tvOS update if `screen` starts failing.

## Reading a capture

- **Highlight** = the enlarged / white tile or button. That is where `select` lands.
- **A black frame while `state` says `playing`** = DRM video. That is success, not a
  failure: protected video never renders in a capture. Verify with `state`, not pixels.
- Netflix resumes wherever it was left — the show page, the episode list, the player.
  Never assume "home"; look first.
- Netflix's episode list highlights the **in-progress** episode, not E1.

## The loop

```
appletv screen            → Read the PNG, name the highlighted item
appletv send <one press>  → the fewest presses whose outcome you can predict
appletv screen            → confirm; if wrong, `menu` backs out one level
appletv state             → the end state: app == target and playback == playing
```

Budget one screenshot per press (1–3 s each, 960 px wide by default). A typical "open Netflix and play
S1E3" is 4–6 looks. Sensed checkpoints still apply where they exist: keyboard
focus for a search box, `type` reading its text back, the now-playing owner at
the end.

## Errors

| Symptom | Fix |
|---|---|
| `no developer tunnel` | start it (step 4); `doctor` shows the exact command |
| `tunnel up but has no device` | the pair record is missing or stale — `screen --pair` |
| `no Apple TV is advertising developer pairing` | the TV is not on Remote App and Devices |
| `sudo: a terminal is required` | it was run with the `!` prefix — use a real terminal window |
| all-black capture, `state` idle | the TV is asleep or on a black screensaver; `turn_on` and look again |

## The TV app's read-back can freeze

Seen on Silo S3E1 (2026-08-24): after **Skip** on the promo and **Skip Recap**,
`state` stayed at `paused · 101s` for a minute while two captures 8 s apart were
clean black — a paused TV-app player keeps its scrubber on screen, a playing one
does not. `play` reported `mismatch` because the read-back never moved. When the
now-playing owner is `com.apple.TVWatchList` and the position stops updating at
a skip point, trust two consecutive scrubber-free black frames over the number,
and say which signal you used.

## Control Center

`control_center` opens it with **Power Off** focused. `up` from there is the
swipe-up that *closes* it — it does not reach the top-row icons (home, user
switcher, avatar). The user picker is reached reliably only by a real cold boot
(the box off for a few minutes, then `turn_on`); a `turn_off` of twenty seconds
is sleep, and `turn_on` resumes whatever was playing.

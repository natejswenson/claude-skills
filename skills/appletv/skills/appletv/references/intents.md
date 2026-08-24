# intents

The things people actually ask a TV to do — ranked from Apple's own Siri and
Shortcuts lists, Home Assistant's built-in media intents, and the Alexa/Roku
command lists — each mapped to what the skill sends and whether it confirms
first. The policy follows Alexa's design guidance: **contextual confirmation
for cheap, reversible actions; explicit confirmation only where a wrong move
costs someone their evening.**

| # | They say | Send | Confirm first? | Verdict source |
|---|---|---|---|---|
| 1 | "pause" / "resume" / "play" | `pause` / `play` | no | playback |
| 2 | "put on Severance" / "play The Bear on Hulu" | `launch_app=<deep link>` (`apps.md`), else `launch_app=<id>` then say what the TV shows | no | app |
| 3 | "skip 30 seconds" / "go back a minute" | `skip_forward=30` / `skip_backward=60` | no | position |
| 4 | "what did they say?" | `skip_backward=15` | no | position |
| 5 | "skip the intro" | `skip_forward=60` (Netflix ~60–90s, Apple TV+ ~45s) — nobody ships this natively | no | position |
| 6 | "open Netflix" | `launch_app=com.netflix.Netflix` | **yes if something is playing** — switching apps kills playback | app |
| 7 | "turn it up/down", "volume 30" | `volume_up` / `volume_down` / `set_volume=30` | no | volume (unverifiable on HDMI-CEC — say so) |
| 8 | "turn off the tv" | `turn_off` | **yes if `state` says playing** — "Severance is playing on Living Room — turn it off anyway?" | power |
| 9 | "turn on the tv" | `turn_on` | no | power |
| 10 | "next episode" / "start over" | `next` / `set_position=0` | no | title / position |
| 11 | "what's playing?" / "what's on?" | `state` | — | read only |
| 12 | "type stranger things" / "search for X" | `type "stranger things"` (needs a focused field — say so if not) | **show the string first if it looks like a password**, never echo it back | keyboard |
| 13 | "go home" / "back" / "select" | `home` / `menu` / `select` | no | unverifiable — say "sent" |
| 14 | "what should I watch?" | not a TV command — recommend, then #2 | — | — |
| 15 | "watch ESPN" / "put on the game" | `launch_app=<sports app id>`; live channels need the app open | no | app |
| 16 | "play this in the kitchen" | not supported yet (output devices) — say so, offer HomePod via the Home app | — | — |
| 17 | "shuffle" / "repeat" | `set_shuffle=songs` / `set_repeat=all` (music only) | no | playback |
| 18 | "subtitles on" | not exposed by pyatv — say so, offer the Siri Remote route | — | — |
| 19 | "switch to Nate's profile" | not exposed by this skill yet | — | — |
| 20 | "movie night" | `turn_on,launch_app=<id>` then `play` once the title is up; lights are HomeKit, not this skill | no | each step |

## Disambiguating the TV

- One remembered device → it is the default, no question.
- Several, and the user said a room → `--device "<room>"` resolves the alias;
  if no alias yet, ask once ("which one is the living room: Living Room or
  Bedroom TV?") and then **`alias` it** so the question never repeats.
- Several, no room, no default → ask once and offer to set the default.

## After every send, one line

Verified: *"Paused Severance on Living Room."*
Unverifiable: *"Sent `menu` to Living Room — a keypress can't be confirmed;
the TV still shows Netflix."*
Mismatch: *"Sent pause but Living Room still reads playing — the app may not
accept it; try `play_pause`?"*

Never *"Done."* on the last two.

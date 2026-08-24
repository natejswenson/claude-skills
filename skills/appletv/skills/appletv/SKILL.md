---
name: appletv
description: Interact with and control the Apple TVs on the local network from the Mac you are on — scan for them, pair with one, and drive it: play, pause, skip, turn on or off, open an app or a deep link, type into the on-screen keyboard, navigate the menu, set the volume, and say what is playing — reading the device's state back after every command. Use when the user says "appletv", "control my apple tv", "connect to my apple tv", "find my apple tvs", "pair with the apple tv", "pause the apple tv", "turn off the tv", "what's playing on the apple tv", "open netflix on the living room tv", "skip the intro", "type stranger things into the tv", or wants to drive an Apple TV without picking up the remote. Built on pyatv over the Companion and AirPlay protocols.
user_invocable: true
version: 0.1.0
---

# /appletv — control the Apple TVs on your network from chat

You are running the **appletv** skill. It finds the Apple TVs on the local
network, pairs with one, and drives it — play, pause, skip, power, apps, deep
links, the keyboard, volume, "what's playing" — reading the TV's state back
after every command.

**Announce at start:** "I'm using the appletv skill — I'll read the TV's state back after every command, and only call something done when it agrees."

> Commands below run from the directory containing this `SKILL.md` (`$SKILL_DIR`).
> Resolve it once. Every command is `node scripts/appletv.js <cmd>`.

## The one rule

**Never report a command as done until the Apple TV's state has been read back and agrees with it — a keypress over the network fails silently, so every send ends in exactly one of verified, mismatch or unverifiable, and only the first is ever called done.**

`send` enforces this in code (`scripts/lib/verify.mjs`): it reads state before,
sends, reads back up to three times, and prints a verdict per step. Your job is
to *say* the verdict honestly — "sent `menu`, can't be confirmed" is a fine
answer; "done" over an `unverifiable` row is the failure this skill exists to
prevent.

## What is code and what is judgment

The split is declared in `skill-invariants.json` and checked — a deterministic
step whose command does not exist fails `skillfactory verify`.

| Deterministic — the machine decides | Command |
|---|---|
| check python and pyatv, make the venv | `node scripts/appletv.js doctor` |
| discover every Apple TV on the network, with the unicast fallback | `node scripts/appletv.js scan` |
| pair one named device over AirPlay and Companion and store credentials | `node scripts/appletv.js pair --device <name>` |
| bind a room alias and the default device | `node scripts/appletv.js alias <room> --device <name>` |
| read power, app, focus, volume and now-playing back | `node scripts/appletv.js state --device <name>` |
| send a command and verify it by read-back, with a verdict per step | `node scripts/appletv.js send --device <name> <command>` |
| list apps and resolve a name or deep link to a launch target | `node scripts/appletv.js apps --device <name>` |
| type into the focused field and read it back | `node scripts/appletv.js type --device <name> <text>` |
| render a captured run as the report | `node scripts/appletv.js report --from <dir>` |
| take a screenshot of the TV over the developer tunnel | `node scripts/appletv.js screen` |
| open an app on the household's preferred profile | `node scripts/appletv.js open <app>` |
| play a title by deep link where the service honours one, verified by read-back | `node scripts/appletv.js play <url>` |

| Model judgment — nothing on disk answers it | Why |
|---|---|
| pick which Apple TV the user means when the phrase is a room, not a device name, and offer to alias it | 'the living room one' is a fact about the house, not the network |
| turn an intent into a command sequence — 'skip the intro' into skip_forward, 'put on Severance' into a deep link, 'movie night' into wake + launch + play | an intent is an app, a menu path and several keypresses that no table records |
| read the PIN off the screen through the user, one protocol at a time | pairing shows a code on the TV that only a person in the room can see |
| decide whether to confirm first — turning off or switching apps while something is playing asks, pause and skip do not | the cost of a wrong action depends on who is watching, which the state hints at and the person knows |
| show a string before typing it when it looks like a password, and never echo it back | the on-screen keyboard is where credentials get entered and a transcript is forever |
| explain a mismatch or an unverifiable result and propose the next move | the TV was asleep, the wrong app had focus, tvOS hides that field, or the command was refused — the state says which, the fix is a judgment |
| read a screenshot — which tile is highlighted, which episode is the latest that is not "coming Friday", whether that black frame is DRM video or a sleeping TV | pixels are the only foreground read-back tvOS has, and only a model can read them |

## The flow

### 1. Detect — never ask what you can read

```bash
node scripts/appletv.js doctor
```

One table: python, the venv (created on first run — takes a minute, say
`installing pyatv…`), pyatv, whether credentials exist, and how many TVs are
remembered with or without a default. **Never ask about anything in it.**
If `doctor` shows a remembered device with credentials, skip straight to the
request — the user does not want to hear about setup twice.

### 2. First contact: scan, pair, alias — once per TV

Only when `doctor` says no devices or no credentials.

```bash
node scripts/appletv.js scan                    # multicast; --hosts <ip> for unicast
```

Show the table. An empty scan prints the likely cause and the fix — relay it,
then try `--hosts <ip>` if the user knows the address. Do not loop scanning.

```bash
node scripts/appletv.js pair --device "<name>"   # run in the BACKGROUND
```

Pairing is two protocols, one PIN each, and the session must stay alive while
the code is read off the screen. Run `pair` with `run_in_background`, watch
for `▶ … is showing a PIN for airplay`, ask the user for the four digits, then:

```bash
node scripts/appletv.js pair --pin <code>        # leading zeros count — pass it as typed
```

It moves on to Companion by itself; repeat the ask once. The result table says
what each protocol unlocks. A refusal names the TV setting that fixes it
(`references/pairing.md`).

```bash
node scripts/appletv.js alias "living room" --device "<name>" --default
```

Ask **at most one question** here: what the user calls this TV, if they have
more than one. With one TV, alias nothing — it is already the default.

### 3. Do what was asked — and read back

```bash
node scripts/appletv.js state [--device <room>]                 # "what's playing"
node scripts/appletv.js send  [--device <room>] pause           # one step
node scripts/appletv.js send  [--device <room>] "turn_on,launch_app=com.netflix.Netflix"
node scripts/appletv.js apps  [--device <room>] netflix         # id for a name, or a deep link
node scripts/appletv.js type  [--device <room>] "stranger things"
```

`references/intents.md` maps the twenty common asks to commands and says which
ones confirm first. Two that always do, **when `state` shows something
playing**: `turn_off` and switching apps. Ask in one line with the title in it:
"The Bear is playing on Living Room — turn it off anyway?"

Before `type`, if the text looks like a password (the field is a login, or the
user says so), show it once and ask; after typing, never repeat it. The capture
records the field's read-back, so with `--out` a password would be on disk —
**never pass `--out` on a `type` that carries a secret.**

### 3b. Navigating inside an app — look, press, look

Nothing on the network says what is on screen: `state` reports the *now-playing
owner*, which changes only once something plays. Netflix disabled deep links
on tvOS in Sept 2025. So any task that needs "find X in the app" runs the loop:

```bash
node scripts/appletv.js screen          # Read the PNG: what is highlighted?
node scripts/appletv.js send <one press>
node scripts/appletv.js screen          # did it do what you predicted?
node scripts/appletv.js state           # the end: app == target and playing
```

**Never send a navigation press you cannot picture the result of.** One press
(or one obvious run of the same press) per look. A wrong guess on a TV opens
the wrong app in front of whoever is watching — this happened, and it is the
reason this section exists. If `screen` is unavailable (no tunnel — `doctor`
says so), say the task needs eyes and stop; do not fall back to guessing.

Things the eyes have taught (`references/screen.md` has the rest):

- Netflix resumes wherever it was left; its episode list highlights the
  in-progress episode, not E1. Look before counting presses.
- Apple TV+ runs a promo before an episode with **Skip** focused; `select`
  it and wait — sending `play` during the promo drops back to the list.
- "Latest episode" is the last tile *without* a "coming Friday" badge.
- A black capture while `state` says `playing` is DRM video: success.
- `open netflix` lands on the household's profile (`appletv pref`); with
  several profiles, always go through `open`, never `launch_app` alone.

### 4. Report — one table, one sentence, stop

`send` prints `| Step | Command | Before | After | Verdict | Why |` and a
summary line. Repeat the table, then one sentence in the verdict's own words:

| Verdict | Say |
|---|---|
| verified | "Paused Severance on Living Room." |
| unverifiable | "Sent `menu` to Living Room — a keypress can't be confirmed; it still shows Netflix." |
| mismatch | "Sent pause but Living Room still reads playing — YouTube may be ignoring it; try `play_pause`?" |

Never "Done." on the last two. A mismatch exits non-zero on purpose.

## Commands

| Command | Returns |
|---|---|
| `appletv doctor [--install]` | python, venv, pyatv version, credentials store, remembered devices — creates the venv when missing |
| `appletv scan [--hosts ip,ip] [--timeout s]` | every Apple TV: model, tvOS, address, paired protocols, what still needs pairing, alias; names the fix when empty |
| `appletv pair --device <name> [--protocol airplay\|companion\|all] [--force]` | pairs AirPlay then Companion, one PIN each, credentials to `~/.pyatv.conf`; per-protocol result and what it unlocks |
| `appletv pair --pin <code>` | delivers the on-screen PIN to the waiting pairing session |
| `appletv alias [<room> --device <name> [--default]]` | binds a room name; sets the default; no args lists them |
| `appletv state [--device <x>]` | power, foreground app, playback, title/series/episode/position, keyboard focus, volume; a field tvOS cannot report says `known-unsupported`, never blank |
| `appletv send [--device <x>] <cmd[=arg][,cmd…]>` | before/after state and a verdict per step; stops at the first mismatch; exits non-zero on any |
| `appletv apps [--device <x>] [<name or url>]` | installed apps with bundle ids; resolves a name or a deep link to a launch target |
| `appletv type [--device <x>] <text> [--append] \| --clear \| --get` | puts text in the focused field and reads it back; refuses when nothing is focused |
| `appletv report --from <dir>` | the same tables from a captured run, verdicts re-derived — exits non-zero if a recorded verdict no longer follows from its capture |
| `appletv screen [--width 1280]` | a screenshot over the developer tunnel (~2.5 s), downscaled; `Read` the path it prints. `--pair` does the one-time developer pairing, `--install-tunnel` writes the LaunchDaemon |
| `appletv pref <app> --profile <name> --position <n>` | this household's profile per app, on this Mac only (never the repo) |
| `appletv open <app>` | turn on, launch, and pick the preferred profile tile |
| `appletv play <deep link> [--title <expected>]` | for services that honour deep links (YouTube, Disney+, Apple TV+, Hulu, Peacock); verified when the app is the now-playing owner and playing |

`--device` takes an alias, a name, an identifier or an IP; omit it for the
default. `--out <dir>` on any live command writes its JSON captures there.

## Rules that are not negotiable

- **Never report a command as done until the Apple TV's state has been read back and agrees with it — a keypress over the network fails silently, so every send ends in exactly one of verified, mismatch or unverifiable, and only the first is ever called done.**
- **Never claim a result you did not observe.** Say what you verified and what
  you did not.
- **Never turn off or switch apps over something playing without asking.** The
  state tells you; the person in the room decides.
- **Never echo a typed password**, and never capture one with `--out`.
- **Never navigate blind.** A deep link is verifiable; a keypress is not — so
  every navigation press is preceded by `screen` and followed by one. No
  tunnel, no navigation: say so.
- **Never ask what `doctor` or `scan` already answered**, and never ask more
  than one question in a row.

<!-- press:agent-ui -->

## What's here

| Path | Is |
|---|---|
| `scripts/appletv.js` | the CLI: `doctor`, `scan`, `pair`, `alias`, `state`, `send`, `apps`, `type`, `report` |
| `references/commands.md` | every command the skill can send, the protocol it needs, the read-back that verifies it, and which are unverifiable |
| `references/pairing.md` | the protocols (AirPlay, Companion, MRP-over-AirPlay), the one-PIN-per-protocol flow, where credentials live, and the TV settings that block pairing |
| `references/apps.md` | the verified bundle-id table and how deep links open a specific title in Netflix, Disney+, Max, YouTube and Apple TV+ |
| `references/errors.md` | the error taxonomy — each failure the network, the TV or tvOS produces, mapped to the message and the fix the skill gives |
| `references/intents.md` | the twenty things people actually ask a TV to do, each mapped to a command sequence and its confirmation policy |

## Maintainer reference — not part of a user run

`skill-invariants.json` names what must not silently disappear, declares which
half of this skill is code, and lists the baseline eval set. The baseline is
pinned against a real run — see its `update_command` to refresh it.

<!-- >>> press:agent-ui v0.9.0 sha256:ce9c1c6b30d6 GENERATED by @natjswenson/press, do not edit -->
## Presentation — how a run should look

This skill is watched, not just run. Everything below assumes the user is
reading the conversation, so **the transcript is part of the product.**

**Keep the machinery invisible.** The user should see a short status line and a
table, not a scroll of raw command output. Concretely:

- **Never print file contents into the conversation.** Not a fetched page, not a
  source file, not a script's own source. Scripts hand each other *paths*; when
  you need a file's text in context, use the `Read` tool rather than `cat`,
  `sed`, `head`, or a `--show` flag. Anything the user already has open
  somewhere is a wall of text in chat.
- **One script call, not a pipeline.** Every step should be a single command that
  returns everything you need. If you find yourself chaining `sed`/`grep`/
  `python3 -` to reshape output, the script should have given it to you — say so
  rather than working around it.
- **Report in tables, with named columns.** Ad-hoc prose summaries are why runs
  read inconsistently. Every stage that produces more than one fact reports a
  table with a fixed column set, declared in this skill's own steps below.
  Omit noise: don't list unchanged fields, don't repeat inputs back, don't show
  paths the user can't act on.
- **Show, don't describe.** When a run produces something visual, `Read` the
  rendered image so the user sees it, instead of writing a paragraph about it.
- **Never claim a visual result without the artifact.** "It looks better" with no
  PNG in the transcript is not a result.

**The exception — narrate the slow parts.** Anything that takes more than a
couple of seconds gets one short lowercase line as it starts (`fetching the
posting…`, `rendering press + ats-plain…`) so the user sees progress rather than
dead air. One line each, not a table.

**Announce the skill once, at the start**, in one sentence, and never again.
<!-- <<< press:agent-ui -->

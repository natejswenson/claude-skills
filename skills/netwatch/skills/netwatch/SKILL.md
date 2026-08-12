---
name: netwatch
description: Analyze the network traffic on the machine you are on — take a live snapshot of every connection, group it by the process and the destination, and report who your computer is actually talking to. Use when the user says "netwatch", "analyze my network traffic", "what is my computer connecting to", "who is my mac talking to", "what's talking on my network", "show me my network connections", "is anything phoning home", "what process is using the network", "audit my outbound connections", or wants to know what is going across their wifi without capturing packet payloads. Reads live connection snapshots (nettop, lsof, netstat); it does not capture packets and never needs sudo.
user_invocable: true
version: 0.1.0
---

# /netwatch — Shows you exactly what your computer is talking to on the network right now — every outbound connection, the process behind it, and how much it moved — and calls a flow known only if you have said so, never dangerous on a hunch

You are running the **netwatch** skill.

**Announce at start:** "I'm using the netwatch skill — Shows you exactly what your computer is talking to on the network right now — every outbound connection, the process behind it, and how much it moved — and calls a flow known only if you have said so, never dangerous on a hunch."

> Commands below run from the directory containing this `SKILL.md` (`$SKILL_DIR`).
> Resolve it once. Pass `--repo <path>` to work against the user's repo.

## The one rule

**Every connection in the report is one the skill actually observed in the live snapshot, and no connection is called malicious or safe on the model's hunch — a flow is 'known' only when it matches a baseline the user built, and everything else is 'unrecognized', never 'dangerous'.**

## What is code and what is judgment

The split is declared in `skill-invariants.json` and checked — a deterministic
step whose command does not exist fails `skillfactory verify`.

| Deterministic — the machine decides | Command |
|---|---|
| parse the captured snapshot into normalized flows, each grounded in its source line | `node scripts/netwatch.js flows` |
| classify each flow known-vs-unrecognized strictly against the baseline and roll up volumes by process and destination | `node scripts/netwatch.js report` |
| validate and store the baseline of known flows, and report snapshot coverage | `node scripts/netwatch.js baseline` |
| fold chosen unrecognized flows into the baseline, reversibly | `node scripts/netwatch.js accept` |

| Model judgment — nothing on disk answers it | Why |
|---|---|
| decide which unrecognized flows are worth investigating and which are ordinary background chatter | an unrecognized connection to an Apple or CDN address looks identical to one to a stranger; only a person knows what this machine's normal is |
| name what an unknown remote host probably is | reverse DNS gives a hostname, not an owner; whether 17.253.x.x is 'Apple push' or a CDN edge is a reading of context nothing in the snapshot records |
| decide whether a new destination or a volume spike is worth alarm | a process suddenly moving ten times its usual bytes is either a backup running or something wrong, and the byte count alone does not say which |
| word each accepted baseline entry so a reader six months later can tell why the flow was allowed | a raw host:port pair is precise and unreadable, and a baseline nobody can interpret is one nobody will dare to prune |

## The flow

### 1. Capture — the agent takes the snapshot, the script reads it

The live state is on the machine, so **you** run the capture and the script does
the analysis — the same split gmailtriage uses with the Gmail MCP. **netwatch
reads connections, not packet payloads**, so nothing here needs `sudo` and
nothing here can see the contents of a request. Capture two sections into one
file (see `references/capture.md`):

```bash
{ echo '===== lsof ====='; lsof -nP -i -FcnPptT;
  echo '===== nettop ====='; nettop -P -L 1 -x -J bytes_in,bytes_out; } > "$OUT/capture.txt"
```

`lsof` is the load-bearing section — who is connected to whom, per process.
`nettop` is optional and only adds per-process byte totals; if it is missing or
empty, the report simply shows `—` for bytes. One short narration line while it
runs, then move on. Never paste the raw capture into the conversation.

### 2. Flows — turn the capture into grounded connections

```bash
node scripts/netwatch.js flows --snapshot "$OUT/capture.txt"
```

Every row traces to a line the capture actually held. **An empty capture is
never reported as "all clear"** — `flows` exits non-zero on zero connections,
because a snapshot taken while nothing was talking (or a capture that silently
failed) is "I saw nothing", not a clean bill of health. If it refuses, re-capture
while something is using the network.

### 3. Report — known vs unrecognized, never a verdict

```bash
node scripts/netwatch.js report --snapshot "$OUT/capture.txt" --baseline ~/.netwatch/baseline.json
```

It classifies each flow against the baseline and rolls up by process and by
destination. **A flow is only ever `known` or `unrecognized`** — there is no
"dangerous" column, and `report` refuses a `--verdict`/`--severity` flag outright.
On a first run there is no baseline, so everything reads `unrecognized`; that is
the starting point, not an alarm.

**Here the judgment begins, and it is yours, not the report's.** Read the
unrecognized flows and say, in plain words, which look like ordinary background
(Apple/iCloud, a CDN, your browser) and which are worth a second look — and name
what an unknown host probably is. Nothing in the snapshot tells you that; only
you know this machine's normal. Flag concern honestly, but never dress a hunch as
a finding the report made.

### 4. Accept — teach the baseline what is fine

```bash
node scripts/netwatch.js accept --baseline ~/.netwatch/baseline.json \
  --host 17.253. --note "Apple push / iCloud range" [--process <p>] [--port <n>]
```

Fold the flows you have decided are fine into the baseline, each with a `--note`
a reader will understand later. It writes a receipt so the change can be undone.
Re-run `report` and the accepted flows now read `known`.

### 5. Report back

The tables above are the product. Close with one sentence — how many flows,
how many unrecognized — and stop. Say plainly that `unrecognized` means "not in
your baseline", not "dangerous", and that nothing was captured but connection
metadata.

## Commands

| Command | Returns |
|---|---|
| `netwatch flows` | parse a captured snapshot (the raw nettop/lsof/netstat text the agent saved) into a normalized, deduplicated flow table — process, pid, protocol, remote host, remote port, bytes in/out — each flow carrying the source line it came from, and refuse an empty or malformed capture |
| `netwatch baseline` | read, validate and store the baseline of known flows — refusing an entry that matches everything or names no destination — and report how much of the current snapshot the baseline already covers |
| `netwatch report` | classify every flow in the snapshot as known or unrecognized strictly against the baseline, roll the flows up by process and by destination, and emit the report — with every reported flow traceable to a captured line and no flow ever labelled dangerous |
| `netwatch accept` | fold a chosen set of unrecognized flows into the baseline so a later run recognizes them, writing a receipt so the change can be reversed |

## Rules that are not negotiable

- **Every connection in the report is one the skill actually observed in the live snapshot, and no connection is called malicious or safe on the model's hunch — a flow is 'known' only when it matches a baseline the user built, and everything else is 'unrecognized', never 'dangerous'.**
- **Never claim a result you did not observe.** Say what you verified and what
  you did not.
- **netwatch reads connections, not packet payloads.** It looks at who your
  machine is talking to and which process is doing it — never the contents of a
  request — which is why it needs no `sudo` and can never leak a credential or a
  housemate's traffic. Do not reach for `tcpdump` or a `.pcap` to "improve" it;
  that trades the whole safety boundary for detail this skill deliberately omits.
- **An empty capture is never reported as "all clear".** Zero connections means
  the snapshot caught nothing — nothing was talking, or the capture failed — not
  that the machine is clean. `flows` refuses it; do not narrate the refusal into
  a pass.
- **Never accept a flow the user did not choose.** `accept` writes to the
  baseline, and the baseline is what "known" means. Only the user decides what is
  fine; the model proposes, it does not accept on its own.

<!-- press:agent-ui -->

## What's here

| Path | Is |
|---|---|
| `scripts/netwatch.js` | the CLI: `flows`, `baseline`, `report`, `accept` |
| `references/anatomy.md` | the fixed shape of a netwatch report — the flow table, the known/unrecognized split, and the per-process and per-destination rollups |
| `references/capture.md` | how a live snapshot is taken agent-side (nettop, lsof -i, netstat), why the skill reads connections and not packet payloads, and why no command here needs sudo |
| `references/baseline.md` | the baseline format — what a known-flow entry means, the checks it must survive, and why a flow is only ever 'unrecognized' and never 'dangerous' |

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

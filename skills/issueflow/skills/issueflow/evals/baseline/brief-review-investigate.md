# issueflow red-team brief — Review: Investigate (round 1)

You are the **red-team reviewer** of the investigate stage of an issueflow run on `natejswenson/local-fitness` issue #132. Your job is to find what the
stage missed. You are the gate: nothing you pass here gets a second look, so hunt
like the defect is in there and you have not found it yet.

You are running cold: you cannot see the conversation that dispatched you, and
nothing you were not handed here exists for you. Everything you need is below or
named by a path below.

## The issue — #132

**update_user_note / delete_user_note can silently hit the wrong preference**

<https://github.com/natejswenson/local-fitness/issues/132>

Found during the `docs/mcp/` audit, not previously known.

## The problem

`update_user_note` and `delete_user_note` address a note by its **raw file line index** in `data/user_notes.md`. Those indices are not stable:

- Any `delete_user_note` shifts every subsequent index down by one.
- The 4 KB rotation renumbers everything.

Nothing detects a stale index. The target line is still a valid bullet, so the write **succeeds against the wrong note** — no error, no warning. A caller that listed notes, thought about it, then wrote back can silently overwrite or delete a different preference than the one it read.

This is the worst shape a bug can take here: user notes are injected into the system prompt, so a wrong write silently changes how the coach behaves in every future conversation, and the only way to notice is to read the file.

## Also in this area

**`update_user_note` never triggers the 4 KB rotation.** Only `append_note` calls `_rotate_to_fit`, so replacing a short note with a much longer one can push the live file past `LIVE_FILE_MAX_BYTES` and leave it there. The prompt-injection budget is enforced on append only.

**`notes.read_notes()`'s docstring is wrong** (`src/local_fitness/notes.py:99-100`): it claims "newest-first ordering matching the on-disk order". The file is append-only, so on-disk order is *oldest*-first and `read_notes` preserves it; only `render_for_prompt()` reverses. So `list_user_notes` returns oldest-first while the system prompt shows newest-first — the two surfaces disagree, and the docstring asserts the wrong one. Worth deciding which is canonical and making both match.

## Suggested fix

Give notes a stable identity that survives deletion and rotation. Options, roughly in order of cost:

1. **Content hash as the handle** — `list_user_notes` returns a short hash per note; the write tools take that instead of an index and fail loudly if it no longer matches. No schema change, no migration.
2. **Monotonic id in the file** — write `<!-- id:7 -->` alongside each bullet. Survives rotation, but changes the on-disk format.
3. **Move notes to the DB** — heaviest; the Markdown file is deliberate (human-editable, greppable, gitignored), so this is probably the wrong trade.

(1) fits the existing design best and makes the failure mode loud instead of silent.

## Lower-severity, adjacent

- `list_observations` passes `obs_type` straight into a case-sensitive SQL `=` with no validation, while `log_observation` validates against `OBS_TYPES` and returns the allowed list. A typo returns an empty list, indistinguishable from "nothing logged".
- `delete_observation` reads `args["observation_id"]` directly rather than `.get()` with a validation branch, so a missing parameter raises a `KeyError` out of the handler instead of returning the clean `_err` shape every neighbouring tool uses.

## Documented meanwhile

`docs/mcp/update_user_note.md`, `delete_user_note.md`, `list_user_notes.md`, and `list_observations.md` call these out prominently, so a reader isn't surprised before the fix lands.

### Comments (1)

**natejswenson:**

<!-- issueflow:run natejswenson/local-fitness#132 -->

### 🤖 issueflow — natejswenson/local-fitness#132

Each stage below ran as its own subagent and was gated by an adversarial
red-team review — every blocking finding resolved before approval. This
comment is rewritten at every gate.

| Step | Model | State | Took |
|---|---|---|---|
| investigate | opus | ✅ approved | 35m22s |
| design | opus | ✅ approved | 18m10s |
| notes-atomic-writes/implement | sonnet | pending | — |
| notes-atomic-writes/test | sonnet | pending | — |
| notes-line-framing/implement | sonnet | pending | — |
| notes-line-framing/test | sonnet | pending | — |
| notes-handles/implement | sonnet | pending | — |
| notes-handles/test | sonnet | pending | — |
| notes-recency-ordering/implement | sonnet | pending | — |
| notes-recency-ordering/test | sonnet | pending | — |
| notes-update-rotates/implement | sonnet | pending | — |
| notes-update-rotates/test | sonnet | pending | — |
| observation-arg-validation/implement | sonnet | pending | — |
| observation-arg-validation/test | sonnet | pending | — |

| Lane | Branch | Base | Pushed |
|---|---|---|---|
| notes-atomic-writes | `feature/issue-132-notes-atomic-writes` | `main` | — |
| notes-line-framing | `feature/issue-132-notes-line-framing` | `feature/issue-132-notes-atomic-writes` | — |
| notes-handles | `feature/issue-132-notes-handles` | `feature/issue-132-notes-line-framing` | — |
| notes-recency-ordering | `feature/issue-132-notes-recency-ordering` | `feature/issue-132-notes-handles` | — |
| notes-update-rotates | `feature/issue-132-notes-update-rotates` | `feature/issue-132-notes-recency-ordering` | — |
| observation-arg-validation | `feature/issue-132-observation-arg-validation` | `feature/issue-132-notes-update-rotates` | — |

| Step | Rounds | Blocking found | Notes |
|---|---|---|---|
| investigate | 3 | 3 | 13 |
| design | 2 | 1 | 16 |

---

<details><summary><b>investigate</b> — investigate.md</summary>

# Investigate — issue #132: `update_user_note` / `delete_user_note` can silently hit the wrong preference

Repo: `natejswenson/local-fitness` @ `dev` (clean tree, nothing modified by this stage).
Every behaviour below was reproduced against a throwaway notes file / temp DB outside the repo,
using the project's own `.venv`. The `/mcp` transport was driven end to end in-process
(Starlette `TestClient`, the same shape `tests/test_mcp_server.py:468-501` uses).

## Root cause

`src/local_fitness/notes.py` treats the live file as **text at write time rather than as a list of
records**. A line's byte position in the file is made to carry three things it does not actually
carry — the note's identity, the note's recency, and its own line boundary — and each produces an
independent silent-corruption path:

1. **No identity, only position.** `Note.line` is a raw file line index recomputed on every read
   (`src/local_fitness/notes.py:110-113`), and the two write paths validate only that the index is
   *in range and still a bullet* (`src/local_fitness/notes.py:229-232`,
   `src/local_fitness/notes.py:260-264`) — never that it is still *the same note the caller read*.
2. **No recency, only position.** `render_for_prompt` derives "newest first" purely by reversing
   file order (`src/local_fitness/notes.py:127`) and emits no timestamps
   (`src/local_fitness/notes.py:130`), while `update_note` refreshes a note's timestamp to `now()`
   and rewrites it **in place** (`src/local_fitness/notes.py:233-237`). After any update, file
   position and recency disagree — and `_rotate_to_fit` evicts by position
   (`src/local_fitness/notes.py:192`), so it archives the *freshest* note first.
3. **No line framing on reassembly.** `_rotate_to_fit` rebuilds the file as
   `"".join(lines) + new_line` (`src/local_fitness/notes.py:193`) without checking that the last
   kept line ends in a newline, so on a file that does not end in one the newest surviving note and
   the incoming bullet are concatenated into a single corrupted note.

In one sentence: **the module encodes a note's identity, its recency and its line boundary in the
file's byte layout, which carries none of the three — so a stale index, an in-place timestamp
refresh, and a missing trailing newline each destroy or mis-rank a different preference than the
caller named, and every one of them reports success.**

All three are the same shape from the caller's side: the tool returns a clean payload naming the
note the caller intended, while a *different* preference is gone or is being read as the wrong one.

## Evidence

### The identity gap, file by file

| What | Where |
|---|---|
| `Note.line` declared "stable until next write" — the whole bug in a comment | `src/local_fitness/notes.py:56` |
| `read_notes()` assigns `line` from `enumerate(text.splitlines())`, i.e. recomputed per read | `src/local_fitness/notes.py:110-113` |
| `render_for_prompt()` emits those same indices as `[N]` prefixes into the system prompt | `src/local_fitness/notes.py:117-130` |
| `update_note()` — the only guards are `0 <= i < len(lines)` and `_parse_line(...) is not None` | `src/local_fitness/notes.py:229-232` |
| `delete_note()` — same two guards, then `del lines[line_index]`, which shifts everything after it | `src/local_fitness/notes.py:260-265` |
| `append_note()` is the **only** caller of `_rotate_to_fit`, which drops oldest lines and renumbers | `src/local_fitness/notes.py:156-159`, `:181-194` |
| MCP surface: `list_user_notes` hands out `line` | `src/local_fitness/agent/tools.py:2029-2037` |
| MCP surface: `update_user_note` takes `line: int`, passes it straight through | `src/local_fitness/agent/tools.py:2049-2062` |
| MCP surface: `delete_user_note` takes `line: int`, passes it straight through | `src/local_fitness/agent/tools.py:2072-2079` |
| The prompt *instructs* the model to call `update_user_note(line=N, …)` / `delete_user_note(line=N)` off the `[N]` prefixes | `src/local_fitness/agent/prompts.py:211-221` |

The `flock` in `_open_locked` (`src/local_fitness/notes.py:61-76`) is held only for the duration of
one call. It serialises writers; it does not span the read→decide→write interval, so it cannot make
an index survive that interval — this is a compare-and-swap problem, not a locking problem. (It also
does not cover readers at all — see *Reproduction 5*.)

### Reproduction 1 — a delete silently redirects the next update

Snapshot from `list_user_notes`: `{0: ZERO, 1: ONE, 2: TWO, 3: THREE}`. Caller deletes line 1
("forget ONE"), then updates what it still believes is line 2 (`TWO`):

```
update_note(2, "REWRITTEN BY THE CALLER")
  -> Note(line=2, timestamp=..., text='REWRITTEN BY THE CALLER')   # reports SUCCESS
file after:
    - ... — ZERO
    - ... — TWO            <- the intended target, untouched
    - ... — REWRITTEN BY THE CALLER   <- THREE, silently destroyed
```

`'TWO' still present: True`, `'THREE' still present: False`. No error, no warning, no archive
(`delete`/`update` never archive — only rotation does).

### Reproduction 2 — rotation renumbers, and the wrong note is deleted

Fill past `LIVE_FILE_MAX_BYTES` (4096, `src/local_fitness/notes.py:33`) so 17 bullets are live.
Caller lists and targets line 5 (`"18 …"`). One `save_user_note` from anywhere (another chat
session, or the same turn) triggers `_rotate_to_fit`:

```
after one more append: line 5 is now '19 xxx'
delete_note(5) -> True        # deleted the WRONG note, no error
```

### Reproduction 3 — `update_user_note` never rotates, so the 4 KB prompt budget is not enforced

`update_note` rewrites a line in place and never calls `_rotate_to_fit`. Six bullets, each replaced
via `update_note` with the 800-char maximum (`src/local_fitness/notes.py:219-220`):

```
file size: 4962 bytes   (cap 4096)   -> over cap: True
```

The file stays over budget until the next `append_note`. Every prompt built in between injects the
oversized block.

### Reproduction 4 — rotation welds two notes into one when the file has no trailing newline

**This is a second silent destroy-a-preference path, and the issue does not mention it. A content
handle on the write tools cannot catch it, because the tool that triggers it — `save_user_note`
(`src/local_fitness/agent/tools.py:1999-2017`, schema `{"note": str}`) — takes no handle at all.**

`append_note` handles the missing-trailing-newline case correctly on the *normal* path
(`src/local_fitness/notes.py:155` and `:165-167` both insert the separator). The rotation branch
does not: `_rotate_to_fit` returns `"".join(lines) + new_line` (`src/local_fitness/notes.py:193`)
with no such guard. So the defect fires **only** when the file both lacks a trailing newline and
crosses the 4 KB cap.

A file without a trailing newline is not exotic — `notes.py:14` explicitly invites hand-editing
("rewrite or delete lines directly with any text editor"), and plenty of editors do not add one.
Nothing in the repo *creates* the shape, but `update_note` preserves it once present
(`src/local_fitness/notes.py:236-237` copies the original line's `had_newline`).

Same 40-note fixture, run twice — identical except for the file's last byte:

```
=== trailing newline on disk: True ===
  size before: 4710  cap: 4096  | notes before: 40
  rotation fired (archive exists): True
  'THE NEW NOTE' is its own note: True
  notes after: 35
  last note text: 'THE NEW NOTE'

=== trailing newline on disk: False ===
  size before: 4709  cap: 4096  | notes before: 40
  rotation fired (archive exists): True
  'THE NEW NOTE' is its own note: False       <-- destroyed
  notes after: 34                             <-- one fewer than it should be
  last note text: 'note number 39 about a durable coaching preference that takes up
                   a realistic amount of room- 2026-09-01T14:01:15 — THE NEW NOTE'
```

Driven end to end through the real MCP handlers (`LOCAL_FITNESS_NOTES_PATH` pointed at the fixture),
the tool reports unqualified success while the file says otherwise:

```
save_user_note -> {"saved": true, "line": 33, "timestamp": "2026-09-01T14:03:33",
                   "text": "Never comment on my weekend sleep."}
list_user_notes count: 34
  {'line': 32, 'timestamp': '2026-01-11T08:00:00', 'text': 'note number 38 …'}
  {'line': 33, 'timestamp': '2026-01-12T08:00:00',
   'text': 'note number 39 about a durable coaching preference that takes up a realistic
            amount of room- 2026-09-01T14:03:33 — Never comment on my weekend sleep.'}
```

Three consequences, all silent:

- The pre-existing note 39 is **gone as a distinct preference** and was *not* archived — it was
  among the kept lines, so `_append_archive` never saw it. Unlike rotation, this loss has no
  recovery copy.
- The new note is **not addressable**: `save_user_note` returned `line: 33`, and line 33 exists, but
  it holds the welded text. A follow-up `update_user_note(line=33, …)` would rewrite the corruption,
  not the note the caller just saved.
- `_parse_line` re-splits the welded line on the *first* `" — "`, so the surviving record carries
  note 39's old timestamp with the new note's text glued onto the end — a bullet that looks
  well-formed to every consumer.

**No existing test can catch this.** `tests/test_notes.py:131-139` (`test_rotation_to_archive`) is
the only rotation test, and it drives rotation through 120 successive `append_note` calls — each of
which writes a line ending in `\n`, so the fixture can never reach the state that triggers the weld.
19 tests in that file; none construct a notes file without a trailing newline.

**The same defect exists a second time in the archive path.** `_append_archive`
(`src/local_fitness/notes.py:197-207`) guards the trailing newline of the text it *writes* (`:204-205`)
but never the file it appends *to*, so a hand-edited archive welds identically:

```
archive after: '- 2025-01-01T00:00:00 — an old archived preference- 2025-02-02T00:00:00 — a rotated preference\n'
archive notes: ['an old archived preference- 2025-02-02T00:00:00 — a rotated preference']
```

Lower severity (the archive is not injected into any prompt), but it is the same missing invariant
and should be fixed in the same change: **every write that concatenates onto existing file content
must establish the line boundary itself.**

### Reproduction 5 — `read_notes` takes no lock, so a concurrent read can see an empty file

`read_notes` reads with a bare `p.read_text()` and no `flock` (`src/local_fitness/notes.py:104-105`),
while `update_note` and `delete_note` `seek(0); truncate()` and only then buffer-and-flush the
replacement (`:238-242`, `:266-270`). Between the `truncate()` and the `flush()` the file is **zero
bytes on disk**, and nothing stops a reader from landing there.

Measured with no artificial delay at all — one thread running `update_note` in a loop, one thread
running `read_notes`, 20 notes in the file:

```
note-count histogram observed by an UNLOCKED concurrent reader:
    0 notes -> 2440 reads
   20 notes -> 8694 reads
```

**22% of reads saw zero notes.** In that window `render_for_prompt` returns `""` and
`user_notes_block` (`src/local_fitness/agent/prompts.py:73-85`) returns `""` — so the persona is
built with **no saved-preferences section at all**, and every path listed below inherits it for the
lifetime of whatever it produced. This is a distinct defect from the index bug (no wrong write
occurs), and a content handle does not address it; the fix is to take a shared `flock` in
`read_notes`, or to write via a temp file and `os.replace` so the swap is atomic.

### Reproduction 6 — one `update_user_note` breaks "newest first" for every later prompt

`update_note` refreshes the timestamp to `now()` (`src/local_fitness/notes.py:233`) while rewriting
the line **in place** (`:237`). `render_for_prompt` ranks by reversing file order (`:127`) and prints
only `[N] text` (`:130`), so the model gets no timestamp to correct with. Two notes, the older one
refined today:

```
=== before any update ===
read_notes (what list_user_notes returns, oldest-first on disk):
   line=0 ts=2026-01-01T08:00:00 OLD note, superseded.
   line=1 ts=2026-02-01T08:00:00 NEWER conflicting note.
render_for_prompt:  [1] NEWER conflicting note. || [0] OLD note, superseded.

=== after update_note(0, ...) -> ts refreshed to 2026-09-01T14:18:18 ===
file on disk:
    - 2026-09-01T14:18:18 — OLD note, but just refreshed today.
    - 2026-02-01T08:00:00 — NEWER conflicting note.
render_for_prompt (claims newest-first):
    [1] NEWER conflicting note. || [0] OLD note, but just refreshed today.

prompt header the model is given for that block:
   # What Nate has told you (most recent first — prefer the newer note when two conflict)

truly newest-first by timestamp: ['OLD note, but just refreshed today.', 'NEWER conflicting note.']
what the prompt actually shows first: [1] NEWER conflicting note.
```

The header at `src/local_fitness/agent/prompts.py:83-85` promises an ordering the renderer cannot
deliver, and the conflict rule built on it ("prefer the newer note when two conflict") resolves
**backwards** the moment any note has been refined — which is precisely the flow
`prompts.py:211-221` tells the model to use ("if it overlaps an existing note, ask whether to
replace it"). So the ordinary, documented preference-refinement path is what breaks the ordering.

This is not a rendering-only bug: file position is what `render_for_prompt` calls recency, what
`list_user_notes` implies by returning on-disk order, and what `docs/mcp/list_user_notes.md:68-70`
asserts ("the file is append-only, so the *last* entry is the newest" — false after any update).

### Reproduction 7 — rotation archives the freshest note first

Because `_rotate_to_fit` pops `lines[0]` (`src/local_fitness/notes.py:192`) — oldest by *position* —
a note refreshed today is the first thing evicted when the file next crosses the cap. 41 bullets,
the one at line 0 refined today, then one ordinary `save_user_note`:

```
size: 4182  cap: 4096
refreshed: 2026-09-01T14:18:43 JUST REFRESHED TODAY — lead with the workout card.
newest note by timestamp: JUST REFRESHED TODAY — lead with the workout card.
refreshed note still live: False
refreshed note in archive: True
live notes count: 40
oldest surviving live note: note 02 a durable coaching preference with a realistic amoun
```

The preference the user most recently confirmed is the one that leaves the prompt, while 40 older
ones stay. It is recoverable (the archive has it) and it is silent.

### Where the notes actually reach a model — the full surface

`render_for_prompt`'s `[N]`-prefixed output reaches a model through **eight** call sites:

| # | Site | Reaches the model as | Resolved |
|---|---|---|---|
| 1 | `_install_coach_persona` → `create_initialization_options` (`src/local_fitness/web/mcp_server.py:552`, memo at `:494-509`, wrap at `:512-577`) | MCP `instructions` (the chat persona) | **per request** in stateless mode; *delivered* only on an `initialize` request |
| 2 | `_coach_prompt` (`src/local_fitness/web/mcp_server.py:260`) | `prompts/get` text | fresh on every `get_prompt` |
| 3 | `_brief_prompt` (`src/local_fitness/web/mcp_server.py:315`) | `prompts/get` text | fresh on every `get_prompt` |
| 4 | Brief V2 alt system prompt (`src/local_fitness/agent/briefing.py:672`) | brief system prompt | fresh per brief |
| 5 | Brief V2 system prompt (`src/local_fitness/agent/briefing.py:720`) | brief system prompt | fresh per brief |
| 6 | Brief V1 system prompt (`src/local_fitness/agent/briefing.py:740`) | brief system prompt | fresh per brief |
| 7 | Plan-coach line (`src/local_fitness/agent/tools.py:4341`) | plan-coach line | fresh per render |
| 8 | Workout-card coach read (`src/local_fitness/agent/tools.py:4631`) | card coach read | fresh per render |

Sites 1–3 and 6 go through `prompts.system_prompt` (`src/local_fitness/agent/prompts.py:141`);
4, 5 and 3 go through `prompts.brief_v2_system_prompt` (`:750`).

Two further surfaces read the notes **without** indices, in raw oldest-first file order:

| Site | Reaches the model as | Order |
|---|---|---|
| `list_user_notes` (`src/local_fitness/agent/tools.py:2029-2037`) | `{line, timestamp, text}` triples | oldest-first |
| `assemble_status` (`src/local_fitness/agent/status.py:443`) → `daily_snapshot` (`src/local_fitness/agent/tools.py:2669-2680`), documented at `docs/mcp/daily_snapshot.md:39` | bare text strings — no index, no timestamp | oldest-first |

So there are **three** model-facing orderings, not two: prompt-reversed, `list_user_notes`
on-disk, and `daily_snapshot` on-disk. Two scoping facts worth recording, both checked:
`_render_status` deliberately omits the notes from the coach prompt's snapshot
(`src/local_fitness/web/mcp_server.py:64-67`), and `get_brief_context` has no notes field at all
(`docs/mcp/get_brief_context.md:262-263`; `assemble_status` has exactly two callers repo-wide,
`src/local_fitness/web/mcp_server.py:263` and `src/local_fitness/agent/tools.py:2680`). Only
`daily_snapshot` carries them.

**Correction to the round-1 artifact:** `prompts.SYSTEM_PROMPT` (`src/local_fitness/agent/prompts.py:905`)
is *not* one of these. Line 904 marks it `# Backwards-compat (tests still import these as constants)`,
and its only consumer repo-wide is `tests/test_prompts.py:185`. Every serving path calls
`system_prompt()` fresh. The import-time snapshot is not part of the story.

**Correction to the round-2 artifact:** round 2 claimed the persona `instructions` are frozen at
handshake, so the model reasons from a pre-conversation snapshot. **That is wrong server-side.**
`build_session_manager(stateless_http: bool = True)` (`src/local_fitness/web/mcp_server.py:605-630`)
is the deployed transport, mounted at `src/local_fitness/web/server.py:60` and `:85`, and in
stateless mode the SDK calls `self.app.create_initialization_options()` once **per HTTP request**
(`.venv/…/mcp/server/streamable_http_manager.py:168-215`) — exactly what the comment at
`src/local_fitness/web/mcp_server.py:418` says. The persona memo key includes the notes file's
`(st_mtime_ns, st_size)` (`:494-509`), so it cannot serve a stale notes block.

Driven end to end against the real mounted `/mcp` app:

```
=== request 1: initialize ===
  instructions present: True
  notes section: ['[0] ORIGINAL note about pacing.']
--- another writer appends a note between requests ---
=== request 2: initialize again, after a write ===
  notes section: ['[1] SECOND note written mid-conversation.', '[0] ORIGINAL note about pacing.']
  instructions changed between the two initializes: True
=== request 3: tools/call with NO initialize ===
  status: 200
  top-level keys of the JSON-RPC response: ['id', 'jsonrpc', 'result']
  'instructions' anywhere in the response body: False
```

Two facts, both load-bearing for the fix. The server re-resolves the notes block on every request
and **never serves a stale one**. But `instructions` travel to a client only inside an
`InitializeResult` — the SDK sends them from exactly one place
(`.venv/…/mcp/server/session.py:176-197`), in reply to an `InitializeRequest`, and in stateless mode
the session starts already `Initialized` (`session.py:94-98`) so a `tools/call` needs no handshake
and gets no `instructions` back. **How often a real client re-initializes is therefore what decides
how fresh the model's `[N]` list is, and that is a client-side question this repo cannot answer** —
it is an Unknown below, not a finding.

None of that changes the conclusion that the prompt path is a second live entry point into the bug,
because the staleness does not come from caching. It comes from writes that land *after* a render:
`render_for_prompt` emits `[N]` values that `prompts.py:211-221` tells the model to write with, and
those indices are invalidated by the model's own next `delete_user_note`, or by any other session's
`save_user_note` that trips rotation — no matter how fresh the render was. A perfectly fresh block
is still a snapshot

… truncated at 20000 characters. The whole artifact is at `investigate.md` in the run directory.

</details>

_Remaining artifacts omitted — the comment reached its size budget._


## The artifact under review

`<RUN>/shared/investigate.md`

Read all of it. This is the work you are attacking — not editing, not improving,
attacking. Round 1 of at most 3.

## Your hunt

Open every `path:line` the investigation cites and check the code says what
the artifact claims it says. A citation that does not support its claim is a
finding at the severity of the claim.
Hunt for an alternate root cause the artifact never ruled out. If you can
name one it did not consider, that is a finding.
Hunt for guesses dressed as findings: any claim presented as established
that belongs in Unknowns.
Check the "does the issue ask for the right fix" question was actually
answered, not restated.

## You must not

Never edit the work or any file other than your own review artifact — a reviewer that fixes what it found has destroyed the gate it was sent to hold. Never file a finding without a citation that resolves; an uncited finding is an opinion, and the registrar refuses the whole review over it. Each round re-hunts the current work from scratch — never weaken a finding to make a round converge, and never re-file a resolved one from memory. Never inflate severity: medium and low are notes, and a note filed as high to force a round is the reviewer gaming its own gate.

## Working context

| Field | Value |
|---|---|
| work in | <REPO> |
| repository | <REPO> |
| branch | (no branch yet — this stage does not commit) |
| base branch | main |
| work item | the whole issue |

## Findings format

Every finding is ONE line under `## Findings`, exactly:

    - [critical|high|medium|low] <citation> — <one-sentence finding>

The citation must be one of:

- `path:line` (or `path:l1-l2`) — a real file, in the repository;
- `investigate.md § <Heading>` — a heading that exists in the artifact under review;

A citation that does not resolve refuses your whole review — cite what you can
point at, and put what you cannot prove in `## Not examined`. Severity is the
gate: critical and high block the stage; medium and low are notes. Rate what the
finding costs if shipped, not how strongly you feel about it.

## Deliver

Write your review to `<RUN>/reviews/investigate-r1.md`.

It must contain a section for each of: **Findings**, **Not examined**, **Verdict**.
`## Not examined` names what you did not check — a clean review that examined
everything still says so there. `## Verdict` is one word, `pass` or `blocked`,
and it must agree with your own severities: any critical or high finding means
`blocked`.

## While you work

Append one short lowercase line to `<RUN>/progress/review-investigate-r1.log` whenever you
reach a real milestone — what you just found, or what you are about to check next.
This is scratch work for whoever is watching the run, not part of your answer:
nobody reads it as prose, and it is never quoted back to you. Skip it if you
genuinely have nothing to report yet; do not pad it to look busy.

## When you are done

The moment the review is written, send the orchestrator a message with
`SendMessage`, addressed to `main` — the agent that dispatched you. The message
is the review's path, then two or three sentences of result: your verdict and
the worst thing you found. Send it before you finish your turn. An agent that
goes idle without sending one leaves the orchestrator unable to tell a finished
review from a stalled one. If your harness names the dispatching agent something
other than `main`, send it to that name instead.

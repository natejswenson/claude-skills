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
is still a snapshot. That is why the fix has to reach `render_for_prompt`, not just `list_user_notes`.
Note also that the prompt's own advice cuts both ways: it says "The notes section above is the
authoritative list" (`src/local_fitness/agent/prompts.py:213`) but also "``list_user_notes`` re-reads
from disk if the section looks stale" (`:219-220`), and "At most one note call per turn unless he
asks for several" (`:221`) narrows — but does not close — the intra-turn multi-write window.

Reproduced ordering disagreement (issue's third point), from the same run:

```
read_notes  (what list_user_notes returns): ['oldest', 'middle', 'newest']
render_for_prompt (what the prompt shows):  [2] newest / [1] middle / [0] oldest
```

The docstring at `src/local_fitness/notes.py:99-100` claims "newest-first ordering matching the
on-disk order". Precisely: **"newest-first" is wrong; "matching the on-disk order" is correct** —
`read_notes` preserves file order and returns oldest-first. What round 2 got wrong is the *reason*:
it is not that "the file is append-only", because `update_note` writes in place and refreshes the
timestamp (Reproduction 6), so file order is not a recency order at all. `docs/mcp/list_user_notes.md:68-74`
flags the docstring as wrong but repeats that same false justification.

Also confirmed: a hand-edited non-bullet line consumes an index without producing a note
(heading + blank line ⇒ first note is `line=2`), and both write paths correctly *refuse* a
non-bullet index — that guard works.

### Lower-severity items — both reproduce exactly as written

`list_observations` (`src/local_fitness/agent/tools.py:2793-2795`) appends `obs_type = ?` with the
raw argument; `log_observation` validates against `OBS_TYPES` and returns the allowed list
(`:2709-2711`). The column is plain `TEXT` with no `COLLATE NOCASE` (`src/local_fitness/db.py:188`),
so SQLite's `=` is case-sensitive:

```
obs_type "rpe"  -> count 1
obs_type "RPE"  -> {"observations": [], "count": 0}
obs_type "rpee" -> {"observations": [], "count": 0}
```

Indistinguishable from "nothing logged", exactly as reported.

`delete_observation` (`src/local_fitness/agent/tools.py:2830`) does `int(args["observation_id"])`
before any validation branch. Two escapes, not one:

```
{}                          -> KeyError: 'observation_id'
{"observation_id": "abc"}   -> ValueError: invalid literal for int() with base 10: 'abc'
```

Neighbouring tools return the `_err` shape for both cases (`delete_coach_memory` at
`src/local_fitness/agent/tools.py:2172-2178` is the model to copy).

### Baseline

Full suite run (`.venv/bin/python -m pytest -q`, coverage gate on): **2 failed, 2644 passed, 6
skipped in 34.55s**, total coverage 95.05% (gate 85%). The two failures are
`tests/test_tools.py::test_fetch_metric_series_window_ends_on_the_given_date` and
`::test_fetch_metric_series_window_starts_days_before_end`. Both are **pre-existing and
time-dependent, unrelated to this issue**: they pin a hard-coded `end="2026-07-10"` against the
`seeded` fixture (`tests/test_tools.py:66-81`), which seeds the 40 days ending on `date.today()` —
so once today is more than 40 days past 2026-07-10 the window matches no rows and `assert dates`
fails. They touch neither `notes.py` nor the observation tools. The tree was clean before and after
the run (`git status --short` empty).

Neither bug in this issue has a failing test. `tests/test_notes.py` (19 tests) and
`tests/test_tools.py -k "user_note or observation"` (22 tests) are green.

`tests/test_docs_drift.py` pins page-per-tool, availability lines, README counts and intra-doc links
— it does **not** check parameter names or tables, so a `line` → new-handle rename will not be
caught by a test. These `docs/mcp/` pages must be edited by hand in the same change:

- `docs/mcp/update_user_note.md:75-79` (the stale-index gotcha) and `:84-87` (the "never rotates"
  gotcha) — both read as accurate today and both change under the fix.
- `docs/mcp/delete_user_note.md:25` (the `line` parameter row) and `:57-59` ("Every later index
  shifts down by one").
- `docs/mcp/list_user_notes.md:68-74` — the ordering gotcha. It flags the docstring correctly but
  justifies it with "the file is append-only, so the *last* entry is the newest", which
  Reproduction 6 falsifies; it needs rewriting even if list order does not change.
- `docs/mcp/daily_snapshot.md:39` — `user_notes` is documented as "a list of strings" with no
  ordering stated at all; it is the third model-facing order and must say which one it uses.
- `docs/mcp/list_observations.md:25` and `:74-76` (the unvalidated/case-sensitive `obs_type` notes).
- `docs/mcp/save_user_note.md` gains a rotation-safety note it does not have today.

## Does the issue ask for the right fix?

**Broadly yes — option 1 (a content handle) is the right shape — but it is not sufficient on its
own, and there are five corrections.**

1. **Option 1 is a guard, not an identity.** The issue's headline asks for "a stable identity that
   survives deletion and rotation"; a content hash does not survive an *update* (the text changes,
   so the handle changes) and does not let you re-find a rotated note. What it actually delivers is
   a **compare-and-swap**: the write verifies the target still holds what the caller read, and
   refuses loudly otherwise. That is the property that matters here, and it is worth naming
   correctly so the implementation is built against it. If literal stable identity is the
   requirement, option 2 (`<!-- id:N -->`) is the only option that provides it — but nothing in the
   reported failure needs it.
2. **The fix must reach `render_for_prompt`, not just `list_user_notes`.** The staleness is not a
   caching artefact — the server re-resolves the notes block on every request (see the surface
   section). It is that any render, however fresh, is a snapshot: `prompts.py:211-221` tells the
   model to write using the `[N]` values it was shown, and the model's own next delete, or another
   session's rotating append, invalidates them after the render. So `render_for_prompt` must emit
   the same handle the write tools accept, and the bare `line` parameter must stop being the only
   thing checked — otherwise that path stays silently wrong while the issue reads as closed.
3. **A handle does not close the whole bug.** Reproduction 4 destroys a preference through
   `save_user_note`, which takes no handle and cannot be given a useful one (it is creating a note,
   not addressing one). The line-framing invariant has to be repaired independently:
   `_rotate_to_fit` must join on a line boundary (`src/local_fitness/notes.py:193`), and
   `_append_archive` must do the same for the file it appends *to* (`:202-205`). Both are one-line
   fixes; both need a regression test built from a fixture *without* a trailing newline, which no
   test in the file currently constructs. This is the cheapest high-value item in the whole issue.
4. **Fold in the rotation gap and the read lock.** `update_note` bypassing `_rotate_to_fit` is a
   separate defect in the same function and cheap to fix alongside; leaving it means the prompt
   budget is enforced on append only, so both write paths should size-check after the rewrite. And
   the unlocked `read_notes` (Reproduction 5) is a one-line shared-`flock` fix — or, better,
   write-to-temp + `os.replace`, which makes every writer atomic and removes the empty-file window
   for all readers at once.
5. **Recency must come from the timestamp, not from file position.** This is the correction the
   issue's ordering bullet does not go far enough on, and it is a prerequisite for the ordering
   decision rather than a consequence of it. `update_note` refreshes the timestamp in place
   (Reproduction 6), so file order stops being a recency order after the *first* refinement — and
   `_rotate_to_fit` then evicts the freshest note first (Reproduction 7). Concretely:
   - `render_for_prompt` must rank by `Note.timestamp` (descending), not by `reversed(file order)`,
     and should emit the date alongside each note so the model can apply the conflict rule itself
     rather than trusting an ordering it cannot verify.
   - `list_user_notes` and `daily_snapshot`'s `user_notes` must use that same ranking, so all three
     model-facing surfaces agree. `list_user_notes` already returns `timestamp`; `daily_snapshot`
     returns bare strings (`src/local_fitness/agent/status.py:443`) and should either carry the
     timestamp or state its order in `docs/mcp/daily_snapshot.md:39`.
   - `_rotate_to_fit` must evict the oldest by timestamp, not by position — otherwise the 4 KB cap
     keeps silently deleting the preference the user most recently confirmed.
   - Only then fix the `read_notes` docstring (`src/local_fitness/notes.py:99-100`), to say what is
     true: on-disk order, which is *arrival* order and not recency order.

   The cheaper alternative — have `update_note` delete-and-re-append so position tracks recency
   again — restores the invariant with less code, but it renumbers every later index on every
   update, which makes the primary bug strictly worse until handles land. If it is taken, it must
   land *after* the handle change, never before.

   Once handles replace indices, changing list order is free — which is the reason to sequence the
   ordering change after the handle change either way.

One thing worth checking before committing to a hash: the model has to transcribe the handle
verbatim. Short is better than cryptographically strong here; 6–8 lowercase hex over
`timestamp + "\n" + text` is enough, since the only adversary is a stale value. Duplicate texts
saved in the same second would collide — the write should refuse an ambiguous handle rather than
pick one.

## Unknowns

- **How often a real MCP client re-initializes, and therefore how fresh the model's `[N]` list is.**
  Server-side is settled and measured: stateless mode re-resolves per request and the memo
  invalidates on the notes file's mtime/size, so the server never serves a stale block. But the SDK
  sends `instructions` only inside an `InitializeResult`
  (`.venv/…/mcp/server/session.py:176-197`), so what the model holds mid-conversation is whatever
  its client last initialized with. I did not observe a real client (Claude Code, claude.ai
  connector) to see whether it re-initializes per turn, per reconnect, or once per session — that
  is client behaviour, not repo behaviour, and nothing in this repo records it. The fix does not
  depend on the answer (correction 2 above rests on post-render writes, not on caching), but the
  *severity* of the prompt path does.
- **Which entry point real runs actually take.** The prompt both points at the notes section
  ("the notes section above is the authoritative list", `src/local_fitness/agent/prompts.py:213`)
  and tells the model to re-read (`:219-220`). I have no measurement of model behaviour, so I cannot
  rank the two paths by likelihood — only assert that both are open. The round-1 artifact stated a
  ranking here as a finding; it was a guess and is withdrawn.
- **How often a real notes file lacks a trailing newline.** The weld (Reproduction 4) needs it, and
  it can only arrive via a hand-edit or an external tool. Nothing in the repo creates the shape and
  I did not read the user's real file, so I cannot say whether the condition is currently met on any
  live install — only that the code invites it and does not defend against it.
- **How `create_sdk_mcp_server` surfaces an uncaught handler exception.** I confirmed
  `delete_observation` raises `KeyError`/`ValueError` out of the handler, but not whether the SDK
  converts that to an `is_error` content block or a protocol-level error the model sees differently
  from `_err`. It is wrong either way; I cannot say how it *looks* to the caller.
- **Whether this has actually corrupted the live `data/user_notes.md`.** The file is gitignored and
  I did not read the user's real notes (and read-only inspection could not prove a past mis-write
  anyway — there is no audit trail; `update`/`delete` archive nothing, and the weld archives
  nothing either). Unknowable from the repo.
- **Whether any real client has ever hit it.** No logging distinguishes a correct write from a
  wrong one (`src/local_fitness/notes.py:173` logs only "Saved user note (N chars)"), so there is
  no signal to count.
- **How the model behaves when handed a handle instead of an int.** Whether it reliably echoes an
  opaque token is an empirical question about the actual model in use; I have no measurement, and
  the choice between a hash and a small integer id partly rests on it.
- **Whether the empty-file read window (Reproduction 5) is reachable in production.** I measured it
  in-process with two threads on one file. Real concurrency here is two MCP sessions or a brief run
  overlapping a chat write; whether that overlap actually occurs at deployed rates is unmeasured. The
  22% figure is a property of my loop, not a production rate.
- **Whether hand-edited timestamps are trustworthy enough to sort on.** Correction 5 makes
  `Note.timestamp` load-bearing, but `_parse_line` accepts an undated bullet
  (`src/local_fitness/notes.py:94-95`, `timestamp=""`) and never validates the ISO string, so a
  hand-edited or malformed file would sort empties first under a naive key. I did not design or test
  the tie-break; the implementer must, and it should probably fall back to file position.
- **The rotation-key edge in `_notes_stat`.** It keys on `(st_mtime_ns, st_size)`. Whether a rewrite
  that lands in the same `mtime_ns` with an identical size can alias the persona cache is a
  theoretical hole I did not attempt to construct; `st_mtime_ns` makes it very unlikely, and it is
  not part of this bug.
- **Non-MCP writers.** Nothing outside `notes.py` writes the file in-repo, but the module docstring
  advertises it as hand-editable, so a user's editor is a writer the code cannot see. No fix can
  make an index survive that; a content guard can at least refuse, and the line-framing fix makes
  the hand-edited shape safe rather than destructive.

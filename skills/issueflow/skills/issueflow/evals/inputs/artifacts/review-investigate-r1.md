# Review — Investigate (round 3), issue #132

Every `path:line` the artifact cites was opened and checked against the code, and all seven
reproductions were rebuilt and re-run against the project's own `.venv`. R1, R3, R4, R4b, R5, R6
and R7 all reproduce, including the exact byte counts the artifact prints (4962; 4710/4709 with
35/34 surviving notes; the archive weld string; 22.4% empty reads). The baseline matches exactly:
2 failed, 2644 passed, 6 skipped, 95.05% coverage, with the two failures being the pre-existing
time-dependent `_fetch_metric_series` tests pinned to `end="2026-07-10"` against a fixture that
seeds the 40 days ending today. The surface inventory is complete — `notes` is imported by exactly
five modules repo-wide and all eight `[N]`-bearing call sites resolve as listed. The
"does the issue ask for the right fix" question is answered, not restated.

## Findings

- [medium] src/local_fitness/notes.py:210-245 — Reproduction 3 under-states the `update_note` rotation gap by ~30x: 146 tiny notes appended entirely within the cap, then each updated to the 800-char maximum, leaves a 120,742-byte live file (29.5x `LIVE_FILE_MAX_BYTES`, ~118 KB injected into every system prompt) through ordinary documented tool calls with no hand-edit and no concurrency, so correction 4's "cheap to fix alongside" ranking mis-prices the one defect here that needs no exotic precondition.
- [low] src/local_fitness/notes.py:197-207 — `_append_archive` swallows `OSError` while `append_note` truncates the live file regardless, so a read-only archive silently destroys the rotated preference (measured: 48 notes in, `preference 000` gone, archive empty, `save_user_note` returns success), which falsifies the artifact's unconditional "It is recoverable (the archive has it)" in Reproduction 7.
- [low] src/local_fitness/agent/tools.py:2073-2075 — `isinstance(line, int)` accepts a JSON boolean, so `delete_user_note(line=true)` deletes note 1 and reports `{"deleted": true, "line": true}`; the artifact's enumeration of the write-path guards misses it even though `docs/mcp/delete_user_note.md:25` promises "Must be an `int`" and `docs/mcp/list_observations.md:24` shows the repo already rejects bool for `days`.
- [low] src/local_fitness/notes.py:192 — the root-cause section asserts without condition that rotation "archives the *freshest* note first", but eviction is by position: a 41-note file whose refreshed note is not at line 0 evicts an ordinary note and keeps the freshest one, so the claim holds only in Reproduction 7's engineered layout.
- [low] src/local_fitness/web/mcp_server.py:315 — the surface section's "Sites 1–3 and 6 go through `prompts.system_prompt`" is wrong for site 3, `_brief_prompt`, which calls only `brief_v2_system_prompt`; the same sentence then correctly lists 3 under `brief_v2_system_prompt`, so the mapping contradicts itself.
- [low] tests/test_status.py:82 — "`assemble_status` has exactly two callers repo-wide" is false: two *production* callers, plus ~28 in `tests/test_status.py` alone; the conclusion it supports (only `daily_snapshot` carries notes to a model) survives, so the cost is precision only.

## Not examined

- The artifact's three end-to-end `/mcp` `TestClient` transcripts were not re-driven. I verified their mechanism instead — `mcp/server/streamable_http_manager.py:168-215` calls `create_initialization_options()` per request in stateless mode, `mcp/server/session.py:176-197` is the only place the SDK emits `instructions`, and `session.py:94-98` starts a stateless session already `Initialized` — and the transcripts' claims follow from that code.
- Reproduction 2's exact fixture (17 live bullets, target line 5) was not rebuilt; rotation renumbering is independently proven by Reproduction 4, which I did rebuild.
- Reproduction 5's 22% figure was reproduced (22.4% on my machine) but, as the artifact says, that is a property of the loop; I did not attempt to establish a production rate either.
- I did not read the user's real `data/user_notes.md` (gitignored), so nothing here says whether the live file is already corrupted, nor did I try to construct the `_notes_stat` mtime/size aliasing edge.
- Model- and client-side behaviour — whether a real MCP client re-initializes per turn, and whether a model transcribes an opaque handle reliably — is untested here, as it is in the artifact.
- Docs: only the seven `docs/mcp/` pages the artifact names were opened. `docs/plans/`, the web UI and the CLI were not read (the CLI and web server import `notes` nowhere, which I did check).
- I did not assess the security posture of the proposed fixes beyond their correctness, and I did not review the `_READ_ONLY_TOOL_NAMES` claim the docs make about the brief loop.

## Verdict

pass

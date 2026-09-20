# Accuracy review — revision 2

Reviewed against the checked-out skill contracts, selected code surfaces, package test
runners, the hub guard, legacy adapter implementation and installed Basic Memory 0.23.2
source. This is a source-level design review, not implemented-adapter test evidence.
Recommendations remain four priority candidates, seven optional integrations and eleven
deferred skills. Priority means worth designing first, not ready to activate.

## Corrections made

1. **Crash recovery:** the prior design wrote the source before recording a pending event.
   Corrected to prepare a durable event first, then save/verify source and mirror. This
   matches the legacy adapter's ordering and closes an untracked-source-change window.
2. **Context limits:** native read_note returns full notes. Distinguished selected-context
   budgets from response limits; hard limits require a server-side projection, not prose.
3. **Real tool surface:** the guard rejects fitness writes; it does not proxy them. It allows
   four tools and has no generic edit/delete capability. Added exact native mappings and
   explicit maintenance/owner-tool implementation gates.
4. **Devlog ownership:** custom voicePath takes precedence over Ghostwriter and fallback.
   Sharing must bind the actual selected owner, and exclude LinkedIn algorithm tuning.
   Devlog reads shared voice keys but may own its separate presentation preferences.
5. **Duplicate source writes:** both writing skills already append corrections before
   redrafting. The bridge must replace that append for opted-in keys, not duplicate it.
6. **Existing versus new vocabulary:** writing.hashtags exists in the legacy adapter;
   X and Devlog identities do not. Neither implies an existing Obsidian implementation.
7. **Failure behavior:** optional recall failure is distinct from owner source-save failure.
   Only the latter must stop the dependent redraft; saved source plus failed mirror is pending.
8. **Forgetting and restore:** the current generic MCP cannot delete. Added a maintenance
   gate and clarified that rolling back both notes and tombstones can resurrect records.
9. **Source evidence and test wiring:** removed fenced example headings from landmarks,
   recorded implementation surface hashes, specified runner-compatible test locations and
   documented Résumé's standalone process runner. Added source-specific flow constraints.
10. **Public/private boundaries:** public key schemas are separate from private bindings.
    Recovery payloads are private outbox state, not diagnostic logs. Added bounded field
    policies and clarified that private style may influence an artifact without publishing
    the underlying note or imposing a new approval gate where authorization already exists.

## Implementation blockers that remain explicit

- Choose shared-profile-safe data or separately enforced restricted storage before moving
  narrowly shared writing records. Metadata filters cannot preserve that privacy boundary.
- Implement and exercise deterministic transport validation/projection before claiming
  enforced context bounds; existing prose/native calls provide workflow guidance only.
- Provide an owner-operated forget/repair path and test derived index cleanup before real
  advisory capture. Define suppression behavior for backups/restores.
- Prove synthetic source-write/crash/retry/concurrency/forget cases and both host workflows;
  a checked design is not proof those future adapters work.

## Evidence and limits

The catalog records exact SKILL.md and selected implementation file hashes at the inspected
claude-skills commit. Core hub references: adapters/client.mjs (prepared event before source
replacement, vocabulary and recall), scripts/guarded_mcp.py (allowlist and write rejection),
pyproject.toml (engine version). Native API signatures were checked in the installed package's
mcp/tools/search.py, read_note.py and write_note.py without reading personal notes.
All 22 specs were reviewed for ownership and failure-policy consistency; this was not an
exhaustive audit of every underlying implementation or historical repository content.

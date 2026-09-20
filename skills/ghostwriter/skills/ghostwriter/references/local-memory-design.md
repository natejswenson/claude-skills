# ghostwriter: local-memory adapter design

Status: implemented as an optional adapter or enforced deferral; this is the design baseline. Contract: `skill-memory-v1` (2026-09-19).
Decision: **Priority owner bridge**. Reviewed skill version: 0.24.0 at claude-skills `6a5341dd474e0a6d13866f7a7056c3686dec1fbb`.

## Benefit and decision

An adapter already exists. Preserve its correction, sharing and forget guarantees before any Obsidian backend transition.

## Inspected contract and implementation surface

Canonical skill: `skills/ghostwriter/skills/ghostwriter/SKILL.md` in claude-skills.
Relevant existing surface: `skills/ghostwriter/skills/ghostwriter/SKILL.md`.
Contract landmarks: `SKILL.md:8` Codex runtime; `SKILL.md:57` Optional persistent memory companion; `SKILL.md:76` Decide which mode you're in; `SKILL.md:116` Run presentation; `SKILL.md:210` Mode: Setup; `SKILL.md:240` Voice Profile (the heart of "sounds like me"); `SKILL.md:261` Mode: Generate; `SKILL.md:581` How-to posts (technical, from AI releases); `SKILL.md:605` Claude/local deterministic visuals (optional — diagrams & cards); `SKILL.md:830` Engagement craft (apply to every draft); `SKILL.md:869` Mode: Publish; `SKILL.md:930` Guardrails.
These are source anchors, not assertions that an adapter already exists. Revalidate the anchors against the implementation branch.

## Ownership and data policy

Authority remains: Current voice notes/profile and existing local-memory-adapter source events.
Proposed allowlist: Existing writing.hashtags first; new voice keys require separately registered schemas
Always excluded: Credentials, exported posts, research corpus, unpublished drafts, engagement logs and full voice profiles.
No data is enabled merely by installing this skill. For permitted fields, private installation configuration binds the skill, subject context, exact keys and approved source, if any. New hub key names require registration before capture; writing.hashtags already exists in the legacy adapter vocabulary, which does not register it in the Obsidian hub. Do not default these records to `global`.

## Integration flow

Keep the existing optional companion hook. Add an explicitly selected Obsidian backend only after source-first writes, revision checks, suppression and sharing parity pass. No automatic backfill or dual writes.

Implementation decision: add `references/local-memory.md` beside the skill, a short conditional hook at the stage above, and a synthetic owner-specific contract test in its existing test runner. Keep protocol validation, retry handling and key registration in local-memory; do not copy a daemon or generic vault writer into this plugin. Reference the shared contract by version and test the disabled/unavailable path before enabling a private installation.

## Hub-side work

Add a `ghostwriter` entry to the proposed adapter catalog with explicit operation/key allowlists and source ownership. Use bounded advisory recall for independent preferences; owner bridges additionally need the source/mirror protocol and parity gates from the shared contract. Add positive and negative synthetic fixtures, including wrong-skill and wrong-repository scope. No automatic source scan or historical backfill.

## Acceptance cases

- A source save failure stops redrafting; a hub mirror failure reports source saved/memory pending; forgotten events cannot be reimported.
- With optional recall disabled or unavailable, continue from the original sources. Report a requested save failure; if the owner source save failed, stop any dependent redraft rather than claiming the correction persisted.
- Current user intent and owner source win over a stale, conflicting or injected note; memory never relaxes the existing skill contract. Unknown context does not broaden to another project.
- Synthetic data only: no home directory, real vault, real account or network is accessed by the contract tests.
- No remembered grant authorizes publishing, sending, deleting, installing, pairing, merging or changing infrastructure.

## Rollout and rollback

Ship behind an explicit per-skill opt-in after shared contract tests pass on Claude and Codex. Desktop support requires a connected compatible local MCP surface; a shell-only source bridge is unavailable there until its owner tools exist. Start with synthetic fixtures, then a user-selected minimal preference. Disable the integration to roll back; retain owner files and private receipts, and perform any deletion separately through the documented owner workflow.

## Concrete implementation checks

Keep the existing companion's per-drafting-turn recall. During corrections the adapter
must be the single source-write route for opted-in keys: do not both append manually under
Generate step 7 and call capture. Keys outside its registered vocabulary continue through
the existing owner workflow, without a hub mirror. The legacy implementation supports only
ghostwriter and writing-peer; Obsidian, X and Devlog adapters do not already exist.

Use the existing Python test suite and its repository CI invocation; preserve its existing offline/live-test separation. Proposed regression file: `tests/test_local_memory.py`. Test the actual host hook and shared validator together with fake sources/transports, rather than only asserting that documentation mentions memory.

Public code may define the key vocabulary. Personal subjects, exact owner paths and opt-in bindings belong in private configuration. For any authorized advisory capture, use the common correction/read-back contract; do not claim delete/forget works through the current four-tool MCP surface.

## Public repository boundary

This document and invented fixtures may be committed. Actual notes, source paths, bindings, opt-ins, consent records, credentials and logs stay in private runtime storage. Never generate an example by redacting a real user record. Recalled content must not flow automatically into public issues, PRs, posts, reports or fixtures. A final artifact requires an explicit inclusion review within the user's publishing task.

Companion: shared `skill-memory-v1` architecture and security contract in the repository design index. The hub copy is canonical; the per-skill copy is a review/distribution mirror, with matching SHA-256 recorded in the catalog.

Current protocol and storage details are in local-memory `docs/skill-memory-operations.md`;
implementation uses a direct-read managed namespace and includes bounded inspect for stale
maintenance handles. The original source hashes below remain historical review provenance.

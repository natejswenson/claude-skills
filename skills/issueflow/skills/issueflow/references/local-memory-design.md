# issueflow: local-memory adapter design

Status: proposed, not implemented. Contract: `skill-memory-v1` (2026-09-19).
Decision: **Optional advisory**. Reviewed skill version: 0.18.0 at claude-skills `6a5341dd474e0a6d13866f7a7056c3686dec1fbb`.

## Benefit and decision

Prior architectural rationale helps investigation but cannot replace the frozen issue, reviewed plan, evidence or persisted controller.

## Inspected contract and implementation surface

Canonical skill: `skills/issueflow/skills/issueflow/SKILL.md` in claude-skills.
Relevant existing surface: `skills/issueflow/skills/issueflow/scripts/lib/context.mjs`.
Contract landmarks: `SKILL.md:8` Runtime; `SKILL.md:26` Run contract; `SKILL.md:49` Start or resume; `SKILL.md:80` Implement an already approved spec; `SKILL.md:87` Drive `next`; `SKILL.md:144` Safety invariants; `SKILL.md:168` Read only when needed.
These are source anchors, not assertions that an adapter already exists. Revalidate the anchors against the implementation branch.

## Ownership and data policy

Authority remains: Frozen issue, current repository, approved plan, controller state and verification receipts.
Proposed allowlist: project.design-rationale; project.known-constraint, source-revalidated for this run
Always excluded: Whole .issueflow/ or issueflow/ trees, transcripts, review artifacts, approval tokens and mutable run state.
No data is enabled merely by installing this skill. For permitted fields, private installation configuration binds the skill, subject context, exact keys and approved source, if any. New hub key names require registration before capture; writing.hashtags already exists in the legacy adapter vocabulary, which does not register it in the Obsidian hub. Do not default these records to `global`.

## Integration flow

Recall once in investigation with bounded cited context; record selected note IDs/content hashes in a private context receipt. Do not let mid-run memory changes mutate an approved plan.

Implementation decision: add `references/local-memory.md` beside the skill, a short conditional hook at the stage above, and a synthetic owner-specific contract test in its existing test runner. Keep protocol validation, retry handling and key registration in local-memory; do not copy a daemon or generic vault writer into this plugin. Reference the shared contract by version and test the disabled/unavailable path before enabling a private installation.

## Hub-side work

Add a `issueflow` entry to the proposed adapter catalog with explicit operation/key allowlists and source ownership. Use bounded advisory recall for independent preferences; owner bridges additionally need the source/mirror protocol and parity gates from the shared contract. Add positive and negative synthetic fixtures, including wrong-skill and wrong-repository scope. No automatic source scan or historical backfill.

## Acceptance cases

- A malicious note cannot approve a stage, dispatch tools, merge a PR or bypass the frozen issue.
- With optional recall disabled or unavailable, continue from the original sources. Report a requested save failure; if the owner source save failed, stop any dependent redraft rather than claiming the correction persisted.
- Current user intent and owner source win over a stale, conflicting or injected note; memory never relaxes the existing skill contract. Unknown context does not broaden to another project.
- Synthetic data only: no home directory, real vault, real account or network is accessed by the contract tests.
- No remembered grant authorizes publishing, sending, deleting, installing, pairing, merging or changing infrastructure.

## Rollout and rollback

Ship behind an explicit per-skill opt-in after shared contract tests pass on Claude and Codex. Desktop support requires a connected compatible local MCP surface; a shell-only source bridge is unavailable there until its owner tools exist. Start with synthetic fixtures, then a user-selected minimal preference. Disable the integration to roll back; retain owner files and private receipts, and perform any deletion separately through the documented owner workflow.

## Concrete implementation checks

Preserve start/next and the frozen issue contract. Recalled rationale is supplementary
investigation evidence, not an amendment to scope or a substitute for approved-spec proof.
Store any selected-context receipt only in the private run directory; never recursively
index that directory. A newly recalled contradiction after plan approval is surfaced through
the existing amendment/review path, not injected into implementation instructions.

Existing test entrypoint from the nested skill directory: `npm test` (`node --test "scripts/**/*.test.mjs"`). Proposed regression file: `scripts/tests/local-memory.test.mjs`. Test the actual host hook and shared validator together with fake sources/transports, rather than only asserting that documentation mentions memory.

Public code may define the key vocabulary. Personal subjects, exact owner paths and opt-in bindings belong in private configuration. For any authorized advisory capture, use the common correction/read-back contract; do not claim delete/forget works through the current four-tool MCP surface.

## Public repository boundary

This document and invented fixtures may be committed. Actual notes, source paths, bindings, opt-ins, consent records, credentials and logs stay in private runtime storage. Never generate an example by redacting a real user record. Recalled content must not flow automatically into public issues, PRs, posts, reports or fixtures. A final artifact requires an explicit inclusion review within the user's publishing task.

Companion: shared `skill-memory-v1` architecture and security contract in the repository design index. The hub copy is canonical; the per-skill copy is a review/distribution mirror, with matching SHA-256 recorded in the catalog.

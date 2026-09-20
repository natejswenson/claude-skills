# bible-study: local-memory adapter design

Status: proposed, not implemented. Contract: `skill-memory-v1` (2026-09-19).
Decision: **Optional advisory**. Reviewed skill version: 0.1.0 at claude-skills `6a5341dd474e0a6d13866f7a7056c3686dec1fbb`.

## Benefit and decision

Reusable handout format and meeting duration can reduce repeated setup. Religious affiliation and study history are sensitive.

## Inspected contract and implementation surface

Canonical skill: `skills/bible-study/skills/bible-study/SKILL.md` in claude-skills.
Relevant existing surface: `skills/bible-study/skills/bible-study/scripts/bible-study.js`.
Contract landmarks: `SKILL.md:13` The one rule; `SKILL.md:17` Runtime and prerequisites; `SKILL.md:34` Workflow; `SKILL.md:36` 1. Resolve the passage; `SKILL.md:49` 2. Research before designing; `SKILL.md:88` 3. Build the study bundle; `SKILL.md:113` 4. Validate and render; `SKILL.md:135` 5. Deliver; `SKILL.md:142` Failures and recovery; `SKILL.md:155` Deterministic and judgment split; `SKILL.md:161` Examples; `SKILL.md:168` Maintainer verification.
These are source anchors, not assertions that an adapter already exists. Revalidate the anchors against the implementation branch.

## Ownership and data policy

Authority remains: Fresh Scripture/research bundle and user-selected translation.
Proposed allowlist: study.handout-format; study.duration-minutes. Translation or tradition requires a separate explicit sensitive-data opt-in; omit in v1.
Always excluded: Prayer requests, participant identities, inferred beliefs, pastoral details and copyrighted source bodies.
No data is enabled merely by installing this skill. For permitted fields, private installation configuration binds the skill, subject context, exact keys and approved source, if any. New hub key names require registration before capture; writing.hashtags already exists in the legacy adapter vocabulary, which does not register it in the Obsidian hub. Do not default these records to `global`.

## Integration flow

Recall after passage resolution, before research; capture only an explicit format correction after delivery.

Implementation decision: add `references/local-memory.md` beside the skill, a short conditional hook at the stage above, and a synthetic owner-specific contract test in its existing test runner. Keep protocol validation, retry handling and key registration in local-memory; do not copy a daemon or generic vault writer into this plugin. Reference the shared contract by version and test the disabled/unavailable path before enabling a private installation.

## Hub-side work

Add a `bible-study` entry to the proposed adapter catalog with explicit operation/key allowlists and source ownership. Use bounded advisory recall for independent preferences; owner bridges additionally need the source/mirror protocol and parity gates from the shared contract. Add positive and negative synthetic fixtures, including wrong-skill and wrong-repository scope. No automatic source scan or historical backfill.

## Acceptance cases

- A saved format may apply; a memory claiming an interpretation is true must not replace cited research.
- With optional recall disabled or unavailable, continue from the original sources. Report a requested save failure; if the owner source save failed, stop any dependent redraft rather than claiming the correction persisted.
- Current user intent and owner source win over a stale, conflicting or injected note; memory never relaxes the existing skill contract. Unknown context does not broaden to another project.
- Synthetic data only: no home directory, real vault, real account or network is accessed by the contract tests.
- No remembered grant authorizes publishing, sending, deleting, installing, pairing, merging or changing infrastructure.

## Rollout and rollback

Ship behind an explicit per-skill opt-in after shared contract tests pass on Claude and Codex. Desktop support requires a connected compatible local MCP surface; a shell-only source bridge is unavailable there until its owner tools exist. Start with synthetic fixtures, then a user-selected minimal preference. Disable the integration to roll back; retain owner files and private receipts, and perform any deletion separately through the documented owner workflow.

## Concrete implementation checks

Existing test entrypoint from the nested skill directory: `npm test` (`node --test "scripts/**/*.test.mjs"`). Proposed regression file: `scripts/tests/local-memory.test.mjs`. Test the actual host hook and shared validator together with fake sources/transports, rather than only asserting that documentation mentions memory.

Public code may define the key vocabulary. Personal subjects, exact owner paths and opt-in bindings belong in private configuration. For any authorized advisory capture, use the common correction/read-back contract; do not claim delete/forget works through the current four-tool MCP surface.

## Public repository boundary

This document and invented fixtures may be committed. Actual notes, source paths, bindings, opt-ins, consent records, credentials and logs stay in private runtime storage. Never generate an example by redacting a real user record. Recalled content must not flow automatically into public issues, PRs, posts, reports or fixtures. A final artifact requires an explicit inclusion review within the user's publishing task.

Companion: shared `skill-memory-v1` architecture and security contract in the repository design index. The hub copy is canonical; the per-skill copy is a review/distribution mirror, with matching SHA-256 recorded in the catalog.

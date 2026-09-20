# devlog: local-memory adapter design

Status: implemented as an optional adapter or enforced deferral; this is the design baseline. Contract: `skill-memory-v1` (2026-09-19).
Decision: **Priority reader**. Reviewed skill version: 0.14.2 at claude-skills `6a5341dd474e0a6d13866f7a7056c3686dec1fbb`.

## Benefit and decision

Shares writing preferences with Ghostwriter and benefits from explicit audience context across projects.

## Inspected contract and implementation surface

Canonical skill: `skills/devlog/skills/devlog/SKILL.md` in claude-skills.
Relevant existing surface: `skills/devlog/skills/devlog/lib/config_ops.mjs`.
Contract landmarks: `SKILL.md:8` Codex runtime; `SKILL.md:45` Decide which mode you're in; `SKILL.md:94` Configure mode; `SKILL.md:150` Producer and website onboarding; `SKILL.md:158` Inspect and preserve the producer registration; `SKILL.md:203` Register the website and its manifest together; `SKILL.md:232` Verify both halves; `SKILL.md:250` Status mode; `SKILL.md:259` Generate mode; `SKILL.md:261` Step 1: Scan for new releases; `SKILL.md:286` Step 2: Resolve the voice profile; `SKILL.md:304` Step 3: Research and write each post; `SKILL.md:472` Step 4: Self-check before publishing; `SKILL.md:506` Step 5: Publish.
These are source anchors, not assertions that an adapter already exists. Revalidate the anchors against the implementation branch.

## Ownership and data policy

Authority remains: Validated devlog config, release scan, publication manifest and selected voice files.
Proposed allowlist: writing.hashtags via owner-approved sharing; devlog.audience and devlog.explanation-depth as independent preferences
Always excluded: Private repo commits, unpublished posts, tokens, configuration files and publication receipts.
No data is enabled merely by installing this skill. For permitted fields, private installation configuration binds the skill, subject context, exact keys and approved source, if any. New hub key names require registration before capture; writing.hashtags already exists in the legacy adapter vocabulary, which does not register it in the Obsidian hub. Do not default these records to `global`.

## Integration flow

Recall after validated config and voice resolution, before composition. Route voice corrections to their actual owner; do not create a second voice writer.

Implementation decision: add `references/local-memory.md` beside the skill, a short conditional hook at the stage above, and a synthetic owner-specific contract test in its existing test runner. Keep protocol validation, retry handling and key registration in local-memory; do not copy a daemon or generic vault writer into this plugin. Reference the shared contract by version and test the disabled/unavailable path before enabling a private installation.

## Hub-side work

Add a `devlog` entry to the proposed adapter catalog with explicit operation/key allowlists and source ownership. Use bounded advisory recall for independent preferences; owner bridges additionally need the source/mirror protocol and parity gates from the shared contract. Add positive and negative synthetic fixtures, including wrong-skill and wrong-repository scope. No automatic source scan or historical backfill.

## Acceptance cases

- Private releases stay excluded and memory cannot claim a post is published or change the configured destination.
- With optional recall disabled or unavailable, continue from the original sources. Report a requested save failure; if the owner source save failed, stop any dependent redraft rather than claiming the correction persisted.
- Current user intent and owner source win over a stale, conflicting or injected note; memory never relaxes the existing skill contract. Unknown context does not broaden to another project.
- Synthetic data only: no home directory, real vault, real account or network is accessed by the contract tests.
- No remembered grant authorizes publishing, sending, deleting, installing, pairing, merging or changing infrastructure.

## Rollout and rollback

Ship behind an explicit per-skill opt-in after shared contract tests pass on Claude and Codex. Desktop support requires a connected compatible local MCP surface; a shell-only source bridge is unavailable there until its owner tools exist. Start with synthetic fixtures, then a user-selected minimal preference. Disable the integration to roll back; retain owner files and private receipts, and perform any deletion separately through the documented owner workflow.

## Concrete implementation checks

Resolve voice ownership from the actual selected directory: config.voicePath first,
then the Ghostwriter voice directory, then Devlog's fallback. A custom path is not presumed
to be Ghostwriter-owned. Skip owner-memory recall unless the exact selected source is
registered and its current revision matches. Never import LinkedIn algorithm.md or its
platform tuning. This skill is a reader of shared voice keys, but can capture its own
explicit devlog.* presentation preferences. That does not authorize configuring voicePath.

Existing test entrypoint from the nested skill directory: `npm test` (`node --test "tests/**/*.test.mjs"`). Proposed regression file: `tests/local-memory.test.mjs`. Test the actual host hook and shared validator together with fake sources/transports, rather than only asserting that documentation mentions memory.

Public code may define the key vocabulary. Personal subjects, exact owner paths and opt-in bindings belong in private configuration. For any authorized advisory capture, use the common correction/read-back contract; do not claim delete/forget works through the current four-tool MCP surface.

## Public repository boundary

This document and invented fixtures may be committed. Actual notes, source paths, bindings, opt-ins, consent records, credentials and logs stay in private runtime storage. Never generate an example by redacting a real user record. Recalled content must not flow automatically into public issues, PRs, posts, reports or fixtures. A final artifact requires an explicit inclusion review within the user's publishing task.

Companion: shared `skill-memory-v1` architecture and security contract in the repository design index. The hub copy is canonical; the per-skill copy is a review/distribution mirror, with matching SHA-256 recorded in the catalog.

Current protocol and storage details are in local-memory `docs/skill-memory-operations.md`;
implementation uses a direct-read managed namespace and includes bounded inspect for stale
maintenance handles. The original source hashes below remain historical review provenance.

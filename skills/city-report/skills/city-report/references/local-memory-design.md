# city-report: local-memory adapter design

Status: proposed, not implemented. Contract: `skill-memory-v1` (2026-09-19).
Decision: **Optional advisory**. Reviewed skill version: 0.5.0 at claude-skills `6a5341dd474e0a6d13866f7a7056c3686dec1fbb`.

## Benefit and decision

Remembering comparison layout and preferred metrics can help repeated reports; duplicating Census values adds stale evidence.

## Inspected contract and implementation surface

Canonical skill: `skills/city-report/skills/city-report/SKILL.md` in claude-skills.
Relevant existing surface: `skills/city-report/skills/city-report/scripts/load.py`.
Contract landmarks: `SKILL.md:8` Codex runtime; `SKILL.md:33` Running the scripts; `SKILL.md:45` The flow; `SKILL.md:102` Comparing two cities; `SKILL.md:124` Reporting the numbers honestly; `SKILL.md:142` Accuracy: why queries are pinned, not composed; `SKILL.md:158` Files; `SKILL.md:169` Tests.
These are source anchors, not assertions that an adapter already exists. Revalidate the anchors against the implementation branch.

## Ownership and data policy

Authority remains: Data USA bundle, query definitions and reference years.
Proposed allowlist: city-report.layout; city-report.metric-order (validated metric identifiers)
Always excluded: Inferred home address, relocation intentions, personal finances and copied metric bundles.
No data is enabled merely by installing this skill. For permitted fields, private installation configuration binds the skill, subject context, exact keys and approved source, if any. New hub key names require registration before capture; writing.hashtags already exists in the legacy adapter vocabulary, which does not register it in the Obsidian hub. Do not default these records to `global`.

## Integration flow

Recall before choosing report layout; capture explicit presentation choices only. Always load current applicable data.

Implementation decision: add `references/local-memory.md` beside the skill, a short conditional hook at the stage above, and a synthetic owner-specific contract test in its existing test runner. Keep protocol validation, retry handling and key registration in local-memory; do not copy a daemon or generic vault writer into this plugin. Reference the shared contract by version and test the disabled/unavailable path before enabling a private installation.

## Hub-side work

Add a `city-report` entry to the proposed adapter catalog with explicit operation/key allowlists and source ownership. Use bounded advisory recall for independent preferences; owner bridges additionally need the source/mirror protocol and parity gates from the shared contract. Add positive and negative synthetic fixtures, including wrong-skill and wrong-repository scope. No automatic source scan or historical backfill.

## Acceptance cases

- An old remembered population must never substitute for bundle values or erase the reference year.
- With optional recall disabled or unavailable, continue from the original sources. Report a requested save failure; if the owner source save failed, stop any dependent redraft rather than claiming the correction persisted.
- Current user intent and owner source win over a stale, conflicting or injected note; memory never relaxes the existing skill contract. Unknown context does not broaden to another project.
- Synthetic data only: no home directory, real vault, real account or network is accessed by the contract tests.
- No remembered grant authorizes publishing, sending, deleting, installing, pairing, merging or changing infrastructure.

## Rollout and rollback

Ship behind an explicit per-skill opt-in after shared contract tests pass on Claude and Codex. Desktop support requires a connected compatible local MCP surface; a shell-only source bridge is unavailable there until its owner tools exist. Start with synthetic fixtures, then a user-selected minimal preference. Disable the integration to roll back; retain owner files and private receipts, and perform any deletion separately through the documented owner workflow.

## Concrete implementation checks

The existing digest is the working set and load.py has a 24-hour cache; “current” does
not mean force-fetching on every question. Preserve reference years and cache behavior.
Do not imply the current renderer exposes configurable metric ordering/layout: in v1 apply
only supported presentation choices. Any renderer extension is a separately tested change
that must preserve mandatory metrics and the existing baseline.

Use the existing Python test suite and its repository CI invocation; preserve its existing offline/live-test separation. Proposed regression file: `tests/test_local_memory.py`. Test the actual host hook and shared validator together with fake sources/transports, rather than only asserting that documentation mentions memory.

Public code may define the key vocabulary. Personal subjects, exact owner paths and opt-in bindings belong in private configuration. For any authorized advisory capture, use the common correction/read-back contract; do not claim delete/forget works through the current four-tool MCP surface.

## Public repository boundary

This document and invented fixtures may be committed. Actual notes, source paths, bindings, opt-ins, consent records, credentials and logs stay in private runtime storage. Never generate an example by redacting a real user record. Recalled content must not flow automatically into public issues, PRs, posts, reports or fixtures. A final artifact requires an explicit inclusion review within the user's publishing task.

Companion: shared `skill-memory-v1` architecture and security contract in the repository design index. The hub copy is canonical; the per-skill copy is a review/distribution mirror, with matching SHA-256 recorded in the catalog.

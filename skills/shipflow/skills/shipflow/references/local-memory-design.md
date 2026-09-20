# shipflow: local-memory adapter design

Status: implemented as an optional adapter or enforced deferral; this is the design baseline. Contract: `skill-memory-v1` (2026-09-19).
Decision: **Defer**. Reviewed skill version: 0.7.0 at claude-skills `6a5341dd474e0a6d13866f7a7056c3686dec1fbb`.

## Benefit and decision

Committed policy plus live detection already preserve intended infrastructure. Memory risks bypassing the plan/apply confirmation boundary.

## Inspected contract and implementation surface

Canonical skill: `skills/shipflow/skills/shipflow/SKILL.md` in claude-skills.
Relevant existing surface: `skills/shipflow/skills/shipflow/lib/plan.mjs`.
Contract landmarks: `SKILL.md:8` Codex runtime; `SKILL.md:46` Decide which mode you're in; `SKILL.md:55` First-run setup; `SKILL.md:138` Re-run / audit; `SKILL.md:142` GitHub Flow readiness, forks and migration; `SKILL.md:181` Check pending releases (`manual-gate` ask-flow); `SKILL.md:201` Cut a component release; `SKILL.md:305` Auto mode (not yet implemented); `SKILL.md:309` Error handling; `SKILL.md:329` Security rules; `SKILL.md:336` Edge cases.
These are source anchors, not assertions that an adapter already exists. Revalidate the anchors against the implementation branch.

## Ownership and data policy

Authority remains: Validated .github/shipflow.json, detection, state hashes and generated receipts.
Proposed allowlist: No v1 keys. Design rationale can be recorded explicitly outside apply inputs.
Always excluded: Credential values, approval claims and unvalidated branch/policy strings.
No data is enabled merely by installing this skill. For permitted fields, private installation configuration binds the skill, subject context, exact keys and approved source, if any. New hub key names require registration before capture; writing.hashtags already exists in the legacy adapter vocabulary, which does not register it in the Obsidian hub. Do not default these records to `global`.

## Integration flow

No memory input to detect/plan/apply. Existing config remains the durable specification.

Implementation decision: add no runtime dependency or memory calls in v1. This specification records the exclusion so a shared adapter rollout cannot silently opt this skill in. Reopen only with a demonstrated cross-client need, an explicit minimum field schema, and tests preserving the authority boundary.

## Hub-side work

Declare this skill disabled in the proposed integration catalog; reject attempts to import its owner store through bulk discovery. No storage schema or migration is needed.

## Acceptance cases

- Remembered branch standards cannot overwrite a repository’s selected workflow pattern or authorize an apply.
- With optional recall disabled or unavailable, continue from the original sources. Report a requested save failure; if the owner source save failed, stop any dependent redraft rather than claiming the correction persisted.
- Current user intent and owner source win over a stale, conflicting or injected note; memory never relaxes the existing skill contract. Unknown context does not broaden to another project.
- Synthetic data only: no home directory, real vault, real account or network is accessed by the contract tests.
- No remembered grant authorizes publishing, sending, deleting, installing, pairing, merging or changing infrastructure.

## Rollout and rollback

Remain disabled. Test the no-call invariant when a shared layer is introduced.

## Concrete implementation checks

Existing test entrypoint from the nested skill directory: `npm test` (`node --test "tests/**/*.test.mjs"`). Proposed regression file: `tests/local-memory.test.mjs`. No test or runtime hook needs to be added now; if common adapter plumbing later reaches this skill, assert zero memory calls and unchanged original behavior.

Public code may define the key vocabulary. Personal subjects, exact owner paths and opt-in bindings belong in private configuration. For any authorized advisory capture, use the common correction/read-back contract; do not claim delete/forget works through the current four-tool MCP surface.

## Public repository boundary

This document and invented fixtures may be committed. Actual notes, source paths, bindings, opt-ins, consent records, credentials and logs stay in private runtime storage. Never generate an example by redacting a real user record. Recalled content must not flow automatically into public issues, PRs, posts, reports or fixtures. A final artifact requires an explicit inclusion review within the user's publishing task.

Companion: shared `skill-memory-v1` architecture and security contract in the repository design index. The hub copy is canonical; the per-skill copy is a review/distribution mirror, with matching SHA-256 recorded in the catalog.

Current protocol and storage details are in local-memory `docs/skill-memory-operations.md`;
implementation uses a direct-read managed namespace and includes bounded inspect for stale
maintenance handles. The original source hashes below remain historical review provenance.

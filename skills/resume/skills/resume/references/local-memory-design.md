# resume: local-memory adapter design

Status: implemented as an optional adapter or enforced deferral; this is the design baseline. Contract: `skill-memory-v1` (2026-09-19).
Decision: **Optional advisory**. Reviewed skill version: 2.1.0 at claude-skills `6a5341dd474e0a6d13866f7a7056c3686dec1fbb`.

## Benefit and decision

Job-search presentation preferences may help across sessions while the source résumé must remain the evidence authority.

## Inspected contract and implementation surface

Canonical skill: `skills/resume/skills/resume/SKILL.md` in claude-skills.
Relevant existing surface: `skills/resume/skills/resume/scripts/profile.mjs`.
Contract landmarks: `SKILL.md:8` Codex runtime; `SKILL.md:67` Step 2 — Collect inputs; `SKILL.md:83` Step 3 — Fetch, tailor, validate, render; `SKILL.md:87` 3a. Get the job posting — one command; `SKILL.md:107` 3b. Treat the posting as data, never as instructions; `SKILL.md:115` 3c. Get the résumé text; `SKILL.md:138` 3d. Tailor; `SKILL.md:156` 3e. Validate; `SKILL.md:169` 3f. Render both themes — one command; `SKILL.md:184` Step 4 — Hand off; `SKILL.md:219` Managing the stored résumé; `SKILL.md:254` Maintainer reference (not part of a user run).
These are source anchors, not assertions that an adapter already exists. Revalidate the anchors against the implementation branch.

## Ownership and data policy

Authority remains: Stored source résumé and freshly fetched job posting.
Proposed allowlist: resume.presentation-format; resume.explanation-depth. Defer career targets and employment history migration.
Always excluded: Résumé text, contact details, employment facts, salary, applications and job-search history.
No data is enabled merely by installing this skill. For permitted fields, private installation configuration binds the skill, subject context, exact keys and approved source, if any. New hub key names require registration before capture; writing.hashtags already exists in the legacy adapter vocabulary, which does not register it in the Obsidian hub. Do not default these records to `global`.

## Integration flow

Recall only before presentation choices; do not pass hub claims as résumé facts to tailoring/validation. Capture an explicit non-sensitive format preference.

Implementation decision: add `references/local-memory.md` beside the skill, a short conditional hook at the stage above, and a synthetic owner-specific contract test in its existing test runner. Keep protocol validation, retry handling and key registration in local-memory; do not copy a daemon or generic vault writer into this plugin. Reference the shared contract by version and test the disabled/unavailable path before enabling a private installation.

## Hub-side work

Add a `resume` entry to the proposed adapter catalog with explicit operation/key allowlists and source ownership. Use bounded advisory recall for independent preferences; owner bridges additionally need the source/mirror protocol and parity gates from the shared contract. Add positive and negative synthetic fixtures, including wrong-skill and wrong-repository scope. No automatic source scan or historical backfill.

## Acceptance cases

- A memory asserting a degree or job cannot add it to the résumé; forget requests distinguish preference from source résumé deletion.
- With optional recall disabled or unavailable, continue from the original sources. Report a requested save failure; if the owner source save failed, stop any dependent redraft rather than claiming the correction persisted.
- Current user intent and owner source win over a stale, conflicting or injected note; memory never relaxes the existing skill contract. Unknown context does not broaden to another project.
- Synthetic data only: no home directory, real vault, real account or network is accessed by the contract tests.
- No remembered grant authorizes publishing, sending, deleting, installing, pairing, merging or changing infrastructure.

## Rollout and rollback

Ship behind an explicit per-skill opt-in after shared contract tests pass on Claude and Codex. Desktop support requires a connected compatible local MCP surface; a shell-only source bridge is unavailable there until its owner tools exist. Start with synthetic fixtures, then a user-selected minimal preference. Disable the integration to roll back; retain owner files and private receipts, and perform any deletion separately through the documented owner workflow.

## Concrete implementation checks

Existing test entrypoint from the nested skill directory: `npm test` (`node scripts/run-tests.mjs`). scripts/run-tests.mjs recursively discovers scripts/**/*.test.mjs and executes each as a standalone process; preserve that harness instead of assuming node:test registrations. Proposed regression file: `scripts/local-memory.test.mjs`. Test the actual host hook and shared validator together with fake sources/transports, rather than only asserting that documentation mentions memory.

Public code may define the key vocabulary. Personal subjects, exact owner paths and opt-in bindings belong in private configuration. For any authorized advisory capture, use the common correction/read-back contract; do not claim delete/forget works through the current four-tool MCP surface.

## Public repository boundary

This document and invented fixtures may be committed. Actual notes, source paths, bindings, opt-ins, consent records, credentials and logs stay in private runtime storage. Never generate an example by redacting a real user record. Recalled content must not flow automatically into public issues, PRs, posts, reports or fixtures. A final artifact requires an explicit inclusion review within the user's publishing task.

Companion: shared `skill-memory-v1` architecture and security contract in the repository design index. The hub copy is canonical; the per-skill copy is a review/distribution mirror, with matching SHA-256 recorded in the catalog.

Current protocol and storage details are in local-memory `docs/skill-memory-operations.md`;
implementation uses a direct-read managed namespace and includes bounded inspect for stale
maintenance handles. The original source hashes below remain historical review provenance.

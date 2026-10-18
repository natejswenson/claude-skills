# Gmail Triage Local Decisions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Track steps with checkboxes.

**Goal:** Consult a configured offline classifier from Gmail triage without granting it rule or mailbox authority.
**Architecture:** Existing deterministic proposal selects eligible unclaimed senders; a Node adapter invokes the separate local Python CLI and validates its typed scores before printing advisory existing-label suggestions.
**Tech Stack:** Node >=18 stdlib, existing Gmail triage modules, external Python classifier.
**Spec:** docs/superpowers/specs/2026-10-17-gmailtriage-local-decisions-design.md

## Global Constraints
- No Gmail access during development, no automatic rule changes or mailbox actions, no release/merge.
- Only existing sortable rows with keepInInbox!==true and destination===null are eligible.
- Default config is ~/.gmailtriage/local-model.json; no committed machine paths or new dependencies.
- Independent scores are uncalibrated_entailment, calibration=none; policy .8/.2 is advisory.
- Force offline environment; execFile argv without shell;90second timeout,1MiB maxBuffer.
- No writes inside Git including symlink-resolved paths, even --allow-repo; clean own private scratch in finally.
- Result is not an importable rules document; existing rule validation and application receipts remain authoritative.

### Task 1: Implement and verify the opt-in classifier integration

**Files:**
- Create scripts/lib/local-model.mjs and scripts/tests/local-model.test.mjs under skills/gmailtriage/skills/gmailtriage.
- Modify scripts/gmailtriage.js there for suggest-local routing, validation, table and output.
- Create references/local-model.md; update SKILL.md, skill-invariants.json and skills/gmailtriage/README.md.
- All new code/test fixtures are synthetic; no version/manifests change for this feature PR (release process is separate).

**Interfaces:**
- Consumes ingested thread array, normalized labels {name,id}, validated rules, choices[{label,description}], local runner config, session scratch path.
- Exports clean helpers for request preparation/response validation plus async local invocation; exact helper names chosen consistently by implementer.
- CLI as defined in spec; defaults rules to ~/.gmailtriage/rules.json and config to ~/.gmailtriage/local-model.json.
- Produces typed advisory result and table only; optional --out guarded before runner invocation.

- [x] Step1: Write eligibility tests before implementation and observe failure: claimed sender has no suggestion, any verification/receipt subject excludes whole sender even if sampled subject is ordinary, existing deterministic destination is unchanged. Example `assert.equal(prepare(...claimedInputs).request.items.length,0)` or equivalent. Run `node --test scripts/tests/local-model.test.mjs`, record RED evidence.
- [x] Step2: Implement preparation and choice validation using existing propose/resolveSender/rule validators. Test unknown labels and exact classifier bounds. Do not reinterpret eligibility independently or auto-select/truncate a subset.
- [x] Step3: Add transport tests using an executable Node test fixture writing valid typed output. Assert received args/offline env, input permissions and own-temp cleanup. Write the async execFile adapter with fixed timeout/buffer and fixed private errors. Test response membership, low/close/tied scores, NaN, surprise actions and inconsistent declared decisions. Recompute decisions from scores.
- [x] Step4: Test CLI using spawnSync, temporary snapshots/config/choices/rules, invalid scratch/output before execution, unchanged rule/source bytes, no importable rules and no file on failures. Wire suggest-local to adapter; ensure --min-count positive and current help remains compatible. Use existing table/writeJson conventions without rewriting main CLI.
- [x] Step5: Document config shape, choices, invocation from Codex/Claude, privacy and advisory constraints, offline requirements and unchanged workflows. Add explicit optional skill step after propose, never invoke on ordinary runs without user requesting local mode. Update invariant split for deterministic payload/validation/transport (judgment stays external and fallible). Follow PRESS table conventions; leave generated regions untouched.
- [x] Step6: Run focused tests, then full `npm test` in skill once, `python3 tools/check_compatibility.py`, brand target check and whitespace check. Self-review and commit task code/docs; leave controller spec/plan already committed. Report RED/GREEN test evidence and limitations in supplied report file.

## Controller delivery
- [x] Fresh task review and fix supported findings; whole-branch final review.
- [x] Run required repo CI commands, synthetic real-model smoke, confirm fixed timeout/private files and unchanged source data.
- [x] Configure existing local runner, install reviewed plugin through supported CLI under existing gmailtriage identifier and verify installed code/config; no duplicate skill aliases or broad marketplace changes.
- [x] Push feature branch, create draft PR with accurate validation; no merge/publish.

## Delivery result

Implemented and independently reviewed.190 Gmail triage tests, compatibility,
metadata, contract/baseline, brand and index checks passed; the real offline
classifier worked through both source and installed plugin. Runner config is
local, existing plugin identity and marketplace registration were preserved.
Draft PR: https://github.com/natejswenson/claude-skills/pull/431
No merge, release or real Gmail access occurred. Remote CI status is reported
in the PR rather than frozen here.

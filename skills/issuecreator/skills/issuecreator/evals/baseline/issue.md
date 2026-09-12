## Problem

The user requested a skill that creates GitHub issues formatted for issueflow. This checkout has issueflow's implementation workflow, but its intake relies on the issue author's description being actionable.

## Desired behavior

Claude Code and Codex can turn a change request into a repository-grounded issue with clear scope, observable acceptance criteria and verification steps, then publish when authorized.

## Scope

- Add a shared issuecreator entrypoint and helpers for local validation, Markdown rendering and verified GitHub issue creation.
- Register the plugin in both host catalogs and the repository's CI and release metadata.
- Capture a real local draft and test rejection of incomplete drafts and uncertain publication retries offline.

## Out of scope

- Changing issueflow's execution state machine.
- Posting a live issue solely to test this skill.
- Cutting a release or applying live branch protection.

## Repository context

- skills/issueflow/skills/issueflow/scripts/lib/brief.mjs embeds the issue title and full body into the planning brief; GitHub issues do not need a special issueflow schema.
- AGENTS.md requires preserving Claude support and generating Codex manifests through tools/sync_codex.py.
- CLAUDE.md requires feature PRs to target dev and releases to be explicitly dispatched after promotion to main.
- docs/plans/2026-09-12-issuecreator-spec.json records the user-approved scope. These references describe the inspected working tree, including existing uncommitted issueflow work.

## Acceptance criteria

- [ ] Both hosts can discover the same issuecreator instructions and invoke the bundled scripts independently of the current directory.
- [ ] Drafts missing scope, desired behavior or acceptance criteria fail validation; a blocking question prevents ready-to-publish rendering.
- [ ] Rendered issues retain repository evidence, acceptance checkboxes and literal Markdown/code text.
- [ ] Creation records a verified URL only after GitHub's returned title and body match; an uncertain attempt cannot automatically create a duplicate.
- [ ] The plugin is included in both catalogs, the release component list and a dispatch-only release caller.

## Verification

- Run npm test in skills/issuecreator/skills/issuecreator; expect the real draft baseline and known-bad validation/publication cases to pass offline.
- Run python3 tools/sync_codex.py --check and python3 tools/check_compatibility.py; expect no catalog or manifest drift.
- Inspect the new workflow and verify its release job is restricted to workflow_dispatch. These are planned checks, not claims of completed tests.

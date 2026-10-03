# Config-driven skill workflows

## Request
Implement the user's approved proposal: replace repeated per-skill GitHub Actions workflows with configuration, matrix CI and a shared explicit release entrypoint.

## Acceptance criteria
- Every registered skill has a stable `ci / <skill>` job on PRs to main and feature branches; unchanged skills succeed without running heavy tests. Matrix failure does not cancel other skills.
- Preserve every current test/install/brand command, working directory, runtime, npm cache and special change filter, including skillhelp's cross-skill filter and press's generated targets.
- Releases accept one validated skill, run its CI first, and tag/publish only on explicit workflow_dispatch on main. Preserve npm opt-ins and press propagation.
- Replace the per-skill callers with ci.yml and release-dispatch.yml; keep reusable _release and other specialized workflows.
- Release tooling passes the selected skill as a workflow input. Existing other repositories retain their current per-component workflow support.
- Skillfactory scaffolds config entries and verifies config-backed checks, while retaining legacy caller support in other repositories.
- Config/registry coverage, command failures, change selection, dispatch routing, and host compatibility are tested. Documentation describes the new architecture.

## Decisions and scope
Use a versioned, validated `.github/skills-config.yml` written in JSON-compatible YAML (YAML 1.2 subset), so Node-based tools can share it without introducing a runtime parser dependency. Commands remain reviewed repository code, executed by a shared Node runner with fail-fast shell semantics; matrix values are passed through environment variables, never inserted into shell source. CI's preparation job reads config, generates dorny filters and emits matrix JSON with stable job names. Every PR matrix includes all skills. PR jobs execute directly in ci.yml to avoid reusable-call prefixes. Dispatch and workflow_call force execution of the selected skill (or all skills for an ordinary CI dispatch), regardless of dorny results. Reject missing/extra config and registry entries and invalid skill selectors before emitting a plan. A failed preparation job fails closed; its missing required checks cannot permit merge. Preserve per-skill timeouts and concurrency semantics. Release calls the same CI as a reusable workflow for the selected skill, then the existing _release workflow. Config changes/shared tooling invalidate all skills. Retain offline, zero-model-cost test boundaries.

No live branch protection/settings changes, ready-for-review, merge, release dispatch or publishing is authorized here. Existing required context names remain declared. The original checkout and scratch files are preserved.

## Repository evidence
- Worktree `/private/tmp/claude-skills-workflow-config`, branch feature/config-driven-workflows, cached origin/main at 3f18fc1. Remote base unverified until delivery.
- Main includes brand-images; it has 26 per-skill callers (including brand-images, local-dev and dotfiles beyond the original inspected feature branch).
- `_release.yml` already provides shared releases; press.yml chains propagation. Shipflow componentLayout uses `{name}.yml`; release.mjs dispatches without inputs.
- Skillfactory house/scaffold/conform and release corpus checks assume one caller per skill. PRESS targets may refer to workflow paths and must be inspected before deletion.
- No `.dev/preview.json`: this is workflow/tooling work, with no application preview.

## Implementation
1. Freeze current caller commands/settings as migration parity evidence; extract entries into validated config and implement shared plan/filter/run/select commands.
2. Add shared matrix/reusable CI and release dispatch; preserve pinned actions and generate PRESS mastheads. Remove migrated callers and reconcile generated targets.
3. Extend shipflow componentLayout with optional workflowInputs, expand per component and pass as separate gh arguments in both dispatch paths; test legacy behavior and stale status safety.
4. Teach skillfactory to read/append validated config entries when the repo opts in, and preserve legacy scaffolding elsewhere. Update release corpus checks, docs and relevant workflow watchers.
5. Run regression/parity tests, action verification/lint/security, affected skill suites, tooling and Claude/Codex compatibility. Review and commit implementation, then push and open a draft PR against refreshed main.

## Validation
Node shared tooling tests; shipflow/skillfactory/release/press suites; python tools/tests and check_compatibility.py; sync_codex.py --check; baseline lint and skillfactory verify --all; ghfactory verify new/edited workflows with actionlint and zizmor. No act, external release or live settings changes. Confirm real PR check names before an authorized merge, but do not wait for remote CI in this local-dev delivery. Preserve unverified checks honestly if unavailable.

## Review
Independent reviewer `/root/workflow_plan_review` approved the architecture with corrections. Accepted: force selected release CI, retain direct PR matrix job names, exact config/directory/component/required-context coverage, explicit read-only CI and scoped release secrets, press propagation, inputs in both shipflow dispatch paths and status hash, dependency-free packaged skillfactory support, and two-sided migration tests preserving historical fixtures. Migration parity covers Playwright/caches, Python coverage/shellcheck, multiline brand checks/CSS lint, offline dotfiles commands, timeouts/concurrency and skillhelp cross-skill filters. Real PR check names must be verified before merge; delivery remains a draft PR without remote CI polling per local-dev. No unresolved implementation blockers.

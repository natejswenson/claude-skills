# local-dev implementation verification

Plan commit: `17de0ee` (`docs(local-dev): commit reviewed implementation plan`).
Implementation: new `local-dev` 0.1.0 plugin; issueflow is unchanged.

## Delivered behavior

Typed features and selected issues enter the same local clarification, planning,
independent plan review, plan commit, implementation, testing, local diff review
and implementation commit workflow. GitHub reads occur only for selected issue
intake and final delivery/recovery. The ordinary endpoint is a draft PR; explicit
local-only runs stop at commits. Markdown and Git supply resume evidence.

The dependency-free helper inspects Git without mutation/network, reads issues
only through explicit commands, and renders saved local evidence. Both plugin
catalogs, release/check declarations, help index and generated branding include it.

## Local verification

- New skill suite: 19 tests pass, including a frozen real inspection report,
  known-bad trap, temporary Git repos, Git command allowlist, unchanged index,
  missing remote, unborn/detached HEAD, rename/newline paths and file-type changes,
  argument rejection, failed issue reads and literal issue content.
- Skillfactory: **reached rung 3 of 3**. Wiring, README structure, score_skill 100,
  plugin lint, baseline lint, skill tests and real frozen report all pass.
- Combined Claude/Codex compatibility, generated metadata drift and all 24 skill
  wiring checks pass. Metadata generator suite: 8 tests pass.
- Affected suites: PRESS 143, skillhelp 18, release 19, skillfactory 76 pass.
  Generated brand regions and help-index drift checks pass. npm audit: 0 findings.
- ghfactory: all five workflow references resolve; actionlint and zizmor pass.
  The sandbox initially blocked network resolution; the scoped read-only retry
  verified the action references. This is local validation, not a CI result.
- The generic skill-creator validator rejects this repository's required
  `user_invocable` and `version` frontmatter extensions. They are retained for
  shared Claude/Codex release compatibility; the repository validators pass.

## Independent review and forward execution

An independent reviewer found a missing Git `T` status and two delivery recovery
issues (stale saved PR URLs, and base-filtered lookups hiding changed-base PRs).
The helper now accepts type changes with a real Git regression case. Later resume
verifies saved PR identity/state once and reconciles the returned base explicitly.

A separate agent actually applied local-dev to an isolated Node repository:
`formatTags(tags, max)` gained an optional validated limit. Initial tests passed,
the plan received an independent red team, plan commit `98624f3` preceded code,
and implementation plus verification commit `3abe56a` passed 22 tests with a clean
worktree and no remotes/network calls. This is a constructed behavioral test,
not a claim of a real user feature or live PR delivery.

That run found two instruction gaps: the opening announcement promised a PR in
local-only mode, and an uncertain create could be retried after an open-only
lookup missed a closed/merged PR. Both are corrected: the announcement follows
scope and uncertain creation requires all-state reconciliation before a retry.

## Delivery boundaries

The implementation PR stays draft. No merge, release or live repository settings
change is part of this task. The new required-check declaration applies only when
an authorized admin runs the settings script after review. CI is not polled or
claimed passed. The original checkout's unrelated branch/work remains intact.
# Merge verification follow-up

After the user authorized merging PRs #424 and #425, #425 merged first. Its
changes were integrated from `origin/main` without conflicts. PR #424's eval
check failed because the frozen contract inventory covered 23 of 24 skills and
omitted local-dev. This was reproduced locally: 87 tests passed and the inventory
test failed. The existing extractor generated only the missing local-dev contract
from its committed skill and invariants; other frozen inputs were preserved.

- `node scripts/eval.js contract --skill local-dev --repo <repo> --out evals/fixtures/contracts/local-dev.json`: 10 source-backed clauses.
- Eval `npm test`: 88 passed after the fix.
- Local-dev `npm test`: 19 passed after integrating current main.
- `python3 tools/check_compatibility.py`: both hosts passed.
- Skillhelp `check --repo .`: all 24 cards current.
- `git diff --check`: passed.

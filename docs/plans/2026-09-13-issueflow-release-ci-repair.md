# Issueflow 0.17.0 release CI repair

The first PR #374 GitHub check failed 13 of 557 tests after the candidate had
passed 557 tests inside a live Codex session. The runtime correctly refused
commands that had lost their owning controller identity; the fixtures and offline
evaluator had depended on ambient host credentials.

Observed failure: [GitHub CI run 34771030742](https://github.com/natejswenson/claude-skills/actions/runs/34771030742/job/103760537037),
Node 22.23.2 on Ubuntu; 544 passed and 13 failed. This supersedes any inference
that the earlier local pass established environment-independent CI success;
[the original validation record](2026-09-13-issueflow-pr-validation.json) remains historical evidence.

## Repair and proof

- Affected multi-command fixtures now supply a stable synthetic session, with
  host session and continuation-file variables removed from the child environment.
- The offline evaluator owns its synthetic session. Both missing-credential and
  hostile ambient-credential cases exercise the actual Claude and Codex CLI paths.
- A real CLI continuation test proves startup prints a usable token path, missing
  and wrong tokens cannot change the run, and the original token resumes it.
- Runtime ownership and recovery checks are unchanged.
- The packaged run lessons retain the failure and the environment-isolation rule.

The initial affected-file suite passed 190/190. After adding the two regression
cases, the full suite passed **559/559**, with zero skips or cancellations, under:

```sh
env -u ISSUEFLOW_SESSION_ID -u CODEX_THREAD_ID -u CLAUDE_SESSION_ID \
  -u ISSUEFLOW_CONTINUATION_FILE npm test
```

Cwd: `skills/issueflow/skills/issueflow`. The retained local log is
`/private/tmp/issueflow-release-final-tests.log`, SHA-256 `fc95e8c0bc0865d1f9267e54c4db3b5e1e90de542b2d872b804e4b6f82596f44`.
Claude/Codex compatibility, generated metadata and skill score 100 also passed.
The repaired remote check is still pending at this commit; these local results
are not represented as a remote pass or a published release.

## Release preparation

The release engine prepared Issueflow 0.17.0 and its dated changelog in an isolated
worktree. Its generated entry was carried into the existing improvements PR so
the already-prepared version and final notes reach main together. No additional
component is selected, and GitHub flow has no promotion collateral. The remote
tag must be read back after the explicit Issueflow workflow dispatch.

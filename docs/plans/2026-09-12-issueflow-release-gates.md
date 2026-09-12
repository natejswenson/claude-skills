# Issueflow Codex release gates — 2026-09-12

## Decision

The requested live safety/recovery and installed-plugin discovery gates have
passed. The checks found defects in report escaping, telemetry and timestamp-based
recovery; each was reproduced and corrected with permanent regressions. The
latest candidate identity and CI results are recorded on the draft PR.

Release preparation is isolated in [draft PR #353](https://github.com/natejswenson/claude-skills/pull/353),
targeting `dev`. The source checkout's unrelated changes were not committed or
pushed. No PR was merged and no release workflow was dispatched.

The proposed next version is **0.16.0**, following published 0.15.0. Version and
release-note approval remains outstanding; this candidate still carries the
matching 0.15.0 metadata. It must not be published under that already-used version.
After approval: prepare the bump/notes, regenerate both-host metadata, recheck the
exact bumped candidate, then follow the normal dev-to-main promotion and explicit
release dispatch process. This report does not authorize those later actions.

## Live failure and repair

[Issue #8](https://github.com/natejswenson/fuzzy-boom-snicker/issues/8) produced
[PR #9](https://github.com/natejswenson/fuzzy-boom-snicker/pull/9).

1. A deliberately failing implementation fixture delivered through the real
   completion protocol. The controller executed its reviewed checks, retained
   failed receipts, and returned exit 2. GitHub read-back found no PR.
2. A fresh attempt delivered a deliberately partial `Set`-based repair. Six
   targeted tests, seven suite tests, and actual GitHub CI passed, but repeated
   values were still undercounted.
3. A cold native finder proposed three candidates, pooled into two distinct
   findings. An independent native verifier confirmed both majors: wrong
   duplicate behavior and a missing regression. The real `ready` command refused
   with exit 2, and GitHub still showed a draft despite green CI.
4. A native fixer added a duplicate/shared-reference regression, observed red,
   fixed the implementation, and pushed `8ba74cdc59a27684f32cc0693d354821f0d4af76`.
   Targeted 7/7 and suite 8/8 passed. The controller independently reran both
   obligations at that exact head before starting another review.
5. A fresh finder found no new issue; a fresh verifier confirmed both prior
   majors fixed. The controller resolved both threads, observed green CI, and
   marked the PR ready. A repeated `next` produced no duplicate remote effects.

There were seven actual native workers and two explicitly synthetic initial
implementation attempts. This fault-injection campaign is not represented as
a fully native implementation E2E. No failing GitHub CI job was injected: the
negative controls were failed controller verification and open majors with green CI.

Evidence: [first review](https://github.com/natejswenson/fuzzy-boom-snicker/pull/9#pullrequestreview-5185127380),
[convergence review](https://github.com/natejswenson/fuzzy-boom-snicker/pull/9#pullrequestreview-5185139142),
[final CI](https://github.com/natejswenson/fuzzy-boom-snicker/actions/runs/34672058067/job/103495142196).
The failed, pre-fix, and post-fix batches were respectively
`a7c40cc2-d398-4f6f-abef-0675894291e3`,
`7b30db2d-de72-4270-90ee-40283c18b0d4`, and
`9c54fa33-ebc0-4c7a-bd04-4fcb6d884ebf`.

## Interrupted-worker recovery

[Issue #7](https://github.com/natejswenson/fuzzy-boom-snicker/issues/7) produced
[PR #10](https://github.com/natejswenson/fuzzy-boom-snicker/pull/10).

The parent interrupted a running native planner and observed its terminal state
before recording cancellation. A premature `next --workers-released` refused
with exit 1 because no completed output existed. Supported `cancel-wave` recovery
retained the cancelled attempt, then issued a different attempt UUID without
resetting the original run creation time, 1,800-second window, or total cap.

A new native planner, independent plan reviewer, implementer, and code finder
completed normally. The controller executed both required checks and read back
green GitHub CI at `ad35505212ed950ec6216c6f0bc6c530030950b6`. The PR became ready
with one review and one summary; a repeated `next` stopped without republishing.
The PR remains open and unmerged. This was a deliberate worker interruption,
not a process crash, host restart, or power-loss test.

## Defects found by the release checks

- GitHub CodeQL rejected incomplete escaping of backslashes before Markdown
  table delimiters in the evaluation report writer. A red regression reproduced
  it; the fix escapes backslashes and pipes together. CodeQL passed the fix at
  `7edc9bc54d613b61f92953715e3859183cdbbc96`.
- The live run exposed invalid finding metrics: telemetry reported one proposal
  and zero confirmations although PR review recorded two of each. The old event
  stream contained only a plan-review note. A compact fixture from real PR #9
  now permanently tests pooled PR proposals and distinct confirmed findings,
  including later repair, duplicate records, cancelled rounds and separate lanes.
  Read-only replay against the original run returns the correct two/two counts.
- Dispatch telemetry conflated the native host role `worker` with semantic roles
  such as `finder`. Codex profiles now carry separate `taskRole` metadata while
  preserving the native adapter's role and exact printed prompt. The actual CLI
  dispatch/delivery regression observed red then green; the 61-test runtime suite
  passed, including finder/verifier waves and stopped-worker coverage. Historical
  unknown roles were not rewritten or represented as newly observed measurements.
- Remote CI at `90dabc3321072c1389850152a62db5dfc63d04ed` exposed a timing-dependent
  report-only recovery failure despite a locally green suite. The regression now
  backdates the artifact ten seconds to reproduce it deterministically. Strict
  delivery uses its validated current attempt, generation, hashes and native
  terminal observation instead of an additional legacy timestamp comparison.
  The old completion is explicitly tested to remain insufficient for the new
  attempt; legacy timestamp guards remain in place. The targeted verification,
  attempt and execution suites passed 33/33 after the correction.
  Independent read-only review found no weakened strict or legacy gate.

## Installed Codex discovery

A separate `issueflow@personal` test plugin was installed from the actual packed
candidate. The released `issueflow@claude-skills` copy was preserved. Fresh Codex
sessions selected the personal plugin through their available skill catalog;
their prompts did not provide a source `SKILL.md` path. They invoked the installed
cache's bundled CLI, not the source checkout.

Observed `doctor` and `status` commands exited 0 and identified schema 4 / Codex.
The final diagnostics are intentionally read-only and offline; installed discovery
is not itself a second network-enabled issue-to-PR lifecycle test. Runtime-version
cachebusters distinguish the local test plugin from a published release.

## Performance and limits

The recovery campaign took 913.522 seconds from its first CLI start to the
readying command's completion. The failure/fix campaign took 1,035.551 seconds
from run creation to final remote read-back. These include parent orchestration,
fault injection, network/CI waits and native work; they are not controlled speed
benchmarks. Native tokens, model execution time and monetary cost remain unknown.

The telemetry-corrected candidate passed **520/520 local tests**, with zero
failures, skips or cancellations (51.960 seconds), and **12/12 foundation cases**
(3.095 seconds), before CI exposed the timestamp defect described above.
Both-host compatibility, generated-manifest drift, plugin/baseline lint and all
20 skillhelp cards passed. Its clean foundation snapshot contains 174 files with
SHA-256 `1f7f85b6cdf22f8ae4889f7824f033fd0c7ac87f1ef69ea6c0ef8685ddfb052f`.
CI on the draft PR is checked separately at its exact current head; an earlier
green commit is not evidence for a later untested one. Foundation coverage still
marks six broader capability groups unverified. No cross-host speedup, comparison with
Superpowers, arbitrary-code isolation or complex-project reliability is claimed.

After the timestamp correction, the complete suite passed **520/520** again
(54.163 seconds, zero failures/skips/cancellations). Compatibility and manifest
drift checks passed. The final package contains 84 entries and has npm SHA-1
`ca4b24af834bcb6104d131597ce28ea67ea3a8eb`; this is a local candidate artifact,
not an npm publication. Final installed-session and clean foundation receipts
are retained under `installed-smoke-clock/` and `foundation-clock/` respectively.

## Retained local evidence

- `/private/tmp/issueflow-release-gates.CHew90/commands.jsonl`: root CLI receipts.
- `/private/tmp/issueflow-release-gates.CHew90/recovery-run/`: recovery state,
  immutable attempts, verification receipts and archived execution outputs.
- `/private/tmp/issueflow-release-gates.CHew90/foundation-final/report.json`:
  clean pre-telemetry-fix foundation result and source identity.
- `/private/tmp/issueflow-release-gates.CHew90/foundation-telemetry/report.json`:
  clean corrected-candidate foundation result and exact source identity.
- `/private/tmp/issueflow-release-gates.CHew90/installed-smoke-final/`: real fresh
  session events and process status for the pre-telemetry-fix package.
- `/private/tmp/issueflow-release-gates.CHew90/installed-smoke-telemetry/`:
  corrected installed telemetry observed two proposals/two confirmations and
  seven native observations; all three read-only commands exited 0 (36.396 seconds).
- `/private/tmp/issueflow-release-failure.e3lanz/REPORT.md` and `observations.json`:
  complete failure/fix evidence, frozen source inventory, seven native worker IDs,
  timestamps, receipt hashes and GitHub read-backs. `node collect.mjs` checks it.

These temporary paths are local evidence, not durable public download links.
The committed report, regression fixture and GitHub PRs preserve the durable
summary. Raw session prompts and machine paths were not copied into the PR body.

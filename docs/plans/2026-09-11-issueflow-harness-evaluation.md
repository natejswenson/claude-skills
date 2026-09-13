# Issueflow harness — observed evaluation

Date: 2026-09-11 (America/Chicago). This is an implementation/evaluation record,
not a release announcement or a completed seven-slice certification.

## Result

The final foundation candidate passes **12/12** cases, versus **6/12** on the
pinned baseline. All six reproduced baseline defects are fixed. The full offline
suite passes **516 tests, zero failures, skips or cancellations**. Independent
fault testing found implementation defects, retained failures, and verified repairs.

Native Codex output/Git smoke passed. The subsequent user-authorized Codex-only
live campaign below also passed **3/3 issue-to-ready-PR runs** against real GitHub,
using the exact final candidate snapshot. Native Claude is **failed/unverified**, not
waived: actual model calls returned HTTP 403 because the organization disabled
Claude subscription access. The cross-host performance gate remains open.
No speedup, token saving, or cost reduction has been established.

## Foundation comparison

| Case | Baseline | Candidate |
|---|---|---|
| E01 — fabricated logs accepted by the real CLI | Fail | Pass |
| E02 — zero passing tests | Fail | Pass |
| E03 — nonzero exit after a green summary | Fail | Pass |
| R01 — copy corruption misclassified as docs | Fail | Pass |
| M01 — unknown duration coerced to zero | Fail | Pass |
| M02 — summed worker duration mislabeled elapsed time | Fail | Pass |
| C01 — actual process red/green control | Pass | Pass |
| C02 — actual process green-only refusal | Pass | Pass |
| CLI01 — Claude offline lifecycle | Pass | Pass |
| CLI02 — Codex workspace gate | Pass | Pass |
| REPLAY01 — historical plan/stage corpus | Pass, 23 tests | Pass, 23 tests |
| REPLAY02 — historical review corpus | Pass, 3 tests | Pass, 3 tests |

Baseline capture correctly exits 1. Candidate and comparison exit 0 for selected
behavior; comparison explicitly reports performance as inconclusive. No failing
case was converted into an expected candidate pass. Historical replays explicitly
retain schema-3 evidence strength; they are not strict proof fixtures.

The 12-case manifest is a foundation comparison. Its six uncovered capability
groups mean this scorecard alone does not cover them; the separate tests below
exercise parts of those groups without claiming complete coverage.

## Strict core and independent failure-to-fix testing

The ordinary suite additionally covers controller-executed assertion-red and
green on Git revisions, required-suite failures, import-only failures, zero tests,
untracked/ignored inputs, receipt/output tampering, contracts, stale attempts,
revision conflicts, ownership, immutable completion, cancellation, bounded
remote-operation adapter faults, usage, capacity, context and head-bound CI policy.
Remote adapter tests are simulations, not real GitHub crash-recovery evidence.

The skill-creator guidance prompted an independent cold forward test against
frozen source copies. Initial controls exposed misleading labels, verification
tables and PR bodies, an offline ship attempt, and a missing doctor command.
All were fixed. A second pass found these failures and verified the repairs:

| Fault | Observed failure | Verified repair |
|---|---|---|
| Report-only correction, unchanged HEAD | Stale receipts exhausted repairs | New attempt UUID triggers fresh verification and acceptance |
| Ignored runtime file changed | Real tests failed but acceptance succeeded | Fingerprinted inputs reject stale acceptance with exit 2 |
| Output changed after completion | Both release and rebrief blocked | Explicit terminal-worker acknowledgement permits cancelled-wave recovery |
| Installed local dependency | Base snapshot failed to load dependency | Fingerprinted runtime inputs copied locally; actual assertion-red/green pass |

Five fresh retests passed: repair, ignored-input refusal, dependency-bearing
regression, interrupted-delivery recovery, and earlier controls. The tester checked
source inventories, receipt hashes, attempt UUIDs and retained history. Workers
were explicitly synthetic; CLI, Git and test processes were real. These are not
claimed as native agent runs.

Private temporary evidence directories (not durable published records):

- First forward test: /private/tmp/issueflow-forward.xL7kdn/REPORT.md.
- Retained failures: /private/tmp/issueflow-adversarial.H1JW3l/REPORT.md.
- Repaired retest: /private/tmp/issueflow-retest.0ACEXf/REPORT.md and observations.json.
- Retest inventory: 9527463390fc1f125141312d8f0c27dc36aa319678a30c7b90c6de638113176a.

The independent snapshot preceded final readiness/brief refinements. The final
full ordinary suite covers those changes; the independent retest is not a native
review of the exact final package.

## Native host observations

| Host/check | Observed result | Scope |
|---|---|---|
| Codex 0.154.0, ordinary sandbox | Initialization EPERM; 20 pass / 2 fail | Failed launch retained |
| Codex, approved boundary smoke | 22 pass; two real children completed (~13.1s, ~16.2s) | Output writes and Git commits inside an approved temporary root |
| Claude, ordinary sandbox | Configuration write EPERM; 20 pass / 2 fail | Failed launch retained |
| Claude 2.1.269, approved launch | 20 pass / 2 fail; model calls HTTP 403; reported cost $0 | CLI starts, subscription access prevents validation |

Codex tasks are boundary smokes, not full strict-contract issue-to-PR runs or
paired benchmarks. Native runs preceded later core refinements. Authentication
and organization settings were not changed. Claude needs authorized API-key
configuration or administrator restoration before retesting; never paste keys
into evaluation records. ISSUEFLOW_CLAUDE_BIN pins the intended executable when
npm's PATH resolves an older installed CLI.

## Reproducibility

- Baseline commit: 9782fa49e2c12380d3f3e727d9d66fac3ea720d9.
- Baseline snapshot: db3f74a7be33fdb7216893cdc8816b6a169e50d0828460804dc62a639bb894a7.
- Candidate working-tree snapshot: 93e7bd126e050f92f5867db32c13793df360c3f7d3a87e08f8fcadd4744c93fa (173 files).
- Evaluator: 501aa3294ea1abf3aa27c8f072b1e543a93e9954a008a2820d72815c3c87720c.
- Manifest: e8a4930c49c1bbd7329db73c7a5ab46382690864da7a80aa41e745704204fe28.
- Environment: Node v25.2.1, Git 2.52.0, macOS/arm64.
- Latest campaign root: /private/tmp/issueflow-final-validation.fEnspV/.
- Reports: baseline/report.json and candidate/report.json; full suite: unit-final.log.
- Earlier campaign evidence remains under /private/tmp/issueflow-harness-resume.kPaqQt/.

Reports retain process results, output hashes and immutable source inventories.
Baseline and candidate evaluator/manifest identities match. Candidate snapshots
include untracked issueflow source, not unrelated dirty work. Foundation durations
were observed under concurrent test load and are not an agent-performance
comparison. The comparison explicitly reports performance inconclusive. Final
candidate file hashes and modes were checked against the working tree with no
drift. Preserve temporary raw artifacts separately.

## Repository gates and open work

Passing: full 516-test offline suite (67.04s); skillhelp 18 tests; combined Claude/Codex
compatibility; metadata drift; baseline declaration lint; structural score 100/100;
plugin/version lint; README brand check; skillhelp currentness; git diff --check.

Now implemented with local regression coverage: pre-PR migration/amendments,
lane obligations, checkpoint/review/reply/resolve/summary reconciliation,
native worker observation and usage import, source-bound context caching,
cancelled-review recovery, automatic post-fix verification, and offline packaged
installation for both host profiles. See the follow-through results below.

Open: native plugin-manager discovery, live GitHub crash recovery, both-host
full lifecycle, complete live latency/usage measurements, and the 72-run paired
W01–W06 campaign. The native campaign runner is still unavailable; requesting that
mode remains explicitly inconclusive. No spend cap was approved for that campaign.
The [implementation ledger](2026-09-11-issueflow-harness-implementation.md) retains
these as incomplete, not waived. Before the separately authorized live campaign
below, no remote PRs, GitHub writes, releases or credential changes were performed.
The working repository has not been committed or pushed.

## Follow-through: full local lifecycle and recovered defects

The permanent `scripts/tests/harness-lifecycle.test.mjs` drives actual CLI commands,
Git commits/pushes to a local bare repository, and assertion-red/green/full-suite
processes. It supplies explicitly synthetic worker artifacts and a persistent
fake GitHub adapter. It verifies one corrective commit, two posted reviews, a
resolved finding, current receipts, interrupted readiness recovery, and no
duplicate effects on repeated `next`. This is a meaningful integration test,
not proof of real model quality or hosted GitHub behavior.

Independent frozen retesting found and then verified repairs for:

- Old review approval surviving migration/amendment, including identical plan bytes.
- Missing post-fix verification before the next review/readiness.
- Different context file paths at briefing and registration.
- Cancelled reviews not consuming the original review-round allowance.
- Incorrect sticky-comment claims and displayed review caps.

Final independent scenarios: **3/3 passed**, exit 0, approximately 34.3s. Report:
/private/tmp/issueflow-final-retest.iklafh/REPORT.md. Frozen behavioral source:
6eb6ad015d9fabf5068b17db362cf8abb730f02488b8fdbc7325ca1b80de5a75.
That snapshot predates final exhaustion-message/docs refinements; the final
516-test suite and foundation snapshot above include those refinements.

The permanent package smoke runs real pre/post-pack hooks only in a scratch copy,
installs the resulting tarball offline without dependency scripts, checks bundled
runtime files, and starts schema-4 Claude and Codex profiles outside the source
checkout. The journal tests separately inject lost acknowledgements after review
creation, thread creation, submission, reply and resolution; each produces one
effect, with unavailable read-back retained as uncertain until reconciliation.

The skill-creator workflow supplied the independent cold-test requirement; the
confirmed failures became permanent executable regression cases. This earlier
local phase changed no remote issue, PR, release, credential, or installed personal
plugin. Local Git writes and package installation used disposable test fixtures.

## Live Codex campaign — authorized disposable GitHub target

The user explicitly narrowed the next evaluation to Codex and authorized creating
a few issues in `natejswenson/fuzzy-boom-snicker`. The repository was empty and
described as a throwaway test repo. Seeded a dependency-free Node fixture on `dev`
at `1e4dcd1128ee3a45854da754d899044e23cbd3ed`, with two intentional edge-case bugs
and a README placeholder. ghfactory resolved current action SHAs and verified
actionlint/zizmor; real baseline CI then passed. PRESS supplied the workflow header.
The installed header helper lacked its PRESS dependency; the repository helper
successfully generated the same header before verification and publication.

All three runs used the unchanged **173-file candidate snapshot
93e7bd126e050f92f5867db32c13793df360c3f7d3a87e08f8fcadd4744c93fa**,
version 0.14.0, directly from the local candidate CLI—not the installed 0.15.0 skill.
Source hashes and modes were checked again after completion with no drift.

| Issue | Ready PR | Controller evidence | Issue-to-ready elapsed |
|---|---|---|---|
| [#1 — falsy counts](https://github.com/natejswenson/fuzzy-boom-snicker/issues/1) | [#4](https://github.com/natejswenson/fuzzy-boom-snicker/pull/4) | Base assertion-red; fixed regression green; full suite 6/6 | 592.466s (9m52s) |
| [#2 — zero cap](https://github.com/natejswenson/fuzzy-boom-snicker/issues/2) | [#5](https://github.com/natejswenson/fuzzy-boom-snicker/pull/5) | Base assertion-red; fixed regression green; full suite 8/8 | 608.049s (10m08s) |
| [#3 — test instructions](https://github.com/natejswenson/fuzzy-boom-snicker/issues/3) | [#6](https://github.com/natejswenson/fuzzy-boom-snicker/pull/6) | Documentation content check and documented `npm test`; suite 2/2 | 667.044s (11m07s) |

Each run used four real, cold native Codex workers: planner, independent plan
reviewer, implementer, and independent PR finder. Twelve workers were observed
starting and completing. Core roles used high reasoning; PR finders used medium.
One child slot per run allowed all three independent runs to proceed concurrently.
Each plan passed its first review; each PR converged in its first code-review round.
No findings required a verifier or fixer, so neither role was dispatched.

GitHub read-back confirmed all PRs open, non-draft, unmerged, based on `dev`, and
with successful `test` CI. Verification receipt hashes, output hashes and reviewed
commit IDs matched the remote heads:

- PR #4: `411ba5caad464c2f89efe4fbf64101e31cab429c`, [review](https://github.com/natejswenson/fuzzy-boom-snicker/pull/4#pullrequestreview-5185065995), [CI](https://github.com/natejswenson/fuzzy-boom-snicker/actions/runs/34670901620/job/103491940265).
- PR #5: `edfe9b2f1358c585b57dcfedd4dc58d008403ffb`, [review](https://github.com/natejswenson/fuzzy-boom-snicker/pull/5#pullrequestreview-5185066569), [CI](https://github.com/natejswenson/fuzzy-boom-snicker/actions/runs/34670902023/job/103491941326).
- PR #6: `9dbde3bdabaeedf6d2cb80e70253f9fda53175fc`, [review](https://github.com/natejswenson/fuzzy-boom-snicker/pull/6#pullrequestreview-5185069103), [CI](https://github.com/natejswenson/fuzzy-boom-snicker/actions/runs/34670938555/job/103492042416).

These are independently generated AI reviews posted as GitHub **COMMENTED**
reviews through the user's account, not human approval or a second GitHub identity.
The reviewer coverage omissions remain in the posted reviews; the controller
separately observed final-head CI. Re-entering `next` after completion stopped at
`shipped` on all three runs. A second read-back found identical PRs, review IDs and
comment IDs: no duplicate remote effects or worker redispatches.

The captured 48 candidate CLI invocations all exited zero. The three live outcomes
required no harness implementation correction. The temporary read-back collector
initially had a syntax error; it was fixed, syntax-checked and actually executed
successfully. That collector failure was not counted as a harness failure or hidden
as a passing evaluation attempt.

### Measurement interpretation and remaining coverage

Elapsed time is `run.createdAt` through the recorded confirmed-readiness timestamp,
including parent orchestration, waits and GitHub calls. It is not summed child
duration, model compute time, or time until a human merges. Median: 608.049s across
three cases. Summed worker-delivery intervals were 545.880s, 559.578s and 616.876s;
those intervals include dispatch/observation overhead. Controller-command wall
times totalled 118.208s across the concurrent runs and later diagnostics; this is
not an additional campaign-elapsed number. No baseline pairing establishes a
speedup. Tokens, cache usage and cost remain **unknown**, not zero.

The initial text classifier selected `deep` for all three issues because their
bodies mention CI/operational terms, including explicit no-workflow-change scope.
That increased the permitted review cap to four but did not force extra workers:
actual diffs received one finder and converged in one round. No classification
policy was changed on the strength of these three clean-path measurements.

This campaign establishes the small, clean Codex issue-to-ready path with actual
GitHub effects and safe completed-run re-entry. It does **not** establish live
finder recall, verifier/fixer convergence, interruption/lost-response recovery,
complex multi-lane performance, hostile repository isolation, plugin-manager
discovery, Claude behavior, or the broader paired campaign. Existing simulated
fault coverage remains separate. No PR was merged, no release was cut, and no
credential or installed plugin was changed.

Raw temporary evidence: `/private/tmp/issueflow-codex-live.ni0pfW/` contains the
initial source snapshot/inventory, `commands.jsonl`, `results-before-resume.json`,
`results.json`, executable read-back collector, and all three canonical run and
prepared-workspace directories. These temporary files are not durable published
artifacts; the GitHub links and this repository-local record retain the summary.

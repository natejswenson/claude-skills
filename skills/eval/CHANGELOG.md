# Changelog

All notable changes to the **eval** skill are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-08-03

Measured against 47 real session transcripts rather than argued. eval scored
**85.7% precision overall but 14% at `high` severity** (1 of 7), and its worst
probe was wrong on **6 of 6** real firings. None of this was a regression — the
48-test suite was green because the frozen baseline is pinned to a dogfooded
session whose SKILL.md happens to contain the exact phrases the probes recognise.
This release fixes the defects that made the report **assert something false**.

`trace.mjs` is deliberately untouched: event ids are positional, and on a
compacted session a count-changing trace fix rewires 40–72% of citations to the
*wrong* event with zero rejections. That work needs source-derived ids first.

### Fixed

- **The clause extractor captured the prose between rules instead of the rules.**
  `/\*\*([\s\S]{5,400}?)\*\*/g` cannot close on a bold span shorter than its
  minimum inner, so `**Auth**` left its opener running to the next `**` — and
  from there the matcher alternated, taking gap text and discarding real spans
  until another short span flipped parity back. Live effect on ghostwriter:
  `**Never print or commit secrets.**` was absent from the contract while the
  sentence *after* it was present at severity high, and a parenthetical that
  merely quotes the approval gate stood in for the gate itself. The inner is now
  a non-asterisk run, so spans close on their own delimiter and `MIN_CLAUSE`
  does the length filtering it was always meant to do. Ghostwriter recovers 10
  real rules and sheds 9 gap-text clauses; skillfactory's frozen contract moves
  32 → 30 clauses.

- **`pr-into-main` flagged the promotion this repo mandates.** All six of its
  real firings were `gh pr create --base main --head dev` — CLAUDE.md's own
  step 3. It read `--base` and never `--head`. A PR from the integration branch
  is now exempt, the push pattern accepts any refspec (`dev:main`, not just
  `HEAD:main`), and `gh pr edit --base main` is caught. Measured: 6 findings → 0,
  with the genuine `--head feature/x` violation still firing.

- **One violating event produced one finding per bound clause.** `decide` ran
  once per clause, so a single `gh pr create` also emitted a finding citing
  "Never push directly to `main`" — a category error about an event that is not
  a push — and one missing announcement was counted twice at two severities.
  Probes now decide once and attach each hit to the most specific bound clause,
  preferring the skill's own rule over shared presentation boilerplate. Measured:
  4 duplicate findings → 0; the golden's 17 findings → 16.

- **`probe.json` still shipped the 0.2.1 bug.** That release taught `report.md`
  and the CLI to count judgment coverage, but `buildProbeReport` kept reading
  probe-only numbers — so the machine-readable artifact paired a finding count
  with a gap that ignored those very findings. All three now call `coverageOf`.

- **Judgment findings were silently swallowed.** `if (seen.has(f.id)) continue`
  was written for content-addressed probe ids; applied to hand-written judgment,
  two findings with a missing or duplicate `id` collapsed into one and
  `--check-finding` reported `Supplied 2 | resolve 1 | Rejected 0` and exited 0.
  Caller-supplied findings are now rejected and counted, never skipped, and an
  unrecognised `severity` is refused instead of sorting last.

### Added

- **`probesUnbound`** — a probe that finds no clause to attach to left no trace
  in any output, so the report read clean over a rule it never located.
  `question-budget` binds **0 of the 12** shipped contracts and nothing said so.
  Both `probe.json` and `report.md` now name them, because "this skill never made
  that promise" and "it phrased the promise in words the probe cannot read" are
  different facts and neither one is clean.

### Changed

- **`evals/baseline/update.mjs` no longer re-extracts contracts from the live
  repo by default.** The declared `update_command` rewrote the fixtures on every
  run, so it could not reproduce the committed baseline — it attributed repo
  movement to eval drift. Contracts are reused unless `--contracts` is passed,
  mirroring the 0.2.0 `--session` fix. Verified: two consecutive refreshes now
  change nothing.

- **The frozen-corpus floor is the live skill list, not the constant 10.** The
  corpus held 12 of this repo's 14 skills and still cleared its floor, so it
  reported on 12 and looked complete — the exact failure this skill grades others
  for. `release` and `issueflow` are now frozen too.

### Known and deliberately not fixed here

Two false-positive classes remain, both measured and both out of scope for a
release about false *statements*: a pipe inside a quoted literal reads as a
shell pipeline, and the English words "less"/"more" inside a heredoc read as
file-dump commands. Machine coverage also stays narrow — probes bind to phrasings
this repo's dogfooded skills happen to use, so a non-dogfooded skill sees ~4% of
its clauses examined. Broadening that means per-skill probe bindings, which is a
design change and not a bug fix.

## [0.2.1] - 2026-08-02

### Fixed

- **A clause a judgment finding cited was still counted in the coverage gap.**
  `probed` only records what the machine looked at, so a clause reached by
  judgment stayed in `probed.unexamined` — it printed in the "clauses nobody
  examined" table directly underneath the finding built on it, and the sentence
  above that table ("N clauses had no probe **and no judgment finding**") was
  false about its own report. Found by grading a real ghostwriter run: both
  clauses the three findings cited were listed as unexamined.

  Coverage is now probe coverage plus whatever judgment cited, and the
  `clauses examined` row shows the split (`4 of 54 (2 probe, 2 judgment)`) so
  machine-decided and model-decided coverage stay distinguishable. The
  increment is counted off the unexamined list rather than off the judgment
  array, so a clause both a probe and a judgment finding touched is not counted
  twice.

- **The CLI summary disagreed with the artifact it had just written.**
  `eval report`'s terminal table read the same probe-only numbers, so the
  conversation showed one coverage gap and `report.md` another. Both now call
  one exported `coverageOf`, because two copies of this arithmetic is how one
  of them goes stale.

- The frozen baseline is unchanged and still byte-compares: the judgment split
  is emitted only when judgment findings exist, so a machine-only run renders
  exactly as it did before.

## [0.2.0] - 2026-08-01

### Changed

- **Renamed from `assay` to `eval`.** The old name said nothing about grading a
  run or writing evals. Breaking across every identity a skill has: plugin id,
  directory, `/eval`, the CLI (`node scripts/eval.js`), `@natjswenson/eval`
  (never published under the old name), `ci / eval`, and the `eval-v*` tag
  prefix. The `assay-v0.1.0` tag stays as history.
- **The golden is the same real run, re-scored.** `evals/fixtures/run-trace.json`
  is untouched: it is a normalized record of a session that actually happened,
  and rewriting the names inside it would be asserting something that was not
  observed — the one thing this skill exists to refuse. The frozen report and
  the contract corpus were regenerated, so the report now cites
  `skills/skillfactory/…` clauses against events that ran under the old paths.
  That mismatch is the honest one.

### Fixed

- **`evals/baseline/update.mjs` no longer re-pins the golden to whatever session
  is newest.** With no `--session` it silently picked the most recently modified
  transcript, so the declared refresh command did not reproduce the committed
  baseline — it swapped the graded run for an unrelated one and called the diff
  drift. It now reuses the committed trace unless `--session <file>` is given
  (`--session latest` restores the old behaviour, deliberately).

## [0.1.0] - 2026-08-01

### Added

- **First release.** eval grades a run that actually happened against the
  contract the skill committed to in writing, and keeps only findings it can
  point at.

- **`contract`** lifts every rule a skill bound itself to out of its committed
  files — SKILL.md, `skill-invariants.json` prose, spliced press regions and the
  repo's golden rules — as clauses with content-addressed ids and `file:line`
  anchors. Three rule forms are recognised (prohibition, positive imperative,
  contrastive), because grading only the "never" sentences reads half a contract.

- **`trace`** normalizes a Claude Code session JSONL into ordered, citable
  events. Thinking blocks, injected `<system-reminder>` payloads and harness
  bookkeeping are dropped; secrets and home paths are masked, because a trace
  becomes a committed fixture and a fixture is forever.

- **`probe`** decides the eight mechanically checkable violations, each carrying
  the clause id it breaks and the event id that breaks it. Every probe declares
  what it *cannot* decide, so the remainder is handed to judgment instead of
  being scored as clean.

- **`report`** prints findings *beside* the coverage gap. A finding count alone
  reads as a verdict on the run when it is only a verdict on the clauses
  something examined.

- **`case`** turns a confirmed finding into a permanent regression test in the
  target skill, runs it there, and keeps it only if it is observed to fail —
  deleting it and exiting non-zero otherwise.

### Found by dogfooding this release

- `node --test` inherits `NODE_TEST_CONTEXT` when spawned from inside another
  test run: it executes nothing and exits 0. That made `case --prove` silently
  vacuous under any test runner, reporting "passed on arrival" for cases that
  were genuinely red. Fixed with a scrubbed child env plus an anti-vacuity check
  that the run actually executed a test.

- Grading this skill's own creation run surfaced a defect in skillfactory's SKILL.md
  template, fixed in skillfactory 0.1.1 and pinned by a generated case.

- CodeQL flagged the `--grep` lookups as **regex injection** (2 high): both built
  a `RegExp` from a command-line argument, so a pathological pattern from a
  script or a pasted command could hang the process. `--grep` now takes
  comma-separated **literal** substrings with OR semantics — which covered every
  real lookup anyway — and a regression test asserts metacharacters stay inert.

# Changelog

All notable changes to the **eval** skill are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

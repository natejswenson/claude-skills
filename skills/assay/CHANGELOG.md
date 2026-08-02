# Changelog

All notable changes to the **assay** skill are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-01

### Added

- **First release.** assay grades a run that actually happened against the
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

- Grading this skill's own creation run surfaced a defect in smith's SKILL.md
  template, fixed in smith 0.1.1 and pinned by a generated case.

- CodeQL flagged the `--grep` lookups as **regex injection** (2 high): both built
  a `RegExp` from a command-line argument, so a pathological pattern from a
  script or a pasted command could hang the process. `--grep` now takes
  comma-separated **literal** substrings with OR semantics — which covered every
  real lookup anyway — and a regression test asserts metacharacters stay inert.

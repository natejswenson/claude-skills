# Changelog

All notable changes to the **smith** skill are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-01

### Added

- **First release.** smith turns an idea into a finished skill: branded by press,
  wired into every registry, its CI caller verified by forge, split into
  deterministic scripts and model judgment, and pinned against a run that
  actually happened.

- **The ladder, and the rung nothing else checks.** `smith verify` reports rungs
  0–3: wiring resolves, house lints pass, the skill's own tests pass, and — the
  one that matters — *a real run is frozen as the baseline*. Rungs 0–2 mean the
  scaffolding is correct, which is not the same as the skill working.

- **Rung 3 is structural, not a promise.** The scaffolded `baseline.test.mjs`
  **fails** until `smith freeze` runs, so `ci / <name>` cannot go green on a
  skill nobody has executed. Every other gate in this repo can be satisfied by a
  skill that has never been run once.

- **`smith freeze` makes evals reproducible rather than decorative.** It records
  the command that produced a real run and generates a test that *re-runs it and
  byte-compares*, so the eval fails when behaviour changes — not merely when
  someone edits a fixture. It refuses a command that looks networked: a CI
  baseline that calls the network costs money and flakes.

- **Two-sidedness is enforced, not encouraged.** Without `--trap-command` the
  generated baseline test fails. A baseline that only asserts good-input-passes
  goes green the day someone weakens a checker — verified adversarially here:
  stubbing `validateSpec` to always return ok left the golden green and turned
  only the trap red.

- **`smith check-spec` grades an intention, harder than CI grades a skill.** It
  rejects things every lint in this repo accepts: a description too thin to ever
  match a real request (`score_skill.py`'s floor is 20 characters, which is a
  skill that never triggers), a split with an empty half, an eval plan with no
  known-bad case. The last moment a bad answer costs nothing.

- **The ten-step checklist, applied all-or-nothing.** `smith scaffold` writes the
  skill tree plus seven wiring points — marketplace entry, required-check
  context, two press targets, the caller workflow, the README table/install/
  symlink block, and the `CLAUDE.md` check list. An unresolvable anchor aborts
  before the first byte is written, because a half-applied wiring is worse than
  none: the half that landed makes the rest look done.

- **No SHA is ever remembered.** Generated callers pin the action SHAs this repo
  already trusts, read out of the callers it already ships. The caller generated
  for the demo spec cleared forge's rungs 0–2 — 5/5 refs resolved and current,
  actionlint and zizmor clean.

- **The declared split.** `skill-invariants.json` gains a `split` block naming
  which steps are code and which are judgment, and `smith verify` fails when a
  deterministic step names a command that does not exist — prose pretending to
  be code. Required of skills smith creates; the nine that predate the contract
  are deliberately not retrofitted.

- **A conformance tier that is right about skills it did not make.** `verify`
  grades every skill in this repo against the house tier and all nine pass, which
  is the only reason to trust it about a new one. The stricter smith tier is
  opt-in via the `smith` block, so a shipped skill is never failed for a rule
  that landed after it.

- **Baseline eval set** — pinned against a real `scaffold` run of the `tally`
  demo spec against a fixture house (golden, re-run and byte-compared), a
  degraded spec that must be rejected (trap), and this repo's nine shipped skills
  as a conformance corpus with a floor of 9, so a resolver that matches nothing
  goes red instead of quiet.

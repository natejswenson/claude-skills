# Changelog

All notable changes to the **smith** skill are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-08-01

### Added

- **The README house style, as a check.** Ten skills shipped ten READMEs — 28 to
  279 lines, no two section orders alike, three different H1 forms. A reader
  arriving from the marketplace had to re-learn where "how do I install this"
  lived on every one.

  The shape is **fixed head, free tail, fixed foot**: masthead, standfirst, the
  one rule as a pull quote, then *Why install this → What you get → Quick start
  → Triggers → Requirements*, anything the skill needs, then *Development →
  Changelog → License*. `references/readme.md` is the contract,
  `scripts/lib/readme.mjs` checks it, and `smith verify` reports it as
  `readme-structure`.

  The tail is free on purpose: devlog's configuration reference and
  ghostwriter's compliance notes are real content that no five-section template
  has room for, and forcing them out would move detail into files nobody opens.

- **`ci / marketplace` now runs `smith verify --all`,** unconditionally, so a
  README edited in *some other skill's* PR is still graded. Placed there rather
  than in a per-skill caller for the same reason as `lint_baseline.py`: it is a
  cross-skill invariant, and a path-filtered check would let a new skill land
  green without ever being evaluated.

- **A README corpus baseline,** pinned against the ten READMEs this repo
  actually ships, with six targeted mutations on the negative side — decorated
  H1, deleted masthead, prose instead of the inventory table, a reordered head,
  a missing foot section, a Quick start with no command. Each asserts the
  *specific* check that exists for it fired, not merely that grading failed.

### Changed

- **`readme-structure` is a house-tier check, not smith-tier.** Every shipped
  skill was retrofitted to the contract in the same change, so the tier is true
  the day it lands — the opposite of the retroactive rule this file warns about.
- **The scaffolded README is now a real README,** filled from the spec rather
  than four lines and an install link: the inventory table comes from the
  declared split and references, and Triggers come from the quoted phrases in
  `description:` — the literal text a request is matched against, so the two
  cannot disagree.
- **The scaffolder writes a `readme-masthead` press target** (press 0.9.0)
  instead of `version-badge`, anchored on a bare `# <name>` H1.

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

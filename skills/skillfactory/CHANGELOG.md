# Changelog

All notable changes to the **skillfactory** skill are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-08-02

### Fixed

- **A scaffolded release job no longer admits `push`.** The caller template still
  emitted `(github.event_name == 'push' || github.event_name == 'workflow_dispatch')`,
  the trigger this repo banned on 2026-08-02 after it cost two releases —
  `city-report` v0.4.0 tagged with stale notes before a planned CHANGELOG edit
  landed, and `shipflow` v0.4.0 tagged *and published to npm* seconds after a
  merge with no dispatch and no decision. A `dev → main` auto-merge fires push
  events, so every scaffolded skill shipped publish-on-merge. Found by
  `ci / release` on `issueflow`'s first PR — one PR too late, because by then the
  caller is written and the fix is manual.
- **`references/wiring.md` still taught the old behaviour.** It carried a
  "Releases are publish-on-merge" section describing exactly what was reversed.
  A scaffolder and a reference that both predate a change are how the change gets
  undone. Replaced with what is actually true, including why never to generate
  `push` back in.

### Added

- **An eighth wiring point: `.github/shipflow.json`'s `release.components`.**
  `scaffold` wired seven registries and not this one, so every new skill was
  invisible to the `release` skill entirely — `preflight` reported on every
  *other* component and looked complete — and `ci / release`'s corpus baseline
  failed the PR. The list is kept sorted, because the committed one is sorted and
  a wiring diff that also reorders is a diff nobody reads.
- **`scripts/tests/wiring.test.mjs`** — named assertions for both defects above,
  deliberately **not** in `baseline.test.mjs`. `freeze` regenerates that file from
  a template and silently deletes anything hand-written in it, which is exactly
  the moment someone is trying to make a failing golden go green. Verified
  non-vacuous: reverting the template *and* re-freezing still fails these.
- The fixture house now contains a `.github/shipflow.json`, so the scaffold golden
  models a real repo rather than one missing a registry.

## [0.3.0] - 2026-08-01

### Added

- **`check-spec` now refuses a name that says nothing about the job.** Every
  part of a name must appear in what the spec says the skill does, allowing for
  a role word (`factory`, `report`, `sync`, `eval`, …) and an abbreviation whose
  expansion is in the text (`gh` when the description says GitHub).
  `nameCoverage` in `scripts/lib/spec.mjs` is the implementation; the failure
  names the uncovered segment rather than just rejecting.

  This exists because three skills in this repo — `forge`, `assay` and `smith` —
  shipped under metaphors and all three had to be renamed afterwards, each
  costing a directory, a plugin id, a slash command, a tag prefix and a required
  status check. A metaphor always reads better at the moment you pick it.

  Pinned by `evals/inputs/metaphor.spec.json`, a spec identical to the demo one
  in every field except its name, so the trap can only fail on the name — and
  the test asserts the failing field is `name`, because a trap that merely fails
  somewhere stops proving anything the day an unrelated rule tightens. The tests
  live in `scripts/tests/naming.test.mjs`, not `baseline.test.mjs`, which
  `freeze` regenerates from a template and would silently delete them from.

  Graded at spec time only. The eight skills that predate the rule are
  grandfathered — `verify` does not re-grade a shipped name.

### Changed

- **Renamed from `smith` to `skillfactory`.** Breaking across the plugin id, the
  directory, `/skillfactory`, the CLI (`node scripts/skillfactory.js`),
  `@natjswenson/skillfactory` (never published under the old name),
  `ci / skillfactory` and the `skillfactory-v*` tag prefix. The `smith-v*` tags
  stay as history. The smith-native marker in a scaffolded skill's
  `skill-invariants.json` is now the `skillfactory` key, and the strict
  conformance tier it selects is reported as `skillfactory` rather than `smith`.
- **The demo spec is `repocount`, not `tally`.** `tally` fails the new name rule
  — nothing in "count what a repository owes you" spells it — and a scaffolder
  whose own golden violates the rule it enforces is not enforcing anything. The
  whole baseline was re-frozen from a real re-run against the renamed spec.

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
  `scripts/lib/readme.mjs` checks it, and `skillfactory verify` reports it as
  `readme-structure`.

  The tail is free on purpose: devlog's configuration reference and
  ghostwriter's compliance notes are real content that no five-section template
  has room for, and forcing them out would move detail into files nobody opens.

- **`ci / marketplace` now runs `skillfactory verify --all`,** unconditionally, so a
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

- **`readme-structure` is a house-tier check, not skillfactory-tier.** Every shipped
  skill was retrofitted to the contract in the same change, so the tier is true
  the day it lands — the opposite of the retroactive rule this file warns about.
- **The scaffolded README is now a real README,** filled from the spec rather
  than four lines and an install link: the inventory table comes from the
  declared split and references, and Triggers come from the quoted phrases in
  `description:` — the literal text a request is matched against, so the two
  cannot disagree.
- **The scaffolder writes a `readme-masthead` press target** (press 0.9.0)
  instead of `version-badge`, anchored on a bare `# <name>` H1.

### Fixed

- **The scaffolded announce line is grammatical again.** The SKILL.md template
  built it as `"I'm using the <name> skill to " + summary.toLowerCase()`, which
  reads correctly only when the summary is written in the imperative. skillfactory's
  own spec template asks for a summary "in the voice of a person", and the
  natural third-person answer produced `"…skill to grades a real run of a
  skill"` on every scaffold. The summary is now spliced in apposition rather
  than after `to`, which is grammatical whatever voice it is written in.

  Found by grading a real skillfactory run with the new `eval` skill, and pinned by a
  generated regression case (`scripts/tests/generated/j-5-announce-grammar.test.mjs`)
  that was observed failing before the fix landed.

## [0.1.0] - 2026-08-01

### Added

- **First release.** skillfactory turns an idea into a finished skill: branded by press,
  wired into every registry, its CI caller verified by ghfactory, split into
  deterministic scripts and model judgment, and pinned against a run that
  actually happened.

- **The ladder, and the rung nothing else checks.** `skillfactory verify` reports rungs
  0–3: wiring resolves, house lints pass, the skill's own tests pass, and — the
  one that matters — *a real run is frozen as the baseline*. Rungs 0–2 mean the
  scaffolding is correct, which is not the same as the skill working.

- **Rung 3 is structural, not a promise.** The scaffolded `baseline.test.mjs`
  **fails** until `skillfactory freeze` runs, so `ci / <name>` cannot go green on a
  skill nobody has executed. Every other gate in this repo can be satisfied by a
  skill that has never been run once.

- **`skillfactory freeze` makes evals reproducible rather than decorative.** It records
  the command that produced a real run and generates a test that *re-runs it and
  byte-compares*, so the eval fails when behaviour changes — not merely when
  someone edits a fixture. It refuses a command that looks networked: a CI
  baseline that calls the network costs money and flakes.

- **Two-sidedness is enforced, not encouraged.** Without `--trap-command` the
  generated baseline test fails. A baseline that only asserts good-input-passes
  goes green the day someone weakens a checker — verified adversarially here:
  stubbing `validateSpec` to always return ok left the golden green and turned
  only the trap red.

- **`skillfactory check-spec` grades an intention, harder than CI grades a skill.** It
  rejects things every lint in this repo accepts: a description too thin to ever
  match a real request (`score_skill.py`'s floor is 20 characters, which is a
  skill that never triggers), a split with an empty half, an eval plan with no
  known-bad case. The last moment a bad answer costs nothing.

- **The ten-step checklist, applied all-or-nothing.** `skillfactory scaffold` writes the
  skill tree plus seven wiring points — marketplace entry, required-check
  context, two press targets, the caller workflow, the README table/install/
  symlink block, and the `CLAUDE.md` check list. An unresolvable anchor aborts
  before the first byte is written, because a half-applied wiring is worse than
  none: the half that landed makes the rest look done.

- **No SHA is ever remembered.** Generated callers pin the action SHAs this repo
  already trusts, read out of the callers it already ships. The caller generated
  for the demo spec cleared ghfactory's rungs 0–2 — 5/5 refs resolved and current,
  actionlint and zizmor clean.

- **The declared split.** `skill-invariants.json` gains a `split` block naming
  which steps are code and which are judgment, and `skillfactory verify` fails when a
  deterministic step names a command that does not exist — prose pretending to
  be code. Required of skills skillfactory creates; the nine that predate the contract
  are deliberately not retrofitted.

- **A conformance tier that is right about skills it did not make.** `verify`
  grades every skill in this repo against the house tier and all nine pass, which
  is the only reason to trust it about a new one. The stricter skillfactory tier is
  opt-in via the `skillfactory` block, so a shipped skill is never failed for a rule
  that landed after it.

- **Baseline eval set** — pinned against a real `scaffold` run of the `tally`
  demo spec against a fixture house (golden, re-run and byte-compared), a
  degraded spec that must be rejected (trap), and this repo's nine shipped skills
  as a conformance corpus with a floor of 9, so a resolver that matches nothing
  goes red instead of quiet.

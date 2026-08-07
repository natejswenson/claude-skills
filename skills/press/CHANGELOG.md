# Changelog

All notable changes to the **press** skill are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.9.0] - 2026-08-01

### Added

- **`readme-masthead` — the masthead a skill README wears.** Ten skills shipped
  ten different READMEs; three of them (`github-stats`, `press`, `shipflow`)
  carried no brand mark at all and were invisible to `press check`. The new
  emitter is `.mast` translated into markdown the same way `gha-header`
  translates it into workflow comments: stamp, brand line, document kind, the
  press version as the issue, byline, and the rule under it.

  Three deviations from `components.md`, each forced by the medium and each
  recorded in the emitter's own docstring: it sits *under* the H1 (a GitHub repo
  page has to open on its own name), the byline is not right-aligned (markdown
  offers no alignment short of a box, which laws §2 forbids), and the eyebrow is
  bold rather than mono (GitHub renders a code span as a rounded chip).

  The blank line before the closing `---` is load-bearing and has its own test:
  without it the entire eyebrow renders as a setext `<h2>` instead of a masthead
  over a rule, and nothing but a rendered page would show it.

- **`identity.name` is now a token.** The masthead needs the publication's name,
  and the alternative was repeating "Nate Swenson" in eleven target configs —
  the exact hand-copying this skill exists to end.

### Changed

- **The eleven skill READMEs moved from `version-badge` to `readme-masthead`,**
  with a uniform `^# <name>$` anchor. Previously three different anchors were in
  use and one (`city-report`'s bare `^# `) would have attached to any heading.
  `version-badge` is unchanged and still serves the product repos — `budget`,
  `local-fitness`, `natejswenson.io` — whose READMEs have their own titles.

## [0.8.1] - 2026-08-01

### Fixed

- **A version-only release no longer claims the brand values changed.** `propagate`
  compared each region's on-disk body against the *new* body, which is wrong for any
  emitter that writes the version into its own output — `version-badge` emits
  "PRESS v0.7.2 — …", so a pure version bump moved those bytes and the pull request
  was titled `BRAND VALUES CHANGED`.

  Observed on the 0.8.0 rollout: three of four consumers cried wolf for a release in
  which no token moved. Only `natejswenson`, the one target with no README badge, was
  labelled correctly. A title that is always loud is a title nobody reads, which
  defeats the entire point of having two of them.

  The question is now whether the bytes on disk are what *today's* tokens would emit
  **at the version the region records**. If they are, no value moved, whatever the
  version substitution did. A real values change arriving in the same release as a
  version bump is still flagged — that side is pinned by its own test.

- **`targets.json` named the budget consumer `budget`; the repo is `local-budget`.**
  Metadata only — selection is by file presence, so propagation still reached it — but
  the registry is meant to be the readable answer to "where does the brand live".

## [0.8.0] - 2026-08-01

### Added

- **A `yaml` comment syntax.** Regions can now be spliced into GitHub Actions
  workflow files. Byte-identical to `python` and deliberately a separate entry:
  a workflow declaring `syntax: "python"` reads as a mistake to the next person
  editing `targets.json`, and a YAML-specific quirk would have nowhere to live.
- **A `gha-header` emitter** — the masthead a generated workflow wears. The
  `.mast` component in the only medium a workflow has: heavy rule, stamp and
  tracked-caps eyebrow, right-aligned byline, hair rule, purpose, provenance.
  Rules rather than a box, per the component law. A long purpose wraps inside
  the rule; a long title moves the byline to its own line rather than clipping
  the one thing that line exists to show.

  Two decisions worth keeping: it **comments its own body**, because every other
  emitter returns code in the target's language and lets `renderRegion` comment
  only the two markers — emitting a masthead bare splices box-drawing into the
  document and yields YAML that cannot parse. And it carries **no verification
  claim**: a frozen `actionlint ✓` would be a statement about the file below the
  region, which the region's hash does not cover and a hand-edit invalidates.

## [0.7.2] - 2026-08-01

### Fixed

- **Propagation now retires its own superseded pull requests.** Each release
  opened a new PR pair per consumer without closing the previous one, so a repo
  that had not merged for two releases accumulated four stacked PRs — and the
  older pair failed *by construction*, because its pin predates the targets the
  newer release declares. Opening `press/brand-vX-<base>` now closes any older
  `press/brand-v*` PR against the same base, with an explanation.

## [0.7.1] - 2026-08-01

### Fixed

- **Declaring a new target broke every consumer's CI.** 0.7.0 added README
  targets for the external repos without seeding the regions, so the moment a
  consumer's pin reached 0.7.0 its `check` failed `missing`. `propagate` now
  **seeds** a region the consumer does not have yet, in the same pull request
  that raises the pin — the two are one change, not two. Only targets declaring
  an `init` anchor are seedable, so a deliberately deleted region is still
  reported rather than silently recreated.
- **`check` now enforces the recorded version, not just the values.** In-repo
  regions sat at `v0.1.0` through six releases with a green check, because only
  content was compared. One version per consumer means `check` has to say so.
- New `init.insertAfter` anchor, so a seeded README badge lands under the title
  instead of at the bottom of the file.

### Added

- Version badges for the in-repo skills' READMEs (`city-report`, `resume`,
  `ghostwriter`, `ghostwriter-x`, `devlog`), and `press` itself is now listed in
  the monorepo's root README skill table.
- `natejswenson` has no README target on purpose: its README is generated by
  `build_svg.py` and a region there would be clobbered on the next build.

## [0.7.0] - 2026-08-01

### Added

- **`version-badge` emitter** — a generated `press:version` line for a
  consumer's README. Until now a repo's press version appeared only in a CI pin
  and a comment marker, neither of which anyone reads when landing on the repo.
- Emitters now receive a small run context (`{ version }`), kept separate from
  target `params` because it is a property of the invocation, not the config.

### Changed

- **Propagation now covers every long-lived branch, not just `dev`.** Landing on
  the integration branch alone left `main` — the branch that actually ships —
  stale until someone remembered to promote, and made the next promotion carry
  an unrelated brand diff. Branch names are suffixed per base so the two pushes
  cannot collide.

### Fixed

- **Target selection could match the wrong repository.** Selection was by file
  presence alone, and `README.md` exists everywhere — so a README target
  selected inside *any* checkout and would have been compared against the wrong
  file. Selection now checks the checkout's own `origin` remote against the
  target's `github`/`repo`, falling back to presence only when there is no
  remote.
- Goldens pin the **shape** of each emitter's output using a fixed placeholder
  version. Using the real release would rewrite every golden on every release
  and turn a drift detector into noise.

## [0.6.1] - 2026-08-01

### Fixed

- **Every propagate push failed on missing git credentials, and the job still
  reported success.** `gh` authenticates its own API calls from `GH_TOKEN`, so
  cloning and PR listing worked, but a plain `git push` has no credential helper
  and fails with `could not read Username for 'https://github.com'`. All four
  consumers failed this way on the 0.6.0 release. `gh auth setup-git` now wires
  gh in as git's credential helper.
- **A failed fan-out now fails the job.** Failures were a warning, on the
  reasoning that the release had already happened and the weekly run would
  retry. That was wrong: a fan-out that silently does nothing is worse than one
  that never ran, because the green tick claims the brand reached everywhere
  when it reached nowhere.

## [0.6.0] - 2026-08-01

### Changed

- **A consumer's pin, its region receipt and the current release are now kept
  equal.** Previously propagation acted only when generated *values* moved, so
  a repo could show three different version numbers at once — natejswenson.io
  read pin 0.2.0, receipt 0.1.0, latest 0.5.1 — and there was no way to tell a
  healthy consumer from a stale one without knowing the rule. Every release now
  opens a PR in every consumer.

  What keeps that readable is that the PR says which kind it is: a **brand
  change** (`press vX — BRAND VALUES CHANGED`) is reviewed as a design change,
  while a **version-only adoption** (`adopt press vX`) is a one-line diff where
  nothing renders differently. `propagate --json` reports the two separately as
  `brand` and `stale`.

  The trade is deliberate: a few no-op pull requests per release, in exchange
  for state anyone can read at a glance.

## [0.5.1] - 2026-08-01

### Fixed

- **Propagation targeted the default branch, not the integration branch.** Every
  consumer runs `feature → dev → main`, so a PR opened straight into `main`
  would violate its own flow. Worse, the default branch can legitimately lag:
  the first real fan-out reported `budget` and `local-fitness` as *missing* only
  because their migration was still sitting on `dev`. It now checks out `dev`
  when the remote has one and falls back to the default branch otherwise.
- The clone was `--depth=1`, which cannot see other branches. Full clone now.

## [0.5.0] - 2026-08-01

The last hand-maintained copy of the brand is gone.

### Added

- **`python-consts` emitter** — flat module constants plus optional dicts, for a
  script that reads tokens as Python names rather than a theme dict. The profile
  README's SVG build has no override file to deep-merge and no stylesheet, so
  `python-theme` would be dead weight around four strings.
- **`font_files`** — the vendorable faces, for engines that EMBED a font file
  rather than resolving a CSS stack. Same type intent as `fonts.profiles`,
  expressed where a stack is not an option: SF is not licensable, so Inter
  stands in for the display voice and IBM Plex for serif and mono.

### Changed

- **Migrated `natejswenson/natejswenson`** (the GitHub profile README). Its
  header named `natejswenson.io/src/styles/global.css` as canonical without
  anything keeping it honest — the ninth copy, and the last one. Every value is
  byte-identical; the only content change is the comment header becoming a
  region marker.
- That repo had **no CI at all**, so it gains a workflow running its existing
  lint and 82 tests plus the brand check.

### On verifying that migration

Its SVG tiles embed subsetted WOFF2, and **font subsetting is not
byte-reproducible** — rebuilding the untouched repo produced different base64
payloads. A byte comparison would have failed constantly while proving nothing.
Parity was verified by stripping the font payloads and comparing everything
else: 7 of 7 SVGs and the generated README identical.

## [0.4.1] - 2026-08-01

### Fixed

- **The propagate workflow could never fire on a release.** It triggered on
  `push: tags: [press-v*]`, but the release tag is created by `_release.yml`
  using the repository's `GITHUB_TOKEN`, and GitHub does not start new workflow
  runs for events created with that token. The trigger looked correct and
  executed exactly zero times — confirmed on the 0.4.0 release, which tagged and
  published with no propagate run at all.

  The release path now calls the workflow directly (`workflow_call` from
  `press.yml`'s `propagate` job, `needs: release`), which runs in the same chain
  and is not subject to that restriction. The weekly schedule and manual
  dispatch were always unaffected.

## [0.4.0] - 2026-08-01

Closes the propagation gap: a pinned check can tell you a consumer is intact,
but never that it is *current*.

### Added

- **`press propagate`** — re-emits every region in a consumer's checkout, bumps
  any `@natjswenson/press@<version>` pin in its workflows, and reports what
  moved. `--dry-run` answers "is this repo behind?"; `--json` is what CI
  branches on.
- **`.github/workflows/press-propagate.yml`** — runs on every `press-v*` tag and
  weekly, opening a PR in each consumer repo whose bytes actually changed. The
  consumer list is derived from `targets.json` (with an optional `github` field
  where the remote name differs), so adding a consumer stays one declaration.
  Without `PRESS_PROPAGATE_TOKEN` it reports what it would do and exits clean,
  rather than failing a release over a missing credential.

### Why

Consumers pin an exact version on purpose — a mutable reference in a repo that
auto-deploys to production is a supply-chain hole. But a pinned check passes
forever against the version it was pinned to: `natejswenson.io` sat **two
releases behind with entirely green CI**. Integrity and freshness are different
questions, and only the first was being answered.

So freshness is pushed from the source of truth rather than polled by each
consumer. Two rules keep it honest:

- **Content decides, not the version receipt.** A region written by 0.1.0 that
  is still byte-correct today is current; opening a PR for it would be noise.
- **A stale pin alone is not "behind".** It changes no shipped artifact, so it
  is bumped quietly and never triggers a PR by itself.

### Fixed

- `changed` was derived by matching `/updated$/` against a status string, which
  silently missed `"would update"` — so `--dry-run` reported "nothing to do"
  while displaying a changed region. It is a boolean now, and a test pins that.

## [0.3.0] - 2026-08-01

Font stacks become per-engine profiles. Migrating `local-fitness` measured a real
regression the previous single-stack model would have shipped.

### Added

- **`fonts.profiles`** — the brand's type *intent* is one thing; the fallback
  chain that achieves it depends on the rendering engine. Targets pick one with
  `params.font_profile`; omitting it uses `fonts.default_profile` (`browser`), so
  every existing consumer is byte-for-byte unchanged.
  - **`browser`** — Chromium/WebKit. `-apple-system` resolves to SF and the
    fallbacks are never reached, so depth is free.
  - **`fontconfig`** — WeasyPrint and anything else walking the chain for real.
    Deliberately shallower: every extra face is one that can *win*.
- An unknown `font_profile` is an error, never a silent fall back to the default.

### Fixed

- **The union stack visibly broke WeasyPrint output.** `local-fitness` renders
  through WeasyPrint, which resolves none of the `ui-*` / `-apple-system`
  keywords and walks the chain for real. The browser-tuned list put `Inter` and
  `'Helvetica Neue'` ahead of `Arial`, and headlines resolved to
  **Helvetica Neue Heavy Condensed** — measured with `pdffonts`, not assumed.
  Under the `fontconfig` profile it renders `Arial-Bold` / `Georgia-Bold` /
  `Menlo-Bold`, exactly as it always has.

### Changed

- **Migrated `budget` and `local-fitness`.** budget renders through headless
  Chrome, where the widened stacks are provably inert: identical embedded faces
  and byte-identical rendered pages. local-fitness takes the `fontconfig`
  profile and its emitted theme changed **zero values**. Suites stay green
  (894 and 2063 tests).

## [0.2.0] - 2026-08-01

Everything `natejswenson.io` needed to adopt the brand without changing by a
single pixel. Surveying the site turned up four values the token set could not
express, so it could not have been migrated without either losing them or
hand-writing them locally — which is the failure mode press exists to end.

### Added

- **Alpha tints as first-class derived tokens** — `border`, `border_hover` and
  `accent_dim`, computed from `ink` and `accent` so no consumer writes an
  `rgba()` by hand.

### Changed

- **`mono_stack` gained `'JetBrains Mono'`.** The site's stack was one fallback
  deeper than the token set's; emitting the shorter one would have silently
  removed a face. Fallbacks are additive, so the union is canonical — the same
  call made for the résumé's stacks in 0.1.0. Purely additive for every existing
  consumer.

### Known inconsistency, kept deliberately

`hair` (0.18) and `border` (0.16) are the same idea at two different strengths —
the résumé's hairline and the site's. They are recorded as separate tokens rather
than reconciled, because reconciling them would change one of two shipped
products. That is a decision to make on purpose, not a side effect of adopting
press. Documented in `tokens.json` under `derived.$comment`.

## [0.1.0] - 2026-07-31

First release. Replaces eight hand-ported copies of the PRESS brand with one
source of truth and a CI drift gate.

### Added

- **`brand/tokens.json`** — the only place a brand value is written down:
  colours, the terminal panel palette, font stacks, identity defaults, and the
  limits the lint enforces.
- **Four contract documents** the brand is more than colours:
  `laws.md` (the accent law, structure, the three voices, the tracking ceiling),
  `components.md` (the shared component vocabulary), `agent-ui.md` (how a run
  should read in the chat transcript), `voice-core.md` (the copy rules that
  hold for every artifact).
- **Marked-region splicing** — press owns a marked block inside an otherwise
  hand-written file, so a consumer keeps its stylesheet, its poster geometry and
  its personal footer. The start marker carries a version + content-hash
  receipt.
- **Five emitters** — `python-theme` (token dict plus the shared deep-merge
  loader), `css-vars` (with per-consumer name aliases), `md-palette`,
  `markdown-block`, `json`.
- **`press check`** — the drift gate. Fails on drifted bytes, on a region that
  has gone missing, and on a run that resolved zero targets.
- **`press lint`** — mechanical brand law: off-palette hexes, the tracking
  ceiling, emoji-presentation glyphs, shadows, gradients, radii, and an optional
  accent cap. Waivable per line or per file.
- **`press emit --init`** — first-time migration, swallowing the hand-written
  block it takes over rather than leaving a duplicate behind.
- **`press doctor`** and **`press tokens`**.
- **Baseline eval** pinned to a real past state: every brand value as it existed
  in eight files across four repos before press generated any of them, plus
  byte-exact goldens per target. Two-sided, with anti-vacuity floors.

### Changed

- **Migrated five in-repo consumers** to generated regions — `city-report`,
  `resume`, `ghostwriter`, `ghostwriter-x`, `devlog`. Every value is unchanged
  and each skill's own suite stays green (222, 13 files, 352, 432 and 255 tests
  respectively).
- **Font stacks widened to the union of every consumer's.** The résumé's
  print-tuned stacks were the deepest; fallbacks are additive, so the richest
  chain became the canonical one and every other consumer gained it.
- **The `.term` rules in both card sets now reference variables** instead of
  five hardcoded hexes.

### Fixed

- **Three genuinely-shared token groups were undeclared anywhere** and are now
  in `tokens.json`: `ink_faint` (`#8A8272`), the terminal panel palette
  (`#141A26`, `#EFE9DC`, `#8A8478`, `#FF8A5C`, `#1E2738` — hardcoded in three
  files), and two paper steps the site was carrying alone (`#ECE5D6`,
  `#E4DCCA`).
- **The tracking ceiling was over-strict.** It exists to protect PDF text
  extraction, so it binds on documents a machine reads back and not on
  rasterised cards, whose eyebrow legitimately runs at `.16em`. Scoped rather
  than waived, and caught by linting the real shipped corpus.

[0.7.2]: https://github.com/natejswenson/claude-skills/releases/tag/press-v0.7.2
[0.7.1]: https://github.com/natejswenson/claude-skills/releases/tag/press-v0.7.1
[0.7.0]: https://github.com/natejswenson/claude-skills/releases/tag/press-v0.7.0
[0.6.1]: https://github.com/natejswenson/claude-skills/releases/tag/press-v0.6.1
[0.6.0]: https://github.com/natejswenson/claude-skills/releases/tag/press-v0.6.0
[0.5.1]: https://github.com/natejswenson/claude-skills/releases/tag/press-v0.5.1
[0.5.0]: https://github.com/natejswenson/claude-skills/releases/tag/press-v0.5.0
[0.4.1]: https://github.com/natejswenson/claude-skills/releases/tag/press-v0.4.1
[0.4.0]: https://github.com/natejswenson/claude-skills/releases/tag/press-v0.4.0
[0.3.0]: https://github.com/natejswenson/claude-skills/releases/tag/press-v0.3.0
[0.2.0]: https://github.com/natejswenson/claude-skills/releases/tag/press-v0.2.0
[0.1.0]: https://github.com/natejswenson/claude-skills/releases/tag/press-v0.1.0

# Changelog

All notable changes to the **press** skill are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.4.0]: https://github.com/natejswenson/claude-skills/releases/tag/press-v0.4.0
[0.3.0]: https://github.com/natejswenson/claude-skills/releases/tag/press-v0.3.0
[0.2.0]: https://github.com/natejswenson/claude-skills/releases/tag/press-v0.2.0
[0.1.0]: https://github.com/natejswenson/claude-skills/releases/tag/press-v0.1.0

# Changelog

All notable changes to the **skillhelp** skill are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-08

### Added

- First release. A knowledge base for every skill in this repo, answering setup,
  usage, commands, architecture and troubleshooting questions out of an index
  extracted from the skills' own files.
- `build` writes one card per skill with five fixed sections, every fact carrying
  the `file:line` it was read from. A section with no source stays empty and is
  reported, never padded.
- `check` re-extracts and byte-compares against the committed cards, failing on
  `would-change`, `missing`, `incomplete`, `ungrounded` or `orphaned`. Drift is
  measured on the **rendered card**, not the skill's file tree, so an edit that
  changes no answer reddens nothing.
- `ask` returns matched fact lines inline with their sources — one command, no
  file reads — and prints a `NOT DOCUMENTED` block naming what was searched when
  nothing clears the floor.
- `list` gives the catalogue for the browse case.
- `ci / skillhelp` is filtered on `skills/**` rather than this skill's own
  directory: the cards describe the other skills, so any of them changing is
  what makes the index stale. Filtered the usual way, the gate would go green on
  exactly the PR that caused the drift.
- Secrets are refused out of markdown, which is indexed verbatim; source files
  are never indexed verbatim at all, only mined for identifiers.
- Baseline: a real build over a frozen snapshot of six real skills, byte-compared
  card for card, plus a drift trap that must exit non-zero and twelve guards
  covering the grounding floor, the secret refusal and index hygiene.

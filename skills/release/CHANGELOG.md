# Changelog

All notable changes to the **release** skill are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-08-03

### Added

- **`preflight`'s table gains an `On dev` column**, printed immediately after
  `On main`. `On main` and `On dev` disagreeing is the fact that `release-cut`
  used to act on silently — cutting whatever untagged bump sat on main even
  when dev already carried the version actually meant to ship (issue #173).
  The column puts that fact in the table the operator reads, next to
  shipflow's new `dev-ahead-of-main` blocker, which already flows through the
  existing blocker column unchanged.

### Changed

- **`MIN_SHIPFLOW` raised `0.4.0` → `0.6.0`.** shipflow 0.6.0 is where `cut`
  refuses to dispatch a release when dev is ahead of main instead of guessing;
  an older shipflow returns a status that looks identical and silently lacks
  that refusal, which is the exact failure this bump closes off rather than
  merely reports.

### Fixed

- **A `skill-invariants.json` rationale overclaimed what its own fixtures
  cover.** `frozen-inputs-still-span-the-shapes` said its three fixtures span
  "the grouper and the state machine"; no assertion in this skill reads
  `state`, and all three fixtures are `state: "clean"`. Corrected to name only
  the grouper — the state machine is pinned separately, by shipflow's own
  `tests/release.test.mjs`.

## [0.1.0] - 2026-08-02

### Added

- **"release devlog" now means something.** Reads the commits on main since the
  component's last tag, proposes a semver bump with its reason, drafts the
  CHANGELOG entry, and — after one approval — drives the whole path and reports
  the tag URL. The mechanical end of releasing already worked here; everything
  upstream of it was manual, and that is where the friction and every past
  mistake lived.

- **`preflight` with no `--component` answers "what's unreleased?"** in one
  table: every component's state, the version on main, its last tag, how many
  commits are unreleased and what blocks it.

- **`changelog-draft` groups the unreleased commits into Keep-a-Changelog
  sections**, and refuses to emit a draft that lost one. A grouper that silently
  drops a commit still produces a plausible, complete-looking entry — the
  failure nobody would ever notice — so it counts what it placed rather than
  trusting itself, and an unrecognised or non-conventional commit lands in
  `Uncategorised` rather than vanishing.

- **The collateral list, spoken before the irreversible step.** A `dev → main`
  promotion is one merge of the whole branch and cannot be made selective, so
  releasing one component releases every other one sitting bumped-but-untagged.
  Those tags, GitHub Releases and npm publishes do not come back, so the list is
  named to the user and the approval covers all of it — not just the component
  that was typed.

### Notes

- **Every mutating step is `shipflow` ≥ 0.4.0's**, not this skill's. `release.js`
  resolves the binary, gates its version, and shapes its JSON into tables; it
  reimplements nothing. Two tools answering "how do I release this?" differently
  is worse than either answer.
- **A release is reported only when the tag is read back from origin.** A
  dispatched workflow exits 0 for a run that fails a minute later, a promotion
  can merge while the release job errors, and `_release.yml` no-ops on a tag that
  already exists — so a "successful" retry can have corrected nothing. That is
  not a theoretical list: it is how `city-report-v0.4.0` shipped with stale
  notes, and why this skill's one rule is what it is.

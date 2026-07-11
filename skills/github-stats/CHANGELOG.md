# Changelog

All notable changes to the github-stats skill are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2026-07-11

### Fixed
- The skill was not discoverable when installed via the Claude Code plugin marketplace
  (Claude Desktop's plugin UI showed no skills). `SKILL.md` now lives at the plugin's
  documented `skills/github-stats/SKILL.md` auto-discovery path instead of the plugin root.

## [0.1.0] - 2026-06-09

### Added
- Initial release. Converts the `github-stats-cli` Python app into a Claude skill.
- `scripts/gh-stats.sh` — deterministic `gh` + `jq` core that computes the five
  profile metrics (commits, followers, stars, pull requests, issues) and renders
  the summary table, plus a repo browser (`repos`) and repo detail (`repo`) view.
  Metric definitions mirror the original `github_stats/metrics/*.py`.
- `SKILL.md` (lean, progressive disclosure) + `reference/commands.md` (full
  command catalog, including a confirmation-gated repository-creation flow).
- `tests/` — network-free unit tests of the `compute_*` aggregation logic via
  JSON fixtures, plus a live smoke test that auto-skips without `gh` auth.
- `eval/` — numeric-parity harness that compares the skill's output against the
  original CLI's metric classes across a fixed set of public usernames.

# Changelog

All notable changes to the **issueflow** skill are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-02

### Added

- First release. Takes one open GitHub issue to a pull request through four
  gated stages — investigate and design on `opus`, implement and test on
  `sonnet` — each run as its own subagent, each writing one artifact, and none
  starting until the previous artifact has been approved.
- **The gate is code, not guidance.** `blockers()` orders every step, and
  `accept` refuses four distinct ways a stage can look done without being done:
  an unapproved predecessor, an empty artifact, an artifact missing the sections
  the next stage needs, and a `test` stage with no recorded command output.
  `ship` refuses to open a pull request over any unapproved step and names every
  one it found.
- **A skipped stage is never a pass.** `accept --skip "<reason>"` records the
  hole and requires a reason; `ship` keeps refusing and reports it as skipped.
- **Dispatch prompts are rendered, never improvised.** `brief` builds each
  stage's prompt from the run state and the approved artifacts and writes it to
  disk, so what crosses into a cold subagent is reviewable — and byte-compared
  by the baseline eval.
- **Automatic decomposition into stacked pull requests.** When the design stage
  reports work items, `split` gives each its own lane, branch, implement/test
  pair and pull request, with the bottom lane on the base branch and every layer
  above targeting the lane below it. Shared stages are never duplicated.
- **The target repo's branch policy is read, not assumed** — from its own
  `.github/shipflow.json` when present, and otherwise from the repo's actual
  default branch.
- Baseline eval pinned against a real run against `natejswenson/local-fitness#133`,
  re-run and byte-compared offline; a two-sided trap that drives a run whose only
  defect is a missing approval; and a four-stage contract corpus with an
  anti-vacuity floor.

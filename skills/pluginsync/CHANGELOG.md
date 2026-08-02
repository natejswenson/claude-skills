# Changelog

All notable changes to the **pluginsync** skill are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-02

### Added

- First release. `pluginsync check` reports one row per marketplace plugin —
  installed version, available version, and an action (`ok`, `update`,
  `install`, `orphan`, `disabled`, `error`). `pluginsync apply` installs and
  updates the drifted rows.
- **`apply` re-reads every version off disk after writing it.** `claude plugin
  update` exits 0 and prints nothing when it no-ops, so a row whose version did
  not move is reported as `stalled`, never as success. Exit code is non-zero for
  `stalled` as well as `failed`.
- Every report separates *available* from *on disk* from *live*, and closes by
  naming the restart — the previous version is what runs until Claude Code is
  restarted, however clean the table looked.
- Shadow detection: a stale `~/.claude/skills/<name>/SKILL.md` silently wins over
  the installed plugin, and no version number anywhere reveals it.
- An unreadable plugin source becomes an `error` row and a non-zero exit, never
  a dropped row inside "everything matches".
- Handles both real shapes of `claude plugin list --json` (a bare array, and
  `{installed}` from `--available`); a third shape throws rather than reading as
  an empty install list.
- Baseline eval pinned against a real run: this machine's actual installed set
  against this repo's actual plugin versions, byte-compared, with a two-sided
  trap and a live-repo corpus floor of 11.

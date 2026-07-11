---
ticket: "n/a"
title: "devlog: release-focused entries + voice-driven publishing"
date: "2026-06-18"
source: "design"
---

# devlog → release-focused + voice-driven publishing

## Problem

`/devlog` currently generates one entry **per day** from `git log --since=midnight`
filtered to the user's authored commits, in a generic "senior engineer standup" tone.

Two changes:
1. **Focus on version releases**, not days. An entry should correspond to a shipped
   release (a semver tag), summarizing what changed in that version.
2. **Publish in the user's voice**, reusing the voice-profile approach ghostwriter
   uses — but configurable, since devlog is a shared skill other users install.

## Decisions (from design dialogue)

- **Release source = git tags (semver).** Fully replaces daily-commit mode. The repo
  already tags per-project (`devlog-v0.2.0`, `ghostwriter-v0.3.0`).
- **Voice = configurable `voicePath` with a fallback chain**:
  `config.voicePath` → `~/.claude/skills/ghostwriter/voice` → devlog's bundled template.
  Reads `voice-profile.md` (+ `voice-notes.md` override). Ignores `algorithm.md`
  (LinkedIn reach tuning does not apply to a dev log).

## Behavior

### Release detection
- Per project, optional `tagPrefix` (default `v`). Tags matched with
  `git tag --list '<tagPrefix>*'`. Monorepo projects set `devlog-v`, `ghostwriter-v`.
- **Version label** = the matched tag from its first `v<digit>` onward
  (`devlog-v0.2.0` → `v0.2.0`, `v1.4.0` → `v1.4.0`). **Only FINAL releases are entried:** the
  label must match `^v[0-9]+(\.[0-9]+)*$` (`v` + digits/dots only). Prerelease tags (`-`, e.g.
  `v1.0.0-rc.1`) and build-metadata tags (`+`, e.g. `v1.0.0+build`) are **skipped**, not
  entried, and never used as a range base — this keeps written filenames within the React
  validator's charset and avoids prerelease-vs-final mis-ordering under `--sort=-v:refname`.
- A tag is **new** (needs an entry) if `<project.key>/<version>.md` does not exist in
  the target repo. Existing version files are skipped — a cut release is immutable.
  (This drops the per-day "Update — HH:MM" append mode.)
- **Commit range** = `<prevTag>..<thisTag>`, where `prevTag` is the next **semver
  release tag** strictly below `<thisTag>` when the project's release tags are sorted
  descending (`git tag --sort=-v:refname`). Non-semver prefix-matched tags (e.g.
  `version-bump`) are ignored when computing the range base, exactly as they are skipped
  for entry creation. For the earliest release tag, range is all commits reachable from
  the tag. Scoped by `pathFilter` when present.
- **Author filter dropped** for the release narrative: a release summarizes *all*
  commits in the range (scoped by `pathFilter`), regardless of committer. `gitAuthor`
  is retained only for backward-compat and is not currently used in entry generation.
- **Entry date** = the tag's commit date (`git log -1 --format=%cs '<tag>^{commit}'`),
  not the run date.

### Data grain
- File: `<project.key>/<version>.md` (e.g. `devlog/v0.2.0.md`). The final-release version-label
  gate (`^v[0-9]+(\.[0-9]+)*$`) restricts `<version>` to `v` + digits/dots, so the filename matches
  the React example's manifest validator `^[a-zA-Z0-9._-]+\.md$` (and the `version` field
  matches `^[a-zA-Z0-9._-]+$`) **by construction** — a `+`/`-`-bearing label can never reach a
  written entry.
- Frontmatter gains `version`. Manifest entry: `{ date, file, title, summary, version }`.
- Sections: voice-driven "What Shipped" narrative + "What's Next" + "Commits" (public
  links). Tone comes from the resolved voice profile, not a hardcoded instruction.

### Voice resolution (at publish time, in SKILL.md)
1. If `config.voicePath` set → expand `~`, require an existing directory.
2. Else if `~/.claude/skills/ghostwriter/voice` exists → use it.
3. Else → devlog's bundled `voice/` (installed next to SKILL.md).
- Read `voice-profile.md`; if `voice-notes.md` exists in the same dir, it overrides.
- **Never** read `algorithm.md`. Apply tone/rhythm/vocabulary/never-do only — the dev
  log is not LinkedIn (no 210-char hook, no saves optimization).
- Voice files are the user's own local content → trusted (unlike fetched remote
  entries, which remain data-not-instructions).

## Security

| Field | Rule |
|---|---|
| `voicePath` (optional, top-level) | string, no shell-quote-break chars, expand `~`, no leading dash; existence is resolved at runtime via the fallback chain (Step 2), not enforced at write time. Read via the Read tool only — never shell-interpolated. |
| `projects[].tagPrefix` (optional) | `^[a-zA-Z0-9][a-zA-Z0-9._/-]*$`, no `..`. Single-quoted into `git tag --list '<tagPrefix>*'`. |

CLI `validateConfig` enforces both at write time; SKILL.md re-enforces at runtime
(user can hand-edit `config.json`).

## Files

1. `SKILL.md` — rewrite for the release flow + voice resolution.
2. `bin/devlog.js` — `validateConfig` + `VALIDATORS` + prompts for `voicePath` /
   `tagPrefix`; install bundled `voice/` template into `~/.claude/skills/devlog/`;
   show the new fields in `config`.
3. `voice/voice-profile.example.md` + `voice/voice-notes.example.md` — bundled fallback.
4. `config.example.json` — show `voicePath` + `tagPrefix`.
5. `README.md` — reframe daily → release; document the new fields.
6. `examples/react/useDevLogEntries.js` — additive `version` (allowlist + manifest).
7. `CHANGELOG.md` + `package.json` → `0.3.0` (note the behavior change).

## Invariants

- Re-running `/devlog` after no new tags produces **no** new entries (idempotent).
- A version file is written exactly once; never overwritten by a later run.
- `algorithm.md` is never read by devlog.
- Every interpolated value (config **and** tag-derived: `<thisTag>`, `<prevTag>`,
  `<version>`) is validated AND single-quoted in shell.

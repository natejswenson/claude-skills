# Changelog

All notable changes to `@natjswenson/devlog` are documented here.

## Unreleased

**Fixed**
- The ghostwriter voice-fallback path (`GHOSTWRITER_VOICE_DIR` / Step 2 of voice resolution) now
  points at `~/.claude/ghostwriter/voice`, matching ghostwriter's new shared home-directory
  location (previously `~/.claude/skills/ghostwriter/voice`, which was never ghostwriter's real
  install path). devlog's own config location (`~/.claude/skills/devlog/config.json`) is
  unchanged.

## 0.4.1 (2026-07-11) — plugin marketplace discovery fix

**Fixed**
- The skill was not discoverable when installed via the Claude Code plugin marketplace
  (Claude Desktop's plugin UI showed no skills). `SKILL.md` now lives at the plugin's
  documented `skills/devlog/SKILL.md` auto-discovery path instead of the plugin root.

## 0.4.0 (2026-06-28) — researched, end-to-end implementation-guide posts

**Changed**
- `/devlog` now writes each release entry as a researched, cited, end-to-end
  implementation guide rather than a narrative summary of what shipped. Step 6
  derives the engineering topic(s) the work touched, researches them against
  reputable outside sources (cited inline and in a `## Sources` section), and
  writes a setup → build → use → verify walkthrough with multiple
  copy-paste-reusable, language-tagged code blocks that together form a complete,
  runnable whole (right-sized: roughly 3-6 essential blocks for a substantive
  feature, fewer for a small change, never padded). A short `## Shipped` hook
  still opens the post and `## Changelog` still closes it. Updated the skill
  description and the Step 6 / 6a-6c guidance accordingly.

**Added**
- `deepDive` config block: `topicDomains` (default: AI, DevOps/SRE, software
  engineering) and `minSources` (default 2) to steer topic selection and the
  citation floor. Repo-agnostic; user-supplied values live in `config.json`.

## 0.3.1 (2026-06-20) — fetch tags before discovering releases

**Fixed**
- `/devlog` now runs a best-effort `git fetch --tags --quiet` per project at the
  start of release discovery (Step 3), before listing tags. Releases are
  commonly cut by CI on the remote (a version-driven GitHub Release on green
  `main`/`master`), so the tag is born on the remote; a local clone that hadn't
  fetched would list only stale local tags and silently report "no new release"
  for a release that was already live. The fetch is best-effort: on failure
  (offline, no remote, auth prompt) it notes the failure and proceeds on local
  tags rather than aborting. `--tags` takes no untrusted input and `project.path`
  is validated + single-quoted per Step 0.5.

## 0.3.0 (2026-06-18) — release-focused entries, written in your voice

**Changed (behavior)**
- `/devlog` now generates one entry **per version release** (a semver git tag) instead of
  one entry per day. An entry summarizes the commits in a release's tag range
  (`<prevTag>..<thisTag>`), scoped by `pathFilter` when present. The run is **idempotent**:
  a release's entry is written once and never overwritten, and re-running produces nothing
  until a new tag is cut. The per-day "Update — HH:MM" append mode is removed.
- Entries are keyed by version: `<project-key>/<version>.md` (e.g. `v0.2.0.md`), with a
  `version` field added to the frontmatter and to each `manifest.json` entry. Entry sections
  are now **What Shipped / What's Next / Commits**. The entry `date` is the tag's commit date.

**Added**
- **Voice-driven publishing.** Entries are written in the user's voice using a voice profile
  resolved in this order: `config.voicePath` → `~/.claude/skills/ghostwriter/voice` (if
  installed) → a bundled fallback at `~/.claude/skills/devlog/voice/`. devlog reads
  `voice-profile.md` and `voice-notes.md` (overrides) — and never `algorithm.md`, since
  LinkedIn reach tuning does not apply to a dev log.
- `voicePath` (top-level, optional) and `projects[].tagPrefix` (optional, default `v`) config
  fields, with security validation in both `bin/devlog.js` and SKILL.md. `tagPrefix` lets each
  project in a monorepo detect its own releases (e.g. `devlog-v`, `ghostwriter-v`).
- `init` prompts for the voice directory and release tag prefix, and installs the bundled
  voice template. `config` shows the voice path and each project's tag pattern.
- The React example carries the optional `version` field through frontmatter parsing and
  manifest validation.

**Migration note:** existing per-day `YYYY-MM-DD.md` entries are left untouched; new entries
are per-release. To detect a monorepo project's releases, set its `tagPrefix`.

## 0.2.0 (2026-06-08) — monorepo subdirectory filtering

**Added**
- `projects[].pathFilter` config field: scope a project's commits to a repo-relative
  subdirectory (e.g. `skills/devlog`). Lets several logical projects share one monorepo
  `path`/`remote` while each collects only its own subtree's commits. `git log` gains a
  `-- <pathFilter>` pathspec; commit links still resolve to `<remote>/commit/<hash>`.
- SKILL.md documents the field, its security validation (no leading `-`/`/`, no `..`,
  single-quoted), and the multi-skill monorepo workflow.
- `bin/devlog.js` validates `pathFilter` and shows it as `scope:` in `devlog config`.

## 0.1.9 (2026-06-05) — accessibility fix

**Accessibility**
- The drop-in React component (`examples/react/DevLogPage.jsx`) now exposes the expand/collapse entries as a proper disclosure control. Previously they were mouse-only — a bare `onClick` on `<article>` with no `role`, `tabIndex`, `aria-expanded`, or keyboard handler, so keyboard and screen-reader users could not operate the feed.
  - The header carries `role="button"`, `tabIndex={0}`, `aria-expanded`, and `aria-controls` for screen-reader toggle semantics.
  - `Enter`/`Space` toggle the focused entry (`preventDefault` on Space stops page scroll).
  - `:focus-visible` outline makes keyboard focus visible.
  - The toggle moved from the whole card to the header, so links inside an expanded entry are no longer nested in an interactive ancestor and text selection in the body works normally.
- Visuals are unchanged: padding/hover/cursor moved from `.devlog-entry` to `.devlog-header`, with the redundant content padding zeroed so spacing matches.

## 0.1.8 (2026-05-01) — final hardening pass

Closes the four Low-Hardening findings from the second adversarial verification:

- **L-1:** `validateConfig` now bounds `projects[].label` length (≤200 chars) and rejects control characters. Label apostrophes/quotes/etc are intentionally allowed since label is React text content only — never shell-interpolated. The validator includes an explicit invariant comment to keep this guarantee load-bearing.
- **L-2:** `atomicWriteJSON` uses `wx` (exclusive create) flag, preventing symlink-attack scenarios on shared filesystems where another local user could pre-create the tmp file.
- **L-3:** `atomicWriteJSON` tmp filename now also includes `Date.now()` for additional uniqueness across rapid sequential calls.
- **L-4:** SKILL.md Step 5 explicitly instructs the LLM to treat fetched dev-log content as data, not instructions — defense against indirect prompt injection from hostile dev-log markdown.

Verification: a second 6-perspective adversarial agent against HEAD reports zero Critical/High/Medium-Active vulnerabilities remain.

## 0.1.7 (2026-05-01) — security hardening + UX improvements

**Security**
- Tightened `SHELL_METACHARS` to additionally reject whitespace, single-quote, square brackets, equals, and percent
- Project paths now cannot start with `-` (would be parsed as flag)
- Added strict validation of the `branch` field (no leading dash, no `..` as a path component)
- Atomic `config.json` writes (write-to-tmp + rename)
- CLI no longer forwards arbitrary `VITE_*` env vars to the spawned vite — only `VITE_DEVLOG_*` plus `PATH`/`HOME`/etc.
- Added `Content-Security-Policy` meta tag to the preview app
- Explicit `urlTransform` in `react-markdown` rejects `data:`, `blob:`, `javascript:`, `vbscript:`, `file:`, and any non-http(s)/mailto scheme
- `react-markdown` invoked with `skipHtml` for explicit defense-in-depth
- `SKILL.md` instructs the LLM to single-quote every interpolated config value (defense-in-depth on top of validation)
- Production preview builds without env vars show a clear "Setup required" screen instead of attempting demo fetches that would 404
- `config.json` written with mode `0600`, `~/.claude/skills/devlog/` created with mode `0700`
- Pinned all dependencies to exact versions (no `^` ranges) to eliminate resolution drift

**UX**
- `init` now loops to register multiple projects in a single setup
- New `add-project` subcommand: `npx @natjswenson/devlog add-project` — register a project without editing config.json by hand
- New `config` subcommand: `npx @natjswenson/devlog config` — view current config with validation status
- Init detects when `gh` is authenticated as a different user than `githubUser` and warns
- Better next-step messaging after init (color, concrete commands)
- All error messages now include actionable hints (`log.hint`)

**Docs**
- New `SECURITY.md` — threat model, audit history, ruled-out attack scenarios, vulnerability reporting flow
- New `CHANGELOG.md` (this file)
- README updated with new subcommands and security guarantees section

## 0.1.6 (2026-05-01) — initial security audit fixes

Addressed 1 Critical + 3 High findings from the first round of the 6-agent siege:
- SKILL.md now requires runtime allowlist validation of every config value before shell interpolation
- CLI switched from `execSync` with template strings to `spawnSync` with argv arrays for any user-input-bearing call
- `gh repo create` regex hardened against leading-dash flag injection
- `gitAuthor` validator now rejects shell metachars
- Schema validation added for `manifest.json`, `VITE_DEVLOG_PROJECTS`, frontmatter (allowlist + `Object.create(null)`)
- `optimizeDeps` includes for vite to fix react-markdown / react-dom CJS interop in npx layouts
- Preview vite server bound to localhost only, CORS disabled

## 0.1.5 (2026-05-01)

- Corrected live-site URL in README (`natejswenson.com` not `.io`)

## 0.1.4 (2026-05-01)

- README troubleshooting section, npm + license badges
- SKILL.md uses `<config.branch || 'main'>` consistently in push/URL output

## 0.1.3 (2026-05-01)

- Expanded `optimizeDeps.include` to cover react/react-dom for npx-installed layouts

## 0.1.2 (2026-05-01)

- First `optimizeDeps` fix for `style-to-js` CJS/ESM interop (react-markdown rendering)

## 0.1.1 (2026-05-01)

- `projects[].label` and `branch` config fields (optional, with safe defaults)

## 0.1.0 (2026-05-01)

- Initial release
- CLI: `init`, `preview`
- React drop-in components: `DevLogPage`, `useDevLogEntries`
- Standalone deployable Vite preview app with snarky demo mode

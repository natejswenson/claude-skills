# Changelog

All notable changes to `@natjswenson/devlog` are documented here.

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

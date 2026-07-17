# Changelog

All notable changes to `@natjswenson/devlog` are documented here.

## 0.9.0 (2026-07-17) — cover images: icon catalog + geometry-enforced hero zone

**Added**
- `image-style/icons.md`: a 20-icon catalog (agents/LLM, testing, CI/CD, git,
  accessibility, debugging, CLI, config, deploy, database, API, search, auth,
  monitoring, cover/image tooling, performance, parsing, caching, UI, networking) —
  real inline SVG, stroke-only, for the optional kicker-area accent glyph only. Never
  the hero illustration itself. Installed by `devlog init` alongside the existing
  style guide/font.
- A fixed hero-zone bounding box (`x:150 y:425 width:1300 height:400`) and 25px
  coordinate grid, documented in `image-style/style-guide.example.md`, with two named
  composition slots: single centered hero, and two-node before/after.
- `lib/render_cover.mjs` now mechanically enforces the hero zone via a new
  `checkHeroZoneOverlap()` check, run immediately before the screenshot: throws if
  `#hero-zone` is missing, duplicated, positioned/sized outside a 2px tolerance of the
  fixed box, or if any catalog icon's rendered rect overlaps it. This replaces a
  prose-only safeguard (a regex checking one sentence still exists in `SKILL.md`) with
  a real pixel-geometry check against actual rendered layout — a sibling investigation
  found the prose-only check could never catch an agent composing two catalog icons
  connected by a line and calling that the hero. `renderCoverImage()`'s documented
  throw contract widens from three failure modes to four accordingly.
- `devlog backfill-covers list` gains an `--all` flag: lists every manifest entry
  regardless of cover status (the default stays missing-cover-only). Needed because
  the ~51 real entries in a typical `daily-dev-log` already have covers from a prior
  batch — without `--all`, there is nothing to iterate over for a cover-quality
  backfill.
- `cover-context`'s underlying `loadStyleGuide()` now also returns the icon catalog
  content (`iconCatalog`, `null` if `icons.md` isn't installed) alongside the style
  guide text — no new CLI flag, just a widened response.

**Changed**
- `skill-invariants.json` gains a `code` array (alongside the existing `prose` array)
  for guardrails checked against arbitrary source files, not just `SKILL.md` — first
  entry: `cover-catalog-hero-overlap-guard`, asserting the new geometry check stays
  wired into `render_cover.mjs`.

## 0.8.1 (2026-07-16) — cover images: illustration over typography

**Changed**
- Rewrote the bundled cover style guide (`image-style/style-guide.example.md`) after the
  first real batch of covers shipped bland and repetitive: a shared text-heavy layout
  with a rotating stock shape (circle/square/slash). The guide now mandates ONE custom
  inline-SVG illustration per post depicting the specific mechanism the release is about
  — sized as the dominant visual element — with the title demoted to a secondary line.
  Explicitly forbids reusing the same shape family/motif across posts and falling back to
  a generic circle/square/checkmark when stuck.
- `SKILL.md` Step 5's compose sub-step now states this mandate inline (not just "compose
  using the style guide") so the failure mode can't silently regress even if the
  installed style guide is later replaced with something weaker.
- New `skill-invariants.json` entry (`cover-custom-illustration`) guards the "cover that
  just re-renders the title in large text is a failure" line in `SKILL.md`.

## 0.8.0 (2026-07-16) — cover images

**Added**
- Every post now gets an auto-generated 1600x900 cover image. Claude composes a
  self-contained HTML/CSS (or inline SVG) document from the post's title/tags/summary/
  `## Shipped` text plus an installed style guide and up to 3 reference images of
  recently published covers — then `devlog render-cover` rasterizes it locally via
  headless Chromium (`playwright`), embeds a bundled font, and quantizes the PNG. No
  external API, no credentials, nothing ever leaves the machine.
- New `SKILL.md` Step 5 sub-steps: `devlog cover-context` (style guide + references) →
  Claude composes the markup → `devlog render-cover` → `publish-entry --cover`. A cover
  render failure (timeout, Chromium not installed, missing font) never blocks publish —
  the post ships with no cover, the same graceful degradation as any other failure.
- New commands for backfilling covers onto already-published posts: `devlog
  backfill-covers list` (deterministic, cross-project, oldest-first, extracts only
  `## Shipped`) drives an agent loop of `cover-context` + compose + `render-cover` into a
  project-namespaced staging directory, reviewed via a contact sheet, then `devlog
  commit-covers` publishes the approved set (with `--force` for re-covering).
- `devlog init` now installs the bundled style guide + font (`image-style/`) and checks
  Chromium/font reachability, mirroring its existing SKILL.md/voice-profile install
  pattern.
- `publishEntry()` gains an optional `coverImageBuffer` param; new
  `addCoverToExistingEntry()` in `lib/publish_entry.mjs` for the backfill path.

## 0.7.0 (2026-07-15) — private projects

**Added**
- New `private` project flag (`add-project --private`, or the interactive "Is this repo
  private?" prompt). A private project's `remote` becomes optional, and `scanProject`'s
  `isPublic` check now short-circuits to `false` unconditionally for it — regardless of
  whether `remote` matches `origin` and the commit is on the published branch. Previously
  those two checks alone decided "public," which is a proxy for "the commit is reachable
  from a correctly-configured remote," not "the GitHub repo is public." A project with a
  real, correctly configured `remote` that happens to live in a private GitHub repo would
  have scanned every commit as public and generated dead `github.com/.../commit/...` links
  in the post. `private` is a declared type, not auto-detected via the GitHub API — no
  extra network call per run, and it stays correct even for a project with no push target
  at all.
- `config`'s project listing shows `(private — no commit links)` instead of a broken
  `remote: github.com/undefined` line for a private project with no `remote` set.

**Fixed**
- `validateConfig` previously required every project to have a valid `remote`
  unconditionally; a private project can now omit it (still validated for shape if
  supplied anyway).

## 0.6.0 (2026-07-12) — lessons from rewriting the whole back-catalog

Every pre-0.5 entry (38 posts across devlog, ghostwriter, resume, local-fitness) was
rewritten against the 0.5.0 how-to contract, and each rewrite's friction fed a skill
refinement. What changed:

**Added (lint)**
- New `sources-inline` rule: every URL in `## Sources` must also be cited inline in the
  body — the contract required it, nothing enforced it, and it was the easiest step to
  silently skip. The finding suggests drop-the-source as an alternative fix so the rule
  can't push citation stuffing. Fixtures updated to comply.

**Changed (SKILL.md writing contract)**
- Topics must pass a usability test: prefer the transferable technique a reader could
  apply to their own project, with a tie-break rule for releases spanning several
  topics; cross-project (monorepo) commits belong to one post's story only.
- New contract point 8, **fun to follow**: early runnable win, momentum between steps,
  payoff visible at each stage — never forced jokes or hype.
- Reader-side verification must be REAL when cheap: run the blocks, paste actual output
  (trim/normalize only with disclosure); new **assemble-and-run** self-check step
  executes the post's own code blocks in order, catching phantom symbols and ordering
  traps mechanically. Revised functions must be shown as complete redefinitions.
- Facts anchor at the tag (`git show '<tag>:<file>'`), teaching code may generalize;
  when a commit message and its diff disagree, the diff wins.
- Gotcha mining follows the release's code FORWARD in history — a later fix to code
  this release introduced is prime material when dated honestly.
- Research: quotes require verbatim re-verification (fetch tools can return
  quote-shaped summaries that aren't on the page).
- Punctuation scope settled: voice rules govern prose; the Sources template separator
  and verbatim commit subjects keep their punctuation. Titles are sentence case.
- Template flexibility: only Shipped/Gotchas/Sources are mandatory sections; output
  blocks fence as `text`; the 900-1600 word target counts prose only.

## 0.5.2 (2026-07-11) — fix: same-date manifest entries buried the newest post

**Fixed**
- `publish-entry` sorted the manifest by date only; several releases cut on the same
  day kept insertion order, so the feed rendered them oldest-version-on-top and the
  newest post landed at the bottom of the day's group (hit live with
  v0.4.2/v0.5.0/v0.5.1, all dated 2026-07-11). Same-date ties now break by version,
  highest first, with numeric component comparison (v0.10.0 > v0.9.0). Date still wins
  overall so a backported tag sorts by its release date. Legacy rows without a
  `version` keep their relative order.

## 0.5.1 (2026-07-11) — fix: npx invocations were a silent no-op

**Fixed**
- Every `npx @natjswenson/devlog <cmd>` invocation exited 0 with no output (present
  since the import-side-effect guard was added, so ≤0.5.0). npm/npx expose the binary
  as a `node_modules/.bin/devlog` **symlink**; `process.argv[1]` is the symlink while
  `import.meta.url` resolves to the real file, so the naive `===` in the `isMain` guard
  never matched and the dispatcher never ran. Both sides are now `realpathSync`'d. A
  regression test invokes the CLI through a symlink exactly like npx does. Running
  `node bin/devlog.js` directly was always unaffected — which is why the test suite
  and local verification missed it.

## 0.5.0 (2026-07-11) — how-to posts with gotchas, deterministic core, agent-native config

**Changed (posts)**
- Every post is now held to an explicit **how-to contract**: the stranger test (a reader
  without the author's repo can build the technique from the post alone), complete code
  (no phantom fixtures — every referenced symbol is defined or explicitly stubbed),
  reader-side verification (commands the reader runs, with expected output), a required
  `## Gotchas` section (trap → symptom → escape, mined from real history: fix-after-feat
  commits, reverts, CHANGELOG "Fixed" entries — never invented), honest scope, and no
  leaked repo-specific artifacts. Generate mode runs a mandatory self-check (lint +
  rubric review, max 2 revision passes) before publishing autonomously.
- `deepDive.minSources` default raised 2 → 3, and sources must be **distinct** URLs.

**Changed (architecture)**
- Release discovery, post linting, entry publication, and manifest updates moved from
  ~20 hand-rolled SKILL.md bash steps into tested CLI subcommands (`scan`, `lint-post`,
  `publish-entry`) backed by new `lib/` modules. Tag names and semver/range logic no
  longer pass through the LLM's shell at all (spawnSync argv only), entry existence is
  one GitHub API call per project instead of one per tag, and the
  never-overwrite-a-published-entry guard is now code-enforced in `publish-entry`.
- SKILL.md restructured around three modes — Configure / Status / Generate — and the
  generate flow prints the release plan up front before any research starts.

**Added**
- Agent-native configuration: `add-project --yes` (non-interactive, auto-detects
  key/remote), `remove-project <key> --yes`, `set <field> <value>` (targetRepo, branch,
  gitAuthor, githubUser, voicePath, deepDive.minSources, deepDive.topicDomains), and
  `config --json`. `/devlog` now handles "add this repo", "stop tracking X", "set min
  sources to 4", and `/devlog status` conversationally.
- `deepDive` config validation (minSources integer 1-10, topicDomains non-empty strings).
- Deterministic test suites for the new core (fixture git repos for scan; manifest
  ordering incl. backported tags; overwrite refusal; config ops) plus a skill-contract
  suite (`skill-invariants.json`) that pins SKILL.md's prose guardrails, its CLI surface,
  and package.json↔CHANGELOG version agreement.
- Cost-capped eval harness under `evals/` for the non-deterministic half: a $0
  deterministic layer (lint-post) plus an LLM judge scoring reproducibility, code
  completeness, gotcha quality, citations, voice, and scope honesty against golden
  fixtures. Mock mode runs in CI for free; live runs are hard-capped (default $0.50) and
  refuse to start over budget.

## 0.4.2 (2026-07-10) — ghostwriter voice-fallback path fix

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

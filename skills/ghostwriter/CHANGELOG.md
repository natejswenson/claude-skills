# Changelog

All notable changes to the linkedin-ghostwriter skill are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.14.0] - 2026-07-18

A conversational-UX pass on the non-deterministic layer (SKILL.md only — no script changes).
Goal: a `/ghostwriter` session with the fewest possible round trips and the most legible
in-chat surfaces Claude Code offers.

### Added
- **One dialog to start** — when the outcome check-in is due AND the idea menu is being offered,
  they share a single `AskUserQuestion` call (two questions, one dialog) instead of two
  sequential question dialogs. Guarded by new prose invariant `one-dialog-start`.
- **Four-section menu dialog — the picker IS the board.** The idea menu is now a single
  `AskUserQuestion` call with one question per lane (headers `Trending` / `Radar` / `Interests`
  / `Projects`), each lane offering up to 3 previewed ideas + a Pass option — 8–12 ideas
  visible in one dialog instead of a 4-item shortlist. Lanes: **Trending now** (a run-day live
  search over the interests file's trending areas — social/discussion surfaces, Google/news,
  industry conversation — each topic tied to an angle the user could own), **Release radar
  current through TODAY** (digest items plus a live top-up for anything released since the
  digest date, labeled `radar · <date>` vs `live · today`), **Interests & hot takes** (strong
  opinions + story bank, filtered against what's already published), and **2–3 recent Claude
  projects** (was 1). Chat intro stays to one provenance line per lane; when the outcome
  check-in is due it takes the first question slot and Interests folds into Trending for the
  day (the call caps at 4 questions).
- **Preview panes on the idea menu** — every menu option now carries an `AskUserQuestion`
  `preview` (≤ ~9 lines so the pane never clips): the working hook line (the post's first ~2
  lines as they'd read), the suggested angle, and a source-freshness line
  (`radar · Jul 17 · anthropic.com`).
- **Preview sketches on the visual-form question** — each step-8 option shows an ASCII sketch of
  what THIS post would get: the proposed Press composition as labeled blocks, the carousel slide
  strip with real slide titles, or the text-only above-the-fold lines. Sketches are text, not
  builds; `visual-pick-before-build` unchanged.
- **LinkedIn-true draft view** — every draft is shown with a visible
  `┄┄┄ …see more (fold ~210 chars) ┄┄┄` marker at the line break nearest char 210, plus a
  `N words · save: <what the reader keeps> · lane: <lane>` metadata line. Re-shows after an edit
  lead with `Changed: <one-line summary>` so the user never re-reads the post hunting for the
  edit. Guarded by new prose invariant `fold-marked-draft-show`.
- **Tappable publish decision** — the post-draft ask is now an `AskUserQuestion`
  (Publish / Edit / Scrap; "Other" takes typed edit instructions directly) instead of a prose
  question. Approval semantics unchanged: the tap follows a full display of the exact draft text.
- **Source-gate narration** — step 6 emits one short status line per claim as it resolves and a
  one-line close (`3 claims · 5 distinct hosts · gate passed`) instead of going silent through
  the slowest step of the flow.

### Fixed
- **Idea menu asked for more options than the tool allows** — SKILL.md said "aim for ~5–6
  options," but `AskUserQuestion` hard-caps a question at 4 options (+ the automatic "Other").
  The menu now specifies exactly 4 rich options (2 radar how-tos, 1 personal-project,
  1 interests/hot-take, with backfill from the radar lane when a lane has nothing real).

## [0.13.0] - 2026-07-18

A real session (drafting the "hardass running coach" post) burned ~9 review rounds because the
terminal card was invented instead of transcribed: the user had to say "make it look like my
ACTUAL agent," paste a screenshot, and hand-feed real numbers row by row. 0.13.0 makes real
output the raw material, not the correction.

### Added
- **Real-output cards (the fidelity contract)** — new SKILL.md section: any card showing the
  user's own agent/CLI/code (hero `term`, `code`, `claude`) must be a *transcription of a real
  session*. Capture first (run the user's CLI/MCP tool yourself, or take their paste/screenshot),
  save the raw capture to `images/<slug>.source.txt`, author as condensation (cut whole rows,
  never smooth texture into prose), print `—` for missing values or ask for ONE real number —
  never invent, especially health/personal metrics. Guarded by a new prose invariant
  (`real-output-transcription`).
- **Mirror check** — when the user supplied a reference screenshot/paste, every render is
  self-compared against it (missing prompt/tool-call lines, missing table columns, invented
  phrasing, dead whitespace) and fixed *before* the user sees it. "Closer" from the user is
  defined as the failure mode.
- **`term-misaligned` lint (FAIL)** — box-drawing table rows inside `.term` must share one
  character width, judged per table (a contiguous run of box rows), so two tables in one
  terminal may differ. Matches `.tl` rows regardless of attribute or class order. Run against
  the session's hand-approved published card, it caught a real 1-char border misalignment
  that 9 rounds of eyeballing missed. Plus `term-rows` / `term-width` WARNs enforcing the
  new hero budget.
- **Secrets scrub on transcription** — captures are gitignored and stay local, but the card
  is published: tokens, keys, emails, home paths, and private hostnames are redacted or
  generalized in the card even when the raw capture keeps them.
- **Hero-terminal budget** — `.term` now has two modes in `assets/card-language.md` and the
  SKILL.md budget table: accent (≤10 rows × 42 chars, unchanged) and hero (≤20 rows × 56
  chars, up to ~⅔ of the card). The published card that finally satisfied the user was 18
  rows × 56 chars — the old budget outlawed the card the user actually wanted.
- **"The hero terminal" section in `assets/card-language.md`** — the anatomy of a believable
  session: highlighted `.tl.prompt` row, verbatim tool-call indicator line, box-drawing table
  with real metrics/baselines/deltas, one `.hot` verdict, closing directive.
- **Hook + save pre-show checks** — the step-7 self-check now verifies the post's most
  specific number/tension sits in the first ~210 chars and that the post has a nameable
  save-worthy artifact (or is deliberately a personal post), tightening the reach loop.

### Changed
- **Step 8 asks ONE question, including output provenance** — when the post is about the
  user's own agent, the single visual question also settles where the real output comes from
  (live capture / paste-screenshot / compose from draft facts). No second round-trip.
- **`.term` CSS upgraded in `diagram.css.example`** — ported the battle-tested block the
  session hand-tuned into the personal brand file: dark navy panel (`#141A26`), tighter row
  gap, and the `.tl.prompt` full-bleed highlighted command bar. The shipped example and the
  personal file no longer diverge on the terminal look.
- The capture's 1–2 strongest real numbers now feed the post body too (re-running the source
  gate if that adds an external claim) — real specifics are what get posts saved and shared.

## [0.12.0] - 2026-07-18

Graphics were the user's stated engagement bottleneck: every card shipped the same light-SaaS
skeleton, anonymous at feed distance. 0.12.0 replaces template-filling with a real brand.

### Added
- **The PRESS design system** — an editorial-poster brand (warm paper, huge black type, serif
  standfirst, one loud signature accent, heavy ink rules, giant numerals, an issue-numbered
  masthead + personal monogram stamp). Chosen by the user from three rendered candidate
  directions expressing the same real post. New section in `assets/diagram.css.example`;
  personalized per user via `--press-sig` (signature color) and `--stamp` (monogram).
- **Composable card language** — new `assets/card-language.md`: 11 body components (ledger,
  duel, pull quote, big stat, facts strip, tiles, terminal, bars, standfirst, marginal,
  command bar), composition rules, per-component budgets, and five **variation axes**. Cards
  are now *composed* per post, not filled into one of 13 fixed templates.
- **Anti-sameness contract** — each approved card's composition fingerprint is appended to
  `images/card-history.jsonl`; the next card must differ from the last 3 on ≥2 variation axes.
- **`assets/card-template-press.html`** — one annotated example composition (auto-covered by
  the template test contract and the render lint's placeholder catches).
- **Press carousel skin** — add `press` to each slide; cover/point/recap/cta adapt to paper +
  ink rules automatically.

### Changed
- SKILL.md Visuals flow is composition-first; the 13 light-system templates are demoted to a
  **legacy reference gallery** (still shipped, tested, and renderable).

## [0.11.0] - 2026-07-17

Driven by mining every past invocation transcript: the three recurring failure classes were a
silently-dead research job, zero performance feedback, and in-session corrections that didn't stick.

### Added
- **`scripts/install_radar.sh`** — renders the release-radar launchd plist from the repo's
  *resolved current* path and retires stale agents. The radar died silently twice when the repo
  moved (launchd kept firing the old absolute path, exit 127); repair is now a one-liner, and
  SKILL.md offers it when the log shows the job failing.
- **Publish log** — every successful publish appends `{date, urn, url, slug, format, chars,
  first_line, lane}` to `~/.claude/ghostwriter/published.jsonl` (new `--lane` flag on
  `linkedin_post.py`). Previously nothing persisted — not even that a post shipped.
- **Outcome feedback loop** — new `scripts/post_outcome.py` records a self-reported
  great/normal/flopped per post; Generate opens with a max-one-question check-in and biases
  topic/format choices with the accumulated outcomes. This is the only LinkedIn-ToS-compliant
  performance signal (no member analytics API; scraping banned).
- **Discussion radar** — the research prompt now also surfaces 1–2 source-backed debates in the
  user's opinion/career lanes, which previously had no research feed.
- **Radar freshness surfacing** — Generate states digest provenance up front, labels every menu
  idea with its source + date, and falls back to live search (saying so) when the digest is >4
  days old.
- Five new Tier-1 prose invariants pin the new guardrails (voice-feedback persistence, outcome
  loop, ending self-check, visual pick-before-build).

### Changed
- **Voice feedback persists immediately** — any in-session style correction is appended to
  `voice-notes.md` in the same turn, *before* redrafting (a real session lost the same
  correction twice).
- **Pre-show self-check** — endings (the #1 flagged AI tell), fabrication, length, and banned
  tics are verified before the user ever sees a draft.
- **Visual form is settled with ONE question** before anything renders (text-only / card /
  carousel, recommendation first, informed by outcome history) — replaces the offer-build-pivot
  flow that wasted a full card render.
- **Length rule reconciled** — SKILL.md now states the voice-notes 50–120-word default wins;
  algorithm.md's ~900–1,500-char range applies only when a post genuinely needs the room.
- Radar budget raised to $1.00 (two healthy runs died at the $0.50 cap) and the research prompt
  gained a hard fetch-to-confirm gate: an item whose primary source wasn't retrieved this run
  does not go in the digest, and nothing future-dated ever does.

### Added — graphics quality overhaul
An 11-agent render-matrix audit of all 13 card templates at sparse/typical/stress content
volumes found 40 first-render defects (21 severe: dead-space voids, clipped bands, ellipsized
command chips, wrapped eyebrows, default template icons shipping). Fixes:
- **`scripts/card_lint.py`** — render-time quality gate. Static layer catches template default
  icons, surviving `ICONS:` comments, placeholder copy, and carousel page-counter drift; DOM
  layer (Playwright) measures clip-overflow, fired ellipses, eyebrow/headline wrap counts,
  dead bands >180px, per-template count budgets, and chip truncation. Runs automatically inside
  `render_image.py` (WARN/FAIL to stderr; `--strict` makes FAILs fatal, `--no-lint` skips).
- **Count-adaptive CSS variants** across the family (generalizing the `n3` pattern via `:has()`)
  so sparse cards scale up to fill the frame instead of floating in whitespace; overflow-wrap
  and spacing fixes for the stress cases; caption/terminal anchoring fixes (flow, howto-check,
  code).
- **Content-budget contract in SKILL.md** — a per-template table of step/row counts and
  max chars per field (derived from the actual CSS geometry and mirrored by the lint), a
  mandatory read-the-PNG-as-art-director-before-showing step, a never-ship-default-icons rule,
  and voice rules extended to card copy.
- Every template header now carries its CONTENT BUDGET block; `render_image.py` defaults to
  the correct 1200×1500 portrait size.

### Tested
- `record_publish` / `post_outcome` covered end-to-end (append on real publish, nothing on
  dry-run, outcome round-trip, unscored-latest selection); an autouse fixture isolates the real
  `published.jsonl` from test runs. Suite remains at 100% coverage.
- `card_lint` fully covered (`tests/test_card_lint.py`); a fresh-eyes agent authoring a card
  cold from the updated docs produced a first render with zero art-director findings.

## [0.10.0] - 2026-07-11

### Added
- **New how-to card family — four on-brand single-image layouts to rotate** so how-to posts never
  look the same twice: `howto` (numbered spine with icon + command chips), `howto-grid` (2×2
  numbered tiles), `howto-check` (a saveable green checklist), and `howto-stack` (editorial
  big-number rows). All share the light design system (eyebrow + byline, headline, lead, optional
  gotcha band, outcome caption) and a monospace command chip for the real flag/config. Templates in
  `assets/card-template-howto*.html` + `.card.howto*.light` blocks in `diagram.css`. The family is
  the default visual for a how-to post; carousels stay available for longer step-by-step content.
- **Topic → icon cheat-sheet** in `assets/card-icons.md` — an intent-to-glyph lookup so authoring
  a card's icons is a quick reference rather than scanning the full catalog.
- **Card-type chooser table** at the top of SKILL.md → Visuals — pick the right template at a
  glance instead of reading every card description.

### Tested
- **Deterministic:** `tests/test_card_templates.py` statically verifies every card template's
  CSS classes resolve in `diagram.css.example`, every card type has a `#canvas` sizing rule, and
  the how-to family stays in sync across templates / CSS / SKILL.md (catches missing-selector and
  unregistered-variant defects that were previously only caught by eyeballing a render).
- **Non-deterministic:** a new `howto-release-still-sources` eval scenario asserts a release
  how-to still enforces the mandatory source gate (sidecar + `verify_sources.py`).

### Changed
- **Blank-start topic selection is now one rich menu.** When no topic is given, Generate presents a
  single `AskUserQuestion` of ~5–6 concrete, ready-to-write ideas — led by recent-AI-release
  how-tos from the radar digest, plus a personal-project and an interests pick — instead of the
  two-tier pick-a-lane-then-drill flow. The tapped idea is the anchor; no second drill.
- **Added a How-to posts playbook** to Generate (implication → steps → gotcha → outcome; real
  technical meat with an accessible entry; the source gate is mandatory and how-to ≠ "I did this").

## [0.9.0] - 2026-07-10

### Changed
- **Personal data (voice profile, brand guide, LinkedIn `.env`) now lives at
  `~/.claude/ghostwriter/`** instead of inside the skill's own repo/plugin directory. Claude Code
  and Claude Desktop both read this same home-directory location regardless of which installed
  copy of the skill is running (dev checkout vs. marketplace plugin), so voice/brand/credentials
  no longer need separate setup per product or per install. `voice/algorithm.md` stays bundled in
  the repo (shipped, identical content, not personal).

## [0.8.1] - 2026-07-11

### Fixed
- The skill was not discoverable when installed via the Claude Code plugin marketplace
  (Claude Desktop's plugin UI showed no skills). `SKILL.md` now lives at the plugin's
  documented `skills/ghostwriter/SKILL.md` auto-discovery path instead of the plugin root.

## [0.8.0] - 2026-06-30

### Changed
- **Card/diagram visuals redesigned into a modern light system.** Every designed card (and Mermaid
  diagrams) moved off the flat dark "quote poster" look to a light canvas with layered white
  panels, a dark callout band, real line icons, and a restrained type hierarchy — the crisp,
  high-end feel of a modern docs card. All card types are now **portrait 4:5 (1200×1500)** and
  share one rhythm: eyebrow + byline → restrained headline → a **lead** paragraph → the **topic
  graphic** that fills the body → an anchored **footer caption**. Migrated: brief (new flagship
  explainer), flow, matrix, ramp, STEM, date/ticket, code, Claude-session, carousel, and the
  Mermaid theme. The code/Claude terminals stay dark as elevated surfaces floating on the light
  canvas (the docs-site pattern).

### Added
- **`assets/card-template-brief.html` — the default light "explainer" card**: headline + lead, an
  explainer `.panel` (before/after `.concept`), a dark thesis `.band`, and an icon `.statrow`.
- **Light design-system foundation in `diagram.css`(.example)**: a `.light` modifier with light
  tokens plus reusable primitives — `.lead`, `.panel`/`.panel-label`, `.band`, `.concept`,
  `.statrow`/`.scol`, `.caption` — and icon-chip helpers (`.tint-*` / `.s-*`).
- **`assets/card-icons.md` — a curated paste-ready line-icon catalog** (Lucide, MIT) grouped by
  topic, so glyphs fit each post instead of generic shapes.
- **Premium matrix scorecard**: solid colour header pills, contained value tiles, and a `.best`
  marker that highlights the winning cell per row for an instant verdict.

### Design principles (enforced in the templates + SKILL.md)
- **Topic graphic is the hero (~3/4); any type-motif is a small accent** (e.g. the STEM blocks
  shrank to a header accent over a real topic graphic).
- **Icons must fit the post** — template icons are examples flagged with `ICONS: …` REPLACE-ME
  comments; pick topic glyphs from `card-icons.md` and never ship the defaults.

## [0.7.0] - 2026-06-28

### Added
- **Source-verification gate — every external-claim post must be generated from ≥3 real, live
  sources, enforced in code at publish time, with zero sources in the post body.** Each draft gets a
  gitignored sidecar `drafts/<slug>.sources.json` pairing every external/world claim to its source
  URL(s). New `scripts/verify_sources.py` (stdlib-only, importable + CLI) checks each URL's liveness
  (browser UA, HEAD then ranged-GET fallback; 401/403/405 count as live since CDNs bot-wall HEAD)
  and requires **≥3 distinct live hosts** (normalized by hostname). `scripts/linkedin_post.py` now
  runs the gate on every real publish — after the dry-run/author checks and **before any media
  upload** — and refuses unless it passes; a bare `--text`/stdin publish is refused by design. The
  gate is **fail-closed**; the only bypass is the human-only `--allow-unverified` flag.
- **Pure first-person posts** declare `{"external_claims": false}` in the sidecar and pass the gate
  trivially — they make no outside-world claim and are covered by the existing authenticity bar.
- **Three-tier regression evals** so future features can't silently break existing behavior.
  *Tier 1* (`tests/test_skill_contract.py` + `skill-invariants.json`): a deterministic, offline,
  $0 CI guard asserting the load-bearing SKILL.md guardrails still exist (approval-before-publish,
  the source gate, never-fabricate, ToS §3.1, sources-out-of-body, human-only bypass, flow order)
  plus repo consistency (referenced scripts/templates exist, version↔CHANGELOG match). *Tier 2*
  (`evals/run_eval.py` + `scenarios.json`): on-demand behavioral scenarios via `claude -p` that
  grade the agent's tool-use intent (refuses w/o approval, runs the gate, declines auto-posting),
  with no real LinkedIn creds. *Tier 3* (`evals/voice_judge.py`): deterministic AI-tell checks +
  an LLM voice-fidelity score. Shared `evals/budget.py` enforces a pre-call hard cap + spend
  estimate + `--mock` mode; CI runs the harness only in mock at $0 (live API call sites are
  `# pragma: no cover`). Design: `docs/plans/2026-06-28-ghostwriter-evals-design.md`.

### Changed
- **SKILL.md Generate mode gains a "Research & fact-check" step** (after Save, before Show): list
  external claims, research each from primary/authoritative sources and read the source to confirm
  it supports the claim, write the sidecar, and run `verify_sources.py` until green. Sources stay in
  the sidecar, never in the post body; re-run when a post-approval edit adds a claim. Guardrails now
  reference the source contract and mark `--allow-unverified` as human-only.

### Notes
- The code gate is **liveness proof-of-work** (evidence the research happened), not a factuality
  checker — whether a source supports its claim, and the personal/external boundary, stay
  prompt-enforced by the research step. This is deliberate and documented.

## [0.6.0] - 2026-06-25

### Changed
- **Generate entry point is now an idea menu, not an interview.** The flow opens by
  *proposing* concrete, already-grounded ideas instead of interrogating the user. A
  two-tier `AskUserQuestion` menu: pick a lane (**Radar** / **Personal project** /
  **Interests-hot-take**), then pick a specific anchor (a radar item, a recently-shipped
  local repo, or an evergreen angle). The pick *is* the post's real anchor, so the old
  generic 2–3-question grounding interview is gone — at most one sharp follow-up remains
  for the personal-project lane. A named topic or "from item N in the radar" still
  short-circuits straight to drafting. (SKILL.md → Mode: Generate.)
- **Release radar broadened beyond Anthropic to the whole AI industry.** The twice-weekly
  research prompt now scans Tier 1 (Anthropic) *and* Tier 2 (OpenAI, Google/DeepMind/Vertex,
  AWS AI & agents, agent/LLMOps tooling), keeping the ops/agent-builder relevance filter and
  the primary-source / anti-hype rule. Each digest item notes its vendor.
  (`scripts/release_radar_prompt.md`.)

### Added
- **`scripts/recent_projects.py`** — discovers local repos that recently had Claude Code
  sessions, powering the "personal project" idea lane. Reads the authoritative `cwd` /
  `gitBranch` out of each session's jsonl (the `~/.claude/projects` slug is ambiguous),
  dedupes by real path, skips temp dirs, and adds each repo's last commit. Human list by
  default, `--json` / `--limit` flags. Pure stdlib, read-only.

## [0.5.0] - 2026-06-24

### Added
- **Matrix card type** (`assets/card-template-matrix.html`) — a comparison card: a
  labeled grid that compares a few options (columns) across the same attributes
  (rows). Header cells (`.col-h`) carry a column accent (`.green`/`.grey`/`.pink`);
  value cells are `.v` for a big mono number or `.vt` for a short plain-English
  phrase; one or more `.switch` rows act as labeled group dividers. The
  `.card.matrix` styling ships in `assets/diagram.css.example`, and the type is
  documented in SKILL.md's template list. Keep it to ≤4 columns / ≤7 rows and
  translate insider units into plain words so the card reads cold.

## [0.4.0] - 2026-06-22

### Added
- **`code` card type** — share a snippet as a terminal coding session: a macOS-style window
  (traffic-light dots + filename), `bat`-style line-number gutter, theme-colored syntax tokens
  (`.t-kw/.t-fn/.t-str/.t-num/.t-com`, retheme via `--t-*`), one focal `.line.hot`, and a solid
  accent caret. `assets/card-template-code.html`. Syntax is hand-authored token spans so the
  card render path stays deterministic and JS-free.
- **`claude` card type** — a Claude Code *session* variant of the code card: a transcript
  (request → action bullets → `└` result branches) in Anthropic's clay accent, for
  "shipped with Claude Code" posts. `assets/card-template-claude.html`.

### Changed
- **Carousel rebuilt as the showstopper**, grounded in current LinkedIn document-post research.
  Switched from 1200×1200 square to **portrait 4:5 (1200×1500)** to own the mobile feed
  (`scripts/render_carousel.py` renders + stitches the PDF at the new ratio). New slide system:
  a cover that contrasts with content, numbered `.point` slides, a new `.recap` framework slide,
  and a `.cta` that ends on ONE action. A persistent progress bar + `NN/TOTAL` counter + byline
  on every slide; the bar fills from per-slide `--i/--n` custom props. One-accent (60/30/10)
  discipline throughout.
- **Redesigned the whole card family into one clean, minimal, professional language:** date →
  realistic ADMIT-ONE ticket; flow → numbered vertical spine; ramp → a real analytics chart
  (gridlines, axis baseline, SVG trend line, growth-delta pill); general hero → grid-aligned
  mapping rows with accent key-markers; stem → calmed onto the dark family base (dropped the
  confetti + saturated gradient, kept the chunky toy-block S T E M motif). Bylines ride inline
  in a crop-safe `.toprow` across the family.

## [0.3.0] - 2026-06-09

### Added
- **Carousel support** — the highest-reach native LinkedIn format, end-to-end:
  `assets/card-template-carousel.html` (cover → numbered `.point` slides → a `.cta` with a
  "Save this" prompt) + `.card.slide` styles; `scripts/render_carousel.py`, which screenshots
  each slide to preview PNGs and stitches them into one PDF; and a `--document`/`--title`
  flag on `scripts/linkedin_post.py` that posts the PDF as a document via `/rest/documents`.
- `voice/algorithm.md` — a sourced, evidence-based LinkedIn reach playbook (Richard van der
  Blom *Algorithm InSights*, Sprout Social, AuthoredUp, Hootsuite; current as of 2026). It is
  read on every draft alongside the voice files and **never overrides `voice-notes.md`**.
- New `flow` card type (`assets/card-template-flow.html` + `.card.flow` styles) — a clean,
  linear architecture/pipeline diagram with a crop-safe top byline. Documented in SKILL.md;
  preferred over Mermaid for architecture posts.

### Changed
- SKILL.md now bakes reach optimization into generation and publishing: hook in the first
  ~210 characters, length ~900–1,500 chars, optimize for **saves** over likes, no external
  links in the post body (use the first comment), 0–3 specific hashtags, and a format-by-reach
  ranking (document/carousel > image > text) so a single decorative card is no longer the
  default. Publish mode now prompts the **golden-hour** routine (reply to comments + engage
  5+ posts in the first 60 minutes), the biggest lever for low reach. Reconciled with
  voice-notes: chase saves and genuine discussion, never CTA bait.

## [0.2.0] - 2026-06-08

### Added
- `assets/card-template-stem.html` — a **STEM card type** for STEM / education /
  outreach posts: deliberately playful (a chunky toy-block S T E M motif, confetti
  accents, a rounded hero headline) so it reads as kid-energy rather than buttoned-up.
- `.card.stem` styles in `assets/diagram.css.example`, and a SKILL.md reference
  documenting when to reach for the STEM card under Visuals.

## [0.1.0] - 2026-06-08

### Added
- `assets/card-template-ramp.html` — a **ramp card type** for accelerating
  progressions: three ascending steps with the last highlighted. Bars are
  illustrative (not to scale); the labeled figures carry the truth.
- `.card.ramp` styles in `assets/diagram.css.example`, and a SKILL.md reference
  documenting when to reach for the ramp card under Visuals.

## [0.0.1] - 2026-06-06

First versioned release. Makes the skill follow its own advice: a skill is code,
so it gets scored, tested, and versioned.

### Added
- `scripts/score_skill.py` — eval that scores `SKILL.md` against grounded pass/fail
  checks (frontmatter, the three modes, the never-publish-without-approval guardrail,
  compliance rule, voice inputs) and exits non-zero on failure so CI can gate on it.
- `tests/` — pytest suite covering all five Python scripts at 100% line coverage,
  with `pyproject.toml` enforcing `--cov-fail-under=100`.
- `.github/workflows/ci.yml` — runs shellcheck, the test suite at 100% coverage,
  and the SKILL.md scorer on every push and PR to `main`.
- `requirements-dev.txt` — dev/test dependencies (the runtime scripts remain
  standard-library only).
- `version: 0.0.1` field in the `SKILL.md` frontmatter.

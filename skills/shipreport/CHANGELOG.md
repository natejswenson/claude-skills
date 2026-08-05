# Changelog

All notable changes to the **shipreport** skill are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-08-05

Measured against the first real run — session `cd77fae8`, 5m18s end to end — and
fixing what that run showed. The report it produced was correct and the one rule
held (13 claims, 15 receipts, 0 unresolved), but replaying the transcript found
four defects the run worked around rather than hit.

### Fixed

- **The ranking did not rank.** Twelve items scored *exactly* 70 —
  `release+50 minor+10 corroborated+10` and nothing else — so the cut between the
  twelfth and the thirteenth was drawn by a timestamp, not by score. Every session
  in the same window scored *exactly* 32, because `edits ≥ 20` and `turns ≥ 60`
  are thresholds that top out: a twenty-edit session and a two-hundred-edit
  session were the same number, sessions were unordered, and **none reached the
  report** — the skill's distinguishing claim failing silently in its first run.

  Four new signals, all tiers rather than thresholds, so they keep climbing:
  `backed×N` (+4…+16, how much in-window work stands behind a release, scoped by
  conventional-commit scope so one skill in a monorepo cannot claim another's
  pull requests), `notes+N` (+3…+9, how much the changelog actually says),
  `first+12` (a component's first release is news its fourth minor is not), and
  tiered `edits×N` / `turns×N` for sessions. On the frozen week this takes the
  ranking from 5 distinct scores to 10 and moves the cut line out of the tie.

  `backed×N` is deliberately capped **below** a major bump's +20: a pull request
  count measures how finely work was split as much as how much of it there was.
  There is deliberately **no duration signal** — a digest's start and end bound
  the wall-clock span of a transcript, not the work in it, and real sessions span
  thirty hours.

- **`rank` now reports a tie at the line itself.** When the last item above the
  line and the first below it share a score, it says how many items share it and
  that nothing separates them. Noticing a column of identical numbers was prose
  asking the model to spot something; drawing the line is the deterministic
  half's job, and so is admitting when the line means nothing.

- **The receipts gate refused correct prose.** `\w+/\w+` matched the phrase
  **"plus/minus"** and reported it as a "raw repo-slug", and the run reworded a
  true sentence to satisfy it — the exact inversion of *fix the draft, never the
  checker*. The same pattern matched "CI/CD", "read/write" and "24/7", and
  `[0-9a-f]{7,40}` matched any seven-digit number and the words "effaced" and
  "defaced". A slug is now a repository when the corpus knows the owner or the
  name carries a hyphen, dot, underscore or digit; a hex run is a sha when it
  mixes letters and digits.

  A false positive here is worse than a miss: it teaches a run that the gate is
  an obstacle to be worded around.

- **A smuggled identifier was caught only by that false positive.** `<<em>em>#412`
  collapses to `em>#412`, and the pull-request pattern required whitespace before
  the `#` — so the case was flagged as a *repo-slug* match on `412/em`, a test
  passing for the wrong reason. Any non-alphanumeric boundary now counts.

- **`receipts` printed `Unresolved: 0` beside `Verdict: REFUSED`.** Two failure
  classes had been collapsed into one word; the verdict table now carries its own
  `Prose` column.

### Added

- **`show <receipt>…` — read the artifact without leaving the corpus.** Release
  and pull request bodies are now cached at index time (excerpted, and redacted
  on the way in), so step 4 — *read what you are about to describe* — is one
  local call. The first run instead made three networked `gh` loops and printed
  roughly sixteen kilobytes of changelog into the conversation, in a skill whose
  own presentation contract forbids exactly that. Sessions render as their shape:
  project, branches, turns, edits, skills, tools and opening prompt.

- **`evals/baseline/update.mjs`.** `skill-invariants.json` had named this file as
  the one-command refresh for every frozen artifact since the skill shipped, and
  it did not exist. It re-runs the manifest's own command, diffs each artifact,
  supports `--dry-run`, and always passes `--trap-command` — without which
  `skillfactory freeze` regenerates `baseline.test.mjs` with the two-sided
  assertion replaced by `assert.fail`, leaving the baseline one-sided.

### Security

- **GitHub items now pass through redaction, like session digests always have.**
  `index` promised to "redact secrets and absolute paths at ingest so nothing
  unsafe is ever cached" while merging `fetchAll`'s output into the corpus
  untouched — true only for as long as nothing but a title was stored. Bodies are
  arbitrary prose, and a token pasted into a changelog is a token written to
  `~/.shipreport`, where every later run and every model pass reads it.

- **The art validator was the whole boundary and had holes in it.** `art` is the
  one field `render` splices unescaped, and the sheet opens in a browser from
  `file://` on its own. Now refused: an SVG `<style>` element (inline SVG styles
  are **document-scoped**, so one card could restyle the entire sheet — the accent
  law defeated by the file that enforces it); a colour in a `style` attribute,
  which bypassed a check that only read presentation attributes; `javascript:`,
  `data:` and `vbscript:` URLs including via `xlink:href`; `<a>`, `<animate>` and
  `<set>`; and protocol-relative `<use href="//host/…">`, which slipped a guard
  that named only `http` and `https`.

### Fixed — from a second graded run, of 0.2.0 itself

The 0.2.0 changes worked: the run took 242s against 318s, the ranking drew the
line by score rather than by timestamp, `--kind session` replaced a `grep`, and
step 4 made no network call. Grading *that* run found four more.

- **A hand-written count reached the sheet — and it was wrong.** The standfirst
  read "Eleven components shipped, two of them brand new" while the computed
  strip printed **16 released** an inch below it; 15 releases were cited and 3
  were first releases. Every number wrong, with the correct ones rendered
  adjacent. `render.mjs` records fixing this contradiction once before from the
  computed side; this was the hand-written side.

  The root cause is ordering: the strip is computed at `render`, *after* the
  prose exists, so a model with no figure in front of it counts its own cards.
  **`rank` now prints the same figures the sheet will**, and the gate refuses a
  count of shipped things in the headline or standfirst — enforcing the rule
  SKILL.md already stated ("do not write numbers") rather than a weaker
  must-match version, because a count that is right today is still the figure
  written down twice. Numbers *inside* an item's prose stay legal: they belong to
  the artifact being described, and flagging them would be the "plus/minus"
  false positive all over again.

- **`show`'s output had no bound, so the run piped it three times.** `--chars`
  was a per-item cap that multiplied — six receipts at 2400 is 14k characters —
  and 0.2.0 had just added the rule "run every one of these bare, the output is
  already bounded", which was false for the one command it also added. `--chars`
  is now a **total** budget divided across the receipts asked for, so asking for
  more artifacts buys less of each and a single call is always safe to run bare.

- **`index --full` reported "incremental — new items only"** — the label read the
  watermark and ignored the flag, describing the opposite of what had just run.

- **A four-item section orphaned its last card.** The ledger was a fixed
  three-column grid, so four items rendered as three plus one alone beside a full
  row-height of white, reading as a section that failed to finish. Two- and
  four-item sections now lay out in pairs, with the column dividers moving to
  match.

- **`receipts` printed `Prose: 0` beside `REFUSED` again**, because the new count
  check did not increment the counter that column reports. Same
  self-contradiction the column was added to end, one release later.

### Changed

- **Speed.** `fetchReleases` now fetches repositories concurrently instead of
  awaiting one `gh api` per repository in sequence — the dominant cost of the
  first-run year backfill. Together with `show`, a run makes no network call after
  `index`.

- **The run's shape.** `SKILL.md` now requires the ranked table to be pasted
  rather than summarised, narrates the card-composition step before the minutes
  of silence it costs, shows the headline and card titles in the conversation
  before rendering rather than after, documents `--kind` / `--limit` / `--near`
  (`--kind` existed precisely so the agent would not `grep`, and went unmentioned,
  and the agent grepped), and says to run every command bare — the first run piped
  all four through `tail`.

- **`render` prints its output path on its own line** instead of in a padded
  table cell, where a 96-character absolute path was both unreadable and a golden
  encoding the host's home directory.

- **`references/receipts.md`'s draft example now includes `art`**, which `render`
  requires and the documented shape omitted — the run spent three tool calls
  hunting the contract, including a grep of a `scripts/lib/glyphs.mjs` that does
  not exist.

## [0.1.0] - 2026-08-04

### Added

- **First release.** Turns a stretch of real commits, pull requests and Claude
  Code sessions into a short executive summary a stakeholder can read — and
  refuses to print a line it cannot back with a receipt.

- **`index` — one cache, two passes.** The first run backfills a year of GitHub
  contributions and every session transcript on disk; later runs read a
  watermark and take only what is newer, filtering sessions by file mtime before
  a transcript is opened. On this machine that is 574 files on the first pass and
  one on the second.

- **Redaction at ingest, never later.** Assigned secrets, Anthropic/OpenAI keys,
  GitHub tokens and PATs, AWS key ids, Slack tokens, JWTs, bearer headers, PEM
  private-key blocks, email addresses and the absolute home path are removed on
  the way into the cache — so the raw value exists only in memory, for the length
  of one parse.

- **`rank` — scoring in code, with the reasons printed.** Every candidate shows
  the signals that produced its score before a word of prose exists. Two
  collapses run first: squash-merged pull requests are folded into the PR they
  came from (without it, one merge method systematically outranks the other),
  and a release series such as `0.3.0 → 0.3.1 → 0.3.2` collapses to its newest
  while the rest ride along as extra receipts.

- **`receipts` — the one rule as a gate.** Every claim must carry at least one
  receipt, every receipt must resolve, and no raw identifier may appear in the
  prose. It exits non-zero, and `render` re-runs it rather than trusting that it
  passed earlier.

- **`render` — a press-styled sheet composed from the named component
  vocabulary.** Masthead with stamp and eyebrow, headline, standfirst, a hero
  `.bigstat` figure, a ruled `.stat-strip`, sections of `.ledger` cards laid two
  to a row, a `table.data` receipt appendix, and a colophon. Tokens come from the
  `shipreport-theme` press region, so no brand value is written here. The hero
  and the strip are computed from the window rather than authored, because there
  is no receipt shape for a figure.

- **One original line-art scene per card, composed not catalogued.** The same
  contract devlog uses for its covers, one level smaller: read the item, name the
  concrete mechanism, draw *that*. Two versions and a selector that took the lower
  one; a chain whose links all report green and whose last one is missing; eight
  near-identical copies collapsing into one definition. A drawing this repo could
  generate would be the same drawing every time, which is the failure the idea
  exists to avoid — so `scripts/lib/art.mjs` validates and never draws.

  It refuses: a missing scene, anything that is not a single `<svg>`, a colour
  literal (the brand is generated, never typed), a `<script>`/`<image>`/
  `<foreignObject>`/external reference/inline handler, fewer than five drawing
  elements, a `viewBox` other than the shared frame, and two cards whose scenes
  match on a fingerprint that normalises whitespace and numeric jitter.

### The brand laws this obeys

The card grid is divided by ink rules and proximity — **never by drawing a
container** — because `laws.md` §2 forbids rounded corners, shadows, gradients,
fills and boxes inside boxes, and says plainly that this is the brand rather than
minimalism awaiting a fix. The accent is spent exactly twice, on the stamp and
the hero figure, per §1; a test counts them. `press lint` runs in `ci / shipreport`
alongside `press check`, because only the lint catches a hand-written hex or a
letter-spacing above the extraction ceiling in the hand-written half of the
stylesheet — it caught a literal white on its first run.

### Ownership — found by running a three-month window

- **A release of somebody else's project is no longer counted as your shipped
  work.** Releases are fetched for every repo the user touched, so one docs pull
  request to an external project imported **eleven** of its releases into the
  window and ranked one of them seventh. The receipts gate cannot catch this: the
  release is real, so the citation resolves. **The one rule stops fabrication,
  not misattribution** — hence a separate filter rather than a stricter receipt.

  Pull requests and commits in an external repo are kept, because contributing to
  someone else's project is your work and releasing it is not. The owner set
  defaults to the authenticated login; `--owner <org>` claims an organisation and
  `--all-owners` disables the filter. Drops are never silent — `rank` names each
  excluded project and its count.

- **`render` applies the same rule to the numbers strip.** It did not at first,
  and the sheet read "21 released" directly beneath a ranking that had found 19 —
  the same defect in a second place, which is the usual shape of a filter that
  lives in only one of two call sites.

### Density

Three cards to a row rather than two, so a three-item section is exactly one row
and leaves no orphan void; headline and standfirst share one band instead of
stacking with a third of the sheet empty to the right.

### Notes

Three things the first real run found, which reviewing the code had not:

- `gh search prs` returns `repository.nameWithOwner` and `gh search commits`
  returns `repository.fullName` for the same value. Reading one produced
  `commit:undefined@…` receipt ids, which then made the squash fold match
  nothing — so every squash-merged pull request was counted twice.
- A week with 52 releases scored all 52 identically, so the top-twelve cut was
  decided by a tiebreak rather than by ranking. Reading the semver bump fixed it,
  and a lone `2.0.0` now infers `major` from the version itself instead of
  scoring below patch releases.
- The numbers strip was computed from the cited items, so the sheet read
  "10 released" directly above a sentence saying more had been. A summary cites a
  handful of things and is still *about* the whole window.

# Changelog

All notable changes to the ghostwriter-x skill are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-07-27

Improvement pass driven by the first real end-to-end run that published a
thread with an image. Two shipped features turned out to be broken, and the
self-learning loop turned out never to have run at all.

### Fixed

- **Image publishing was broken for every card since 0.1.0.** Typefully returns
  an S3 *SigV2* presigned URL signed with an **empty** Content-Type; the script
  sent `Content-Type: image/png`, so S3 computed a different StringToSign and
  every upload died with `403 SignatureDoesNotMatch`. Omitting the header is not
  a fix — urllib substitutes `application/x-www-form-urlencoded`, which fails
  the same way — so it is now set explicitly to `""`. The first two posts were
  text-only, which is why this shipped unnoticed.
- **The outcome loop had never fired once across three published posts.** The
  check-in asked about the *newest* unscored post and required it to be ≥2 days
  old. Posting twice in one day leaves the newest record same-day forever, so
  the gate never opened — and because only the newest was ever considered, ripe
  older posts were never offered either. `due_record()` now selects the *oldest*
  ripe unscored post.
- Tests recorded only the URL and body of the presigned PUT, never its headers,
  so the suite held 100% coverage of the broken line while the feature was dead
  in production. The fake now records headers, and the regression test was
  falsification-tested against the reverted fix.

### Added

- `--draft-only`: parks the exact approved text in Typefully without publishing,
  for when X policy blocks direct API publishing. Deliberately not written to
  `published.jsonl`, which records only what went live. The bare 403 is now an
  actionable error naming both recovery paths and stating that the failure is
  atomic and pre-publish, so a retry carries no double-post risk.
- `scripts/hn_trending.py` for the Trending lane. A hand-written curl needs
  `points>150,created_at_i>…` percent-encoded; in a shell the `>` redirects and
  the query silently returns nothing, which cost a wasted round trip on a real
  run.
- `scripts/post_outcome.py --check-due`: a deterministic "is a check-in owed,
  and on which post" query, so the skill stops re-deriving the age rule by hand.
- **Run it before you write about it** (SKILL.md 3a): verify mechanisms against
  the real binary rather than the docs, and measure a real before/after on the
  user's own repos when there is a legitimate subject. This was the unplanned
  move that produced the run's best post (`9 errors became 138` on identical
  code) and it was documented nowhere. Read-only commands only.
- **The disclosure rule** (SKILL.md 3b): measurements from 3a are run by the
  agent, not the user. First-person framing is allowed only when the run was
  against the user's own machine *and* the provenance is stated at approval;
  otherwise write in the second person.
- Card lint `term-not-in-capture`: when a real capture exists at
  `<slug>.source.txt`, every `.term` row must be a line from it verbatim, modulo
  alignment whitespace and prompt glyph. Catches the defect from this run's
  first render — the `[ ]`/`[*]` fixability column silently smoothed away.
- Card lints `panel-rag` (DOM) and `term-underfilled` (static): dead space
  measured to the **ink** inside painted panels, which the existing
  `empty-band-x` cannot see because block children are full-width and its
  box-edge measure reads ~0.
- Publish-time covariates in `published.jsonl` (`images`, `hour`, `claims`) —
  cheap to record now, impossible to reconstruct later.
- Sample-size floors before any outcome may steer a decision (≥3 scored posts in
  a lane/format/treatment; under 3 total, ignore outcomes entirely).

### Changed

- The visual choice now rides in the draft-approval dialog as a second question
  instead of its own round trip (4 dialogs per post → 3).
- Publish failures get a recovery, not a debugging session: the first thing said
  is always whether anything went out, then a one-line classification per error
  with the next step offered as a choice.
- Card work lints before rendering and reads the PNG only once the lint is
  clean; the mechanical checks now cover most of what used to cost a render
  cycle.
- Narration floor extended past the source gate to every slow stretch: never
  more than ~2 tool calls without a user-facing line.
- Idea-board status is now `published · <url>` / `drafted · <slug>` / `on deck`,
  reconciled against `published.jsonl` and `drafts/` — a bare `picked` recorded
  an intention and went stale (a real board carried three that were never
  drafted).
- `research/.radar.log` is read only if present; absent means "the job never ran
  on this machine", which is not the same as "the job failed".

### Notes

- Typefully's analytics endpoints return `403 MONETIZATION_ERROR` on the free
  plan (verified 2026-07-27), for both per-post metrics and follower counts. The
  self-reported check-in remains the only compliant signal; SKILL.md records
  this so it is not re-probed every session.
- Calibrating `panel-rag` surfaced a design-system inconsistency worth its own
  look: `.term` offers ~92 characters of width at 18px mono, but
  `BUDGETS['term']['max_chars']` caps rows at 64, so a fully budget-compliant
  hero terminal is already ~31% ragged. The visible dead band on the published
  card was inherited from that gap, not from authoring.

## [0.1.0] - 2026-07-26

### Added

- Initial release: X (Twitter) ghostwriter, a full sibling of the LinkedIn
  `ghostwriter` skill.
- **Setup**: one Typefully API key (`typefully_post.py --connect` stores the
  social set id — no OAuth dance, no token expiry); voice corpus from the X
  account archive via `scripts/extract_tweets.py`, or seeded from an existing
  LinkedIn ghostwriter voice profile.
- **Generate**: four-lane idea picking, hook-first drafting under
  voice-notes > voice-profile > algorithm.md precedence, weighted
  280-character validation per tweet via `scripts/x_len.py` (twitter-text
  rules, conservative approximation), and the source-verification gate
  (`scripts/verify_sources.py`, ≥3 live distinct hosts per external claim).
- **Publish**: `scripts/typefully_post.py` — posts through the free Typefully
  API (X's own API lost its free tier in Feb 2026): single posts and threads,
  up to 4 images per tweet, `--dry-run`, async publish polling that returns
  the live X URL, publish log at `~/.claude/ghostwriter-x/published.jsonl`,
  self-reported outcome loop via `scripts/post_outcome.py`.
- **PRESS card system at 16:9** (1200×675): landscape card templates,
  parameterized `card_lint.py` content budgets, PNG-only carousels (4-image
  post or thread-with-images — no PDF documents on X).
- Evals (mock-capped harness, voice judge, behavioral scenarios) and a
  100%-coverage test suite with a data-driven skill-invariants contract test.

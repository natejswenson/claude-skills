# Changelog

All notable changes to the ghostwriter-x skill are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

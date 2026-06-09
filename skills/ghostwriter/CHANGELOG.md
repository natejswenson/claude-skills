# Changelog

All notable changes to the linkedin-ghostwriter skill are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

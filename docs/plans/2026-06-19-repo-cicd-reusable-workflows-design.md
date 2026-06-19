---
ticket: "n/a"
title: "Repo-wide CI/CD: reusable release, dev→main flow, and skill performance tests"
date: "2026-06-19"
source: "design"
---

# Repo-wide CI/CD for claude-skills

## Problem

`.github/workflows/` has 8 hand-written files (`<skill>-ci.yml` + `<skill>-release.yml` for
devlog, resume, ghostwriter, github-stats). The **4 release files are ~95% identical** (only
the skill name and version-read line differ) — the real duplication and the scaling pain. The
**4 CI files genuinely differ** (per-skill test/lint/score commands). Further gaps: release is
**not gated on CI**; the version source-of-truth splits two ways (package.json for node skills,
SKILL.md frontmatter for python skills); there is **no branch protection** (work merges
straight to an unprotected `main`); and **skill performance is unevenly tested** (devlog has
no tests at all; the others have varied scorers/evals).

Goals:
1. DRY, scalable CI/CD for all skills; a new skill onboards with one small file.
2. `dev → main` flow: work integrates on `dev`, ships via PR to `main`; releases cut on `main`.
   `main` is protected (PR + CI required, no direct push). Versions are cut off `main`.
3. Release gated on CI green; per-skill auto-tag-on-merge preserved (`<skill>-v<version>`).
4. A uniform **skill performance test** gate across all skills, plus real functional tests
   per skill (devlog gets a brand-new suite).

## Decisions

- **Reusable `_release.yml` (`workflow_call`) + one per-skill caller `<skill>.yml`.** Shared
  release logic lives once; each caller owns triggers + its own CI steps + the release call.
- **Branch model:** `main` is the default and the **only** protected branch (PR required, CI
  required, no direct push, no force-push). `dev` is an integration branch (unprotected —
  direct pushes allowed for fast iteration). Releases cut on **push to `main`** only.
- **Release gating** falls out of the architecture: each caller's `release` job has `needs: ci`
  and runs only on push to `main`.
- **Version source: auto-detect** (package.json if present, else SKILL.md frontmatter
  `version:`); optional `version-source` input override. **Frontmatter parsing is restricted
  to the YAML block between the first two `---` fences** — never a whole-file grep (see below).
- **CI stays inline per skill** (steps legitimately differ). The scorer's binding default is
  `--min 100` (every required generic check must pass) and **no current skill needs an override** —
  all four pass at 100. Callers therefore run the scorer at the default; the `--min N` arg is an
  **opt-in escape hatch** for a hypothetical future skill that needs slack, not the normal path
  (see Tier-1 for the recalibrated value tied to the generic check count — NOT ghostwriter's old
  8-check 80%). There is no separate config file.
- **Skill performance tests — two tiers, uniform across node/python:**
  - **Tier 1:** a NEW, **skill-agnostic** repo-level `tools/score_skill.py` runs a
    **structural/quality lint** of any skill's `SKILL.md` against a *generic* rubric (frontmatter
    present, `name`/`description` present, `description` length within bounds, ≥1 `## ` heading,
    optionally `name` matches the dir). It is a structural lint of SKILL.md, **NOT** a deep
    output-performance eval. Offline, deterministic, $0. Every skill, including devlog. The new
    scorer is itself unit-tested (see Tier-1 + tools CI). It is **not** built from ghostwriter's
    bespoke scorer — that scorer is ghostwriter-specific (it hardcodes `version:`, the
    Setup/Generate/Publish modes, the never-publish guardrail, the no-automated-posting rule, and
    voice-profile/voice-notes refs, which devlog/resume/github-stats would fail) and is **deleted
    and replaced**, not folded in.
  - **Tier 2:** per-skill functional tests (offline/mock, CI-gated). Existing suites
    (resume, ghostwriter, github-stats) are wired in; **devlog gets a new unit suite** for
    `bin/devlog.js`.
- **Scope:** repo CI + per-skill release + skill tests. No site/deploy step (the devlog site
  lives in a separate repo).

## Architecture

```
.github/workflows/
  _release.yml          # REUSABLE (workflow_call): version -> tag-check -> notes -> gh release
  devlog.yml            # caller: triggers + ci job + release job (needs: ci)
  resume.yml
  ghostwriter.yml
  github-stats.yml
  tools.yml             # tools CI: runs pytest tools/tests on tools/** changes
tools/
  score_skill.py        # NEW skill-agnostic Tier-1 SKILL.md structural lint (run by every caller's ci job)
  tests/
    test_score_skill.py # unit tests for the generic scorer (gate of every skill's merge — must be tested)
```

5 caller workflows replace 8 old files; a small `tools.yml` tests the shared scorer; each new
skill adds exactly one caller.

### Component 1 — `_release.yml` (reusable)

Inputs: `skill` (required), `version-source` (optional, `auto|package-json|skill-md`, default
`auto`). Job: checkout `fetch-depth: 0` → resolve version (auto-detect) → skip if
`<skill>-v<version>` already tagged → extract CHANGELOG notes (existing awk) → `gh release
create "<skill>-v<version>" --target "<github.sha>" --title "<skill> v<version>" --notes-file
release-notes.md`. `permissions: contents: write`. **Concurrency is parameterized by the input and
must NOT cancel an in-flight release: `concurrency: { group: release-${{ inputs.skill }},
cancel-in-progress: false }`** (parameterized group, NOT a literal `release-<skill>`, which would
collide across skills sharing the one reusable workflow; `cancel-in-progress: false` so a queued
release waits rather than aborting a publish mid-flight). This is today's release logic, parameterized.
Tag prefix, idempotent skip, CHANGELOG notes, `--target github.sha`, `--title`, and
`--notes-file release-notes.md` are preserved exactly. Add a guard: empty resolved version →
`exit 1` with a clear message.

**Version resolution rules (must be implemented exactly):**

- `package-json` branch: `node -p "require('./package.json').version"` (today's logic).
- `skill-md` branch: parse **only the YAML frontmatter block** — the content between the first
  two `---` fences at the top of `SKILL.md` — and read its `version:` key. The unsafe whole-file
  `grep -m1 '^version:' SKILL.md` used by the current release workflows **must NOT be carried
  forward**: devlog's `SKILL.md` contains a `version: <version label, e.g. v0.2.0>` line inside a
  fenced code block (the entry template), which a whole-file grep would wrongly match. If
  `version:` appears only OUTSIDE the frontmatter, treat it as "no frontmatter version".
- `auto`: use package.json if present, else the frontmatter-only `skill-md` rule above. (devlog
  has a package.json, so it always resolves via package.json — its in-code-block `version:` line
  is never consulted.)
- Note: for node skills (devlog, resume) `auto` resolves via package.json, so a `version:` in their
  SKILL.md frontmatter is ignored and need not be maintained (resume currently carries a redundant
  `version: 0.1.1` in frontmatter — harmless, package.json wins).

### Component 2 — per-skill caller `<skill>.yml`

```yaml
name: devlog
on:
  # PR trigger is intentionally NOT path-filtered: the ci job runs on every PR to
  # dev/main so its status check ALWAYS reports (see "Required checks & the
  # path-filter deadlock" below). The push trigger IS path-filtered so the
  # release job only attempts on relevant merges to main.
  push:         { branches: [main], paths: ["skills/devlog/**", "tools/score_skill.py", ".github/workflows/devlog.yml"] }
  pull_request: { branches: [dev, main] }
  workflow_dispatch:

jobs:
  ci:
    runs-on: ubuntu-latest
    # dorny/paths-filter@v3 detects PR changes via the GitHub REST API, which
    # requires pull-requests: read on the job token. With GITHUB_TOKEN now
    # restricted-by-default, omitting this makes dorny's API call fail → the
    # required `ci` check red-lines every PR → reintroduces the merge deadlock
    # this design resolves. This permission is load-bearing on PR events.
    permissions: { contents: read, pull-requests: read }
    steps:
      - uses: actions/checkout@v4
      # Detect whether this skill (or the shared gate) actually changed, using a
      # maintained action (NOT hand-rolled `git diff`). dorny/paths-filter handles
      # the PR merge-base correctly, the push first-commit/force-push/zero-SHA case,
      # and base-object availability — the three bugs the old git-diff step had.
      # Fail-safe: if detection is ever indeterminate, the heavy steps still run
      # (we never skip a real gate).
      - name: Detect relevant changes
        id: changes
        uses: dorny/paths-filter@v3
        with:
          filters: |
            devlog:
              - 'skills/devlog/**'
              - 'tools/score_skill.py'
              - '.github/workflows/devlog.yml'
      # Tier 1: shared SKILL.md structural lint (every skill)
      - if: steps.changes.outputs.devlog == 'true'
        uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - if: steps.changes.outputs.devlog == 'true'
        run: python tools/score_skill.py skills/devlog --min 100   # binding default; no current skill needs an override
      # Tier 2: skill's own functional/unit steps (working-directory: skills/devlog)
      - if: steps.changes.outputs.devlog == 'true'
        uses: actions/setup-node@v4
        with: { node-version: "22", cache: npm, cache-dependency-path: skills/devlog/package-lock.json }
      - if: steps.changes.outputs.devlog == 'true'
        run: cd skills/devlog && npm install --no-fund
      - if: steps.changes.outputs.devlog == 'true'
        run: cd skills/devlog && npm test          # NEW devlog unit suite (see migration order)
      - if: steps.changes.outputs.devlog == 'true'
        run: cd skills/devlog && npm run audit
  release:
    needs: ci
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    uses: ./.github/workflows/_release.yml
    with: { skill: devlog }
    permissions: { contents: write }
```

- **The `ci` job runs on every PR to `dev`/`main`** (PR trigger un-filtered) so its status check
  always reports. Its first step uses `dorny/paths-filter@v3` to detect whether the skill (or the
  shared gate) changed and **short-circuits to success when the skill is unchanged**, doing no
  install/test work. The action computes the PR merge-base correctly and handles the push
  zero-SHA / first-commit / force-push cases that broke the previous hand-rolled `git diff`.
- **The `push` trigger stays path-filtered** to `skills/devlog/**` (+ `tools/score_skill.py` and
  the caller file) so the release job only attempts on relevant merges to `main`.
- **release** runs only on push to `main`, only if `ci` passed.
- The repeated per-step `if: steps.changes.outputs.<skill> == 'true'` guards are functionally
  correct: when the skill is unchanged every heavy step skips and the `ci` job still reports
  success, which is exactly the short-circuit the required-check design relies on. No
  restructuring (e.g. a single job-level guard) is needed.
- When the skill changed, CI runs Tier-1 (shared scorer at the binding `--min 100` default — every
  required generic check must pass; no current skill needs an override) then the skill's Tier-2 steps.

### Required checks & the path-filter deadlock

Marking a per-skill `ci` job as a required status check is **only safe if that check always
reports on every PR**. If the PR trigger were path-filtered (the naive design), a PR touching
only one skill would never start the other skills' workflows, so their required `ci` checks would
sit at "Expected — waiting for status" and block the merge **permanently**. The un-filtered PR
trigger + changed-files short-circuit above resolves this while preserving the per-skill-caller
architecture: all four `ci` checks run and report on every PR, cheaply when nothing changed.

**Chosen branch-protection configuration:** the four per-skill `ci` jobs (`devlog / ci`,
`resume / ci`, `ghostwriter / ci`, `github-stats / ci`) are the required status checks. They are
safe to require precisely because each now reports on every PR. **Future skills MUST keep the PR
trigger un-filtered** (path-filter only the `push` trigger) or they reintroduce the deadlock —
this is the load-bearing rule for adding a required skill check. **Equally load-bearing: the `ci`
job MUST grant `permissions: { contents: read, pull-requests: read }`.** `dorny/paths-filter@v3`
detects PR changes via the GitHub REST API and needs `pull-requests: read`; with the now-default
restricted `GITHUB_TOKEN`, omitting it makes the change-detection action fail on PRs, red-lining
the required `ci` check on every PR and re-creating the same deadlock. A skill author copying the
caller template inherits both rules.

## Branch model & protection

- Create `dev` from `main`. Daily work branches off `dev`; integrate on `dev`; ship via PR
  `dev → main`. Releases cut on the `main` merge.
- **`main` protection ruleset** (via `gh api` / repo settings): require a pull request before
  merging; require status checks to pass — **the four per-skill `ci` jobs** (`devlog / ci`,
  `resume / ci`, `ghostwriter / ci`, `github-stats / ci`); block direct pushes; block
  force-pushes; **required approvals 0** (the solo owner self-merges their own PRs — explicitly
  allowed; PR + green CI is the gate, not a second reviewer).
- **`enforce_admins: false`** (decided explicitly). The solo owner retains an escape hatch if a
  required check is stuck or misconfigured — including the very gates this design adds. The
  tradeoff: an admin can technically bypass "no direct push" / push past a red check. This is an
  **accepted v1 tradeoff for a solo maintainer**; for non-admins the "no direct push" + required-CI
  guarantees hold fully.
- These four checks are safe to require **only because each `ci` job's PR trigger is NOT
  path-filtered** and so reports on every PR (skipping its heavy steps when the skill is
  unchanged). Path-filtering the PR trigger would deadlock the merge (see "Required checks & the
  path-filter deadlock"). The workflow-level `push: paths: [skills/<skill>/**]` filter remains
  load-bearing — it stops the reusable release from running on unrelated merges — but the PR
  trigger must stay unfiltered.
- `dev` stays unprotected (direct pushes allowed).
- Default branch stays `main`.

## Skill performance tests

### Tier 1 — shared SKILL.md structural lint (`tools/score_skill.py`)

Tier-1 is a **structural/quality lint of `SKILL.md`** — a $0, offline, deterministic check that a
skill's prompt file is well-formed. It is explicitly **NOT** a deep output-performance eval (no
LLM, no running the skill); deep output quality is Tier-2's job. The scorer is **NEW and
skill-agnostic**: it must pass for every skill in the repo (devlog, resume, ghostwriter,
github-stats) without any skill-specific knowledge.

- CLI: `python tools/score_skill.py <skill-dir> [--min N]`. Reads `<skill-dir>/SKILL.md`, runs the
  generic checks below, prints the breakdown, and exits non-zero when the passed-fraction is below
  `--min` (a percentage). There is no `tools/score_skill.toml` config file.
- **Generic rubric (skill-agnostic, offline, deterministic — no LLM).** All checks are universal;
  none is ghostwriter-specific:
  1. `SKILL.md` has a YAML frontmatter block (between the first two `---` fences).
  2. Frontmatter has a `name`.
  3. Frontmatter has a `description`.
  4. `description` length within bounds (**20–1024 chars** — non-trivial, under the 1024-char
     triggering cap). The lower bound (20 chars) is comfortably cleared by all current skills
     (shortest is devlog at ~117 chars); a future skill with a genuinely short description would
     hard-fail at `--min 100` and must use the documented `--min N` escape hatch.
  5. Body has at least one `## ` section heading.
  6. *(optional / soft)* `name` matches the skill directory name. **All four current skills already
     satisfy this**, so excluding it from the required fraction is reserved slack — a small carve-out
     held in reserve for a future skill whose `name` legitimately diverges from its dir, not a
     workaround any current skill needs.
  Frontmatter is parsed from the fenced block only (split on the first two `---`, ignore body
  `---`), so a `version:`/`description:` inside a code block is never counted (the same
  `split_frontmatter` robustness, but none of ghostwriter's bespoke checks). No network, no paid
  calls.
- **`version:` is deliberately NOT in this rubric.** Requiring it would falsely fail node skills:
  devlog and resume carry their version in `package.json`, not SKILL.md frontmatter (devlog has no
  `version:` key at all). Likewise NONE of ghostwriter's bespoke checks (Setup/Generate/Publish
  modes, never-publish guardrail, no-automated-posting compliance, voice-profile/voice-notes refs)
  are in the shared gate — they would red-line ~3/4 skills permanently. If a skill-specific check
  is ever wanted, it must be **opt-in / parameterized**, never part of the shared gate.
- **Threshold recalibration.** The default does NOT inherit ghostwriter's old 8-check / 80% number.
  With ~5 required generic checks, the binding default is `--min 100` (every required check must
  pass — a clean structural lint); check 6 is reported as soft/advisory and excluded from the
  required fraction. **No current skill needs an override** — the generic checks are designed so all
  four current skills pass at `--min 100`, and the caller examples pass `--min 100` explicitly to
  match. The `--min N` arg is an **opt-in escape hatch** for a hypothetical future skill that needs
  slack, not an expected per-skill setting; the same binding default also lives in the scorer so a
  caller that omits the arg still binds at 100.
- **This scorer gates every skill's merge, so it is itself unit-tested** (see "Tier-1 tests + tools
  CI" below). ghostwriter's bespoke `scripts/score_skill.py` is **deleted and replaced** by this
  generic scorer (not folded in) — see migration / score_skill.py consolidation.

#### Tier-1 tests + tools CI

The shared scorer decides merges for every skill, so an unverified scorer is unacceptable. It ships
with `tools/tests/test_score_skill.py` covering:

- a fully-valid `SKILL.md` passes;
- each individual failing check fails (missing frontmatter block; missing `name`; missing
  `description`; `description` too short; `description` too long; no `## ` heading);
- frontmatter-only parsing: a `version:` (or `description:`) line inside a fenced code block in the
  body is ignored, not parsed as frontmatter;
- graceful degradation when there is no frontmatter at all (returns empty frontmatter, fails the
  relevant checks rather than crashing).

These run in a small dedicated **`tools` CI** (`.github/workflows/tools.yml`), triggered on
`tools/**` changes, that runs `pytest tools/tests` with coverage. It is intentionally lean — one
small workflow, separate from the per-skill callers, so the scorer's own tests don't ride on any
skill's gate.

### Tier 2 — per-skill functional tests

| Skill | Tier-2 steps (offline / mock / $0), preserved exactly | Status |
|---|---|---|
| devlog | `npm install --no-fund` + `npm run audit` + **(NEW)** `npm test` — a new unit suite for `bin/devlog.js`: `validateConfig` accept/reject (incl. injection rejection), version-label derivation, `^v[0-9]+(\.[0-9]+)*$` final-release gate, tagPrefix matching, voicePath validation. **HARD PREREQUISITE: the `bin/devlog.js` unit suite + a `test` script in `skills/devlog/package.json` MUST land before (or in the same change as) wiring `npm test` here** — today `skills/devlog/package.json` has only an `audit` script and no test suite. | author tests first, then wire |
| resume | `npm ci` (strict lockfile — NOT `npm install`) + `npm test` + `MOCK_LLM=1 npm run eval` | wire |
| ghostwriter | `pip install -r requirements-dev.txt` + `shellcheck scripts/release_radar.sh` + `pytest --cov=scripts --cov-report=term-missing --cov-fail-under=100` | wire |
| github-stats | `pip install -r requirements-dev.txt` + `shellcheck scripts/gh-stats.sh` + `pytest tests/ -v` | wire |

Callers preserve these commands exactly — in particular resume keeps `npm ci`, not `npm install`.
Real-LLM evals (resume live tailoring, github-stats live smoke) stay local-only, as today.

## Migration (8 files → 5 + shared scorer + devlog tests)

| Old | New |
|---|---|
| `devlog-ci.yml` + `devlog-release.yml` | `devlog.yml` |
| `resume-ci.yml` + `resume-release.yml` | `resume.yml` |
| `ghostwriter-ci.yml` + `ghostwriter-release.yml` | `ghostwriter.yml` |
| `github-stats-ci.yml` + `github-stats-release.yml` | `github-stats.yml` |
| — | `_release.yml`, `tools.yml`, `tools/score_skill.py`, `tools/tests/test_score_skill.py`, `skills/devlog/tests/*` |
| `skills/ghostwriter/scripts/score_skill.py` + `skills/ghostwriter/tests/test_score_skill.py` | deleted (replaced by the generic `tools/score_skill.py`) |

Behavior-preserving except deliberate improvements: release gated on CI; uniform SKILL.md
score gate; devlog now has functional tests; `main` protected; `dev` flow.

### Migration order (sequencing — devlog tests are a hard prerequisite)

devlog currently has **no `test` script and no unit suite** (`skills/devlog/package.json` defines
only `audit`). The devlog caller's `npm test` step therefore cannot be wired until the suite
exists. Required order:

1. **Author devlog's `bin/devlog.js` unit suite first** and add a `test` script to
   `skills/devlog/package.json` (e.g. via `node --test` or the project's chosen runner).
2. **Then** swap the workflows in (the `devlog.yml` caller with its `npm test` step). Steps 1 and
   2 may land in the same change, but the test suite + `test` script MUST NOT lag behind the
   caller — otherwise CI's `npm test` fails immediately on a missing script.

Other skills already have their test scripts, so their caller swap is a straight wire-up.

### Per-skill CI-step inventory (preserved exactly)

The migration must carry each skill's current CI steps verbatim — the callers do not normalize
them. The generic `npm install --no-fund` shown in the example is devlog-specific; resume
deliberately uses `npm ci`.

- **devlog:** `npm install --no-fund` + `npm run audit` + **(new)** `npm test`.
- **resume:** `npm ci` + `npm test` + `MOCK_LLM=1 npm run eval` (keep `npm ci`, NOT `npm install`).
- **ghostwriter:** `pip install -r requirements-dev.txt` + `shellcheck scripts/release_radar.sh`
  + `pytest --cov=scripts --cov-report=term-missing --cov-fail-under=100`.
- **github-stats:** `pip install -r requirements-dev.txt` + `shellcheck scripts/gh-stats.sh`
  + `pytest tests/ -v`.

### score_skill.py consolidation — replace, don't fold (ghostwriter's 100% coverage gate)

ghostwriter's `scripts/score_skill.py` is **ghostwriter-specific** (it requires `version:`, the
Setup/Generate/Publish modes, the never-publish guardrail, the no-automated-posting compliance
rule, and voice-profile/voice-notes refs — checks the other three skills do not satisfy). It is
therefore **not** the basis for the shared scorer. The new generic `tools/score_skill.py` is
written fresh; ghostwriter's bespoke scorer is **deleted and replaced**, not folded in.

ghostwriter's CI runs `pytest --cov=scripts --cov-fail-under=100`, and its
`scripts/score_skill.py` is inside that coverage target. To replace it without breaking the gate:

- **Delete ghostwriter's `scripts/score_skill.py` AND its `tests/test_score_skill.py`**, and rely
  on the shared Tier-1 `tools/score_skill.py` (run by the caller's `ci` job) for ghostwriter's
  SKILL.md scoring. Removing both the script and its test together keeps `--cov=scripts` at 100%
  over the remaining `scripts/*.py` — no orphaned tests, no retained-but-unrun module dragging
  coverage below 100%. After the migration `--cov-fail-under=100` still passes.
- The shared `tools/score_skill.py` is NOT under ghostwriter's `--cov=scripts` target (it lives in
  the repo-level `tools/`); its own coverage is enforced by the `tools` CI
  (`pytest tools/tests`), not ghostwriter's gate.

## New skill onboarding

1. Copy a caller `<skill>.yml`; set name, path filters, and the `ci` job's Tier-2 steps. **Keep the
   `pull_request` trigger un-filtered** and **keep the `ci` job's `permissions: { contents: read,
   pull-requests: read }`** — `pull-requests: read` is required for the `dorny/paths-filter@v3`
   change-detection action to work on PRs under the restricted-by-default `GITHUB_TOKEN`; dropping
   it red-lines the required `ci` check on every PR.
2. Tier-1 score gate is automatic (the shared scorer runs against the skill's SKILL.md at the
   binding `--min 100` default; no override is expected).
3. Set release `with: { skill: <skill> }` (+ `version-source` only if not auto-detectable).
4. Ensure the skill has `CHANGELOG.md` and a version in package.json or SKILL.md frontmatter.

## API Surface

- `_release.yml` inputs: `skill` (string, required), `version-source`
  (`auto|package-json|skill-md`, default `auto`). Emits tag/release `<skill>-v<version>` via
  `gh release create "<skill>-v<version>" --target "<github.sha>" --title "<skill> v<version>"
  --notes-file release-notes.md`. Concurrency `group: release-${{ inputs.skill }}`,
  `cancel-in-progress: false`.
- `tools/score_skill.py <skill-dir> [--min N]`: exit 0 if passed-fraction ≥ min, non-zero otherwise
  (binding default `--min` 100 over the required generic checks; no current skill needs an override —
  `--min N` is an opt-in escape hatch, not a per-skill setting).
- Caller contract: `ci` job (`permissions: { contents: read, pull-requests: read }`; Tier-1 scorer
  at `--min 100` + Tier-2 steps) + `release` job (`needs: ci`, push-to-main guard,
  `uses: ./_release.yml`, `permissions: contents: write`).

## Invariants

**Checkable (by inspection):**
- One reusable `_release.yml` + one caller per skill; no `<skill>-ci`/`<skill>-release` pairs remain.
- Every caller's `release` job has `needs: ci` AND `if: push && ref == main`.
- Every caller's `ci` job runs `tools/score_skill.py` (Tier-1) before Tier-2 steps.
- Every caller's **`pull_request` trigger is un-filtered** (no `paths:`); only the `push` trigger
  is path-filtered to `skills/<skill>/**`.
- Every caller's **`ci` job grants `permissions: { contents: read, pull-requests: read }`** —
  `pull-requests: read` is required for `dorny/paths-filter@v3` to detect changes via the GitHub
  REST API on PRs under the restricted-default `GITHUB_TOKEN`; without it the change-detection
  action fails and the required `ci` check red-lines every PR.
- `_release.yml` concurrency is `group: release-${{ inputs.skill }}` with
  `cancel-in-progress: false` (parameterized group; never cancels an in-flight release).
- `_release.yml`'s `skill-md` version branch parses ONLY the frontmatter block (split on the first
  two `---`, ignore body `---`; no whole-file `grep -m1 '^version:'`).
- **`tools/score_skill.py` is skill-agnostic**: its rubric contains only generic structural checks
  (frontmatter present, `name`/`description` present, `description` length bounds, ≥1 `## ` heading;
  optional name-matches-dir). It contains NO `version:` requirement and NONE of ghostwriter's
  bespoke checks (modes/guardrail/compliance/voice). All four current skills pass it.
- **The shared scorer is itself tested**: `tools/tests/test_score_skill.py` exists and runs in the
  `tools` CI (`pytest tools/tests`). The merge-gating scorer is never unverified.
- ghostwriter's `scripts/score_skill.py` and `tests/test_score_skill.py` are removed (deleted and
  replaced by the generic scorer, not folded in).
- Tag prefix is `<skill>-v<version>` (unchanged). `_release.yml` declares `contents: write`.
- `main` branch protection requires PR + the four skill `ci` checks; direct push blocked for
  non-admins. **`enforce_admins: false`** — the "no direct push" guarantee holds for non-admins;
  the solo-owner admin retains an override escape hatch (accepted v1 tradeoff).

**Testable (by running):**
- Every skill's `ci` check reports on every PR (no "Expected — waiting for status" deadlock); a PR
  touching one skill short-circuits the other skills' `ci` jobs to success without install/test
  work, and triggers no release.
- Merging a version bump to `main` creates `<skill>-v<version>` once; a no-bump merge no-ops.
- **A merge to `main` bumping only skill X triggers only X's caller (push path-filter); X's
  `changes`/paths-filter is `true` so its release fires, and the other three callers don't trigger
  at all → exactly one release, no missed or wrong release.**
- A merge whose `ci` fails creates no release (gating holds).
- `tools/score_skill.py` exits non-zero on a structurally-deficient SKILL.md and zero on a
  well-formed one; all four current skills pass at the default `--min`.
- `tools/tests/test_score_skill.py` passes in the `tools` CI (covers each failing check,
  frontmatter-only parsing incl. ignoring a `version:` inside a code block, and the no-frontmatter
  path).
- **devlog resolves its version via package.json; a `version:` inside a SKILL.md code block is
  never matched by the `skill-md` branch.**
- ghostwriter's `pytest --cov=scripts --cov-fail-under=100` still passes after the scorer removal.
- devlog unit suite covers validateConfig reject paths, version-label derivation, the
  final-release gate, and tagPrefix matching; `npm test` passes in CI (after the suite + `test`
  script land).

## Failure modes

- Reusable-workflow permission error → caller grants `contents: write` on the release job.
- Skill with neither package.json nor frontmatter `version:` → resolved version empty → release
  step exits 1 with a clear message.
- **`version:` only inside a SKILL.md code block (e.g. devlog's entry template), not in
  frontmatter** → the `skill-md` branch parses ONLY the frontmatter block, so it is never matched;
  `auto` resolves via package.json (devlog) or treats it as "no frontmatter version" otherwise. The
  unsafe whole-file `grep -m1 '^version:'` is not carried forward.
- **Change-detection: PR over/under-reports** → a hand-rolled `git diff base.sha head` uses the
  base-branch TIP, not the merge-base, so it mis-reports the PR's real changes. Resolved by
  `dorny/paths-filter@v3`, which computes the PR merge-base (three-dot semantics) correctly.
- **Change-detection: push zero-SHA / first-commit / force-push** → on push, `github.event.before`
  can be all-zeros (new or recreated branch, force-push), which makes a raw `git diff 000... <sha>`
  hard-error → `ci` fails → `release needs: ci` is blocked (a silently missed release). The action
  handles the zero-SHA / first-push case internally, so detection degrades safely instead of erroring.
  Note: on a `push` event the caller's `push` trigger is already path-filtered to
  `skills/<skill>/**`, so the paths-filter step is belt-and-suspenders there; the genuinely
  load-bearing case for change-detection is the UN-filtered `pull_request` trigger (where it gates
  the heavy steps so the required `ci` check always reports).
- **Change-detection: base object missing** → for `pull_request`, `fetch-depth: 0` alone does not
  guarantee the base SHA object is present for a raw diff. The action fetches what it needs, so the
  base is available without a bespoke fetch step. Fail-safe principle throughout: if detection is
  ever indeterminate, the heavy steps run (a real gate is never silently skipped).
- **Required-check + path-filter deadlock** → if a per-skill `ci` check is required but its PR
  trigger is path-filtered, PRs not touching that skill leave the check "Expected — waiting for
  status" and block the merge forever. Resolution: keep the PR trigger un-filtered and
  short-circuit the `ci` job to success (via the paths-filter action) when the skill is unchanged,
  so every required check always reports. A new skill that wants a required check MUST follow this
  pattern.
- **Stuck/misconfigured required check** → because `enforce_admins: false`, the solo-owner admin
  can still land a fix when a required check is wedged (e.g. a mis-named or broken gate). Tradeoff:
  an admin can bypass "no direct push"; accepted for a solo maintainer. Non-admins remain fully gated.
- A skill's SKILL.md legitimately differs from the rubric → tune the `--min N` arg / rubric, do not
  weaken the gate silently.
- Status-check name drift (protection references a check name that changed) → keep the four `ci`
  job names stable (`<skill> / ci`); they are the documented required checks. Renaming a caller or
  its `ci` job silently un-requires it — update branch protection in the same change.

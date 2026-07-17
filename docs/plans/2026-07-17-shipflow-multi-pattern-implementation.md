# Shipflow Multi-Pattern Templates Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use crucible:build to implement this plan task-by-task.

**Goal:** Generalize shipflow from one hardcoded branching pattern (`dev-main-promotion`) to a
registry of three selectable patterns (`dev-main-promotion`, `github-flow`, `gitflow`) with
deterministic autodetection, with zero behavior change for repos already on the existing pattern.

**Architecture:** A new `lib/pattern-registry.mjs` exposes `listPatterns()` /
`resolvePattern(config)` / `scoreAll(repoState)`. Each pattern lives in its own
`lib/patterns/<id>/index.mjs` exporting `detect(signals)`, `protectedBranches(config)`,
`templates(config)`, `planEntries(repoState, config)`, and a config-independent
`templateTargetPaths` constant. `detect.mjs`/`plan.mjs`/`apply.mjs` become thin dispatchers that
loop over whatever the registry returns instead of hardcoding one pattern's logic inline.

**Tech Stack:** Node.js (`--test` runner, ESM `.mjs`), no new dependencies (`yaml` stays the only
devDependency — already present for `tests/template-validity.test.mjs`).

**Source of truth (already quality-gated, do not re-litigate):**
`docs/plans/2026-07-16-shipflow-multi-pattern-design.md` +
`docs/plans/2026-07-16-shipflow-multi-pattern-contract.yaml` (on `dev` as of commit `d96db62`).

**Working directory for every step below:**
`skills/shipflow/skills/shipflow/` (relative to repo root). Run `npm test` from that directory
after every task.

---

## Judgment calls made during this planning pass

The contract is precise on data shapes and control flow but leaves a few things at the
"an implementer would need to pick something concrete" level. These are resolved here so tasks
below aren't ambiguous:

1. **`computeDetectionSignals`'s job-block boundary** (for `hasRestrictedPromotionWorkflow`/
   `hasUnrestrictedAutomergeWorkflow`): reuses `detect.mjs`'s existing `jobNameRe` regex
   (`/^\s{2}([\w.-]+):\s*$/`) to find each job's own name line, then scans forward until a line
   dedents to that same or lesser indent (mirroring `listWorkflowJobNames`'s dedent-detection, but
   per-job instead of per-file). See Task 7.
2. **`hasGitflowMarker`**: checks for a `.gitflow` file at the repo root (tracked or untracked —
   `existsSync`, not `git ls-files`, since a local-only git-flow AVH config file is plausible) OR
   `git config --get gitflow.branch.develop` exiting 0. Either alone is sufficient.
3. **Branch remote-prefix normalization**: `git remote` (not `git remote -v`) gives bare remote
   names, one per line. Strip `^<name>/` only for an exact match against that list.
4. **`hasTagsFromMain`**: `git tag --merged main` (or the configured main branch name) returns a
   non-empty list. Cheap, no history walking beyond what git already indexes.

---

## Task 1: `render.mjs` — new tokens + self-check assertion

**Files:**
- Modify: `lib/render.mjs`
- Test: `tests/render.test.mjs`

**Step 1: Write the failing tests**

Add to `tests/render.test.mjs`:

```js
test('renderTemplate substitutes RELEASE_BRANCH_PREFIX and HOTFIX_BRANCH_PREFIX', () => {
  const out = renderTemplate("release={{RELEASE_BRANCH_PREFIX}} hotfix={{HOTFIX_BRANCH_PREFIX}}", {
    devBranch: 'dev', mainBranch: 'main', mergeFlag: '--merge',
    releaseCredentialSecret: 'RELEASE_PAT',
    releaseBranchPrefix: 'release/', hotfixBranchPrefix: 'hotfix/',
  });
  assert.strictEqual(out, 'release=release/ hotfix=hotfix/');
});

test('renderTemplate rejects a release/hotfix branch prefix containing a quote or newline', () => {
  assert.throws(() => renderTemplate('{{RELEASE_BRANCH_PREFIX}}', {
    devBranch: 'dev', mainBranch: 'main', mergeFlag: '--merge',
    releaseCredentialSecret: 'RELEASE_PAT', releaseBranchPrefix: "release/' || 'x'=='x",
    hotfixBranchPrefix: 'hotfix/',
  }), /unsafe value/);
});

test('assertTokenValidatorsComplete throws when a TOKEN_TO_PARAM key has no matching TOKEN_VALIDATORS key', () => {
  assert.throws(
    () => assertTokenValidatorsComplete({ FOO: 'foo', BAR: 'bar' }, { FOO: () => true }),
    /BAR/
  );
});

test('assertTokenValidatorsComplete does not throw when every key is covered', () => {
  assert.doesNotThrow(() => assertTokenValidatorsComplete({ FOO: 'foo' }, { FOO: () => true }));
});
```

Import `assertTokenValidatorsComplete` alongside the existing `renderTemplate`/`mergeMethodToFlag`
imports at the top of the test file.

**Step 2: Run tests to verify they fail**

Run: `npm test 2>&1 | grep -A2 "RELEASE_BRANCH_PREFIX\|assertTokenValidatorsComplete"`
Expected: FAIL — token/export doesn't exist yet.

**Step 3: Implement**

In `lib/render.mjs`, extend `TOKEN_VALIDATORS` and `TOKEN_TO_PARAM`, and add the exported
self-check function, called once at module load against the real singletons:

```js
// Prefix tokens for gitflow's release/*  and hotfix/*  head.ref match guards. Same
// UNSAFE_YAML_STRING_RE validation as DEV_BRANCH/MAIN_BRANCH — these substitute into
// an identical single-quoted YAML string-comparison context.
const TOKEN_VALIDATORS = Object.freeze({
  DEV_BRANCH: (v) => !UNSAFE_YAML_STRING_RE.test(v),
  MAIN_BRANCH: (v) => !UNSAFE_YAML_STRING_RE.test(v),
  MERGE_FLAG: () => true,
  RELEASE_CREDENTIAL_SECRET: (v) => SAFE_SECRET_NAME_RE.test(v),
  RELEASE_BRANCH_PREFIX: (v) => !UNSAFE_YAML_STRING_RE.test(v),
  HOTFIX_BRANCH_PREFIX: (v) => !UNSAFE_YAML_STRING_RE.test(v),
});

const TOKEN_TO_PARAM = Object.freeze({
  DEV_BRANCH: 'devBranch',
  MAIN_BRANCH: 'mainBranch',
  MERGE_FLAG: 'mergeFlag',
  RELEASE_CREDENTIAL_SECRET: 'releaseCredentialSecret',
  RELEASE_BRANCH_PREFIX: 'releaseBranchPrefix',
  HOTFIX_BRANCH_PREFIX: 'hotfixBranchPrefix',
});

// INV-MP-12: every TOKEN_TO_PARAM key must have a matching TOKEN_VALIDATORS key, or a
// substituted value could reach a template with zero validation (the exact class of
// gap a 2026-07-15 Siege audit found and fixed). Called once at module load against
// the real exported objects; also independently callable so a unit test can assert
// the logic itself (not just today's two maps happening to agree) by passing in
// deliberately-mismatched local fixture objects.
export function assertTokenValidatorsComplete(tokenToParam, tokenValidators) {
  const missing = Object.keys(tokenToParam).filter((key) => !(key in tokenValidators));
  if (missing.length > 0) {
    throw new Error(`assertTokenValidatorsComplete: TOKEN_VALIDATORS missing entr(y/ies) for: ${missing.join(', ')}`);
  }
}
assertTokenValidatorsComplete(TOKEN_TO_PARAM, TOKEN_VALIDATORS);
```

Note: `TOKEN_TO_PARAM` is referenced by `renderTemplate` above its own declaration in the current
file (function hoisting handles this for `renderTemplate` itself, but the module-load call to
`assertTokenValidatorsComplete` must come **after** both `const` declarations — place it at the
bottom of the file, after `TOKEN_TO_PARAM`'s declaration, not interleaved between the two
`Object.freeze` blocks.

**Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all previous 57 + 4 new = 61 passing, 0 failing.

**Step 5: Commit**

```bash
git add lib/render.mjs tests/render.test.mjs
git commit -m "feat(shipflow): add RELEASE_BRANCH_PREFIX/HOTFIX_BRANCH_PREFIX tokens + validator-completeness self-check"
```

---

## Task 2: Extract `dev-main-promotion` into its own pattern module

This is a **behavior-preserving refactor** — no test should change meaning, only where the logic
lives. Existing tests must stay green throughout.

**Files:**
- Create: `lib/patterns/dev-main-promotion/index.mjs`
- Create: `templates/dev-main-promotion/dev-to-main-automerge.yml.tmpl` (moved from
  `templates/dev-to-main-automerge.yml.tmpl`)
- Modify: `tests/render.test.mjs` — repoint its module-level `AUTOMERGE_TEMPLATE_SOURCE`
  `readFileSync` path (see Step 1a below)
- Modify: `tests/template-validity.test.mjs` — repoint the same constant (see Step 1a)
- Test: `tests/patterns/dev-main-promotion.test.mjs` (new)
- Tests to verify unchanged (after Step 1a): `tests/detect.test.mjs`, `tests/plan.test.mjs`,
  `tests/apply.test.mjs`

**Step 1: Move the template file**

```bash
mkdir -p templates/dev-main-promotion
git mv templates/dev-to-main-automerge.yml.tmpl templates/dev-main-promotion/dev-to-main-automerge.yml.tmpl
```

**Step 1a: Fix the two test files with a module-level hardcoded read of the old path.**
`tests/render.test.mjs` and `tests/template-validity.test.mjs` both do, at module load (not
inside a test — a crash here fails every test in the file, not one assertion):

```js
const AUTOMERGE_TEMPLATE_SOURCE = readFileSync(
  join(SKILL_ROOT, 'templates', 'dev-to-main-automerge.yml.tmpl'),
  'utf8'
);
```

The `git mv` above makes this path `ENOENT`. In BOTH files, change the path segment to
`'templates', 'dev-main-promotion', 'dev-to-main-automerge.yml.tmpl'`. Do this in the SAME commit
as the `git mv` — do not defer it, or `npm test` fails at module load for the rest of this task
list, masking every other task's real pass/fail signal.

Run `npm test` immediately after this one-line change in both files (before writing any other
code in this task) to confirm the suite is back to its pre-move green baseline (57 passing) —
this is a checkpoint, not the task's real Step 2/3/4 below.

**Step 2: Write the failing test for the new module**

Create `tests/patterns/dev-main-promotion.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  id, templateTargetPaths, protectedBranches, templates, detect, planEntries,
} from '../../lib/patterns/dev-main-promotion/index.mjs';

test('id matches directory name', () => {
  assert.strictEqual(id, 'dev-main-promotion');
});

test('templateTargetPaths is the one dev-to-main-automerge target', () => {
  assert.deepStrictEqual(templateTargetPaths, ['.github/workflows/dev-to-main-automerge.yml']);
});

test('protectedBranches returns [dev, main]', () => {
  assert.deepStrictEqual(
    protectedBranches({ branches: { dev: 'develop', main: 'main' } }),
    ['develop', 'main']
  );
});

test('templates returns one entry pointing at the relocated template', () => {
  const config = {
    branches: { dev: 'dev', main: 'main' },
    mergeMethod: { devToMainMethod: 'merge' },
    release: { releaseCredential: 'RELEASE_PAT' },
  };
  const entries = templates(config);
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].targetPath, '.github/workflows/dev-to-main-automerge.yml');
  assert.match(entries[0].templateSourcePath, /dev-main-promotion\/dev-to-main-automerge\.yml\.tmpl$/);
  assert.deepStrictEqual(entries[0].params, {
    devBranch: 'dev', mainBranch: 'main', mergeFlag: '--merge', releaseCredentialSecret: 'RELEASE_PAT',
  });
});

test('detect: +0.5 dev/develop/staging branch AND no release/hotfix branch; +0.5 restricted promotion workflow', () => {
  const signals = {
    hasDevBranch: true, hasReleaseOrHotfixBranch: false,
    hasRestrictedPromotionWorkflow: true, hasUnrestrictedAutomergeWorkflow: false,
    hasTagsFromMain: false, hasGitflowMarker: false,
  };
  const result = detect(signals);
  assert.strictEqual(result.score, 1.0);
});

test('detect: scores 0 when a release/hotfix branch is present (gitflow territory)', () => {
  const signals = {
    hasDevBranch: true, hasReleaseOrHotfixBranch: true,
    hasRestrictedPromotionWorkflow: false, hasUnrestrictedAutomergeWorkflow: false,
    hasTagsFromMain: false, hasGitflowMarker: false,
  };
  assert.strictEqual(detect(signals).score, 0);
});

test('planEntries returns an empty array (no pattern-specific entries beyond the 3 common ones)', () => {
  assert.deepStrictEqual(planEntries({}, {}), []);
});
```

**Step 3: Run to verify it fails**

Run: `node --test tests/patterns/dev-main-promotion.test.mjs`
Expected: FAIL — module doesn't exist.

**Step 4: Implement the module**

Create `lib/patterns/dev-main-promotion/index.mjs`:

```js
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeMethodToFlag } from '../../render.mjs';

const PATTERN_DIR = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_SOURCE_PATH = join(
  PATTERN_DIR, '..', '..', '..', 'templates', 'dev-main-promotion', 'dev-to-main-automerge.yml.tmpl'
);
const TARGET_PATH = '.github/workflows/dev-to-main-automerge.yml';

export const id = 'dev-main-promotion';
export const templateTargetPaths = [TARGET_PATH];

export function protectedBranches(config) {
  return [config.branches.dev, config.branches.main];
}

export function templates(config) {
  return [{
    id: 'dev-to-main-automerge',
    targetPath: TARGET_PATH,
    templateSourcePath: TEMPLATE_SOURCE_PATH,
    params: {
      devBranch: config.branches.dev,
      mainBranch: config.branches.main,
      mergeFlag: mergeMethodToFlag(config.mergeMethod?.devToMainMethod),
      releaseCredentialSecret: config.release?.releaseCredential ?? 'GITHUB_TOKEN',
    },
  }];
}

// signals: precomputed DetectionSignals (see pattern-registry.mjs's computeDetectionSignals).
export function detect(signals) {
  const evidence = [];
  let score = 0;
  if (signals.hasDevBranch && !signals.hasReleaseOrHotfixBranch) {
    score += 0.5;
    evidence.push('a dev/develop/staging branch exists with no release/*  or hotfix/*  branches present');
  }
  if (signals.hasRestrictedPromotionWorkflow) {
    score += 0.5;
    evidence.push('an existing workflow restricts auto-merge-to-main to one specific branch');
  }
  return { score, evidence };
}

export function planEntries(_repoState, _config) {
  return [];
}
```

**Step 5: Run to verify it passes**

Run: `node --test tests/patterns/dev-main-promotion.test.mjs`
Expected: PASS, all 7 new tests.

**Step 6: Commit**

```bash
git add lib/patterns/dev-main-promotion/index.mjs templates/dev-main-promotion tests/patterns/dev-main-promotion.test.mjs
git commit -m "feat(shipflow): extract dev-main-promotion into its own pattern module"
```

(Existing tests will fail at this point since `detect.mjs`/`plan.mjs`/`apply.mjs`/`bin/shipflow.js`
still reference the old template path — Task 5-8 fix this. Commit anyway; this is one step in a
larger atomic sequence and the plan tracks it task-by-task, not commit-by-green-suite. If your
workflow prefers a fully-green commit at every step, squash Tasks 2 through 8 into one commit
instead — see the note at the end of Task 8.)

---

## Task 3: `pattern-registry.mjs` — registry + signal computation + classification

**Execution order note (do this first):** `pattern-registry.mjs`'s top-level
`import * as githubFlow from './patterns/github-flow/index.mjs'` (and gitflow's) is a real ESM
import, not lazy — it resolves at module load, before any test runs. **Do Task 4 (below) first**
— create the two minimal stub modules — before writing this task's Step 3 implementation, or
Step 4's verification hits a hard module-resolution error instead of the "worked examples fail
against a zero-scoring stub" outcome this task expects. Task 4 is deliberately placed after this
task in the document for narrative flow (it's easier to explain "here's the registry, and here's
what unblocks it" in that order) — but mechanically, build order is: Task 4's stubs, then this
task's Steps 1-4.

**Files:**
- Create: `lib/pattern-registry.mjs`
- Test: `tests/pattern-registry.test.mjs`

**Step 1: Write the failing tests**

Create `tests/pattern-registry.test.mjs` with the design doc's 5 hand-verified worked examples as
fixtures (these are the load-bearing regression tests for the whole autodetection feature):

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listPatterns, resolvePattern, scoreAll, computeDetectionSignals, classify } from '../lib/pattern-registry.mjs';

test('listPatterns returns all 3 patterns with their templateTargetPaths', () => {
  const patterns = listPatterns();
  assert.deepStrictEqual(patterns.map((p) => p.id).sort(), ['dev-main-promotion', 'github-flow', 'gitflow']);
  const devMain = patterns.find((p) => p.id === 'dev-main-promotion');
  assert.deepStrictEqual(devMain.templateTargetPaths, ['.github/workflows/dev-to-main-automerge.yml']);
});

test('resolvePattern defaults to dev-main-promotion when workflowPattern is absent', () => {
  assert.strictEqual(resolvePattern({}).id, 'dev-main-promotion');
  assert.strictEqual(resolvePattern({ branches: { main: 'main', dev: 'dev' } }).id, 'dev-main-promotion');
});

test('resolvePattern honors an explicit workflowPattern', () => {
  assert.strictEqual(resolvePattern({ workflowPattern: 'github-flow' }).id, 'github-flow');
});

// --- The 5 worked examples from the design doc's Autodetection section ---

test('worked example: bare repo (only main) -> Greenfield', () => {
  const signals = {
    hasDevBranch: false, hasReleaseOrHotfixBranch: false, hasGitflowMarker: false,
    hasRestrictedPromotionWorkflow: false, hasUnrestrictedAutomergeWorkflow: false, hasTagsFromMain: false,
  };
  const ranked = scoreAll.__scoreFromSignals(signals); // see Step 3 note on test seam
  assert.strictEqual(ranked[0].score, 0.3); // github-flow's absence-only bonus
  assert.strictEqual(ranked[0].id, 'github-flow');
  assert.strictEqual(classify(ranked), 'greenfield');
});

test('worked example: this repo\'s own real shape -> Confident dev-main-promotion', () => {
  const signals = {
    hasDevBranch: true, hasReleaseOrHotfixBranch: false, hasGitflowMarker: false,
    hasRestrictedPromotionWorkflow: true, hasUnrestrictedAutomergeWorkflow: false, hasTagsFromMain: true,
  };
  const ranked = scoreAll.__scoreFromSignals(signals);
  assert.strictEqual(ranked[0].id, 'dev-main-promotion');
  assert.strictEqual(ranked[0].score, 1.0);
  assert.strictEqual(classify(ranked), 'confident');
});

test('worked example: clean github-flow signal -> Confident github-flow', () => {
  const signals = {
    hasDevBranch: false, hasReleaseOrHotfixBranch: false, hasGitflowMarker: false,
    hasRestrictedPromotionWorkflow: false, hasUnrestrictedAutomergeWorkflow: true, hasTagsFromMain: false,
  };
  const ranked = scoreAll.__scoreFromSignals(signals);
  assert.strictEqual(ranked[0].id, 'github-flow');
  assert.strictEqual(ranked[0].score, 0.8);
  assert.strictEqual(classify(ranked), 'confident');
});

test('worked example: clean gitflow signal (develop + open release branch) -> Confident gitflow', () => {
  const signals = {
    hasDevBranch: true, hasReleaseOrHotfixBranch: true, hasGitflowMarker: false,
    hasRestrictedPromotionWorkflow: false, hasUnrestrictedAutomergeWorkflow: false, hasTagsFromMain: false,
  };
  const ranked = scoreAll.__scoreFromSignals(signals);
  assert.strictEqual(ranked[0].id, 'gitflow');
  assert.strictEqual(ranked[0].score, 1.0);
  assert.strictEqual(classify(ranked), 'confident');
});

test('worked example: lone hotfix branch, no develop -> Ambiguous (residual)', () => {
  const signals = {
    hasDevBranch: false, hasReleaseOrHotfixBranch: true, hasGitflowMarker: false,
    hasRestrictedPromotionWorkflow: false, hasUnrestrictedAutomergeWorkflow: false, hasTagsFromMain: false,
  };
  const ranked = scoreAll.__scoreFromSignals(signals);
  assert.strictEqual(ranked[0].id, 'gitflow');
  assert.strictEqual(ranked[0].score, 0.5);
  assert.strictEqual(classify(ranked), 'ambiguous');
});

test('classify is exhaustive by construction: confident, else greenfield, else ambiguous', () => {
  assert.strictEqual(classify([{ score: 0.9 }, { score: 0.1 }]), 'confident');
  assert.strictEqual(classify([{ score: 0.2 }, { score: 0 }]), 'greenfield');
  assert.strictEqual(classify([{ score: 0.5 }, { score: 0.4 }]), 'ambiguous'); // top<0.7
  assert.strictEqual(classify([{ score: 0.9 }, { score: 0.7 }]), 'ambiguous'); // gap not >0.3
});

// --- Branch-name remote-prefix normalization (the design's F1 fix, round 5) ---
// computeDetectionSignals takes a full repoState (single param, per the contract's
// scoreAll(repoState) signature) — repoState.configuredRemotes is populated by
// detect.mjs (Task 7), not fetched here, so this is a pure function test with no
// git calls of its own.

test('computeDetectionSignals strips an exact configured-remote-name prefix (origin/dev -> dev)', () => {
  const repoState = {
    branches: { local: ['main', 'origin/dev'] },
    configuredRemotes: ['origin'],
    hasGitflowMarker: false, hasRestrictedPromotionWorkflow: false,
    hasUnrestrictedAutomergeWorkflow: false, hasTagsFromMain: false,
  };
  const signals = computeDetectionSignals(repoState);
  assert.strictEqual(signals.hasDevBranch, true);
});

test('computeDetectionSignals leaves a local release/*  branch untouched (no blind strip-to-first-slash)', () => {
  const repoState = {
    branches: { local: ['main', 'release/1.2.0'] },
    configuredRemotes: ['origin'], // 'release' is not a configured remote name
    hasGitflowMarker: false, hasRestrictedPromotionWorkflow: false,
    hasUnrestrictedAutomergeWorkflow: false, hasTagsFromMain: false,
  };
  const signals = computeDetectionSignals(repoState);
  assert.strictEqual(signals.hasReleaseOrHotfixBranch, true);
});
```

**Step 2: Run to verify it fails**

Run: `node --test tests/pattern-registry.test.mjs`
Expected: FAIL — module doesn't exist.

**Step 3: Implement**

Create `lib/pattern-registry.mjs`. Note on the test seam above: rather than exposing a private
`__scoreFromSignals`, the cleaner real implementation takes a `repoState`-shaped input everywhere
externally but internally separates signal computation from scoring so tests CAN pass a
`DetectionSignals` object directly. Implement it as:

```js
import * as devMainPromotion from './patterns/dev-main-promotion/index.mjs';
import * as githubFlow from './patterns/github-flow/index.mjs';       // real logic lands in Task 9
import * as gitflow from './patterns/gitflow/index.mjs';               // real logic lands in Task 11

const PATTERNS = [devMainPromotion, githubFlow, gitflow];

export function listPatterns() {
  return PATTERNS.map((p) => ({ id: p.id, templateTargetPaths: p.templateTargetPaths }));
}

export function resolvePattern(config) {
  const wanted = config?.workflowPattern ?? 'dev-main-promotion';
  const found = PATTERNS.find((p) => p.id === wanted);
  if (!found) throw new Error(`resolvePattern: unknown workflowPattern "${wanted}"`);
  return found;
}

// Strips a leading '<remote>/' ONLY when it exactly matches one of repoState's
// configuredRemotes — never a blind "strip to first slash," which would corrupt a
// purely local release/1.2.0 into 1.2.0. configuredRemotes is populated by
// detect.mjs (Task 7) via `git remote` — this function takes the already-collected
// repoState, no git calls of its own, keeping it a pure, easily-testable function.
function normalizeBranchName(name, remotes) {
  for (const remote of remotes) {
    if (name.startsWith(`${remote}/`)) return name.slice(remote.length + 1);
  }
  return name;
}

const DEV_BRANCH_RE = /^(dev|develop|staging)$/;
const RELEASE_HOTFIX_RE = /^(release|hotfix)\//;

// Computes the 6 shared boolean signals every pattern's detect() consumes. Pure
// given its single repoState input (matches the contract's scoreAll(repoState)
// signature — repoPath/git calls stay confined to detect.mjs's collection step,
// Task 7 — repoState must already carry the raw material (branches,
// configuredRemotes, tags, .gitflow marker, workflow-shape scan) that step gathers.
export function computeDetectionSignals(repoState) {
  const remotes = repoState.configuredRemotes ?? [];
  const normalized = (repoState.branches?.local ?? []).map((b) => normalizeBranchName(b, remotes));
  return {
    hasDevBranch: normalized.some((b) => DEV_BRANCH_RE.test(b)),
    hasReleaseOrHotfixBranch: normalized.some((b) => RELEASE_HOTFIX_RE.test(b)),
    hasGitflowMarker: repoState.hasGitflowMarker ?? false,
    hasRestrictedPromotionWorkflow: repoState.hasRestrictedPromotionWorkflow ?? false,
    hasUnrestrictedAutomergeWorkflow: repoState.hasUnrestrictedAutomergeWorkflow ?? false,
    hasTagsFromMain: repoState.hasTagsFromMain ?? false,
  };
}

function scoreFromSignals(signals) {
  return PATTERNS.map((p) => ({ id: p.id, ...p.detect(signals) })).sort((a, b) => b.score - a.score);
}

export function scoreAll(repoState) {
  return scoreFromSignals(computeDetectionSignals(repoState));
}
// Test-only seam: exercise scoring against a hand-built DetectionSignals object
// directly, bypassing computeDetectionSignals/repoState entirely. Not part of the
// public CLI-facing API — the 5 worked-example tests above use this seam because
// they're testing the SCORING rules in isolation; the two normalization tests
// above instead call computeDetectionSignals(repoState) directly, since THAT is
// what those tests are about. Attaching a property to an exported `function`
// declaration works fine in ESM (the export binding is the function object
// itself, and function objects are ordinary mutable objects) — this is not the
// same footgun as trying to reassign a `const`-exported binding from outside the
// module, which ESM does forbid.
scoreAll.__scoreFromSignals = scoreFromSignals;

// Confident: top >= 0.7 AND (top - second) > 0.3. Greenfield: top < 0.4. Else
// Ambiguous — the residual/else branch, no separate condition to satisfy, which is
// what makes this exhaustive by construction (see design doc's Autodetection section).
export function classify(ranked) {
  const [top, second] = ranked;
  const secondScore = second?.score ?? 0;
  if (top.score >= 0.7 && top.score - secondScore > 0.3) return 'confident';
  if (top.score < 0.4) return 'greenfield';
  return 'ambiguous';
}
```

**Step 4: Run to verify it passes**

Run: `node --test tests/pattern-registry.test.mjs`
Expected: PASS once Task 4's stub `github-flow`/`gitflow` modules exist (`id`/`templateTargetPaths`/
a `detect` returning `{score: 0, evidence: []}` /`protectedBranches`/`templates`/`planEntries`
returning empty) — see the Execution order note at the top of this task. The `listPatterns`/
`resolvePattern`/normalization tests pass immediately against the stubs; the 5 worked-example
tests that depend on github-flow/gitflow's REAL scoring (bare-repo Greenfield, clean-github-flow-
signal, clean-gitflow-signal, ambiguous-residual) will still fail until Task 9 and Task 11 replace
the stubs with real logic — Task 10 (github-flow) and Task 12 (full-suite re-verification) are
where those specific assertions turn green. This is expected, not a bug at this point in the
sequence.

**Step 5: Commit**

```bash
git add lib/pattern-registry.mjs tests/pattern-registry.test.mjs
git commit -m "feat(shipflow): add pattern-registry with deterministic autodetection scoring"
```

---

## Task 4: Stub `github-flow` and `gitflow` modules (unblock Task 3, filled in later)

**Files:**
- Create: `lib/patterns/github-flow/index.mjs` (stub)
- Create: `lib/patterns/gitflow/index.mjs` (stub)

**Step 1: Implement minimal stubs**

```js
// lib/patterns/github-flow/index.mjs
export const id = 'github-flow';
export const templateTargetPaths = ['.github/workflows/main-automerge.yml'];
export function detect() { return { score: 0, evidence: [] }; }
export function protectedBranches(config) { return [config.branches.main]; }
export function templates() { return []; }
export function planEntries() { return []; }
```

```js
// lib/patterns/gitflow/index.mjs
export const id = 'gitflow';
export const templateTargetPaths = [
  '.github/workflows/release-automerge.yml',
  '.github/workflows/hotfix-automerge.yml',
  '.github/workflows/hotfix-merge-back.yml',
  '.github/workflows/release-merge-back.yml',
];
export function detect() { return { score: 0, evidence: [] }; }
export function protectedBranches(config) { return [config.branches.dev, config.branches.main]; }
export function templates() { return []; }
export function planEntries() { return []; }
```

**Step 2: Run Task 3's tests**

Run: `node --test tests/pattern-registry.test.mjs`
Expected: `listPatterns`/`resolvePattern` tests PASS; worked-example tests for github-flow/gitflow
FAIL (stub always scores 0) — expected at this point, fixed in Tasks 10 and 14.

**Step 3: Commit**

```bash
git add lib/patterns/github-flow/index.mjs lib/patterns/gitflow/index.mjs
git commit -m "chore(shipflow): stub github-flow/gitflow pattern modules"
```

---

## Task 5: Generalize `plan.mjs`

**Files:**
- Modify: `lib/plan.mjs`
- Test: `tests/plan.test.mjs` (extend)

**Step 1: Write failing tests**

Add to `tests/plan.test.mjs`:

```js
test('computePlan accepts a templateSources map (plural) keyed by template id', () => {
  const config = { workflowPattern: 'dev-main-promotion', branches: { dev: 'dev', main: 'main' },
    mergeMethod: { devToMainMethod: 'merge' }, release: { releaseCredential: 'RELEASE_PAT' },
    branchCleanup: {}, protectionOwner: 'external' };
  const repoState = { /* ...minimal fixture matching existing test fixtures... */ stateHash: 'x',
    templateFiles: {}, repoSettings: {}, rulesets: [], protection: {}, releasePendingLabelExists: true };
  const plan = computePlan(repoState, config, { 'dev-to-main-automerge': 'name: {{DEV_BRANCH}}' });
  assert.ok(Array.isArray(plan.creates) || Array.isArray(plan.updates) || Array.isArray(plan.noops));
});

test('computePlan returns Plan.protectedBranches computed from the resolved pattern', () => {
  const config = { workflowPattern: 'dev-main-promotion', branches: { dev: 'develop', main: 'main' },
    mergeMethod: { devToMainMethod: 'merge' }, release: {}, branchCleanup: {}, protectionOwner: 'external' };
  const repoState = { stateHash: 'x', templateFiles: {}, repoSettings: {}, rulesets: [], protection: {},
    releasePendingLabelExists: true };
  // dev-main-promotion's one template entry is keyed 'dev-to-main-automerge' — computePlan
  // throws on a missing templateSources key (Step 3 below), so this map can't be empty even
  // though this test only cares about the protectedBranches field, not the template output.
  const plan = computePlan(repoState, config, { 'dev-to-main-automerge': 'name: {{DEV_BRANCH}}' });
  assert.deepStrictEqual(plan.protectedBranches, ['develop', 'main']);
});
```

Adjust these fixtures to match whatever minimal `repoState` shape the existing `plan.test.mjs`
fixtures already use — read the existing file first and reuse its fixture-building helper rather
than duplicating it.

**Step 2: Run to verify failure**

Run: `node --test tests/plan.test.mjs`
Expected: FAIL — old signature takes a single string, `Plan.protectedBranches` doesn't exist.

**Step 3: Implement**

Rewrite `lib/plan.mjs`'s `computePlan` to:
- Accept `templateSources: Record<string, string>` as its third parameter (was: single string).
- Resolve the pattern via `resolvePattern(config)` (import from `./pattern-registry.mjs`).
- Compute `protectedBranches` via `pattern.protectedBranches(config)` — used for BOTH the
  `delete-branch-on-merge`-adjacent `deletion-ruleset` entry AND the new `Plan.protectedBranches`
  output field.
- Loop over `pattern.templates(config)` (not a single hardcoded template), building one plan entry
  per returned `{id, targetPath, templateSourcePath, params}` — look up that entry's rendered
  source from `templateSources[id]` (the caller-supplied map), erroring clearly if a key is
  missing.
- Keep `delete-branch-on-merge` logic exactly as-is (repo-wide boolean, no branch-name
  involvement — this was Round 6's correction, don't reintroduce branch-list coupling here).
- `deletion-ruleset`'s "already exists" coarse check stays as-is; only the *branches it would
  protect* (used in the plan description string, not in this file's own mutation — that's
  apply.mjs's job) comes from `pattern.protectedBranches(config)`.
- Return shape gains one field: `{ creates, updates, noops, sourceStateHash, liveRequiredChecks,
  protectedBranches }`.

```js
import { resolvePattern } from './pattern-registry.mjs';
import { sha256 } from './gh.mjs';

export function computePlan(repoState, config, templateSources) {
  const pattern = resolvePattern(config);
  const protectedBranchList = pattern.protectedBranches(config);
  const creates = [];
  const updates = [];
  const noops = [];

  // 1. delete_branch_on_merge — unchanged, repo-wide boolean, no branch names involved.
  const wantDeleteOnMerge = config.branchCleanup?.deleteOnMerge ?? true;
  const haveDeleteOnMerge = repoState.repoSettings?.deleteBranchOnMerge;
  if (haveDeleteOnMerge === wantDeleteOnMerge) {
    noops.push({ id: 'delete-branch-on-merge', description: 'delete_branch_on_merge already set correctly' });
  } else {
    updates.push({ id: 'delete-branch-on-merge', description: `set delete_branch_on_merge to ${wantDeleteOnMerge}`, desired: wantDeleteOnMerge });
  }

  // 2. deletion-ruleset — protects protectedBranchList, not a hardcoded [dev, main].
  // Description strings below are copied VERBATIM from the pre-existing (single-pattern)
  // plan.mjs, not rephrased — this repo's own live .github/shipflow.json has
  // protectionOwner: "external", so Task 8/15's dogfood smoke test
  // (`node bin/shipflow.js plan --repo .../claude-skills`) exercises this exact else-branch
  // and must reproduce byte-identical plan-entry text, not just equivalent behavior.
  if (config.protectionOwner === 'shipflow') {
    if ((repoState.rulesets ?? []).length > 0) {
      noops.push({ id: 'deletion-ruleset', description: 'a ruleset already exists (coarse check — see plan.mjs comment)' });
    } else {
      creates.push({ id: 'deletion-ruleset', description: `create a ruleset protecting ${protectedBranchList.join('/')} from deletion` });
    }
  } else {
    noops.push({ id: 'deletion-ruleset', description: `protectionOwner is "${config.protectionOwner}" — deferring to existing mechanism, shipflow installs nothing` });
  }

  // 3. per-pattern templates — generalized from one hardcoded entry to N.
  for (const entry of pattern.templates(config)) {
    const templateSource = templateSources[entry.id];
    if (templateSource === undefined) {
      throw new Error(`computePlan: no templateSources entry for template id "${entry.id}"`);
    }
    const planEntry = computeTemplatePlanEntry(repoState, config, entry, templateSource);
    if (planEntry.kind === 'noop') noops.push(planEntry);
    else if (planEntry.kind === 'create') creates.push(planEntry);
    else updates.push(planEntry);
  }

  // 4. release-pending label — unconditional across every release.mode and pattern.
  if (repoState.releasePendingLabelExists) {
    noops.push({ id: 'release-pending-label', description: 'release-pending label already exists' });
  } else {
    creates.push({ id: 'release-pending-label', description: 'create the release-pending label' });
  }

  // 5. pattern-specific entries beyond the 4 common ones above (empty for all 3 v1 patterns).
  for (const entry of pattern.planEntries(repoState, config)) {
    if (entry.kind === 'noop') noops.push(entry);
    else if (entry.kind === 'create') creates.push(entry);
    else updates.push(entry);
  }

  const classicChecks = repoState.protection?.[config.branches.main]?.requiredChecks ?? [];
  const rulesetChecks = (repoState.rulesets ?? []).flatMap((rs) => rs.requiredChecks ?? []);
  const liveRequiredChecks = [...new Set([...classicChecks, ...rulesetChecks])].sort();

  return { creates, updates, noops, sourceStateHash: repoState.stateHash, liveRequiredChecks, protectedBranches: protectedBranchList };
}

// entry is one {id, targetPath, templateSourcePath, params} item from
// pattern.templates(config); templateSource is that entry's already-read-off-disk
// content (looked up from the caller-supplied templateSources map above).
//
// IMPORTANT: the returned plan entry's `id` field is NOT entry.id (the pattern
// module's own template identifier, e.g. 'release-automerge') — it MUST stay the
// pre-existing 'template:' + targetPath convention, because apply.mjs's dispatch
// (`entry.id.startsWith('template:')`) and the empty-required-checks refusal both
// key off that exact prefix today. Reusing the pattern module's own template id
// verbatim here would silently break both of those existing mechanisms.
function computeTemplatePlanEntry(repoState, config, entry, templateSource) {
  const planId = 'template:' + entry.targetPath;
  const renderedContent = renderTemplate(templateSource, entry.params);
  const freshHash = sha256(renderedContent);
  const onDisk = repoState.templateFiles?.[entry.targetPath];
  const lastRenderedHash = config.renderedTemplateHashes?.[entry.targetPath] ?? null;

  if (!onDisk || !onDisk.exists) {
    return { id: planId, kind: 'create', path: entry.targetPath, description: `write ${entry.targetPath}`, renderedHash: freshHash, content: renderedContent };
  }
  if (onDisk.sha256 === freshHash) {
    return { id: planId, kind: 'noop', path: entry.targetPath, description: `${entry.targetPath} already matches config` };
  }
  if (onDisk.sha256 === lastRenderedHash) {
    return { id: planId, kind: 'update', path: entry.targetPath, description: `re-render ${entry.targetPath} (config changed)`, renderedHash: freshHash, content: renderedContent, handEditDetected: false };
  }
  return {
    id: planId, kind: 'update', path: entry.targetPath,
    description: `${entry.targetPath} was hand-edited — blocked pending --force`,
    renderedHash: freshHash, content: renderedContent, handEditDetected: true,
  };
}
```

This is the SAME hash-diff/hand-edit-detection algorithm as the pre-existing (single-template)
`computeTemplatePlanEntry` in the current `lib/plan.mjs` — only the inputs changed (an `entry`
object instead of hardcoded constants, `templateSource` looked up per-entry instead of a single
module-level string). Move `import { renderTemplate } from './render.mjs'` and
`import { sha256 } from './gh.mjs'` to the top of the file if they aren't already there from the
pre-existing version. The pre-existing version's import line is
`import { renderTemplate, mergeMethodToFlag } from './render.mjs';` — drop `mergeMethodToFlag`
from it: every `mergeMethodToFlag` call now lives inside each pattern module's own `templates(config)`
(see Tasks 2/9/11), so `plan.mjs` itself has no remaining caller for it after this rewrite.

**Step 4: Run to verify it passes**

Run: `npm test`
Expected: `tests/plan.test.mjs`'s NEW tests pass; existing `plan.test.mjs` tests will need their
call sites updated from `computePlan(repoState, config, templateSourceString)` to
`computePlan(repoState, config, { 'dev-to-main-automerge': templateSourceString })` — update every
existing call site in that file (this is the one deliberate, contract-documented signature change;
see design doc's API surface section).

**Step 5: Commit**

```bash
git add lib/plan.mjs tests/plan.test.mjs
git commit -m "refactor(shipflow): generalize computePlan for multi-pattern templates + protectedBranches field"
```

---

## Task 6: Generalize `apply.mjs`

**Files:**
- Modify: `lib/apply.mjs`
- Test: `tests/apply.test.mjs` (extend/update call sites)

**Note on testability:** `applyOne` is a private, non-exported function in the current
`lib/apply.mjs`, and `tests/apply.test.mjs` today only tests the pure, exported
`classifyRulesetError` — there is no existing gh-mocking infrastructure in this file to invoke
`applyOne`'s network path directly, and there shouldn't need to be one just for this change.
Instead of testing the mutation through `applyOne`, **extract the ruleset request-body
construction into its own small, pure, exported function** — this is both easier to test (matches
this file's existing `classifyRulesetError` style exactly: pure, no I/O, directly assertable) and
is what actually closes Round 8's F2 finding cleanly: a pure function computing the body from
`protectedBranchList` can't accidentally read a stale stored config value, because it doesn't take
`config` at all.

**Step 1: Write the failing test**

Add to `tests/apply.test.mjs`:

```js
import { classifyRulesetError, buildDeletionRulesetBody } from '../lib/apply.mjs';

test('buildDeletionRulesetBody derives ref_name.include from the given branch list, not a hardcoded [dev, main]', () => {
  const body = buildDeletionRulesetBody(['develop', 'main']);
  assert.deepStrictEqual(body.conditions.ref_name.include, ['refs/heads/develop', 'refs/heads/main']);
  assert.strictEqual(body.name, 'shipflow-branch-deletion-protection');
  assert.strictEqual(body.rules[0].type, 'deletion');
});

test('buildDeletionRulesetBody works for github-flow\'s single-branch case', () => {
  const body = buildDeletionRulesetBody(['main']);
  assert.deepStrictEqual(body.conditions.ref_name.include, ['refs/heads/main']);
});
```

**Step 2: Run to verify failure**

Run: `node --test tests/apply.test.mjs`
Expected: FAIL — `buildDeletionRulesetBody` isn't exported yet.

**Step 3: Implement**

In `lib/apply.mjs`, extract the existing inline `JSON.stringify({...})` object construction (today
built directly inside `applyOne`'s `deletion-ruleset` branch, using hardcoded
`config.branches.dev`/`config.branches.main`) into its own pure, exported function, and change the
`deletion-ruleset` branch to call `resolvePattern(config).protectedBranches(config)` **fresh** —
never a stored `config.branchCleanup.protectedBranches` value — and pass the result in:

```js
import { resolvePattern } from './pattern-registry.mjs';

// Pure — no I/O, no gh calls. Exported so it's directly unit-testable without
// mocking the network layer, matching this file's existing classifyRulesetError
// pattern. protectedBranchList must come from a FRESH call to the resolved
// pattern's protectedBranches(config) — never from a stored config field — so
// this function intentionally takes a plain string array, not a config object,
// making "read a stale stored value" structurally impossible to do by accident.
export function buildDeletionRulesetBody(protectedBranchList) {
  return {
    name: 'shipflow-branch-deletion-protection',
    target: 'branch',
    enforcement: 'active',
    conditions: { ref_name: { include: protectedBranchList.map((b) => `refs/heads/${b}`), exclude: [] } },
    rules: [{ type: 'deletion' }],
  };
}

// inside applyOne(entry, { ownerRepo, repoPath, config }):
if (entry.id === 'deletion-ruleset') {
  const protectedBranchList = resolvePattern(config).protectedBranches(config);
  const body = JSON.stringify(buildDeletionRulesetBody(protectedBranchList));
  // ... rest unchanged (the spawnArgs('gh', ['api', ...], { input: body }) call) ...
}
```

Also generalize the `entry.id.startsWith('template:')` dispatch — it already writes based on
`entry.path`/`entry.content` generically, so this should need NO change; confirm by reading the
current file and only touching what's actually pattern-specific (the deletion-ruleset branch
above).

**Step 4: Run to verify it passes**

Run: `npm test`
Expected: all tests pass.

**Step 5: Commit**

```bash
git add lib/apply.mjs tests/apply.test.mjs
git commit -m "refactor(shipflow): apply.mjs computes protectedBranches fresh from the resolved pattern"
```

---

## Task 7: Generalize `detect.mjs`

**Files:**
- Modify: `lib/detect.mjs`
- Test: `tests/detect.test.mjs` (extend)

**Step 1: Write failing tests**

Add to `tests/detect.test.mjs`:

The existing `withTempRepo(fn)` helper does NOT `git init` — it only `mkdtempSync`s a throwaway
directory. That's sufficient for the file's existing tests because they all call low-level
functions directly with an explicit tracked-files array (`listWorkflowJobNames(dir, ['...'])`,
`findSettingsAsCodeArtifact(dir, ['...'])`) rather than going through `detectRepoState`, so none
of them ever shell out to `git`. The tests below call `detectRepoState(dir, ...)` directly, which
internally runs `git ls-files`, `git tag --merged`, and `git remote` — none of which work (or
worse, silently return empty/false rather than crashing, since `lib/gh.mjs`'s `git()` wrapper never
throws on a non-zero exit) against a directory with no `.git` at all. Add a second helper,
`withTempGitRepo(fn)`, that actually initializes a repo with one commit so these calls have
something real to operate on:

```js
function withTempGitRepo(fn) {
  withTempRepo((dir) => {
    // -b main pins the initial branch name explicitly rather than relying on the
    // ambient init.defaultBranch config (which varies by machine/CI image) — every
    // test below asserts against config.branches.main === 'main', so the repo's
    // actual default branch must match that literally, not "whatever this git
    // install happens to default to".
    spawnSync('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
    spawnSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: dir });
    spawnSync('git', ['config', 'user.name', 'Shipflow Test'], { cwd: dir });
    // git tag/tag --merged both require at least one commit to exist (there is no
    // valid HEAD to tag or compare against in a brand-new repo) — a placeholder
    // commit gives every test below a real commit to build on.
    writeFileSync(join(dir, 'README.md'), '# fixture repo\n');
    spawnSync('git', ['add', 'README.md'], { cwd: dir });
    spawnSync('git', ['commit', '--quiet', '-m', 'init'], { cwd: dir });
    fn(dir);
  });
}
```

`git ls-files` (what `listTrackedFiles` shells out to) only reflects the **index** — files that
have been `git add`ed, not merely written to disk. Any test below that writes new fixture files
AND expects `detectRepoState` to see them via tracked-file scanning (the two job-block tests) must
`git add` those files before calling `detectRepoState`; a test that only needs the repo to exist
(e.g. to make `git tag`/`git remote` succeed) does not.

Every test below is written as a callback passed to `withTempGitRepo`, not the plain
`withTempRepo` (`withTempRepo` stays as-is for the file's pre-existing tests — do not change
those):

```js
test('detectRepoState templateFiles covers every pattern\'s templateTargetPaths, not one hardcoded key', () => {
  withTempGitRepo((dir) => {
    const repoState = detectRepoState(dir, { branches: { main: 'main', dev: 'dev' } });
    const expectedKeys = listPatterns().flatMap((p) => p.templateTargetPaths);
    assert.deepStrictEqual(Object.keys(repoState.templateFiles).sort(), expectedKeys.sort());
  });
});

test('detectRepoState reports hasTagsFromMain', () => {
  withTempGitRepo((dir) => {
    git(['tag', 'v0.1.0'], { cwd: dir });
    const repoState = detectRepoState(dir, { branches: { main: 'main', dev: 'dev' } });
    assert.strictEqual(repoState.hasTagsFromMain, true);
  });
});

test('detectRepoState reports hasGitflowMarker via a .gitflow file', () => {
  // Plain withTempRepo is fine here — hasGitflowMarker is a pure existsSync check
  // (or a git-config read that fails closed to false), not tracked-file-list-backed,
  // so this test never needed a real repo. Left as withTempRepo deliberately, to
  // keep the "which helper does this test actually need" reasoning explicit rather
  // than defaulting every test to the heavier fixture.
  withTempRepo((dir) => {
    writeFileSync(join(dir, '.gitflow'), '[gitflow "branch"]\n\tmaster = main\n\tdevelop = develop\n');
    const repoState = detectRepoState(dir, { branches: { main: 'main', dev: 'dev' } });
    assert.strictEqual(repoState.hasGitflowMarker, true);
  });
});

test('detectRepoState scans a workflow\'s own job block, never a different job\'s head.ref == condition', () => {
  withTempGitRepo((dir) => {
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
    // Job A: gh pr merge --auto guarded by its own head.ref == 'dev'. Job B: an
    // unrelated job that also happens to contain a head.ref == check, for a
    // different purpose — this must NOT be attributed to job A.
    writeFileSync(join(dir, '.github', 'workflows', 'mixed.yml'), `
on:
  pull_request:
    branches: [main]
jobs:
  auto-merge:
    if: github.event.pull_request.head.ref == 'dev'
    steps:
      - run: gh pr merge --auto --merge "$PR"
  unrelated-job:
    if: github.event.pull_request.head.ref == 'something-else'
    steps:
      - run: echo hi
`);
    // detectRepoState finds workflow files via git ls-files (listTrackedFiles) —
    // they must be staged, not just written to disk, or the scanner never sees them.
    spawnSync('git', ['add', '-A'], { cwd: dir });
    const repoState = detectRepoState(dir, { branches: { main: 'main', dev: 'dev' } });
    assert.strictEqual(repoState.hasRestrictedPromotionWorkflow, true);
    assert.strictEqual(repoState.hasUnrestrictedAutomergeWorkflow, false);
  });
});

test('detectRepoState does NOT misattribute an unrelated job\'s head.ref == to an unrestricted auto-merge job in the same file', () => {
  withTempGitRepo((dir) => {
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
    // Job A: gh pr merge --auto with NO head.ref guard of its own (unrestricted).
    // Job B: unrelated, has a head.ref == check for something else entirely. If the
    // scan incorrectly spans the whole jobs: section (the bug this test guards
    // against), job B's condition would get misattributed to job A, and
    // hasRestrictedPromotionWorkflow would wrongly read true.
    writeFileSync(join(dir, '.github', 'workflows', 'mixed2.yml'), `
on:
  pull_request:
    branches: [main]
jobs:
  auto-merge:
    steps:
      - run: gh pr merge --auto --merge "$PR"
  unrelated-job:
    if: github.event.pull_request.head.ref == 'something-else'
    steps:
      - run: echo hi
`);
    spawnSync('git', ['add', '-A'], { cwd: dir });
    const repoState = detectRepoState(dir, { branches: { main: 'main', dev: 'dev' } });
    assert.strictEqual(repoState.hasUnrestrictedAutomergeWorkflow, true);
    assert.strictEqual(repoState.hasRestrictedPromotionWorkflow, false);
  });
});

test('detectRepoState reports configuredRemotes for pattern-registry.mjs\'s branch normalization', () => {
  withTempGitRepo((dir) => {
    git(['remote', 'add', 'origin', 'https://example.invalid/x/y.git'], { cwd: dir });
    const repoState = detectRepoState(dir, { branches: { main: 'main', dev: 'dev' } });
    assert.deepStrictEqual(repoState.configuredRemotes, ['origin']);
  });
});
```

`spawnSync` is already imported in this file (it backs the existing `withGitRemote` helper) — no
new import needed for it. Import `mkdirSync`, `writeFileSync` from `node:fs` and `join` from
`node:path` at the top of the test file if not already imported; import `listPatterns` from
`../lib/pattern-registry.mjs` and `git` from `../lib/gh.mjs` alongside the existing imports. Add
`detectRepoState` to the existing `../lib/detect.mjs` import (line 7's import currently lists only
`listWorkflowJobNames`, `findSettingsAsCodeArtifact`, `classifyProtectionOwner`,
`resolveOwnerRepo` — every test above calls `detectRepoState` directly, so it must be added to
that same import statement or all of them throw `ReferenceError`).

**Step 2: Run to verify failure**

Run: `node --test tests/detect.test.mjs`
Expected: FAIL — new fields/behavior don't exist yet.

**Step 3: Implement**

In `lib/detect.mjs`:

1. Replace the single `TEMPLATE_RELATIVE_PATH`-keyed `templateFiles` computation with a loop over
   `listPatterns().flatMap(p => p.templateTargetPaths)`, hashing whichever exist on disk (reuse the
   existing `readTemplateFileHash`-style helper, generalized to take a path parameter instead of
   the hardcoded constant).
2. Add `hasTagsFromMain`: `git(['tag', '--merged', branches.main], { cwd: repoPath })` — non-empty
   stdout means true.
3. Add `hasGitflowMarker`: `existsSync(join(repoPath, '.gitflow'))` OR
   `git(['config', '--get', 'gitflow.branch.develop'], { cwd: repoPath }).status === 0`.
4. Add `configuredRemotes`: `git(['remote'], { cwd: repoPath })`, split into lines, filtered
   non-empty — this is what lets `pattern-registry.mjs`'s `computeDetectionSignals` stay a pure,
   single-`repoState`-argument function with no git calls of its own (see Task 3's fix).
5. Add the new job-block-scoped workflow-shape heuristic (`hasRestrictedPromotionWorkflow`/
   `hasUnrestrictedAutomergeWorkflow`) — a new function alongside the existing
   `listWorkflowJobNames`, scanning each workflow file's individual job blocks (using the SAME
   `jobNameRe` the existing function already defines, but bounding each job's own line range rather
   than the whole `jobs:` section) for a `gh pr merge --auto` step, then checking whether a
   `head.ref ==` comparison appears within that same job's line range. **The outer scan loop must
   stop at the same column-0 dedent `listWorkflowJobNames` already stops at** — without that, a
   trailing top-level section after `jobs:` (e.g. `env:`/`concurrency:`) gets mis-scanned as more
   job candidates:

```js
const GH_PR_MERGE_AUTO_RE = /gh pr merge --auto/;
const HEAD_REF_EQ_RE = /head\.ref\s*==/;

// One level finer than listWorkflowJobNames()'s whole-jobs:-section boundary: bounds
// each INDIVIDUAL job's own line range (its jobNameRe-matching name line down to the
// next line at that same or lesser indent — the next sibling job, or EOF) so a
// head.ref == check in one job is never misattributed to a different job's
// gh pr merge --auto step in the same file.
export function scanWorkflowShapeSignals(repoPath, trackedFiles) {
  let restricted = false;
  let unrestricted = false;
  for (const f of trackedFiles.filter((f) => /^\.github\/workflows\/.*\.ya?ml$/.test(f))) {
    const full = join(repoPath, f);
    if (!existsSync(full)) continue;
    const lines = readFileCapped(full).split('\n');
    const jobsLineIdx = lines.findIndex((l) => l.trim() === 'jobs:');
    if (jobsLineIdx === -1) continue;
    let i = jobsLineIdx + 1;
    while (i < lines.length) {
      // Mirrors listWorkflowJobNames's own dedent-out-of-block termination: a line
      // that dedents all the way to column 0 ends the WHOLE jobs: section (a
      // trailing env:/concurrency: block, or EOF), not just the current job — stop
      // the outer scan entirely rather than treating it as another job candidate.
      if (lines[i].trim() !== '' && /^\S/.test(lines[i])) break;
      const nameMatch = lines[i].match(/^\s{2}([\w.-]+):\s*$/);
      if (!nameMatch) { i++; continue; }
      const jobStart = i;
      let jobEnd = lines.length;
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() === '') continue;
        if (/^\S/.test(lines[j])) { jobEnd = j; break; }          // dedents to column 0 — end of jobs: section
        if (lines[j].match(/^\s{2}([\w.-]+):\s*$/)) { jobEnd = j; break; } // next sibling job
      }
      const jobBlock = lines.slice(jobStart, jobEnd).join('\n');
      if (GH_PR_MERGE_AUTO_RE.test(jobBlock)) {
        if (HEAD_REF_EQ_RE.test(jobBlock)) restricted = true;
        else unrestricted = true;
      }
      i = jobEnd;
    }
  }
  return { hasRestrictedPromotionWorkflow: restricted, hasUnrestrictedAutomergeWorkflow: unrestricted };
}
```

6. Wire all of the above (`templateFiles` union, `hasTagsFromMain`, `hasGitflowMarker`,
   `configuredRemotes`, `hasRestrictedPromotionWorkflow`/`hasUnrestrictedAutomergeWorkflow`) into
   `detectRepoState`'s return object as top-level fields.

**Step 4: Run to verify it passes**

Run: `npm test`
Expected: all tests pass, including both job-boundary fixtures (restricted-correctly-attributed,
and unrestricted-not-misattributed) proving the scan never crosses a job's own line-range boundary.

**Step 5: Commit**

```bash
git add lib/detect.mjs tests/detect.test.mjs
git commit -m "refactor(shipflow): generalize detect.mjs for multi-pattern templateFiles + new autodetection signals"
```

---

## Task 8: Update `bin/shipflow.js`

**Files:**
- Modify: `bin/shipflow.js`
- Test: `tests/cli-apply-guards.test.mjs` (verify still passes; extend if it directly exercises
  `TEMPLATE_PATH`)

**Step 1: Implement `cmdPlan`/`cmdApply`'s templateSources wiring**

Replace the single hardcoded `TEMPLATE_PATH`/`readFileSync(TEMPLATE_PATH, 'utf8')` in `cmdPlan`/
`cmdApply` with: resolve the pattern via `resolvePattern(config)`, call `pattern.templates(config)`,
and build a `templateSources` map by reading each entry's `templateSourcePath` off disk, keyed by
`entry.id`:

```js
import { resolvePattern, scoreAll } from '../lib/pattern-registry.mjs';

function buildTemplateSources(config) {
  const pattern = resolvePattern(config);
  const sources = {};
  for (const entry of pattern.templates(config)) {
    sources[entry.id] = readFileSync(entry.templateSourcePath, 'utf8');
  }
  return sources;
}

// in cmdPlan and cmdApply, replace:
//   const templateSource = readFileSync(TEMPLATE_PATH, 'utf8');
//   plan = computePlan(repoState, config, templateSource);
// with:
//   const templateSources = buildTemplateSources(config);
//   plan = computePlan(repoState, config, templateSources);
```

Remove the now-unused `TEMPLATE_PATH` constant.

**Step 1a: Wire `scoreAll` into `cmdDetect`'s printed output.**

This is the actual autodetection surface `SKILL.md`'s first-run interview (Task 13) reads from —
no other task implements it, so it belongs here, alongside the other `bin/shipflow.js` changes.
`cmdDetect` currently prints `{ ...repoState, protectionOwnerClassification }`. Add a ranked-pattern
field, computed unconditionally (it's cheap — pure scoring over already-collected `repoState`).

Computing it unconditionally here does not conflict with the contract's INV-MP-4 ("detection only
runs when existingConfig is null"): that invariant constrains the SKILL.md setup-wizard's own
control flow (its re-run/audit branch must never invoke autodetection), not this CLI subcommand.
`cmdDetect` is a standalone, always-invocable diagnostic primitive — same category as `cmdPlan` —
and the wizard's re-run branch simply never calls it. See the contract's amended INV-MP-4 wording.

```js
function cmdDetect(args) {
  // ...existing parseArgs/repoState/protectionOwner code, unchanged...
  const rankedPatterns = scoreAll(repoState);
  printJson({ ...repoState, protectionOwnerClassification: protectionOwner, rankedPatterns });
}
```

Add one test to `tests/cli-apply-guards.test.mjs` (or a new `tests/cli-detect.test.mjs` if that
file is scoped to `apply`-only guards — check its existing scope first) asserting `detect`'s
printed JSON includes a `rankedPatterns` array with all 3 pattern ids present.

**Step 2: Run the full suite**

Run: `npm test`
Expected: all tests pass (this is the point where the full behavior-preserving refactor for
`dev-main-promotion` should be verified end-to-end — same 57+ original tests, now routed through
the registry instead of hardcoded logic, producing byte-identical output for a `dev-main-promotion`
config).

**Step 3: Manual smoke test (this repo dogfoods shipflow on itself)**

```bash
node bin/shipflow.js plan --repo /Users/natejswenson/localrepo/claude-skills
```

Expected: identical `plan` output shape to before this refactor (this repo's own
`.github/shipflow.json` has no `workflowPattern`, so it must resolve to `dev-main-promotion` and
produce a `noops`-only plan against already-correct live state — a concrete backward-compatibility
check, not just a unit-test assertion).

**Step 4: Commit**

```bash
git add bin/shipflow.js
git commit -m "refactor(shipflow): bin/shipflow.js builds a templateSources map via the resolved pattern"
```

*(Note: if you'd rather land Tasks 2–8 as one atomic commit instead of 7 separate ones — since
intermediate commits between Task 2 and Task 8 don't leave the suite green — that's a reasonable
call for this specific refactor. The task-by-task structure above is for your own incremental
verification; squash at the end if you prefer a single clean "extract pattern registry, zero
behavior change" commit for code review.)*

---

## Task 9: `github-flow` pattern — real implementation + template

**Files:**
- Modify: `lib/patterns/github-flow/index.mjs` (replace stub)
- Create: `templates/github-flow/main-automerge.yml.tmpl`
- Test: `tests/patterns/github-flow.test.mjs` (new)

**Step 1: Write failing tests**

Mirror Task 2's test structure for `dev-main-promotion`, adjusted for github-flow's rules:

```js
test('protectedBranches returns [main] only', () => {
  assert.deepStrictEqual(protectedBranches({ branches: { main: 'main' } }), ['main']);
});

test('detect: +0.5 unrestricted-workflow-or-tags, +0.3 absence-of-dev-and-release-branches', () => {
  assert.strictEqual(detect({
    hasDevBranch: false, hasReleaseOrHotfixBranch: false,
    hasUnrestrictedAutomergeWorkflow: true, hasTagsFromMain: false, hasGitflowMarker: false, hasRestrictedPromotionWorkflow: false,
  }).score, 0.8);
});

test('detect: bare repo scores 0.3 (absence bonus only, no positive signal)', () => {
  assert.strictEqual(detect({
    hasDevBranch: false, hasReleaseOrHotfixBranch: false,
    hasUnrestrictedAutomergeWorkflow: false, hasTagsFromMain: false, hasGitflowMarker: false, hasRestrictedPromotionWorkflow: false,
  }).score, 0.3);
});

test('templates returns one entry, no head-ref restriction, reuses MAIN_BRANCH/MERGE_FLAG/RELEASE_CREDENTIAL_SECRET (no new tokens)', () => {
  const entries = templates({ branches: { main: 'main' }, mergeMethod: { devToMainMethod: 'squash' }, release: { releaseCredential: 'RELEASE_PAT' } });
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].targetPath, '.github/workflows/main-automerge.yml');
});
```

**Step 2: Run to verify failure**

Run: `node --test tests/patterns/github-flow.test.mjs`
Expected: FAIL against the stub (always scores 0, wrong template count).

**Step 3: Implement the module**

```js
// lib/patterns/github-flow/index.mjs
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeMethodToFlag } from '../../render.mjs';

const PATTERN_DIR = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_SOURCE_PATH = join(PATTERN_DIR, '..', '..', '..', 'templates', 'github-flow', 'main-automerge.yml.tmpl');
const TARGET_PATH = '.github/workflows/main-automerge.yml';

export const id = 'github-flow';
export const templateTargetPaths = [TARGET_PATH];

export function protectedBranches(config) {
  return [config.branches.main];
}

export function templates(config) {
  return [{
    id: 'main-automerge',
    targetPath: TARGET_PATH,
    templateSourcePath: TEMPLATE_SOURCE_PATH,
    params: {
      mainBranch: config.branches.main,
      mergeFlag: mergeMethodToFlag(config.mergeMethod?.devToMainMethod),
      releaseCredentialSecret: config.release?.releaseCredential ?? 'GITHUB_TOKEN',
    },
  }];
}

export function detect(signals) {
  const evidence = [];
  let score = 0;
  if (signals.hasUnrestrictedAutomergeWorkflow || signals.hasTagsFromMain) {
    score += 0.5;
    evidence.push('an unrestricted auto-merge-to-main workflow exists, or tags are reachable from main');
  }
  if (!signals.hasDevBranch && !signals.hasReleaseOrHotfixBranch) {
    score += 0.3;
    evidence.push('no dev/develop/staging branch and no release/*  or hotfix/*  branches exist');
  }
  return { score, evidence };
}

export function planEntries() { return []; }
```

Create `templates/github-flow/main-automerge.yml.tmpl` by copying the structure of
`templates/dev-main-promotion/dev-to-main-automerge.yml.tmpl` (read it first), with these
differences:
- `on.pull_request.branches` still targets `{{MAIN_BRANCH}}`.
- The `auto-merge` job's `if:` drops the `head.ref == '{{DEV_BRANCH}}'` clause entirely (no
  restriction — every PR to main is eligible, per the design's explicit github-flow shape).
- The `label-release-pending` job's `if:` similarly drops the head-ref clause (design's explicit,
  documented UX difference: every merge to main is release-worthy under github-flow, no separate
  "promotion" concept exists).
- Uses only `{{MAIN_BRANCH}}`, `{{MERGE_FLAG}}`, `{{RELEASE_CREDENTIAL_SECRET}}` — no
  `{{DEV_BRANCH}}` token at all (matches Task 1's confirmed token set — no new tokens needed for
  this template).
- Keep the same header comment style (rendered-by-apply.mjs warning, GH_TOKEN loop-prevention
  rationale) as the existing template, adjusted to describe github-flow's shape.

**Step 4: Run to verify it passes**

Run: `node --test tests/patterns/github-flow.test.mjs`
Expected: PASS.

**Step 5: Add to `tests/template-validity.test.mjs`**

Extend the existing YAML-validity test to also render and validate
`templates/github-flow/main-automerge.yml.tmpl` across a range of branch/secret names (mirror the
existing dev-main-promotion coverage in that file).

**Step 5a: INV-MP-9 idempotency test (`tests/patterns/github-flow.test.mjs`)**

The contract's INV-MP-9 asks for "running `apply.mjs` twice against an unchanged github-flow
repo produces zero mutating calls on the second run," mirroring the prior contract's INV-9. That
precedent was never actually automated in this codebase — `tests/apply.test.mjs` today only covers
the pure `classifyRulesetError` helper, and there is no existing harness for stubbing `gh`'s live
API calls (`apply.mjs`'s actual mutations shell out to the real `gh` binary via `lib/gh.mjs`'s
`spawnArgs`). Building that harness is a real but separate, cross-cutting investment — out of
scope for this plan (see the Deferred Minor findings section's item 18 below for the explicit
acknowledgment).

What IS cheaply and honestly testable without new infrastructure: `computePlan` is pure (no I/O),
so a repoState fabricated to already reflect a prior successful apply must compute to an
all-noop plan — this is the plan-computation-layer half of idempotency, and it exercises the
exact same code every command runs before deciding whether to mutate anything:

```js
import { readFileSync } from 'node:fs';
import { computePlan } from '../../lib/plan.mjs';
import { renderTemplate } from '../../lib/render.mjs';
import { sha256 } from '../../lib/gh.mjs';

test('computePlan produces an all-noop plan for github-flow once repoState reflects a converged apply (INV-MP-9, plan layer)', () => {
  const config = {
    workflowPattern: 'github-flow',
    branches: { main: 'main' },
    mergeMethod: { devToMainMethod: 'merge' },
    release: { releaseCredential: 'RELEASE_PAT' },
    branchCleanup: {},
    protectionOwner: 'external',
  };
  const [entry] = templates(config);
  const templateSource = readFileSync(entry.templateSourcePath, 'utf8');
  const renderedContent = renderTemplate(templateSource, entry.params);
  const repoState = {
    stateHash: 'x',
    repoSettings: { deleteBranchOnMerge: true },
    rulesets: [],
    protection: {},
    releasePendingLabelExists: true,
    templateFiles: { [entry.targetPath]: { exists: true, sha256: sha256(renderedContent) } },
  };
  const plan = computePlan(repoState, config, { [entry.id]: templateSource });
  assert.strictEqual(plan.creates.length, 0);
  assert.strictEqual(plan.updates.length, 0);
  assert.strictEqual(plan.noops.length, 4);
});
```

**Step 6: Run full suite + commit**

Run: `npm test` → expect all pass.

```bash
git add lib/patterns/github-flow templates/github-flow tests/patterns/github-flow.test.mjs tests/template-validity.test.mjs
git commit -m "feat(shipflow): implement github-flow pattern module + main-automerge template"
```

---

## Task 10: Re-run `pattern-registry.test.mjs`'s github-flow worked examples

**Files:** none changed — verification-only task.

**Step 1:** Run: `node --test tests/pattern-registry.test.mjs`
**Step 2:** Confirm the "clean github-flow signal" and "bare repo" worked-example tests (which
were failing against the stub since Task 3/4) now pass against the real implementation.
**Step 3:** No commit needed (no file changes) — if any assertion needs adjustment, that's a signal
the Task 9 implementation drifted from the design doc's exact scoring rules; fix Task 9's module,
not the test (the test encodes the quality-gated design, not a moving target).

---

## Task 11: `gitflow` pattern — real implementation + 4 templates

**Files:**
- Modify: `lib/patterns/gitflow/index.mjs` (replace stub)
- Create: `templates/gitflow/release-automerge.yml.tmpl`
- Create: `templates/gitflow/hotfix-automerge.yml.tmpl`
- Create: `templates/gitflow/hotfix-merge-back.yml.tmpl`
- Create: `templates/gitflow/release-merge-back.yml.tmpl`
- Test: `tests/patterns/gitflow.test.mjs` (new)

**Step 1: Write failing tests**

This is a new test file — import what's under test at the top, mirroring Task 2's explicit
import line:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { protectedBranches, detect, templates } from '../../lib/patterns/gitflow/index.mjs';
```

```js
test('protectedBranches returns [config.branches.dev, main] — release/hotfix branches excluded', () => {
  assert.deepStrictEqual(
    protectedBranches({ branches: { dev: 'develop', main: 'main' } }),
    ['develop', 'main']
  );
});

test('detect: +0.5 dev branch exists, +0.5 release/hotfix branch exists (independent, additive)', () => {
  assert.strictEqual(detect({
    hasDevBranch: true, hasReleaseOrHotfixBranch: true,
    hasGitflowMarker: false, hasRestrictedPromotionWorkflow: false, hasUnrestrictedAutomergeWorkflow: false, hasTagsFromMain: false,
  }).score, 1.0);
});

test('detect: lone hotfix branch with no develop scores 0.5', () => {
  assert.strictEqual(detect({
    hasDevBranch: false, hasReleaseOrHotfixBranch: true,
    hasGitflowMarker: false, hasRestrictedPromotionWorkflow: false, hasUnrestrictedAutomergeWorkflow: false, hasTagsFromMain: false,
  }).score, 0.5);
});

test('templates returns exactly 4 entries: release-automerge, hotfix-automerge, hotfix-merge-back, release-merge-back', () => {
  const config = {
    branches: { dev: 'develop', main: 'main' },
    mergeMethod: { devToMainMethod: 'merge' },
    release: { releaseCredential: 'RELEASE_PAT' },
    patternConfig: { gitflow: { releaseBranchPrefix: 'release/', hotfixBranchPrefix: 'hotfix/' } },
  };
  const entries = templates(config);
  assert.deepStrictEqual(entries.map((e) => e.id).sort(), [
    'hotfix-automerge', 'hotfix-merge-back', 'release-automerge', 'release-merge-back',
  ]);
  const releaseAutomerge = entries.find((e) => e.id === 'release-automerge');
  assert.strictEqual(releaseAutomerge.params.releaseBranchPrefix, 'release/');
});
```

**Step 2: Run to verify failure**

Run: `node --test tests/patterns/gitflow.test.mjs` — expect FAIL against the stub.

**Step 3: Implement the module**

```js
// lib/patterns/gitflow/index.mjs
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeMethodToFlag } from '../../render.mjs';

const PATTERN_DIR = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = join(PATTERN_DIR, '..', '..', '..', 'templates', 'gitflow');

export const id = 'gitflow';
export const templateTargetPaths = [
  '.github/workflows/release-automerge.yml',
  '.github/workflows/hotfix-automerge.yml',
  '.github/workflows/hotfix-merge-back.yml',
  '.github/workflows/release-merge-back.yml',
];

// release/*  and hotfix/*  are deliberately excluded — transient, cleaned up
// post-merge like any feature branch under every pattern.
export function protectedBranches(config) {
  return [config.branches.dev, config.branches.main];
}

export function templates(config) {
  const releasePrefix = config.patternConfig?.gitflow?.releaseBranchPrefix ?? 'release/';
  const hotfixPrefix = config.patternConfig?.gitflow?.hotfixBranchPrefix ?? 'hotfix/';
  const baseParams = {
    devBranch: config.branches.dev,
    mainBranch: config.branches.main,
    mergeFlag: mergeMethodToFlag(config.mergeMethod?.devToMainMethod),
    releaseCredentialSecret: config.release?.releaseCredential ?? 'GITHUB_TOKEN',
    releaseBranchPrefix: releasePrefix,
    hotfixBranchPrefix: hotfixPrefix,
  };
  return [
    { id: 'release-automerge', targetPath: '.github/workflows/release-automerge.yml',
      templateSourcePath: join(TEMPLATE_DIR, 'release-automerge.yml.tmpl'), params: baseParams },
    { id: 'hotfix-automerge', targetPath: '.github/workflows/hotfix-automerge.yml',
      templateSourcePath: join(TEMPLATE_DIR, 'hotfix-automerge.yml.tmpl'), params: baseParams },
    { id: 'hotfix-merge-back', targetPath: '.github/workflows/hotfix-merge-back.yml',
      templateSourcePath: join(TEMPLATE_DIR, 'hotfix-merge-back.yml.tmpl'), params: baseParams },
    { id: 'release-merge-back', targetPath: '.github/workflows/release-merge-back.yml',
      templateSourcePath: join(TEMPLATE_DIR, 'release-merge-back.yml.tmpl'), params: baseParams },
  ];
}

export function detect(signals) {
  const evidence = [];
  let score = 0;
  if (signals.hasDevBranch) { score += 0.5; evidence.push('a develop/dev/staging branch exists'); }
  if (signals.hasReleaseOrHotfixBranch) { score += 0.5; evidence.push('a release/*  or hotfix/*  branch exists'); }
  // hasGitflowMarker is a best-effort bonus signal only — carries no numeric
  // weight in v1 (see design doc's Autodetection section).
  return { score, evidence };
}

export function planEntries() { return []; }
```

**Step 4: Create the 4 templates**

`templates/gitflow/release-automerge.yml.tmpl` and `hotfix-automerge.yml.tmpl`: same shape as
`dev-main-promotion`'s template, but the `if:` guard compares `head.ref` against a PREFIX match
(`startsWith(github.event.pull_request.head.ref, '{{RELEASE_BRANCH_PREFIX}}')` /
`'{{HOTFIX_BRANCH_PREFIX}}'`) instead of an exact-equality `{{DEV_BRANCH}}` comparison — use GitHub
Actions' `startsWith()` expression function, e.g.:

```yaml
if: >-
  github.event.action != 'closed' &&
  startsWith(github.event.pull_request.head.ref, '{{RELEASE_BRANCH_PREFIX}}')
```

`templates/gitflow/hotfix-merge-back.yml.tmpl` (and `release-merge-back.yml.tmpl`, identical shape
with `{{RELEASE_BRANCH_PREFIX}}` swapped in for `{{HOTFIX_BRANCH_PREFIX}}`):

```yaml
name: merge {{MAIN_BRANCH}} back to {{DEV_BRANCH}} after a hotfix

# Rendered by shipflow's apply.mjs. See dev-to-main-automerge.yml.tmpl's header
# comment for the general hand-edit/renderedTemplateHashes discipline — same rules
# apply here.
#
# GitFlow's hotfix branches merge into BOTH main and develop — this is the
# defining semantic of a hotfix, not an optional convention (confirmed via
# research: git-flow CLI's own `hotfix finish` command does both merges
# atomically). This job runs the develop-side merge automatically once the
# main-side merge (hotfix-automerge.yml) lands.

on:
  pull_request:
    types: [closed]
    branches: [{{MAIN_BRANCH}}]

permissions:
  contents: write

jobs:
  merge-back-to-dev:
    if: >-
      github.event.pull_request.merged == true &&
      startsWith(github.event.pull_request.head.ref, '{{HOTFIX_BRANCH_PREFIX}}')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          token: ${{ secrets.{{RELEASE_CREDENTIAL_SECRET}} }}
      - name: Attempt a clean merge of {{MAIN_BRANCH}} into {{DEV_BRANCH}}
        id: merge
        continue-on-error: true
        run: |
          git config user.name "shipflow"
          git config user.email "shipflow@users.noreply.github.com"
          git checkout {{DEV_BRANCH}}
          git merge origin/{{MAIN_BRANCH}} --no-edit
          git push origin {{DEV_BRANCH}}
        env:
          GH_TOKEN: ${{ secrets.{{RELEASE_CREDENTIAL_SECRET}} }}
      - name: On any failure (conflict, rejected push, or otherwise), open a PR for manual resolution
        if: steps.merge.outcome == 'failure'
        run: |
          git merge --abort || true
          BRANCH="shipflow/merge-back-{{MAIN_BRANCH}}-to-{{DEV_BRANCH}}-${{ github.run_id }}"
          git checkout -b "$BRANCH" origin/{{MAIN_BRANCH}}
          git push origin "$BRANCH"
          gh pr create --base {{DEV_BRANCH}} --head "$BRANCH" \
            --title "Manual merge-back needed: {{MAIN_BRANCH}} -> {{DEV_BRANCH}}" \
            --body "Automatic merge-back failed (conflict or rejected push) after a hotfix/release merged to {{MAIN_BRANCH}}. Resolve and merge this PR manually."
        env:
          GH_TOKEN: ${{ secrets.{{RELEASE_CREDENTIAL_SECRET}} }}
```

Uses `{{RELEASE_CREDENTIAL_SECRET}}` for the push credential (per the design's corrected
credential-consistency rationale — not a loop-prevention claim, just consistency with every other
merge-triggering step in this design).

**Step 5: Run tests, add to template-validity, commit**

Run: `node --test tests/patterns/gitflow.test.mjs` → PASS.

Extend `tests/template-validity.test.mjs` to render and YAML-validate all 4 gitflow templates
across a range of branch-prefix/secret-name inputs.

**Step 5a: INV-MP-8 integration test — merge-back never force-pushes, opens a PR on failure**

This is genuinely new logic (unlike INV-MP-9's precedent-mirroring situation in Task 9), and it's
testable without any live GitHub API: the conflict/push-failure fallback only ever shells out to
local `git` plus one `gh pr create` call, so a PATH-stubbed fake `gh` plus two real local git repos
(acting as "origin" and a working checkout) is enough to exercise it for real. Add to
`tests/patterns/gitflow.test.mjs`:

```js
import { mkdtempSync, writeFileSync, rmSync, chmodSync, readFileSync as readFileSyncFs } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { renderTemplate } from '../../lib/render.mjs';

// The template's YAML has no parser in this codebase's style (see detect.mjs's own
// no-YAML-parser precedent) — extract each named step's `run: |` block by locating
// its `name:` line, then its `run: |` line, then every subsequent line indented
// deeper than `run:` itself, matching listWorkflowJobNames'/scanWorkflowShapeSignals'
// existing dedent-detection approach rather than introducing a new one.
function extractRunBlock(yamlText, nameSubstring) {
  const lines = yamlText.split('\n');
  const nameIdx = lines.findIndex((l) => l.includes(nameSubstring));
  const runIdx = lines.findIndex((l, i) => i > nameIdx && l.trim() === 'run: |');
  const runIndent = lines[runIdx].match(/^(\s*)/)[1].length;
  const body = [];
  for (let i = runIdx + 1; i < lines.length; i++) {
    const indent = lines[i].match(/^(\s*)/)[1].length;
    if (lines[i].trim() !== '' && indent <= runIndent) break;
    body.push(lines[i].slice(runIndent + 2));
  }
  return body.join('\n');
}

test('hotfix-merge-back: a genuine conflict never force-pushes and opens a PR instead (INV-MP-8)', () => {
  const config = {
    branches: { dev: 'dev', main: 'main' },
    mergeMethod: { devToMainMethod: 'merge' },
    release: { releaseCredential: 'RELEASE_PAT' },
    patternConfig: { gitflow: { releaseBranchPrefix: 'release/', hotfixBranchPrefix: 'hotfix/' } },
  };
  const entry = templates(config).find((e) => e.id === 'hotfix-merge-back');
  const templateSource = readFileSyncFs(entry.templateSourcePath, 'utf8');
  const rendered = renderTemplate(templateSource, entry.params);

  // Static check: the invariant's literal claim — no force-push flag anywhere in
  // either run: block, independent of whether the dynamic conflict path below
  // happens to exercise every line.
  assert.doesNotMatch(rendered, /git push[^\n]*(--force|-f\b)/);

  const mergeScript = extractRunBlock(rendered, 'Attempt a clean merge');
  const fallbackScript = extractRunBlock(rendered, 'On any failure');

  const root = mkdtempSync(join(tmpdir(), 'shipflow-mergeback-'));
  const originDir = join(root, 'origin.git');
  const workDir = join(root, 'work');
  const binDir = join(root, 'bin');
  const ghLog = join(root, 'gh-calls.log');
  try {
    spawnSync('git', ['init', '--quiet', '--bare', '-b', 'main', originDir]);
    spawnSync('git', ['clone', '--quiet', originDir, workDir]);
    const gitIn = (args) => spawnSync('git', args, { cwd: workDir, encoding: 'utf8' });
    gitIn(['config', 'user.email', 'test@example.invalid']);
    gitIn(['config', 'user.name', 'Shipflow Test']);
    writeFileSync(join(workDir, 'shared.txt'), 'base\n');
    gitIn(['add', 'shared.txt']);
    gitIn(['commit', '--quiet', '-m', 'base']);
    gitIn(['push', '--quiet', 'origin', 'main']);
    gitIn(['checkout', '--quiet', '-b', 'dev']);
    writeFileSync(join(workDir, 'shared.txt'), 'dev-side change\n');
    gitIn(['commit', '--quiet', '-am', 'dev change']);
    gitIn(['push', '--quiet', 'origin', 'dev']);
    gitIn(['checkout', '--quiet', 'main']);
    writeFileSync(join(workDir, 'shared.txt'), 'main-side conflicting change\n');
    gitIn(['commit', '--quiet', '-am', 'main change']);
    gitIn(['push', '--quiet', 'origin', 'main']);
    gitIn(['fetch', '--quiet', 'origin']);
    const devHeadBefore = gitIn(['rev-parse', 'origin/dev']).stdout.trim();

    // Fake `gh` on PATH: records argv instead of touching the network.
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(binDir, 'gh'), '#!/bin/sh\necho "$@" >> ' + JSON.stringify(ghLog) + '\n');
    chmodSync(join(binDir, 'gh'), 0o755);
    const env = { ...process.env, PATH: `${binDir}:${process.env.PATH}` };

    // fallbackScript contains a literal `${{ github.run_id }}` GitHub Actions
    // expression (inside the shipflow/merge-back-...-${{ github.run_id }} branch
    // name) — in real GitHub Actions the runner textually pre-substitutes every
    // `${{ ... }}` expression BEFORE handing the script to bash; renderTemplate's
    // own token regex (\{\{(\w+)\}\}, no leading `$`, no space after `{{`)
    // deliberately does not touch it, so it survives extraction unresolved. Running
    // it through bash as-is is a bad substitution (bash reads `${{` as a parameter
    // expansion). Stand in for the runner's own pre-substitution step with a fixed
    // literal, exactly as the real runner would substitute a real run id:
    const executableFallback = fallbackScript.replace('${{ github.run_id }}', '999');

    writeFileSync(join(root, 'merge.sh'), mergeScript);
    writeFileSync(join(root, 'fallback.sh'), executableFallback);

    const mergeResult = spawnSync('bash', ['-e', '-o', 'pipefail', join(root, 'merge.sh')], { cwd: workDir, env, encoding: 'utf8' });
    assert.notStrictEqual(mergeResult.status, 0, 'the conflicting merge must fail, not silently resolve');

    const fallbackResult = spawnSync('bash', ['-e', '-o', 'pipefail', join(root, 'fallback.sh')], { cwd: workDir, env, encoding: 'utf8' });
    assert.strictEqual(fallbackResult.status, 0);

    const ghCalls = readFileSyncFs(ghLog, 'utf8');
    assert.match(ghCalls, /pr create/);
    assert.match(ghCalls, /--base dev/);

    const devHeadAfter = gitIn(['rev-parse', 'origin/dev']).stdout.trim();
    assert.strictEqual(devHeadAfter, devHeadBefore, 'origin/dev must be untouched — no merge landed and no force-push occurred');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

Import `join` from `node:path` and `mkdirSync` alongside the file's existing `node:fs` imports if not
already present.

```bash
git add lib/patterns/gitflow templates/gitflow tests/patterns/gitflow.test.mjs tests/template-validity.test.mjs
git commit -m "feat(shipflow): implement gitflow pattern module + 4 templates (release/hotfix automerge + merge-back)"
```

---

## Task 12: Re-run full worked-example suite + full test suite

**Step 1:** `node --test tests/pattern-registry.test.mjs` — every worked example (bare repo,
this-repo's-shape, clean github-flow, clean gitflow, ambiguous residual) now passes against real
(non-stub) pattern modules.

**Step 2:** `npm test` (full suite) — expect green across everything: the original 57 (routed
through the registry now, behavior-preserving), plus every new test from Tasks 1–11.

**Step 3:** No commit if nothing changed; if any fixup was needed, commit it with a clear message
tied to which task's test caught the regression.

---

## Task 13: `SKILL.md` — pattern resolution in the first-run interview

**Files:**
- Modify: `SKILL.md`
- Modify: `skill-invariants.json` (add new prose guardrails for anything load-bearing you add)
- Test: `tests/skill_contract.test.mjs` (the existing regex-guardrail test will need new entries
  for any new mandatory phrase you add)

**Step 1: Read the current "First-run setup" section's step 1 (Detect) closely.**

**Step 2: Insert a new step between the existing steps 1 and 2** (renumber subsequent steps):
resolve the workflow pattern before asking about branch names/checks, since a `github-flow` repo
never asks about a `dev` branch at all. Concretely:

- Run `detect` (unchanged CLI call) — its printed JSON now includes a `rankedPatterns` array (see
  Task 8, Step 1a) — sorted-descending `{id, score, evidence}` entries for all 3 patterns. Apply
  `classify(rankedPatterns)`'s rule (confident/greenfield/ambiguous) to decide which of the two
  branches below to take.
- If classification is `confident`: state what was detected and why (the `evidence` array) — "I
  detected this repo is using **`<pattern-id>`** because: `<evidence bullets>`. I'll set
  `workflowPattern` to this — confirm before I proceed, or tell me if you'd rather pick a different
  pattern." This is still a confirm-before-write checkpoint, per the existing mandatory-interview
  invariant — a confident autodetect is not a substitute for the user's explicit confirmation.
- If classification is `ambiguous` or `greenfield`: present all 3 patterns with a one-line
  description each (pull from the design doc's pattern table) and the detected evidence (if any),
  and ask the user to choose. For greenfield, note `github-flow` as the lightweight default
  suggestion per the research, without auto-picking it.
- Only after the pattern is resolved does the rest of the existing interview (branch names,
  required checks, protectionOwner, releaseCredential) proceed — and only for the fields that
  pattern's config actually uses (e.g., skip asking about a `dev` branch name under `github-flow`).
- If `workflowPattern` is `gitflow`, additionally ask for `releaseBranchPrefix`/`hotfixBranchPrefix`
  (defaulting to `release/`/`hotfix/` if the user has no preference).

**Step 3: Add a new "Re-run / audit" clarification** — pattern resolution is skipped entirely on
re-run (read `workflowPattern` from the existing config, don't re-detect), exactly like every other
already-recorded interview field.

**Step 4: Update `skill-invariants.json`** with a new prose-guardrail entry if you add a new
"never silently pick a pattern" style mandate (mirroring the existing `ambiguous-protection-owner-prompt`
entry's shape) — e.g.:

```json
{
  "id": "ambiguous-pattern-no-silent-pick",
  "pattern": "present all 3 (templates|patterns).{0,60}ask the user to choose",
  "rationale": "Ambiguous/greenfield autodetection must never silently pick a pattern — mirrors the existing protectionOwner disambiguation precedent."
}
```

Adjust the regex to match whatever exact phrasing you actually land on in `SKILL.md` — run
`tests/skill_contract.test.mjs` to confirm the pattern matches.

**Step 5: Run the test suite**

Run: `npm test`
Expected: `skill_contract.test.mjs` passes with the new guardrail; everything else unaffected.

**Step 6: Commit**

```bash
git add SKILL.md skill-invariants.json
git commit -m "docs(shipflow): SKILL.md interview flow resolves workflowPattern before the existing branch/check questions"
```

---

## Task 14: `config.example.json`, `README.md`, `CHANGELOG.md`

**Files:**
- Modify: `config.example.json` (no `workflowPattern` key needed — the whole point is that its
  absence is valid; but DO add a comment-adjacent note in `README.md` about the field)
- Modify: `README.md` (skill-level, and the outer `skills/shipflow/README.md` if it documents
  config shape)
- Modify: `CHANGELOG.md` — add an `## Unreleased` (or next-version) entry describing the
  multi-pattern feature, following this file's existing entry style (see the 0.2.6 entry read
  earlier in this session for the expected format/tone).

**Step 1–3:** Straightforward doc edits, no tests. Read the existing files first, match their
tone/structure exactly (this file has a strong existing voice — terse, causal, "why" not just
"what").

**Step 4: Commit**

```bash
git add config.example.json README.md CHANGELOG.md skills/shipflow/README.md
git commit -m "docs(shipflow): document the 3-pattern multi-pattern feature in README/CHANGELOG"
```

Do NOT bump `package.json`'s version or `plugin.json.version` as part of this task — per this
repo's CLAUDE.md, "a release is cut by a version bump, not by a merge," and that's a deliberate,
separate step taken when the maintainer decides to release, not bundled into the feature branch.

---

## Task 15: Final full-suite verification + PR

**Step 1:** From the worktree root, run the FULL shipflow test suite one more time:
```bash
cd skills/shipflow/skills/shipflow && npm test
```
Expected: 100% pass, including every new pattern module, template, and registry test.

**Step 2:** Run the repo's own dogfood smoke test again (this repo's live `.github/shipflow.json`
still has no `workflowPattern`):
```bash
node bin/shipflow.js plan --repo /Users/natejswenson/localrepo/claude-skills
```
Expected: resolves to `dev-main-promotion`, produces the same `noops`-only plan as before this
entire feature branch — the concrete backward-compatibility proof.

**Step 3:** Invoke `crucible:quality-gate` on the full implementation diff (artifact type: `code`)
before opening a PR — per this plan's header directive to run through `crucible:build`, which
handles this gate automatically at its Phase 4. If running these tasks manually instead of via
`/build`, invoke `/quality-gate` yourself at this point.

**Step 4:** Open a PR from `feature/shipflow-multi-pattern` into `dev` (per this repo's branch
model — feature branches never PR straight into `main`). Reference both design docs
(`2026-07-16-shipflow-multi-pattern-design.md` and its contract) in the PR description.

**Step 5:** After merge, delete the feature branch (local + remote) per this repo's
"always delete a merged feature branch" rule, and remove the worktree:
```bash
git worktree remove .worktrees/shipflow-multi-pattern
git branch -D feature/shipflow-multi-pattern   # after remote merge auto-deletes the remote head
```

---

## Deferred Minor findings (documented, not silently dropped)

These 15 items were logged across the design's 10 quality-gate rounds. None block correctness;
they're wording/notation nits or narrow edge cases. Resolve opportunistically while touching
nearby code in the tasks above, but don't block the plan on them:

1. `PlanEntry` shape for `pattern.planEntries()` — still informally specified (fine, since all 3
   v1 patterns return `[]`; a real 4th-pattern author will need to formalize this then, not now).
2. Exact prefix-match logic (`startsWith` vs. regex) — resolved concretely in Task 11's templates
   above (`startsWith()` GHA expression function) — no longer open.
3. `hasGitflowMarker` "bonus" terminology — cosmetic, ignore.
4. Asymmetric `config.branches.main` notation (bare literal vs. `config.branches.dev`) —
   cosmetic, ignore.
5. Contract's single-file `TEMPLATE_RELATIVE_PATH` misattribution (design doc already correctly
   describes both files) — no code impact.
6. "~6 template files" approximation wording — cosmetic.
7. `gh.mjs` unchanged-claim — confirmed true during Task 7 (new git calls use the existing generic
   `git()` wrapper, no new `gh.mjs` exports needed).
8. `featureToDevMethod`'s cross-pattern meaning under github-flow — stays documentation-only/inert,
   consistent with its pre-existing status; no code change needed.
9. Vacuous "capped at 1.0" clause — cosmetic, in the design doc only.
10. `detectRepoState`'s existing second-parameter elision in the API-surface summary — pre-existing
    drift from before this feature, not introduced here; out of scope.
11. Merge-back fallback's terse PR-direction notation — resolved concretely in Task 11's template
    (`--base {{DEV_BRANCH}} --head "$BRANCH"`) — no longer open.
12. Prefix-guarded automerge workflows (e.g. `startsWith(head.ref, 'release/')`) falling into
    neither `hasRestrictedPromotionWorkflow` nor `hasUnrestrictedAutomergeWorkflow` — a real but
    narrow gap in the 6-signal model's completeness; doesn't affect any documented worked example.
    Worth a follow-up design note if a real repo ever hits it, not worth blocking this plan.
13. "Run once... or equivalently at the top of every renderTemplate call" loose-equivalence
    claim — Task 1's implementation picked module-load-once concretely; the parenthetical
    alternative in the design doc is now moot (code is more precise than prose here, which is
    fine).
14–15. (Two additional wording nits from round 3/4 already folded into the design doc's final
    text during the quality-gate fix rounds — no further action.)

The following 2 items were logged during this **implementation plan's own** quality-gate round 2
(as distinct from the 15 above, which came from the design's gate):

16. Task 8's "check its existing scope first" hedge for whether `tests/cli-apply-guards.test.mjs`
    or a new `tests/cli-detect.test.mjs` is the right home for the new `rankedPatterns` test —
    left as an implementer judgment call deliberately; either file location is correct, this is a
    style/organization choice with no behavioral stakes.
17. Task 3's shipped code comments referencing ephemeral plan task numbers (e.g. `// real logic
    lands in Task 9`) will read oddly once this plan is archived post-merge — low-value to scrub
    now since Tasks 4/9/11 land within the same feature branch shortly after Task 3, at which
    point the comments become accurate history rather than a forward reference. If Task 9/11 end
    up landing much later or differently shaped, update or remove these comments then.

The following item was logged during this plan's quality-gate **round 3** — a genuine, acknowledged
gap rather than a nit, called out explicitly per this repo's "no silent caps" norm rather than left
implicit:

18. **INV-MP-9 is only satisfied at the plan-computation layer, not the full `apply.mjs`/live-`gh`
    layer.** Task 9's Step 5a test proves `computePlan` returns an all-noop plan for github-flow
    when `repoState` already reflects a converged apply — real coverage, not a stub. It does NOT
    prove `apply.mjs` itself makes zero live `gh api` calls on a second run, because no test in this
    codebase mocks or stubs `lib/gh.mjs`'s `spawnArgs('gh', ...)` calls today — `tests/apply.test.mjs`
    only covers the pure `classifyRulesetError` helper, and the prior contract's equivalent
    invariant (INV-9, "running apply.mjs twice... zero mutating calls on the second run") was never
    actually automated either (confirmed: no `contract:idempotency:inv-9`-tagged test exists in the
    live suite). Closing this properly needs a `gh`-call-recording/stub harness in `lib/gh.mjs` or
    `tests/`, which is cross-cutting test infrastructure affecting every pattern (not just
    github-flow) — genuinely out of scope for a plan whose job is to generalize the existing
    single-pattern behavior, not to backfill a pre-existing test gap this feature didn't create.
    Worth a follow-up ticket if `apply.mjs`-level idempotency testing becomes a priority.

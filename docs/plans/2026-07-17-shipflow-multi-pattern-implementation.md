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
- Test: `tests/patterns/dev-main-promotion.test.mjs` (new)
- Tests to verify unchanged: `tests/detect.test.mjs`, `tests/plan.test.mjs`, `tests/apply.test.mjs`,
  `tests/template-validity.test.mjs`

**Step 1: Move the template file**

```bash
mkdir -p templates/dev-main-promotion
git mv templates/dev-to-main-automerge.yml.tmpl templates/dev-main-promotion/dev-to-main-automerge.yml.tmpl
```

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
import * as githubFlow from './patterns/github-flow/index.mjs';       // Task 10
import * as gitflow from './patterns/gitflow/index.mjs';               // Task 14
import { git } from './gh.mjs';

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

const REMOTE_PREFIX_CACHE = new WeakMap();

function listConfiguredRemotes(repoPath) {
  const r = git(['remote'], { cwd: repoPath });
  return r.status === 0 ? r.stdout.split('\n').filter(Boolean) : [];
}

function normalizeBranchName(name, remotes) {
  for (const remote of remotes) {
    if (name.startsWith(`${remote}/`)) return name.slice(remote.length + 1);
  }
  return name;
}

const DEV_BRANCH_RE = /^(dev|develop|staging)$/;
const RELEASE_HOTFIX_RE = /^(release|hotfix)\//;

// Computes the 6 shared boolean signals every pattern's detect() consumes. Pure
// given its inputs — repoState must already carry the raw material (branches,
// tags, .gitflow marker, workflow-shape scan) that detect.mjs's collection step
// gathers (see Task 7).
export function computeDetectionSignals(repoState, repoPath) {
  const remotes = listConfiguredRemotes(repoPath);
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

export function scoreAll(repoState, repoPath) {
  return scoreFromSignals(computeDetectionSignals(repoState, repoPath));
}
// Test-only seam: exercise scoring against a hand-built DetectionSignals object
// without needing a real repoPath/git call. Not part of the public CLI-facing API.
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
Expected: PASS once Tasks 10 and 14 (github-flow/gitflow modules) also exist — for now, stub
`github-flow`/`gitflow` modules with `id`/`templateTargetPaths`/a `detect` returning `{score: 0,
evidence: []}` /`protectedBranches`/`templates`/`planEntries` returning empty, so this task's tests
can run in isolation. Task 10/14 replace the stubs with real logic and re-run these same tests to
confirm the worked examples still hold (they're written against the FINAL scoring rules already,
so no changes needed here once the stubs are replaced).

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
  const plan = computePlan(repoState, config, {});
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
  if (config.protectionOwner === 'shipflow') {
    if ((repoState.rulesets ?? []).length > 0) {
      noops.push({ id: 'deletion-ruleset', description: 'a ruleset already exists (coarse check)' });
    } else {
      creates.push({ id: 'deletion-ruleset', description: `create a ruleset protecting ${protectedBranchList.join('/')} from deletion` });
    }
  } else {
    noops.push({ id: 'deletion-ruleset', description: `protectionOwner is "${config.protectionOwner}" — deferring to existing mechanism` });
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

function computeTemplatePlanEntry(repoState, config, entry, templateSource) {
  // Import renderTemplate lazily-by-reference to avoid a cycle if render.mjs ever
  // needs plan.mjs — currently it doesn't, so a top-level import is fine; keep this
  // comment if that ever changes.
  const { renderTemplate } = /* top-level import in the real file */ { renderTemplate: null };
  // ... identical hash-diff / hand-edit-detection logic to the pre-existing
  // computeTemplatePlanEntry (single-template version), just parameterized by
  // entry.targetPath / entry.params instead of the hardcoded TEMPLATE_PATH /
  // dev-main-promotion-specific params object. Port the existing function body
  // verbatim, replacing every reference to the old hardcoded constants with the
  // entry's own fields, and every reference to config.branches.dev/main directly
  // with entry.params (already fully resolved by the pattern module).
}
```

(The `computeTemplatePlanEntry` port should copy the EXISTING function's hash-diff/hand-edit logic
verbatim from the current `lib/plan.mjs` — only the input shape changes, not the algorithm. Move
the actual `import { renderTemplate } from './render.mjs'` to the top of the file properly; the
inline placeholder above is illustrative of "port, don't redesign," not literal code to ship.)

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

**Step 1: Update failing/changed tests**

Existing `deletion-ruleset` tests in `tests/apply.test.mjs` currently assert
`refs/heads/${config.branches.dev}`/`refs/heads/${config.branches.main}` literally. Update them to
instead assert against `config.branchCleanup.protectedBranches` (or, if that test fixture doesn't
set it, against `resolvePattern(config).protectedBranches(config)` computed independently in the
test) — the mutation must read the SAME list `plan.mjs`'s `Plan.protectedBranches` computed, not a
separately-stored config value (this closes Round 8's F2 finding). Add one new test:

```js
test('deletion-ruleset ref_name.include is derived from protectedBranches(config), not a hardcoded [dev, main]', () => {
  // gitflow config with branches.dev = 'develop'
  const config = { workflowPattern: 'gitflow', branches: { dev: 'develop', main: 'main' }, protectionOwner: 'shipflow' };
  // ... invoke applyOne's deletion-ruleset path (via a test seam or by checking the
  // constructed request body before the gh call, per this file's existing mocking style) ...
  // assert the ref_name.include list is exactly ['refs/heads/develop', 'refs/heads/main']
});
```

**Step 2: Run to verify failure**

Run: `node --test tests/apply.test.mjs`
Expected: FAIL on the updated assertions.

**Step 3: Implement**

In `lib/apply.mjs`'s `applyOne`, change the `deletion-ruleset` branch to call
`resolvePattern(config).protectedBranches(config)` fresh (never read a stored
`config.branchCleanup.protectedBranches` value for the actual mutation — per Round 8's F2 fix):

```js
import { resolvePattern } from './pattern-registry.mjs';

// inside applyOne(entry, { ownerRepo, repoPath, config }):
if (entry.id === 'deletion-ruleset') {
  const protectedBranchList = resolvePattern(config).protectedBranches(config);
  const body = JSON.stringify({
    name: 'shipflow-branch-deletion-protection',
    target: 'branch',
    enforcement: 'active',
    conditions: { ref_name: { include: protectedBranchList.map((b) => `refs/heads/${b}`), exclude: [] } },
    rules: [{ type: 'deletion' }],
  });
  // ... rest unchanged ...
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

```js
test('detectRepoState templateFiles covers every pattern\'s templateTargetPaths, not one hardcoded key', () => {
  const repoState = detectRepoState(fixtureRepoPath, { branches: { main: 'main', dev: 'dev' } });
  const expectedKeys = listPatterns().flatMap((p) => p.templateTargetPaths);
  assert.deepStrictEqual(Object.keys(repoState.templateFiles).sort(), expectedKeys.sort());
});

test('detectRepoState reports hasTagsFromMain', () => {
  // fixture repo with at least one tag reachable from main
  const repoState = detectRepoState(fixtureRepoPathWithTags, { branches: { main: 'main', dev: 'dev' } });
  assert.strictEqual(repoState.hasTagsFromMain, true);
});

test('detectRepoState reports hasGitflowMarker via a .gitflow file', () => {
  // fixture repo with a .gitflow file at root
  const repoState = detectRepoState(fixtureRepoPathWithGitflowMarker, { branches: { main: 'main', dev: 'dev' } });
  assert.strictEqual(repoState.hasGitflowMarker, true);
});

test('detectRepoState scans for a restricted-vs-unrestricted promotion workflow within one job\'s own line range', () => {
  // fixture workflow: job A has gh pr merge --auto with head.ref == 'dev'; job B
  // (separate, unrelated) has some other head.ref == check for a different purpose.
  // Assert hasRestrictedPromotionWorkflow is true (job A's own condition) and that
  // job B's unrelated condition is NOT what satisfied it — construct a second fixture
  // where job A's gh pr merge --auto has NO head.ref guard, but job B does, and
  // assert hasRestrictedPromotionWorkflow is FALSE for that fixture (proving the scan
  // doesn't cross job boundaries).
});
```

Reuse whatever fixture-repo-building helper `tests/detect.test.mjs` already has (it likely builds
a throwaway git repo in a temp dir per test, given the existing branch/workflow-file tests) —
extend that helper rather than writing a new one.

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
4. Add the new job-block-scoped workflow-shape heuristic (`hasRestrictedPromotionWorkflow`/
   `hasUnrestrictedAutomergeWorkflow`) — a new function alongside the existing
   `listWorkflowJobNames`, scanning each workflow file's individual job blocks (using the SAME
   `jobNameRe` the existing function already defines, but bounding each job's own line range rather
   than the whole `jobs:` section) for a `gh pr merge --auto` step, then checking whether a
   `head.ref ==` comparison appears within that same job's line range:

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
      const nameMatch = lines[i].match(/^\s{2}([\w.-]+):\s*$/);
      if (!nameMatch) { i++; continue; }
      const jobStart = i;
      let jobEnd = lines.length;
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() !== '' && /^\s{0,2}\S/.test(lines[j]) && lines[j].match(/^\s{2}([\w.-]+):\s*$/)) { jobEnd = j; break; }
        if (lines[j].trim() !== '' && /^\S/.test(lines[j])) { jobEnd = j; break; }
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

5. Wire all of the above into `detectRepoState`'s return object.

**Step 4: Run to verify it passes**

Run: `npm test`
Expected: all tests pass, including the new job-boundary fixture proving no cross-job
misattribution.

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

**Step 1: Implement**

Replace the single hardcoded `TEMPLATE_PATH`/`readFileSync(TEMPLATE_PATH, 'utf8')` in `cmdPlan`/
`cmdApply` with: resolve the pattern via `resolvePattern(config)`, call `pattern.templates(config)`,
and build a `templateSources` map by reading each entry's `templateSourcePath` off disk, keyed by
`entry.id`:

```js
import { resolvePattern } from '../lib/pattern-registry.mjs';

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

- Run `detect` (unchanged CLI call) — it now returns `scoreAll`-shaped ranking data in its output
  (wire this into `cmdDetect`'s printed JSON as part of Task 7/8, if not already covered — verify
  and add if missing).
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

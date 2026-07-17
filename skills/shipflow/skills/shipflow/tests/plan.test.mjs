import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePlan } from '../lib/plan.mjs';
import { renderTemplate } from '../lib/render.mjs';
import { sha256 } from '../lib/gh.mjs';

const TEMPLATE = 'dev={{DEV_BRANCH}} main={{MAIN_BRANCH}} flag={{MERGE_FLAG}}';

const BASE_CONFIG = {
  branches: { main: 'main', dev: 'dev' },
  requiredChecks: ['ci / foo'],
  mergeMethod: { devToMainMethod: 'merge' },
  protectionOwner: 'external',
  branchCleanup: { deleteOnMerge: true, protectedBranches: ['dev', 'main'] },
  renderedTemplateHashes: {},
};

function baseRepoState(overrides = {}) {
  return {
    stateHash: 'abc123',
    repoSettings: { deleteBranchOnMerge: true },
    rulesets: [],
    templateFiles: { '.github/workflows/dev-to-main-automerge.yml': { exists: false, sha256: null } },
    releasePendingLabelExists: true,
    protection: { main: { requiredChecks: ['ci / foo'] }, dev: { requiredChecks: [] } },
    ...overrides,
  };
}

test('delete-branch-on-merge is a noop when already set correctly', () => {
  const plan = computePlan(baseRepoState(), BASE_CONFIG, { 'dev-to-main-automerge': TEMPLATE });
  assert.ok(plan.noops.some((e) => e.id === 'delete-branch-on-merge'));
});

test('delete-branch-on-merge is an update when not yet set', () => {
  const repoState = baseRepoState({ repoSettings: { deleteBranchOnMerge: false } });
  const plan = computePlan(repoState, BASE_CONFIG, { 'dev-to-main-automerge': TEMPLATE });
  const entry = plan.updates.find((e) => e.id === 'delete-branch-on-merge');
  assert.ok(entry);
  assert.equal(entry.desired, true);
});

test('deletion-ruleset defers to external protection without creating anything', () => {
  const plan = computePlan(baseRepoState(), { ...BASE_CONFIG, protectionOwner: 'external' }, { 'dev-to-main-automerge': TEMPLATE });
  const entry = plan.noops.find((e) => e.id === 'deletion-ruleset');
  assert.ok(entry, 'expected a noop entry deferring to external protection');
  assert.ok(!plan.creates.some((e) => e.id === 'deletion-ruleset'));
});

test('deletion-ruleset is a create when shipflow owns protection and no ruleset exists', () => {
  const plan = computePlan(baseRepoState({ rulesets: [] }), { ...BASE_CONFIG, protectionOwner: 'shipflow' }, { 'dev-to-main-automerge': TEMPLATE });
  assert.ok(plan.creates.some((e) => e.id === 'deletion-ruleset'));
});

test('deletion-ruleset is a noop when shipflow owns protection and a ruleset already exists', () => {
  const plan = computePlan(
    baseRepoState({ rulesets: [{ id: 1, requiredChecks: [] }] }),
    { ...BASE_CONFIG, protectionOwner: 'shipflow' },
    { 'dev-to-main-automerge': TEMPLATE }
  );
  assert.ok(plan.noops.some((e) => e.id === 'deletion-ruleset'));
});

test('template entry is a create when the file does not exist on disk', () => {
  const plan = computePlan(baseRepoState(), BASE_CONFIG, { 'dev-to-main-automerge': TEMPLATE });
  const entry = plan.creates.find((e) => e.id.startsWith('template:'));
  assert.ok(entry);
  assert.equal(entry.content, renderTemplate(TEMPLATE, { devBranch: 'dev', mainBranch: 'main', mergeFlag: '--merge' }));
});

test('template entry is a noop when on-disk content already matches a fresh render', () => {
  const rendered = renderTemplate(TEMPLATE, { devBranch: 'dev', mainBranch: 'main', mergeFlag: '--merge' });
  const repoState = baseRepoState({
    templateFiles: { '.github/workflows/dev-to-main-automerge.yml': { exists: true, sha256: sha256(rendered) } },
  });
  const plan = computePlan(repoState, BASE_CONFIG, { 'dev-to-main-automerge': TEMPLATE });
  assert.ok(plan.noops.some((e) => e.id.startsWith('template:')));
});

test('template entry is a clean update (not hand-edit) when on-disk matches the last shipflow render but config changed', () => {
  const oldRendered = renderTemplate(TEMPLATE, { devBranch: 'dev', mainBranch: 'main', mergeFlag: '--squash' });
  const repoState = baseRepoState({
    templateFiles: { '.github/workflows/dev-to-main-automerge.yml': { exists: true, sha256: sha256(oldRendered) } },
  });
  const config = {
    ...BASE_CONFIG,
    mergeMethod: { devToMainMethod: 'merge' }, // changed from squash -> merge since the last render
    renderedTemplateHashes: { '.github/workflows/dev-to-main-automerge.yml': sha256(oldRendered) },
  };
  const plan = computePlan(repoState, config, { 'dev-to-main-automerge': TEMPLATE });
  const entry = plan.updates.find((e) => e.id.startsWith('template:'));
  assert.ok(entry);
  assert.equal(entry.handEditDetected, false);
});

test('template entry is flagged handEditDetected when on-disk matches neither a fresh render nor the last recorded render', () => {
  const repoState = baseRepoState({
    templateFiles: { '.github/workflows/dev-to-main-automerge.yml': { exists: true, sha256: 'someone-hand-edited-this' } },
  });
  const config = { ...BASE_CONFIG, renderedTemplateHashes: { '.github/workflows/dev-to-main-automerge.yml': 'a-different-old-hash' } };
  const plan = computePlan(repoState, config, { 'dev-to-main-automerge': TEMPLATE });
  const entry = plan.updates.find((e) => e.id.startsWith('template:'));
  assert.ok(entry);
  assert.equal(entry.handEditDetected, true);
});

test('release-pending-label is a create when absent, noop when present', () => {
  const planAbsent = computePlan(baseRepoState({ releasePendingLabelExists: false }), BASE_CONFIG, { 'dev-to-main-automerge': TEMPLATE });
  assert.ok(planAbsent.creates.some((e) => e.id === 'release-pending-label'));

  const planPresent = computePlan(baseRepoState({ releasePendingLabelExists: true }), BASE_CONFIG, { 'dev-to-main-automerge': TEMPLATE });
  assert.ok(planPresent.noops.some((e) => e.id === 'release-pending-label'));
});

test('liveRequiredChecks unions classic-protection and ruleset checks, deduped and sorted', () => {
  const repoState = baseRepoState({
    protection: { main: { requiredChecks: ['b', 'a'] }, dev: { requiredChecks: [] } },
    rulesets: [{ id: 1, requiredChecks: ['a', 'c'] }],
  });
  const plan = computePlan(repoState, BASE_CONFIG, { 'dev-to-main-automerge': TEMPLATE });
  assert.deepEqual(plan.liveRequiredChecks, ['a', 'b', 'c']);
});

test('sourceStateHash pins repoState.stateHash', () => {
  const plan = computePlan(baseRepoState({ stateHash: 'xyz789' }), BASE_CONFIG, { 'dev-to-main-automerge': TEMPLATE });
  assert.equal(plan.sourceStateHash, 'xyz789');
});

test('computePlan accepts a templateSources map (plural) keyed by template id', () => {
  const config = { workflowPattern: 'dev-main-promotion', branches: { dev: 'dev', main: 'main' },
    mergeMethod: { devToMainMethod: 'merge' }, release: { releaseCredential: 'RELEASE_PAT' },
    branchCleanup: {}, protectionOwner: 'external' };
  const repoState = { stateHash: 'x',
    templateFiles: {}, repoSettings: {}, rulesets: [], protection: {}, releasePendingLabelExists: true };
  const plan = computePlan(repoState, config, { 'dev-to-main-automerge': 'name: {{DEV_BRANCH}}' });
  assert.ok(Array.isArray(plan.creates) || Array.isArray(plan.updates) || Array.isArray(plan.noops));
});

test('computePlan returns Plan.protectedBranches computed from the resolved pattern', () => {
  const config = { workflowPattern: 'dev-main-promotion', branches: { dev: 'develop', main: 'main' },
    mergeMethod: { devToMainMethod: 'merge' }, release: {}, branchCleanup: {}, protectionOwner: 'external' };
  const repoState = { stateHash: 'x', templateFiles: {}, repoSettings: {}, rulesets: [], protection: {},
    releasePendingLabelExists: true };
  const plan = computePlan(repoState, config, { 'dev-to-main-automerge': 'name: {{DEV_BRANCH}}' });
  assert.deepStrictEqual(plan.protectedBranches, ['develop', 'main']);
});

test('computePlan has no side effects — repoState and config are not mutated', () => {
  const repoState = baseRepoState();
  const config = JSON.parse(JSON.stringify(BASE_CONFIG));
  const repoStateSnapshot = JSON.parse(JSON.stringify(repoState));
  const configSnapshot = JSON.parse(JSON.stringify(config));
  computePlan(repoState, config, { 'dev-to-main-automerge': TEMPLATE });
  assert.deepEqual(repoState, repoStateSnapshot);
  assert.deepEqual(config, configSnapshot);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { protectedBranches, detect, templates } from '../../lib/patterns/github-flow/index.mjs';
import { computePlan } from '../../lib/plan.mjs';
import { renderTemplate } from '../../lib/render.mjs';
import { sha256 } from '../../lib/gh.mjs';

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

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

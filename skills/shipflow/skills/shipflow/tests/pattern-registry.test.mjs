import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listPatterns, resolvePattern, scoreAll, computeDetectionSignals, classify } from '../lib/pattern-registry.mjs';

test('listPatterns returns all 3 patterns with their templateTargetPaths', () => {
  const patterns = listPatterns();
  // Lexicographic sort: 'gitflow' < 'github-flow' ('f' < 'h' at index 3).
  assert.deepStrictEqual(patterns.map((p) => p.id).sort(), ['dev-main-promotion', 'gitflow', 'github-flow']);
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

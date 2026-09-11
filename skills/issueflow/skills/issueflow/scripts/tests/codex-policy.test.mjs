import test from 'node:test';
import assert from 'node:assert/strict';
import { adjudicationNeed, contextCurator, delegationInstructions, learnedPolicy, preflightScout, resetLearnedPolicy, stageTimeout, testPolicy, verifyCuratorMap } from '../lib/codex-policy.mjs';

test('preflight and curator outputs are bounded and hash-bound', () => {
  assert.equal(preflightScout({ files: ['src/auth/login.js'] }).recommendedProfile, 'deep');
  const map = contextCurator({ head: 'abc', files: ['src/a.js'] });
  assert.equal(verifyCuratorMap(map, 'abc'), true);
  assert.equal(verifyCuratorMap({ ...map, head: 'def' }, 'abc'), false);
});

test('learning uses minimum samples and safe caps', () => {
  assert.equal(learnedPolicy([{ durationMs: 1, findings: 1 }]).learned, false);
  const learned = learnedPolicy([{ durationMs: 1e7, findings: 100 }, { durationMs: 1e7, findings: 100 }, { durationMs: 1e7, findings: 100 }]);
  assert.equal(learned.durationMultiplier, 2);
  assert.equal(learned.expectedFindings, 50);
  assert.equal(resetLearnedPolicy().learned, false);
});

test('stage-specific validation, adjudication, and Codex delegation are deterministic', () => {
  assert.ok(stageTimeout('implement') > stageTimeout('finder'));
  assert.equal(testPolicy(['.github/workflows/ci.yml']).level, 'full');
  assert.equal(testPolicy(['docs/readme.md']).level, 'targeted');
  assert.equal(adjudicationNeed([{ status: 'confirmed' }, { status: 'refuted' }]).required, true);
  assert.match(delegationInstructions('codex'), /dependency barriers/);
  assert.equal(delegationInstructions('claude'), '');
});

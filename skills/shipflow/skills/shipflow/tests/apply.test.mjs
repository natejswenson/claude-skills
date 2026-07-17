import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyRulesetError, buildDeletionRulesetBody } from '../lib/apply.mjs';

test('classifyRulesetError flags the GitHub Pro tier-gating message', () => {
  const stderr = 'gh: Upgrade to GitHub Pro or make this repository public to enable this feature. (HTTP 403)';
  const result = classifyRulesetError(stderr);
  assert.equal(result.tierGated, true);
  assert.match(result.reason, /GitHub Pro\/Team\/Enterprise/);
});

test('classifyRulesetError recognizes Team and Enterprise tier messages too', () => {
  assert.equal(classifyRulesetError('Upgrade to GitHub Team to enable this feature.').tierGated, true);
  assert.equal(classifyRulesetError('Upgrade to GitHub Enterprise to enable this feature.').tierGated, true);
});

test('classifyRulesetError does not flag an unrelated failure', () => {
  const stderr = 'gh: Bad credentials (HTTP 401)';
  const result = classifyRulesetError(stderr);
  assert.equal(result.tierGated, false);
  assert.equal(result.reason, null);
});

test('classifyRulesetError does not flag a generic 403 without the tier-gating message', () => {
  const stderr = 'gh: Resource not accessible by integration (HTTP 403)';
  const result = classifyRulesetError(stderr);
  assert.equal(result.tierGated, false);
});

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

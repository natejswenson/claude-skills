import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyIssue, createRun } from '../lib/run.mjs';

test('plain documentation routes to the fast budget', () => {
  assert.equal(classifyIssue({ title: 'docs: fix a typo in the guide', body: 'Correct spelling.' }).kind, 'fast-docs');
});

test('documentation with shipped-contract impact stays standard', () => {
  const profile = classifyIssue({ title: 'docs: update README', body: 'Add a template and acceptance criteria test.' });
  assert.equal(profile.kind, 'standard');
  assert.equal(profile.reviewRounds, 2);
});

test('the profile is persisted on the run and lane', () => {
  const run = createRun({
    repo: { owner: 'a', name: 'b', path: '/tmp/repo' },
    issue: { number: 1, title: 'docs: typo', body: 'fix wording' },
    policy: { base: 'dev', featurePrefix: 'feature/' },
    now: () => '2026-01-01T00:00:00.000Z',
  });
  assert.equal(run.createdAt, '2026-01-01T00:00:00.000Z');
  assert.equal(run.complexity.kind, 'fast-docs');
  assert.equal(run.lanes[0].review.maxRounds, 1);
});

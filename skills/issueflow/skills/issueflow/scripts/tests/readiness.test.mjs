import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCiReady } from '../lib/readiness.mjs';
import { compactContext } from '../lib/context.mjs';

test('readiness binds CI to the reviewed head and never promotes missing, skipped or pending checks', () => {
  const base = { expectedHead: 'reviewed', observedHead: 'reviewed', checks: [{ name: 'suite', bucket: 'pass' }] };
  assertCiReady(base);
  for (const bucket of ['pending', 'fail', 'skipping', 'cancel', 'unknown']) assert.throws(() => assertCiReady({ ...base, checks: [{ name: 'suite', bucket }] }), /not passing/);
  assert.throws(() => assertCiReady({ ...base, checks: [] }), /no CI/);
  assert.throws(() => assertCiReady({ ...base, observedHead: 'new-code' }), /head differs/);
  assert.throws(() => assertCiReady({ ...base, policy: { requiredChecks: ['security'] } }), /missing required/);
  assertCiReady({ ...base, checks: [], policy: { mode: 'none', reason: 'Reviewed repo has no CI; local obligations are required.' } });
});

test('compact context honors UTF-8 byte budgets, including the omission marker', () => {
  for (const text of ['x'.repeat(100), '😀'.repeat(100), '漢'.repeat(100)]) for (const size of [4, 8, 16, 31]) {
    const result = compactContext(text, size);
    assert.ok(Buffer.byteLength(result.value) <= size);
    assert.match(result.omission, /primary source/);
  }
});

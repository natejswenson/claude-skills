import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRun, loadRun, saveRun } from '../lib/run.mjs';
import { operation } from '../lib/operations.mjs';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'issueflow-operation-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const run = createRun({ repo: { path: dir }, issue: { number: 1, title: 'fixture' }, policy: { base: 'main' } }); saveRun(dir, run); return { dir, run };
}
test('lost acknowledgement is reconciled without a duplicate remote mutation', (t) => {
  const { dir, run } = fixture(t); let effects = 0; let remote = null;
  const params = { kind: 'create-pr', target: 'fixture', intent: { head: 'a' }, read: () => remote, write: () => { effects++; remote = { url: 'https://example.invalid/pr/1' }; throw new Error('connection lost after effect'); } };
  assert.deepEqual(operation(dir, run, params), remote);
  assert.deepEqual(operation(dir, loadRun(dir), params), remote);
  assert.equal(effects, 1); assert.equal(Object.values(loadRun(dir).operations)[0].state, 'confirmed');
});
test('uncertain non-idempotent effects stop; safe retries remain bounded', (t) => {
  const { dir, run } = fixture(t); let effects = 0;
  const params = { kind: 'post', target: 'fixture', intent: {}, read: () => null, write: () => { effects++; throw new Error('lost'); } };
  assert.throws(() => operation(dir, run, params), /unconfirmed/);
  assert.throws(() => operation(dir, run, params), /uncertain outcome/); assert.equal(effects, 1);
  for (let n = 0; n < 2; n++) assert.throws(() => operation(dir, run, { ...params, retrySafe: true }), /unconfirmed/);
  assert.throws(() => operation(dir, run, { ...params, retrySafe: true }), /exhausted/); assert.equal(effects, 3);
});
test('unavailable read-back never authorizes a write or a success claim', (t) => {
  const { dir, run } = fixture(t); let effects = 0;
  assert.throws(() => operation(dir, run, { kind: 'post', target: 'fixture', intent: {}, read: () => { throw new Error('denied'); }, write: () => effects++ }), /denied/);
  assert.equal(effects, 0); assert.equal(Object.values(loadRun(dir).operations)[0].state, 'pending');
});

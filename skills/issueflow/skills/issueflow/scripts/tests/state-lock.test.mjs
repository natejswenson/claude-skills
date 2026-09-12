import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRun, loadRun, saveRun } from '../lib/run.mjs';
import { claimController, StateConflict, withStateLock } from '../lib/state-lock.mjs';

test('two loaded controllers cannot lose an accepted state update', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'issueflow-cas-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const run = createRun({ repo: { path: dir }, issue: { number: 1, title: 'fixture' }, policy: { base: 'main' } });
  saveRun(dir, run); const a = loadRun(dir); const b = loadRun(dir);
  a.checkpoint.commentId = 123; saveRun(dir, a);
  b.checkpoint.commentId = 456; assert.throws(() => saveRun(dir, b), StateConflict);
  assert.equal(loadRun(dir).checkpoint.commentId, 123);
  const revision = a.revision; saveRun(dir, a); assert.equal(a.revision, revision, 'a no-op save is not another transition');
});

test('command ownership excludes a second controller and releases after completion', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'issueflow-owner-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const release = claimController(dir, 'next'); assert.throws(() => claimController(dir, 'brief'), /concurrent transition/);
  release(); claimController(dir, 'brief')();
  writeFileSync(join(dir, 'controller-owner.json'), JSON.stringify({ pid: 2147483647, host: hostname(), command: 'crashed' }));
  claimController(dir, 'next')();
});

test('short mutex rejects active and ambiguous locks but recovers a dead local owner', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'issueflow-lock-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  withStateLock(dir, () => assert.throws(() => withStateLock(dir, () => {}), StateConflict));
  writeFileSync(join(dir, 'controller.lock'), JSON.stringify({ pid: 2147483647, host: hostname() }));
  assert.equal(withStateLock(dir, () => 42), 42);
  writeFileSync(join(dir, 'controller.lock'), '{}'); assert.throws(() => withStateLock(dir, () => {}), StateConflict);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { attemptDelivered, completeAttempt, createAttempt } from '../lib/attempts.mjs';

test('partial, late, tampered and superseded results cannot satisfy a current attempt', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'issueflow-attempt-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const brief = join(root, 'brief.md'); const output = join(root, 'result.json');
  const run = { createdAt: 'fixed-generation', harness: { contractHash: 'approved' } };
  writeFileSync(brief, 'Read source.'); writeFileSync(output, 'partial');
  const first = createAttempt(root, run, brief, [output]);
  assert.equal(attemptDelivered(first), false);
  writeFileSync(output, 'complete'); completeAttempt(first.manifest); assert.equal(attemptDelivered(first), true);
  writeFileSync(output, 'late mutation'); assert.equal(attemptDelivered(first), false);
  writeFileSync(brief, 'Read revised source.');
  const second = createAttempt(root, run, brief, [output]);
  assert.equal(attemptDelivered(second), false);
  assert.throws(() => completeAttempt(first.manifest), /stale/);
  writeFileSync(second.completion, readFileSync(first.completion)); assert.equal(attemptDelivered(second), false);
  assert.throws(() => completeAttempt(second.manifest), /immutable/);
  rmSync(second.completion);
  completeAttempt(second.manifest); assert.equal(attemptDelivered(second), true);
  second.state = 'cancelled'; assert.equal(attemptDelivered(second), false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptiveReasoning, effectiveSlots, setAvailableSlots, startWave, rollingWave } from '../lib/runtime.mjs';
import { buildContextPacket, compactContext, verifyContextPacket } from '../lib/context.mjs';
import { fleetPlan, reviewRisk, routeVerifierCandidates } from '../lib/prreview.mjs';

test('adaptive Codex effort escalates only from deterministic risk signals', () => {
  assert.equal(adaptiveReasoning({ runtime: 'codex' }, 'finder', { risk: 'low' }), 'medium');
  assert.equal(adaptiveReasoning({ runtime: 'codex' }, 'finder', { risk: 'sensitive' }), 'xhigh');
  assert.equal(adaptiveReasoning({ runtime: 'codex' }, 'implement', { disagreement: 1 }), 'xhigh');
  assert.equal(adaptiveReasoning({ runtime: 'claude' }, 'finder', { risk: 'sensitive' }), 'xhigh');
});

test('semantic risk and verifier routing are deterministic', () => {
  assert.equal(reviewRisk(['src/generated/output.lock']).risk, 'low');
  assert.equal(reviewRisk(['src/auth/session.js']).risk, 'sensitive');
  const plan = fleetPlan(20, 1, { files: ['src/auth/session.js'] });
  assert.equal(plan.risk, 'sensitive');
  const batches = routeVerifierCandidates([
    { id: 'a', category: 'auth', severity: 'major' },
    { id: 'b', category: 'auth', severity: 'medium' },
    { id: 'c', category: 'formatting', severity: 'nit' },
  ]);
  assert.equal(batches.length, 3);
  assert.deepEqual(batches[0].map((item) => item.id), ['a']);
  assert.deepEqual(batches.flat().map((item) => item.id).sort(), ['a', 'b', 'c']);
});

test('context packets are hash-bound and compact without losing provenance', () => {
  const packet = buildContextPacket({ issue: { number: 1 }, base: 'a', head: 'b', files: ['src/a.js'] });
  assert.equal(verifyContextPacket(packet), true);
  assert.equal(verifyContextPacket({ ...packet, head: 'c' }), false);
  const compact = compactContext('x'.repeat(100), 20);
  assert.equal(compact.summarized, true);
  assert.equal(compact.sourceHash.length, 64);
});

test('observed capacity bounds rolling refill without freeing undelivered native slots', () => {
  const run = { runtime: 'codex', harness: {}, dispatch: { childSlots: 4 } };
  assert.equal(effectiveSlots(run), 1);
  setAvailableSlots(run, 2);
  const items = [0, 1, 2, 3].map((id) => ({ id }));
  assert.equal(startWave(run, items).length, 2);
  assert.deepEqual(rollingWave(run, (item) => item.id === 0).map((item) => item.id), [2]);
  assert.deepEqual(run.dispatch.queue.active.map((item) => item.id), [1, 2]);
  assert.equal(new Set(run.dispatch.queue.active.map((item) => item.attemptId)).size, 2);
  setAvailableSlots(run, 0);
  assert.deepEqual(rollingWave(run, (item) => item.id === 2), []);
  assert.deepEqual(run.dispatch.queue.active.map((item) => item.id), [1]);
});

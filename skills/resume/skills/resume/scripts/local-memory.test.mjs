#!/usr/bin/env node
import assert from 'node:assert/strict';
import { recallPresentation } from './local-memory.mjs';
let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (error) { console.error(`  ✗ ${name}: ${error.message}`); fail++; }
}
const depth = 'resume.explanation-depth', format = 'resume.presentation-format';
const subject = 'synthetic-resume-test';
const answer = records => ({ status: 'ok', records, conflict_keys: [] });
function fake(result) {
  const calls = [];
  const tool = async request => { calls.push(request); return request.op === 'status' ? { status: 'ready' } : result; };
  return { calls, tool };
}
await test('disabled, absent tool, and unknown scope preserve choices without access', async () => {
  const { calls, tool } = fake(answer([])), current = { [depth]: 'brief' };
  assert.deepEqual(await recallPresentation({ subject, tool, current }), current);
  assert.deepEqual(await recallPresentation({ enabled: true, tool, current }), current);
  assert.deepEqual(await recallPresentation({ enabled: true, subject, current }), current);
  assert.equal(calls.length, 0);
});
await test('ready hook recalls only two keys under the same subject with a bound', async () => {
  const { calls, tool } = fake(answer([{ key: depth, value: 'brief' }, { key: format, value: 'Compact handoff' }, { key: 'resume.degree', value: 'Invented degree' }]));
  assert.deepEqual(await recallPresentation({ enabled: true, subject, tool }), { [depth]: 'brief', [format]: 'Compact handoff' });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], { contract: 'skill-memory-v1', skill: 'resume', subject, op: 'recall', keys: [format, depth], max_context_bytes: 2048 });
});
await test('current intent and conflicts override recalled preferences', async () => {
  const { tool } = fake({ ...answer([{ key: depth, value: 'brief' }, { key: format, value: 'Compact' }]), conflict_keys: [format] });
  assert.deepEqual(await recallPresentation({ enabled: true, subject, tool, current: { [depth]: 'detailed' } }), { [depth]: 'detailed' });
});
await test('malformed, duplicate, oversized, and failed records cannot apply', async () => {
  for (const result of [answer([{ key: format, value: 'x'.repeat(129) }, { key: depth, value: {} }]), answer([{ key: depth, value: 'brief' }, { key: depth, value: 'detailed' }]), { ...answer([{ key: depth, value: 'brief' }]), status: 'conflict' }, { ...answer([{ key: depth, value: 'brief' }]), status: 'ready' }, null]) {
    assert.deepEqual(await recallPresentation({ enabled: true, subject, tool: fake(result).tool }), {});
  }
});
await test('unavailable status and thrown transport fall back without mutation', async () => {
  let count = 0;
  const tool = async () => { count++; return { status: 'disabled' }; };
  assert.deepEqual(await recallPresentation({ enabled: true, subject, tool }), {});
  assert.equal(count, 1);
  assert.deepEqual(await recallPresentation({ enabled: true, subject, tool: async () => { throw Error('offline'); } }), {});
});
console.log(`\nresult: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

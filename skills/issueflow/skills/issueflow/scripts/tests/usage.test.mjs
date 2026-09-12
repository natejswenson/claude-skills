import test from 'node:test';
import assert from 'node:assert/strict';
import { readUsage } from '../lib/usage.mjs';

test('Claude streaming messages are counted once by message identity', () => {
  const record = { type: 'assistant', message: { id: 'message-1', usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 5, cache_creation_input_tokens: 3 } } };
  const later = structuredClone(record); later.message.usage.output_tokens = 8;
  const result = readUsage([record, later], { host: 'claude', attemptId: 'A1' });
  assert.equal(result.samples, 1); assert.equal(result.totals.inputTokens, 18); assert.equal(result.totals.outputTokens, 8);
  assert.equal(result.attemptId, 'A1'); assert.equal(result.costUsd, null);
});

test('Codex cumulative snapshots are not summed and exec usage is a separate adapter', () => {
  const total = (input) => ({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: input, output_tokens: 4, cached_input_tokens: 3 } } } });
  const result = readUsage([total(10), total(20), total(20)], { host: 'codex' });
  assert.equal(result.totals.inputTokens, 20); assert.equal(result.totals.cacheWriteTokens, null);
  const exec = readUsage([{ type: 'turn.completed', turn_id: '1', usage: { input_tokens: 10, output_tokens: 2, cached_input_tokens: 3 } }], { host: 'codex' });
  assert.equal(exec.totals.inputTokens, 10);
});

test('missing, malformed, and unsupported usage never become measured zero', () => {
  for (const host of ['claude', 'codex']) {
    assert.equal(readUsage([], { host }).totals.inputTokens, null);
    assert.equal(readUsage(['bad JSON'], { host }).totals.outputTokens, null);
  }
  const result = readUsage([{ type: 'assistant', message: { id: 'x', usage: { input_tokens: null, output_tokens: -1, cache_read_input_tokens: '5', cache_creation_input_tokens: false } } }], { host: 'claude' });
  assert.equal(result.totals.inputTokens, null); assert.equal(result.totals.outputTokens, null);
  assert.throws(() => readUsage([], { host: 'unknown' }), /host/);
});

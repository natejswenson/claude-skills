import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTranscript } from '../lib/trace.mjs';

test('Codex rollout keeps anchored evidence, redacts secrets and ignores duplicate events', () => {
  const rows = [
    { type: 'session_meta', payload: { id: 'session' } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Run tests' }] } },
    { type: 'event_msg', payload: { type: 'user_message', message: 'Run tests' } },
    { type: 'response_item', payload: { type: 'reasoning', summary: [{ text: 'private' }] } },
    { type: 'response_item', payload: { type: 'function_call', name: 'functions.exec_command', call_id: 'c1', arguments: JSON.stringify({ cmd: 'npm test' }) } },
    { type: 'response_item', payload: { type: 'function_call_output', call_id: 'c1', output: 'ghp_abcdefghijklmnopqrstuvwx' } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Tests passed.' }] } },
  ];
  const trace = normalizeTranscript(rows.map(r => JSON.stringify(r)).join('\n'));
  assert.deepEqual(trace.events.map(e => e.kind), ['user', 'tool-use', 'tool-result', 'assistant']);
  assert.equal(trace.events[1].line, 5);
  assert.equal(trace.events[1].command, 'npm test');
  assert.equal(trace.events[2].callId, 'c1');
  assert.equal(trace.events[2].text, 'gh-REDACTED');
  assert.equal(trace.dropped.thinking, 1);
  assert.ok(!JSON.stringify(trace).includes('private'));
});

test('Codex bookkeeping and malformed records do not become a clean-looking run', () => {
  const trace = normalizeTranscript('{bad\n' + JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'injected' }] } }));
  assert.equal(trace.events.length, 0);
  assert.equal(trace.dropped.unparsed, 1);
  assert.equal(trace.dropped.bookkeeping, 1);
});

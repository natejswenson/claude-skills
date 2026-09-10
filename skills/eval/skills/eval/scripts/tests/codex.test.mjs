import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTranscript } from '../lib/trace.mjs';
import { runProbes } from '../lib/probes.mjs';
import { homedir } from 'node:os';

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

const claudeCall = (name, input) => ({
  type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] },
});
const codexCall = (name, input) => ({
  type: 'response_item', payload: { type: 'function_call', name: `functions.${name}`, arguments: JSON.stringify(input) },
});
const eventsOf = (rows) => normalizeTranscript(rows.map(r => JSON.stringify(r)).join('\n')).events;
const target = 'skills/widget/skills/widget/SKILL.md';
const patch = `*** Begin Patch\n*** Update File: ${target}\n@@\n-old\n+private patch body\n*** End Patch`;
const claudeRows = [
  claudeCall('AskUserQuestion', { questions: [{}, {}] }),
  claudeCall('AskUserQuestion', { questions: [{}] }),
  claudeCall('Edit', { file_path: target, new_string: 'private patch body' }),
];
const codexRows = [
  codexCall('request_user_input', { questions: [{}, {}] }),
  codexCall('request_user_input', { questions: [{}] }),
  { type: 'response_item', payload: { type: 'custom_tool_call', name: 'functions.apply_patch', call_id: 'patch1', input: patch } },
];
const contract = { clauses: [
  { id: 'questions', severity: 'major', text: 'Ask at most two questions.' },
  { id: 'brand', severity: 'major', text: 'Never hand-write a brand value; regions are generated.' },
] };
const findingsOf = (events) => runProbes({ contract, events, skill: 'widget' }).findings;

for (const [probe, eventId, detail] of [
  ['question-budget', 'e2', 'question 3 of a 2-question budget'],
  ['brand-bypass', 'e3', `edited ${target} with no press emit/check anywhere in the run`],
]) {
  test(`${probe} produces identical Claude and Codex findings`, () => {
    const claude = findingsOf(eventsOf(claudeRows)).filter(f => f.probe === probe);
    assert.equal(claude.length, 1);
    assert.equal(claude[0].eventId, eventId);
    assert.equal(claude[0].detail, detail);
    assert.deepEqual(findingsOf(eventsOf(codexRows)).filter(f => f.probe === probe), claude);
  });
}

for (const [index, count] of [[0, 2], [1, 1]]) {
  test(`Codex question call ${index + 1} retains its question count`, () => {
    assert.equal(eventsOf(codexRows)[index].questions, count);
  });
}

test('semantic normalization preserves raw names, anchors, call IDs and omits edit bodies', () => {
  const events = eventsOf(codexRows);
  assert.deepEqual(events.map(e => e.name), ['functions.request_user_input', 'functions.request_user_input', 'functions.apply_patch']);
  assert.deepEqual(events.map(e => [e.id, e.line]), [['e1', 1], ['e2', 2], ['e3', 3]]);
  assert.equal(events[2].callId, 'patch1');
  assert.ok(!JSON.stringify(events).includes('private patch body'));
});

for (const [kind, claude, codex] of [
  ['command', claudeCall('Bash', { command: 'npm test' }), codexCall('exec_command', { cmd: 'npm test' })],
  ['read', claudeCall('Read', { file_path: target }), codexCall('read_file', { path: target })],
  ['edit', claudeRows[2], codexRows[2]],
  ['question', claudeRows[0], codexRows[0]],
  ['delegation', claudeCall('Agent', { subagent_type: 'explorer' }), codexCall('spawn_agent', { agent_type: 'explorer' })],
  ['skill', claudeCall('Skill', { skill: 'press' }), codexCall('Skill', { skill: 'press' })],
]) {
  for (const [host, row] of [['Claude', claude], ['Codex', codex]]) {
    test(`${host} ${kind} call exposes its semantic kind`, () => {
      assert.equal(eventsOf([row])[0].toolKind, kind);
    });
  }
}

for (const [representation, payload] of [
  ['custom input', { type: 'custom_tool_call', input: patch }],
  ['raw arguments', { type: 'function_call', arguments: patch }],
  ['JSON string arguments', { type: 'function_call', arguments: JSON.stringify(patch) }],
  ['JSON patch arguments', { type: 'function_call', arguments: JSON.stringify({ patch }) }],
]) {
  test(`Codex patch paths are extracted from ${representation}`, () => {
    const [event] = eventsOf([{ type: 'response_item', payload: { name: 'functions.apply_patch', ...payload } }]);
    assert.deepEqual(event.paths, [target]);
    assert.ok(!JSON.stringify(event).includes('private patch body'));
  });
}

test('patch evidence includes only redacted Add/Update/Delete headers and probes every path', () => {
  const patch = `*** Begin Patch\n*** Add File: ${homedir()}/notes.md\n+body skills/decoy/SKILL.md\n*** Update File: ${target}\n@@\n+*** Add File: skills/decoy/README.md\n*** Delete File: ghp_abcdefghijklmnopqrstuvwx.txt\n*** End Patch`;
  const events = eventsOf([codexCall('apply_patch', { patch })]);
  assert.deepEqual(events[0].paths, ['~/notes.md', target, 'gh-REDACTED.txt']);
  assert.equal(findingsOf(events).filter(f => f.probe === 'brand-bypass').length, 1);
  assert.ok(!JSON.stringify(events).includes('decoy'));
});

test('semantic selectors work without host names and legacy Claude traces retain findings', () => {
  const events = eventsOf(claudeRows);
  const expected = findingsOf(events);
  assert.equal(expected.length, 2);
  assert.deepEqual(findingsOf(events.map(e => ({ ...e, name: 'another-host' }))), expected);
  assert.deepEqual(findingsOf(events.map(({ toolKind, ...e }) => e)), expected);
});

test('semantic command evidence suppresses brand bypass after press', () => {
  const edited = { id: 'edit', kind: 'tool-use', name: 'Edit', toolKind: 'edit', path: target };
  const command = { id: 'command', kind: 'tool-use', toolKind: 'command', name: 'another-host', command: 'press check' };
  assert.equal(findingsOf([edited, command]).filter(f => f.probe === 'brand-bypass').length, 0);
});

test('Codex exec orchestration source is not treated as a shell command', () => {
  const events = eventsOf([{ type: 'response_item', payload: {
    type: 'custom_tool_call',
    name: 'functions.exec',
    input: "await tools.exec_command({ cmd: 'gh pr create --base main' });",
  } }]);
  const contract = { clauses: [{ id: 'main', severity: 'major', text: 'Never open a PR into main.' }] };
  assert.equal(events[0].toolKind, undefined);
  assert.equal(events[0].command, undefined);
  assert.deepEqual(runProbes({ contract, events, skill: 'widget' }).findings, []);
});

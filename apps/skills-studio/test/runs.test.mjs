import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunManager } from '../server/runs.mjs';

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'studio-test-'));
  await mkdir(join(root, 'workspace'));
  class Client extends EventEmitter {
    calls = []; replies = []; account = { type: 'chatgpt', planType: 'plus' };
    async initialize() {}
    async request(method, params) {
      this.calls.push({ method, params });
      if (method === 'account/read') return { account: this.account };
      if (method === 'model/list') return { data: [{ id: 'test-model', model: 'test-model', isDefault: true }] };
      if (method === 'skills/list') return { data: [] };
      if (method === 'thread/start') return { thread: { id: 'thread-1' } };
      if (method === 'turn/start') return { turn: { id: 'turn-1' } };
      return {};
    }
    reply(id, result) { this.replies.push({ id, result }); }
    reject(id) { this.replies.push({ id, rejected: true }); }
  }
  const records = new Map();
  const store = { list: () => [...records.values()], get: id => records.get(id), save: run => records.set(run.id, structuredClone(run)) };
  const client = new Client();
  const manager = new RunManager({ client, store, repoRoot: root, dataDir: root, workspace: join(root, 'workspace'), catalog: [{ id: 'proof', name: 'Proof', path: join(root, 'SKILL.md'), available: true }] });
  await manager.initialize();
  return { manager, client, root };
}
test('requires a subscription before each turn, even after a valid connection', async () => {
  const { manager, client } = await setup();
  client.account = { type: 'apiKey' };
  await assert.rejects(manager.create({ prompt: 'hello' }), /subscription/);
  assert.equal(client.calls.filter(c => c.method === 'turn/start').length, 0);
});
test('selected skills use structured input and explicit execution policy', async () => {
  const { manager, client } = await setup();
  await manager.create({ prompt: 'hello', skillId: 'proof' });
  const start = client.calls.find(c => c.method === 'thread/start').params;
  assert.equal(start.sandbox, 'workspace-write');
  assert.equal(start.approvalPolicy, 'on-request');
  assert.equal(start.approvalsReviewer, 'user');
  const turn = client.calls.find(c => c.method === 'turn/start').params;
  assert.equal(turn.input[1].type, 'skill');
  await assert.rejects(manager.create({ prompt: 'another' }), /active/);
});
test('streamed messages, approval decisions and duplicate replies are bound to the run', async () => {
  const { manager, client } = await setup();
  const run = await manager.create({ prompt: 'hello' });
  client.emit('event', { method: 'item/agentMessage/delta', params: { threadId: run.threadId, itemId: 'msg', delta: 'Hello' } });
  assert.equal(manager.get(run.id).messages.at(-1).text, 'Hello');
  client.emit('event', { id: 91, method: 'item/commandExecution/requestApproval', params: { threadId: run.threadId, turnId: 'turn-1', command: 'touch report.txt' } });
  assert.equal(manager.get(run.id).status, 'approval_needed');
  assert.throws(() => manager.respond(run.id, { requestId: '91', result: { decision: 'acceptForSession' } }), /decision/);
  manager.respond(run.id, { requestId: '91', result: { decision: 'decline' } });
  assert.deepEqual(client.replies.at(-1), { id: 91, result: { decision: 'decline' } });
  assert.throws(() => manager.respond(run.id, { requestId: '91', result: { decision: 'accept' } }), /pending/);
});
test('user answers are validated, cancellation waits for completion, crashes preserve history', async () => {
  const { manager, client } = await setup();
  const run = await manager.create({ prompt: 'hello' });
  client.emit('event', { id: 3, method: 'item/tool/requestUserInput', params: { threadId: run.threadId, questions: [{ id: 'choice', question: 'Choose' }] } });
  assert.equal(manager.get(run.id).status, 'awaiting_input');
  assert.throws(() => manager.respond(run.id, { requestId: '3', result: { answers: {} } }), /answer/);
  manager.respond(run.id, { requestId: '3', result: { answers: { choice: { answers: ['Yes'] } } } });
  await manager.interrupt(run.id);
  assert.equal(manager.get(run.id).status, 'working');
  client.emit('disconnect', 'Lost connection');
  assert.equal(manager.get(run.id).status, 'interrupted');
  assert.equal(manager.get(run.id).messages[0].text, 'hello');
});
test('rejects unknown skills and oversized or blank messages without creating turns', async () => {
  const { manager } = await setup();
  await assert.rejects(manager.create({ prompt: 'hello', skillId: 'missing' }), /skill/);
  await assert.rejects(manager.create({ prompt: ' ' }), /prompt/);
  await assert.rejects(manager.create({ prompt: 'x'.repeat(50001) }), /prompt/);
});
test('resolved server requests clear pending state even without a thread ID', async () => {
  const { manager, client } = await setup();
  const run=await manager.create({prompt:'hello'});
  client.emit('event',{id:7,method:'item/commandExecution/requestApproval',params:{threadId:run.threadId}});
  client.emit('event',{method:'serverRequest/resolved',params:{requestId:7}});
  assert.equal(manager.get(run.id).pending.length,0);
  assert.equal(manager.get(run.id).status,'working');
});
test('unknown run follow-ups cannot lock out future work', async () => {
  const {manager}=await setup();
  await assert.rejects(manager.followUp('unknown',{prompt:'hello'}),/not found/);
  assert.ok(await manager.create({prompt:'valid'}));
});

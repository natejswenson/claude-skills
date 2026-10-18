import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunManager } from '../server/runs.mjs';

async function setup() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'studio-test-')));
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
test('approval responses respect the actual server choices without granting persistent permissions', async () => {
  const {manager,client}=await setup();
  const run=await manager.create({prompt:'approval test'});
  client.emit('event',{id:12,method:'item/commandExecution/requestApproval',params:{threadId:run.threadId,availableDecisions:['accept',{acceptWithExecpolicyAmendment:{execpolicy_amendment:['printf']}},'cancel']}});
  assert.throws(()=>manager.respond(run.id,{requestId:'12',result:{decision:'decline'}}),/decision/);
  assert.throws(()=>manager.respond(run.id,{requestId:'12',result:{decision:{acceptWithExecpolicyAmendment:{execpolicy_amendment:['printf']}}}}),/decision/);
  manager.respond(run.id,{requestId:'12',result:{decision:'cancel'}});
  assert.deepEqual(client.replies.at(-1),{id:12,result:{decision:'cancel'}});
});
test('command activity includes actual stdout and exit code, including failed commands', async () => {
  const {manager,client}=await setup();
  const run=await manager.create({prompt:'command test'});
  client.emit('event',{method:'item/completed',params:{threadId:run.threadId,item:{id:'exec1',type:'commandExecution',command:'printf marker',aggregatedOutput:'REAL_MARKER',exitCode:7,status:'completed'}}});
  const activity=manager.get(run.id).activities[0];
  assert.match(activity.detail,/REAL_MARKER/);
  assert.match(activity.detail,/Exit code: 7/);
  assert.equal(activity.status,'failed');
});
test('workspace scans stop at the documented file limit, including a single large directory', async () => {
  const {manager,root}=await setup();
  await Promise.all(Array.from({length:510},(_,index)=>writeFile(join(root,'workspace',`${index}.md`),'existing output')));
  const run=await manager.create({prompt:'scan test'});
  assert.equal(Object.keys(run.baseline).length,500);
});
test('output revisions are immutable and do not capture existing files or symlink escapes', async () => {
  const {manager,root}=await setup();
  await writeFile(join(root,'workspace','existing.md'),'not from this run');
  await writeFile(join(root,'outside.md'),'not part of the workspace');
  const run=await manager.create({prompt:'artifact test'});
  await symlink(join(root,'outside.md'),join(root,'workspace','escape.md'));
  await writeFile(join(root,'workspace','report.md'),'first revision');
  await manager.collectArtifacts(run.id);
  const first=manager.get(run.id).artifacts;
  assert.equal(first.length,1);
  assert.equal(first[0].name,'report.md');
  await writeFile(join(root,'workspace','report.md'),'second revision with more detail');
  await manager.collectArtifacts(run.id);
  const versions=manager.get(run.id).artifacts;
  assert.equal(versions.length,2);
  assert.equal(await readFile(join(root,'artifacts',run.id,versions[0].file),'utf8'),'first revision');
  assert.equal(await readFile(join(root,'artifacts',run.id,versions[1].file),'utf8'),'second revision with more detail');
});
test('attached documents are copied into the run and referenced in Codex input; images use native image input', async () => {
  const {manager,client,root}=await setup();
  const image='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8hkAAAAASUVORK5CYII=';
  const run=await manager.create({prompt:'Read the brief and inspect the image',attachments:[{name:'brief.md',data:Buffer.from('LOCAL_BRIEF_MARKER').toString('base64')},{name:'reference.png',data:image}]});
  const files=run.messages[0].attachments;
  assert.equal(files.length,2);
  assert.equal(await readFile(join(root,files[0].file),'utf8'),'LOCAL_BRIEF_MARKER');
  const input=client.calls.find(call=>call.method==='turn/start').params.input;
  const text=input.filter(item=>item.type==='text').map(item=>item.text).join('\n');
  assert.match(text,/brief.md/);
  assert.ok(text.includes(join(root,files[0].file)));
  assert.ok(input.some(item=>item.type==='localImage'&&item.path===join(root,files[1].file)));
});
test('follow-up files are attached to their own message and prior attachments remain unchanged', async () => {
  const {manager,client,root}=await setup();
  const run=await manager.create({prompt:'Read first',attachments:[{name:'notes.txt',data:Buffer.from('first').toString('base64')}]});
  client.emit('event',{method:'turn/completed',params:{threadId:run.threadId,turn:{id:'turn-1',status:'completed'}}});
  while(manager.finalizing.size) await once(manager,'change');
  const next=await manager.followUp(run.id,{prompt:'Read second',attachments:[{name:'notes.txt',data:Buffer.from('second').toString('base64')}]});
  assert.equal(next.messages.filter(message=>message.role==='user').length,2);
  const first=next.messages[0].attachments[0],second=next.messages[1].attachments[0];
  assert.notEqual(first.id,second.id);
  assert.equal(await readFile(join(root,first.file),'utf8'),'first');
  assert.equal(await readFile(join(root,second.file),'utf8'),'second');
  const latest=client.calls.filter(call=>call.method==='turn/start').at(-1).params.input;
  assert.ok(latest.some(item=>item.text?.includes(second.file)));
  assert.ok(!latest.some(item=>item.text?.includes(first.file)));
});
test('invalid or forged attachment paths fail before creating a Codex thread', async () => {
  const {manager,client}=await setup();
  await assert.rejects(manager.create({prompt:'Read file',attachments:[{name:'notes.txt',path:'/etc/passwd'}]}),/attachment|file|data|base64/i);
  assert.equal(client.calls.filter(call=>call.method==='thread/start').length,0);
});

test('activity retains its owning turn so a later turn cannot show stale progress', async () => {
  const { manager, client } = await setup();
  const run = await manager.create({ prompt: 'hello' });
  client.emit('event', {method:'item/started',params:{threadId:run.threadId,turnId:'turn-1',item:{id:'prior',type:'commandExecution',command:'printf prior',status:'inProgress'}}});
  assert.equal(manager.get(run.id).activities[0].turnId,'turn-1');
  client.emit('event', {method:'item/completed',params:{threadId:run.threadId,turnId:'turn-1',item:{id:'prior',type:'commandExecution',command:'printf prior',status:'completed'}}});
  assert.equal(manager.get(run.id).activities[0].turnId,'turn-1');
});

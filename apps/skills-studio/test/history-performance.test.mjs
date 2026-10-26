import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Store } from '../server/store.mjs';
import { RunManager } from '../server/runs.mjs';

function fixture(t) {
  const store = new Store(':memory:'); t.after(() => store.close());
  const client = new EventEmitter(); client.reject = () => {};
  const manager = new RunManager({store, client, repoRoot:'/tmp', dataDir:'/tmp', workspace:'/tmp', catalog:[]});
  return {store, manager, client};
}
const record = (id, extra={}) => ({id, title:`Run ${id}`, skillId:'devlog', status:'completed', createdAt:'2026-10-20T00:00:00Z',updatedAt:'2026-10-20T00:00:00Z', messages:[{id:'message',role:'assistant',text:'archived body '.repeat(1000)}],activities:[],pending:[],artifacts:[],...extra});

test('bootstrap returns bounded summaries rather than archived conversation bodies', t => {
  const {store,manager}=fixture(t);
  for(let n=0;n<1000;n++)store.save(record(String(n).padStart(4,'0')));
  const data=manager.bootstrap();
  assert.equal(data.runs.length,50); assert.equal(data.history.total,1000); assert.equal(data.history.nextOffset,50);
  assert.ok(data.runs.every(run=>!('messages' in run)&&!('activities' in run)&&!('artifacts' in run)&&!('pending' in run)));
  assert.ok(Buffer.byteLength(JSON.stringify(data))<32000);
});

test('history pages preserve literal case-insensitive message search and stable ordering', t => {
  const {store}=fixture(t);
  for(let n=0;n<125;n++)store.save(record(String(n).padStart(3,'0')));
  store.save(record('unicode',{messages:[{text:'Follow-up ÉCOLE with 100%_ literal content'}]}));
  const first=store.history({limit:50}), second=store.history({limit:50,offset:50}), third=store.history({limit:50,offset:100});
  const ids=[...first.runs,...second.runs,...third.runs].map(run=>run.id);
  assert.equal(new Set(ids).size,126); assert.equal(third.nextOffset,null);
  assert.deepEqual(store.history({query:'école'}).runs.map(run=>run.id),['unicode']);
  assert.deepEqual(store.history({query:'100%_'}).runs.map(run=>run.id),['unicode']);
  assert.equal(store.history({query:'devlog'}).total,126);
  assert.equal(store.history({query:'missing phrase'}).total,0);
  assert.throws(()=>store.history({limit:500}),{status:400});
  assert.throws(()=>store.history({offset:-1}),{status:400});
});

test('streaming, request resolution and idle checks do not scan archived full records', t => {
  const {store,manager}=fixture(t);
  for(let n=0;n<1000;n++)store.save(record(`archive-${n}`));
  store.save(record('live',{status:'working',threadId:'live-thread',messages:[],pending:[{id:'91',rpcId:91,method:'item/commandExecution/requestApproval',params:{}}]}));
  store.list=()=>{throw new Error('Full history scan forbidden on live path');};
  manager.onEvent({method:'item/agentMessage/delta',params:{threadId:'live-thread',itemId:'live-msg',delta:'Updated'}});
  assert.equal(store.get('live').messages[0].text,'Updated');
  manager.onEvent({method:'serverRequest/resolved',params:{requestId:91}});
  assert.equal(store.get('live').pending.length,0);
  assert.throws(()=>manager.assertIdle(),{status:409});
  const done=store.get('live');done.status='completed';store.save(done);assert.doesNotThrow(()=>manager.assertIdle());
});

test('disconnect interrupts only active runs without scanning completed bodies', t => {
  const {store,manager,client}=fixture(t);
  store.save(record('old'));store.save(record('live',{status:'approval_needed',threadId:'thread',pending:[{rpcId:12}]}));
  store.list=()=>{throw new Error('Full archive scan forbidden');};
  client.emit('disconnect','synthetic');
  assert.equal(store.get('live').status,'interrupted');assert.equal(store.get('live').pending.length,0);
  assert.equal(store.get('old').status,'completed');
});


test('an active run stays discoverable outside the newest history page', t => {
  const {store,manager}=fixture(t);
  for(let n=0;n<60;n++)store.save(record(`future-${n}`,{updatedAt:'2099-01-01'}));
  store.save(record('live',{status:'working',threadId:'thread',messages:[]}));
  const data=manager.bootstrap();assert.equal(data.runs.some(run=>run.id==='live'),false);assert.equal(data.activeRun.id,'live');
  assert.equal('messages' in data.activeRun,false);
});
test('streamed text invalidates open history search even when status does not change', t => {
  const {store,manager}=fixture(t);store.save(record('live',{status:'working',threadId:'thread',messages:[]}));
  const before=manager.bootstrap().history.revision;assert.equal(store.history({query:'needle'}).total,0);
  manager.onEvent({method:'item/agentMessage/delta',params:{threadId:'thread',itemId:'msg',delta:'needle'}});
  assert.equal(store.history({query:'needle'}).total,1);assert.ok(manager.bootstrap().history.revision>before);
});

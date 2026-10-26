import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, realpath, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.mjs';
import { RunManager } from '../server/runs.mjs';

async function setup(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'studio-delete-')));
  const dataDir = join(root, 'data'), workspace = join(root, 'source');
  await mkdir(dataDir); await mkdir(workspace);
  const store = new Store(join(dataDir, 'studio.sqlite'));
  t.after(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  const client = new EventEmitter(); client.reject = () => {};
  const manager = new RunManager({client, store, dataDir, workspace, repoRoot: root, catalog: []});
  const run = {id: randomUUID(), title: 'Synthetic report', status: 'completed', cwd: workspace, threadId:'native-thread', messages:[], pending:[], artifacts:[], activities:[], updatedAt:'2026-10-25'};
  store.save(run);
  for (const tree of ['inputs', 'artifacts']) { await mkdir(join(dataDir, tree, run.id), {recursive:true}); await writeFile(join(dataDir, tree, run.id, 'copy.txt'), tree); }
  await writeFile(join(workspace, 'original.txt'), 'source preserved');
  return {root, dataDir, workspace, store, manager, run};
}

test('deletion removes only the selected row and Studio copies; nested symlink targets and source survive', async t => {
  const {manager,store,run,dataDir,workspace,root} = await setup(t);
  const other = {...run,id:randomUUID()}; store.save(other);
  await writeFile(join(root,'native-history'), 'history preserved');
  await symlink(join(root,'native-history'),join(dataDir,'inputs',run.id,'nested-link'));
  assert.deepEqual(await manager.delete(run.id), {deleted:run.id});
  assert.equal(store.get(run.id),undefined); assert.ok(store.get(other.id));
  assert.deepEqual(store.list().map(r=>r.id),[other.id]);
  for(const tree of ['inputs','artifacts']) await assert.rejects(access(join(dataDir,tree,run.id)),{code:'ENOENT'});
  assert.equal(await readFile(join(workspace,'original.txt'),'utf8'),'source preserved');
  assert.equal(await readFile(join(root,'native-history'),'utf8'),'history preserved');
  assert.throws(()=>manager.get(run.id),{status:404});
});

test('missing run and invalid identifiers cannot delete any copies', async t => {
 const {manager,run,store,dataDir}=await setup(t);
 await assert.rejects(manager.delete(randomUUID()),{status:404});
 for(const id of ['../inputs','',run.id+'/..']) await assert.rejects(manager.delete(id),{status:400});
 assert.ok(store.get(run.id)); assert.equal(await readFile(join(dataDir,'inputs',run.id,'copy.txt'),'utf8'),'inputs');
});

for(const status of ['working','approval_needed','awaiting_input','collecting_output']) test(`cannot delete ${status} run`,async t=>{
 const {manager,store,run}=await setup(t); store.save({...run,status});
 await assert.rejects(manager.delete(run.id),{status:409}); assert.ok(store.get(run.id));
});

test('finalizing and busy managers reject deletion and deletion synchronously locks competing operations',async t=>{
 const {manager,store,run}=await setup(t);
 manager.finalizing.add(run.id); await assert.rejects(manager.delete(run.id),{status:409}); manager.finalizing.clear();
 manager.busy=true; await assert.rejects(manager.delete(run.id),{status:409}); manager.busy=false;
 const deletion=manager.delete(run.id);
 assert.throws(()=>manager.assertIdle(),{status:409});
 await assert.rejects(manager.delete(run.id),{status:409});
 await assert.rejects(manager.followUp(run.id,{prompt:'Competing follow-up'}),{status:409});
 await assert.rejects(manager.create({prompt:'Competing run'}),{status:409});
 await assert.rejects(manager.reconnect(),{status:409});
 await manager.onEvent({method:'item/agentMessage/delta',params:{threadId:run.threadId,itemId:'late',delta:'late'}});
 assert.equal(store.get(run.id).messages.length,0);
 await deletion; assert.equal(store.get(run.id),undefined); assert.doesNotThrow(()=>manager.assertIdle());
});

for(const location of ['inputs','artifacts','run-root']) test(`preflight rejects ${location} symlink before removing either tree`,async t=>{
 const {manager,store,run,dataDir,root}=await setup(t);
 const target=location==='run-root'?join(dataDir,'artifacts',run.id):join(dataDir,location);
 await rm(target,{recursive:true}); await symlink(root,target);
 await assert.rejects(manager.delete(run.id),/symlink|unsafe/i);
 assert.ok(store.get(run.id));
 if(location!=='inputs') assert.equal(await readFile(join(dataDir,'inputs',run.id,'copy.txt'),'utf8'),'inputs');
 assert.equal(await readFile(join(root,'source','original.txt'),'utf8'),'source preserved');
});

test('workspace overlap is rejected before copy removal',async t=>{
 const {manager,store,run,dataDir}=await setup(t); store.save({...run,cwd:join(dataDir,'artifacts',run.id,'project')});
 await assert.rejects(manager.delete(run.id),/workspace|unsafe/i);
 assert.equal(await readFile(join(dataDir,'inputs',run.id,'copy.txt'),'utf8'),'inputs'); assert.ok(store.get(run.id));
});

test('database failure retains the row with a partial-cleanup warning; retry tolerates missing directories',async t=>{
 const {manager,store,run}=await setup(t);
 const remove=store.delete.bind(store); store.delete=()=>{throw new Error('synthetic database failure')};
 await assert.rejects(manager.delete(run.id),/copies may already.*removed|partially removed/i);
 assert.ok(store.get(run.id)); assert.doesNotThrow(()=>manager.assertIdle());
 store.delete=remove; await manager.delete(run.id); assert.equal(store.get(run.id),undefined);
});

test('filesystem cleanup failure retains the row and releases busy state for retry',async t=>{
 const {manager,store,run,dataDir}=await setup(t);
 const {chmod}=await import('node:fs/promises');
 const dir=join(dataDir,'inputs',run.id);
 await chmod(dir,0o500);
 try {
   await assert.rejects(manager.delete(run.id),/copies may already.*removed|partially removed/i);
   assert.ok(store.get(run.id)); assert.doesNotThrow(()=>manager.assertIdle());
 } finally { await chmod(dir,0o700); }
 await manager.delete(run.id); assert.equal(store.get(run.id),undefined);
});

test('canonical workspace aliases cannot point into the deletion trees',async t=>{
 const {manager,store,run,dataDir,root}=await setup(t);
 await symlink(join(dataDir,'artifacts',run.id),join(root,'workspace-alias'));
 store.save({...run,cwd:join(root,'workspace-alias')});
 await assert.rejects(manager.delete(run.id),/workspace|unsafe/i);
 assert.equal(await readFile(join(dataDir,'inputs',run.id,'copy.txt'),'utf8'),'inputs');
});

for (const selectionFirst of [false, true]) test(`workspace selection ${selectionFirst ? 'already awaiting the filesystem' : 'started during deletion'} cannot switch into copies being removed`, async t => {
 const {manager,store,run,dataDir,workspace} = await setup(t);
 const target = join(dataDir,'inputs',run.id);
 let selection, deletion;
 if (selectionFirst) { selection = manager.selectWorkspace(target); deletion = manager.delete(run.id); }
 else { deletion = manager.delete(run.id); selection = manager.selectWorkspace(target); }
 const [selected, deleted] = await Promise.allSettled([selection, deletion]);
 assert.equal(selected.status,'rejected','workspace selection must not succeed while deletion is in flight');
 assert.equal(selected.reason.status,409);
 assert.equal(deleted.status,'fulfilled');
 assert.equal(manager.workspace,workspace);
 assert.equal(store.get(run.id),undefined);
 assert.equal(await readFile(join(workspace,'original.txt'),'utf8'),'source preserved');
 // create() selects its requested workspace while holding the generic busy flag.
 manager.busy = true;
 assert.deepEqual(await manager.selectWorkspace(workspace),{workspace});
 manager.busy = false;
});

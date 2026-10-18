import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, chmodSync, symlinkSync, linkSync, unlinkSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { captureFeedback, validateFeedbackBatch } from '../lib/local-feedback.mjs';
const record = (extra={}) => {
  const sender='person@synthetic.example', subject='Café 😀 project update';
  return {schemaVersion:1,eventId:randomUUID(),confirmed:true,source:'triage-review',sender,subject,
    choices:[{id:'work',description:'Work correspondence'},{id:'learning',description:'Courses'}],
    selectedChoiceId:'work',sourceId:createHash('sha256').update(JSON.stringify([sender.toLowerCase(),subject])).digest('hex'),...extra};
};
const batch = (...examples) => ({schemaVersion:1,examples});
const fixture = t => { const dir=mkdtempSync(join(tmpdir(),'gmail-feedback-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir; };
test('strict explicit feedback with Unicode hash and none',()=>{
  const r=record();assert.deepEqual(validateFeedbackBatch(batch(r)),[r]);
  assert.equal(validateFeedbackBatch(batch(record({selectedChoiceId:null})))[0].selectedChoiceId,null);
  const mutations=[r=>r.confirmed=false,r=>delete r.confirmed,r=>r.snippet='private',r=>r.threadId='gmail',r=>r.eventId='../escape',r=>r.source='prediction',r=>r.sender='Person <p@synthetic.example>',r=>r.sender='a@@synthetic.example',r=>r.sender='Person@synthetic.example',r=>r.sender=' person@synthetic.example',r=>r.subject='',r=>r.subject='😀'.repeat(161),r=>r.sourceId='0'.repeat(64),r=>r.selectedChoiceId='absent',r=>r.choices[1].id='work',r=>r.choices[1].description=r.choices[0].description,r=>r.choices[0].extra=true,r=>r.choices.pop()];
  for(const mutate of mutations){const r=record();mutate(r);assert.throws(()=>validateFeedbackBatch(batch(r)));}
  for(const subject of ['Your verification code','Invoice available','Confirm your email','Reset password']) assert.throws(()=>validateFeedbackBatch(batch(record({subject}))),/protected/);
  for(const invalid of [batch(),{...batch(record()),extra:true},batch(...Array.from({length:201},()=>record()))]) assert.throws(()=>validateFeedbackBatch(invalid));
});
test('private immutable records, idempotent retry and no payload in aggregate',t=>{
  const dir=fixture(t), store=join(dir,'new','feedback'),r=record();
  assert.deepEqual(captureFeedback(batch(r),store),{captured:1,existing:0});
  const path=join(store,r.eventId+'.json'), before=readFileSync(path,'utf8');
  assert.equal(statSync(store).mode&511,0o700);assert.equal(statSync(path).mode&511,0o600);
  assert.deepEqual(captureFeedback(batch(r),store),{captured:0,existing:1});assert.equal(readFileSync(path,'utf8'),before);
  assert.throws(()=>captureFeedback(batch({...r,selectedChoiceId:null}),store),/event/);
  assert.deepEqual(captureFeedback(batch(r,r),store),{captured:0,existing:2});
});
test('validation and event conflicts preflight whole batch',t=>{
  const dir=fixture(t),store=join(dir,'feedback'),r=record();
  assert.throws(()=>captureFeedback(batch(r,record({confirmed:false})),store));
  assert.throws(()=>captureFeedback(batch(r,{...r,selectedChoiceId:null}),store));
  mkdirSync(store,{mode:0o700});captureFeedback(batch(r),store);
  assert.throws(()=>captureFeedback(batch(record(),{...r,selectedChoiceId:null}),store));assert.equal(readdirSync(store).length,1);
});
test('Git, symlink and permissions cannot bypass private store guards',t=>{
  const dir=fixture(t),store=join(dir,'feedback'),r=record();mkdirSync(store,{mode:0o700});
  chmodSync(store,0o755);assert.throws(()=>captureFeedback(batch(r),store),/private/);chmodSync(store,0o700);
  const outside=join(dir,'outside');writeFileSync(outside,JSON.stringify(r),{mode:0o600});
  const path=join(store,r.eventId+'.json');
  symlinkSync(outside,path);assert.throws(()=>captureFeedback(batch(r),store),/regular|symlink/);unlinkSync(path);
  linkSync(outside,path);assert.throws(()=>captureFeedback(batch(r),store),/regular|hardlink/);unlinkSync(path);
  writeFileSync(path,JSON.stringify(r),{mode:0o644});assert.throws(()=>captureFeedback(batch(r),store),/private/);unlinkSync(path);
  writeFileSync(path,'{"private subject": broken}',{mode:0o600});assert.throws(()=>captureFeedback(batch(r),store),e=>e.message==='learn-local: invalid review JSON');unlinkSync(path);
  const storeAlias=join(dir,'store-alias');symlinkSync(store,storeAlias);assert.throws(()=>captureFeedback(batch(r),storeAlias),/regular|symlink/);
  const repo=join(dir,'repo');mkdirSync(repo);writeFileSync(join(repo,'.git'),'gitdir: nowhere');
  assert.throws(()=>captureFeedback(batch(record()),join(repo,'feedback')),/Git/);
  const alias=join(dir,'alias');symlinkSync(repo,alias);assert.throws(()=>captureFeedback(batch(record()),join(alias,'feedback')),/Git/);
});
test('CLI requires private external input and emits only counts',t=>{
  const dir=fixture(t),input=join(dir,'review.json'),store=join(dir,'feedback'),r=record();writeFileSync(input,JSON.stringify(batch(r)),{mode:0o600});
  const run=(...args)=>spawnSync(process.execPath,[new URL('../gmailtriage.js',import.meta.url).pathname,'learn-local','--input',input,'--store',store,...args],{encoding:'utf8'});
  const result=run();assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),{captured:1,existing:0});assert.ok(!result.stdout.includes(r.sender));
  chmodSync(input,0o644);assert.notEqual(run().status,0);chmodSync(input,0o600);
  assert.notEqual(run('--allow-repo').status,0);
});

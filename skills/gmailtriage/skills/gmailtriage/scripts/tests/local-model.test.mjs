import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareLocalRequest } from '../lib/local-model.mjs';
const labels = [{name:'Projects',id:'l1'},{name:'Updates',id:'l2'}];
const choices = labels.map(({name}) => ({label:name,description:name+' correspondence'}));
const threads = (subject='Application update') => [0,1,2].map(i => ({id:String(i),from:'jobs@recruiting.example',subject,hasUnsubscribe:true}));
const prepare = (ts, extra={}) => prepareLocalRequest(ts,{labels,choices,rules:[],...extra});
test('uses proposal authority for claimed senders and whole-cluster sensitive subjects', () => {
  assert.equal(prepare(threads(),{rules:[{id:'keep-jobs',action:'keep',note:'Keep recruiting correspondence',match:{from:'jobs@recruiting.example'}}]}).request.items.length,0);
  for (const subject of ['Your verification code','Your receipt']) {
    const ts=threads(); ts[2].subject=subject;
    assert.equal(prepare(ts).request.items.length,0);
  }
});
test('existing deterministic destination is excluded', () => {
  assert.equal(prepare(threads(),{labels:[...labels,{name:'Recruiting',id:'l3'}]}).request.items.length,0);
});
import { validateLocalResponse, suggestLocal, assertLocalPath, validateLocalConfig } from '../lib/local-model.mjs';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, mkdirSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const response = (p, scores=[.95,.1]) => ({schemaVersion:1,model:{id:'synthetic',revision:'fixture'},scoreKind:'uncalibrated_entailment',calibration:'none',thresholds:{minScore:.8,minMargin:.2},decisions:p.candidates.map(c => ({itemId:c.id,decision:'suggest',choiceId:p.choices[0].id,scores:Object.fromEntries(p.choices.map((x,i) => [x.id,scores[i]])),topScore:scores[0],margin:scores[0]-scores[1],reason:'thresholds_met'}))});
const fixture = () => {
  const dir=mkdtempSync(join(tmpdir(),'gmailtriage-test-local-')); const script=join(dir,'runner.mjs');
  writeFileSync(script,`import {readFileSync,writeFileSync,statSync} from 'node:fs'; import {dirname} from 'node:path';
const args=process.argv.slice(2), input=args[args.indexOf('--input')+1], p=JSON.parse(readFileSync(input));
writeFileSync(args[args.indexOf('--model-dir')+1]+'/observed.json',JSON.stringify({args,env:[process.env.HF_HUB_OFFLINE,process.env.HF_HUB_DISABLE_IMPLICIT_TOKEN,process.env.TRANSFORMERS_OFFLINE],file:statSync(input).mode&511,dir:statSync(dirname(input)).mode&511,request:p}));
console.log(JSON.stringify({schemaVersion:1,model:{id:'synthetic',revision:'fixture'},scoreKind:'uncalibrated_entailment',calibration:'none',thresholds:{minScore:.8,minMargin:.2},decisions:p.items.map(c=>({itemId:c.id,decision:'suggest',choiceId:p.choices[0].id,scores:Object.fromEntries(p.choices.map((x,i)=>[x.id,i?0.1:0.95])),topScore:.95,margin:.85,reason:'thresholds_met'}))}));`);
  return {dir,config:{version:1,python:process.execPath,script,modelDir:dir}};
};
test('eligibility, exact choices and Unicode bounds', () => {
  const p=prepare(threads().map(t=>({...t,snippet:'PRIVATE'})));
  assert.equal(p.request.items.length,1);assert.deepEqual(Object.keys(p.request.items[0]),['id','sender','subjects']);assert.ok(!JSON.stringify(p.request).includes('PRIVATE'));
  assert.equal(prepare(threads().map(t=>({...t,senderAmbiguous:true}))).request.items.length,0);
  assert.equal(prepare(threads().map(t=>({...t,labels:['SENT']}))).request.items.length,0);
  for (const minCount of [0,1.5,NaN]) assert.throws(()=>prepare(threads(),{minCount}),/positive integer/);
  assert.throws(()=>prepare(threads(),{rules:[{}]}));
  assert.throws(()=>prepare(threads('😀'.repeat(161))),/bounds/);assert.equal(prepare(threads('😀'.repeat(160))).request.items.length,1);
  const batch=Array.from({length:21},(_,i)=>threads().map(t=>({...t,id:i+'-'+t.id,from:`jobs${i}@recruiting.example`}))).flat();
  assert.equal(prepare(batch.slice(0,60)).request.items.length,20);assert.throws(()=>prepare(batch),/smaller sample/);
  assert.equal(prepare(threads().map(t=>({...t,from:'x'.repeat(240)+'@recruiting.example'}))).request.items.length,0);
  for (const changed of [[choices[0]],[...choices,...Array(11).fill(choices[0])],[choices[0],choices[0]],[choices[0],{label:'New',description:'new'}],[choices[0],{label:'INBOX',description:'inbox'}],[choices[0],{...choices[1],description:''}],[choices[0],{...choices[1],description:'😀'.repeat(201)}],[choices[0],{...choices[1],action:'trash'}]]) assert.throws(()=>prepare(threads(),{choices:changed}));
  assert.throws(()=>prepare(threads(),{labels:[...labels,labels[0]]}),/unambiguous/);
  assert.equal(prepare(threads(),{choices:[choices[0],{...choices[1],description:'😀'.repeat(200)}]}).request.choices.length,2);
});
test('all scores and exact response fields checked; score policy is independently derived', () => {
  const p=prepare(threads());assert.equal(validateLocalResponse(response(p),p).suggestions[0].destination,'Projects');
  for (const [scores,reason] of [[[.79,.1],'below_min_score'],[[.9,.75],'below_min_margin'],[[.9,.9],'tied_top_scores'],[[.8,.60000001],'below_min_margin']]) {
    const r=response(p,scores);Object.assign(r.decisions[0],{decision:'abstain',choiceId:null,reason});assert.equal(validateLocalResponse(r,p).suggestions[0].decision,'abstain');r.decisions[0].decision='suggest';assert.throws(()=>validateLocalResponse(r,p));
  }
  for (const mutate of [r=>r.action='trash',r=>r.model.extra=true,r=>r.thresholds.minScore=.79,r=>r.decisions.push(r.decisions[0]),r=>r.decisions[0].itemId='alien',r=>r.decisions[0].scores.extra=.1,r=>delete r.decisions[0].scores[p.choices[1].id],r=>r.decisions[0].choiceId='alien',r=>r.decisions[0].margin=.5,r=>r.decisions[0].topScore=true,r=>r.decisions[0].reason='confident',r=>r.decisions[0].action='trash']) { const r=response(p);mutate(r);assert.throws(()=>validateLocalResponse(r,p)); }
  for (const score of [NaN,Infinity,-.1,1.1,true,'0.9']) {const r=response(p);r.decisions[0].scores[p.choices[1].id]=score;assert.throws(()=>validateLocalResponse(r,p));}
});
test('real execFile private files, exact offline arguments, and scoped cleanup', async () => {
  const {dir,config}=fixture();try {
    writeFileSync(join(dir,'unrelated'),'keep'); const p=prepare(threads());assert.equal((await suggestLocal(p,config,dir)).kind,'local-label-suggestions');
    const observed=JSON.parse(readFileSync(join(dir,'observed.json')));assert.deepEqual(observed.env,['1','1','1']);assert.deepEqual(observed.args.slice(2),['--model-dir',dir,'--min-score','0.8','--min-margin','0.2']);assert.equal(observed.file,0o600);assert.equal(observed.dir,0o700);assert.deepEqual(observed.request,p.request);
    assert.ok(!readdirSync(dir).some(n=>n.startsWith('gmailtriage-local-')));assert.equal(readFileSync(join(dir,'unrelated'),'utf8'),'keep');
    assert.equal((await suggestLocal(prepare([]),config,dir,{execute:()=>assert.fail('must not execute')})).suggestions.length,0);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test('fixed timeout and buffer, private errors and cleanup on failures', async () => {
  const {dir,config}=fixture();try {
    for (const mode of ['timeout','invalid']) {
      let observed;
      await assert.rejects(suggestLocal(prepare(threads()),config,dir,{execute:(python,args,options,cb)=>{
        observed={python,options};cb(mode==='timeout'?new Error('PRIVATE sender'):null,'PRIVATE stdout','PRIVATE stderr');
      }}),mode==='timeout'?/^Error: suggest-local: local classifier failed or timed out$/:/^Error: suggest-local: invalid local classifier response$/);
      assert.equal(observed.python,process.execPath);assert.equal(observed.options.timeout,90_000);assert.equal(observed.options.killSignal,'SIGKILL');assert.equal(observed.options.maxBuffer,1024*1024);assert.equal(observed.options.shell,false);
      assert.ok(!readdirSync(dir).some(n=>n.startsWith('gmailtriage-local-')));
    }
    writeFileSync(config.script,"console.error('PRIVATE');process.exit(1)");await assert.rejects(suggestLocal(prepare(threads()),config,dir),/^Error: suggest-local: local classifier failed or timed out$/);
    assert.throws(()=>validateLocalConfig({...config,python:'node'}));assert.throws(()=>validateLocalConfig({...config,extra:true}));
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test('CLI advice, unchanged inputs, no failure output, and preflight refusal of repository symlinks', () => {
  const {dir,config}=fixture();try {
    const docs={threads:threads(),labels,choices,rules:{rules:[]},config};for (const [name,value] of Object.entries(docs)) writeFileSync(join(dir,name+'.json'),JSON.stringify(value));
    const originals=Object.keys(docs).map(n=>readFileSync(join(dir,n+'.json'),'utf8'));
    const cli=resolve('scripts/gmailtriage.js');const args=['--threads',join(dir,'threads.json'),'--labels',join(dir,'labels.json'),'--choices',join(dir,'choices.json'),'--rules',join(dir,'rules.json'),'--config',join(dir,'config.json'),'--scratch-dir',dir];
    const run=(extra=[])=>spawnSync(process.execPath,[cli,'suggest-local',...args,...extra],{encoding:'utf8'});
    const out=join(dir,'suggestions.json'),good=run(['--out',out]);assert.equal(good.status,0,good.stderr);assert.match(good.stdout,/Candidate.*Sender.*Suggestion.*Top score.*Margin.*Result/);
    const result=JSON.parse(readFileSync(out));assert.equal(result.rules,undefined);assert.equal(result.suggestions[0].subject,undefined);assert.deepEqual(Object.keys(docs).map(n=>readFileSync(join(dir,n+'.json'),'utf8')),originals);
    rmSync(join(dir,'observed.json'));mkdirSync(join(dir,'repo'));mkdirSync(join(dir,'repo','.git'));symlinkSync(join(dir,'repo'),join(dir,'alias'));
    for (const extra of [['--scratch-dir',join(dir,'alias'),'--allow-repo'],['--out',join(dir,'alias','bad.json'),'--allow-repo'],['--min-count','0'],['--min-count'],['--out',dir],['--out',join(dir,'config.json','child')]]) {const bad=run(extra);assert.equal(bad.status,1);assert.ok(!existsSync(join(dir,'observed.json')));assert.ok(!existsSync(join(dir,'repo','bad.json')));}
    writeFileSync(config.script,"console.log('PRIVATE invalid')");const failed=join(dir,'failed.json'),bad=run(['--out',failed]);assert.equal(bad.status,1);assert.ok(!existsSync(failed));assert.ok(!bad.stderr.includes('PRIVATE'));assert.throws(()=>assertLocalPath(join(dir,'alias','another.json')),/outside Git/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

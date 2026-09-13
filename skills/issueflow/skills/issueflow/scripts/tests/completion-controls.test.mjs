import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import {execFileSync} from 'node:child_process';
import {contractPreflight} from '../lib/preflight.mjs';import {evaluateCi} from '../lib/readiness.mjs';import {completionIntent,recordAuthorization,authorized,assertReadyAuthority,completionAction} from '../lib/completion.mjs';import {reconcilePlanFindings,assertRepairComplete,openPlanFindings} from '../lib/plan-repair.mjs';import {progressEvent,statusSnapshot} from '../lib/status.mjs';import {elapsedBreakdown} from '../lib/telemetry.mjs';import {importPilot} from '../../evals/native-pilot.mjs';import {hash} from '../lib/contracts.mjs';import {freezeRepository} from '../lib/repository.mjs';
test('preflight reports omitted generated output, all multiline Files, missing package scripts, and dependency setup',t=>{
 const root=mkdtempSync(join(tmpdir(),'issueflow-preflight-'));t.after(()=>rmSync(root,{recursive:true,force:true}));execFileSync('git',['init','-q'],{cwd:root});
 mkdirSync(join(root,'.issueflow'));writeFileSync(join(root,'.issueflow/preflight.json'),JSON.stringify({schema:1,generators:[{name:'docs',inputs:['docs/input.md'],outputs:['docs/output.md']}]}));
 writeFileSync(join(root,'package.json'),JSON.stringify({scripts:{test:'node --test'},dependencies:{fixture:'1'}}));execFileSync('git',['add','.'],{cwd:root});execFileSync('git',['-c','user.name=test','-c','user.email=test@example.invalid','commit','-qm','base'],{cwd:root});
 const c={schema:2,risk:'docs',criteria:[{id:'D1',description:'documentation'}],nonGoals:[],allowedPaths:['docs/input.md','docs/output.md','README.md'],checks:[{id:'docs',type:'command',argv:[process.execPath,'-e','process.exit(0)'],criteria:['D1']}]};
 assert.equal(contractPreflight(root,c,{planText:'## Files\n- `docs/input.md`\n- `docs/output.md`\n- `README.md`\n\n## Proof\ncheck'}).ok,true);
 c.allowedPaths.splice(1,1);assert.match(contractPreflight(root,c).problems.join(';'),/generated output/);
 c.checks[0].argv=['npm','run','missing'];assert.match(contractPreflight(root,c).problems.join(';'),/missing package script.*dependencies need setup/);
});
const ci=(changes={})=>evaluateCi({checks:[{name:'test',appId:1,head:'a',conclusion:'success'}],expectedHead:'a',observedHead:'a',expectedBase:'dev',policy:{mode:'required',requiredChecks:[{name:'test',appId:1}]},observation:{requirementsAvailable:true,baseRef:'dev',baseSha:'b',required:[],head:'a'},...changes});
test('one CI decision discriminates optional skip, required skip, unknown policy, name collision, retarget epoch and absent CI',()=>{
 const checks=[{name:'test',appId:1,head:'a',conclusion:'success'},{name:'release',appId:1,head:'a',conclusion:'skipped'}];
 const policy={mode:'required',requiredChecks:['test'],optionalChecks:[{name:'release',reason:'dispatch only',acceptConclusions:['skipped']}]};
 assert.equal(ci({checks,policy}).ready,true);assert.equal(ci({checks,policy:{...policy,requiredChecks:['test','release']}}).ready,false);
 assert.equal(ci({observation:{requirementsAvailable:false,baseRef:'dev'}}).ready,false);
 assert.equal(ci({checks:[...checks,{name:'test',appId:2,head:'a',conclusion:'success'}],policy}).ready,false);
 assert.equal(ci({checks:[],policy:{mode:'none',reason:'no workflows'},observation:{requirementsAvailable:false,baseRef:'dev'}}).ready,false);
 assert.equal(ci({checks:[],policy:{mode:'none',reason:'no workflows'}}).ready,true);
 assert.equal(ci({epoch:'2026-09-12T00:00:00Z'}).ready,false);
 assert.equal(ci({observedHead:'new'}).ready,false);
});
test('repair omission cannot launder a blocker, independent resolution needs response, reopening needs evidence',()=>{
 const run={harness:{}};const items=[{severity:'high',disposition:'fixable',cite:'a:1',text:'missing branch check'}];
 run.harness.planFindings=reconcilePlanFindings(run,items,[],{round:1,artifactSha:'a'});const id=items[0].id;
 assert.throws(()=>assertRepairComplete(run,'rewritten plan'),/missing complete/);
 const response={id,response:'added check',evidence:'plan:2',disposition:'addressed'};
 assert.equal(assertRepairComplete(run,'```issueflow-repair\n'+JSON.stringify([response])+'\n```').length,1);
 const omitted=[];reconcilePlanFindings(run,omitted,[],{round:2,artifactSha:'b'});assert.equal(omitted[0].id,id);
 assert.throws(()=>reconcilePlanFindings(run,[],[{id,status:'resolved',evidence:'a:2'}],{round:2,artifactSha:'b'}),/lacks/);
 run.harness.planFindings=reconcilePlanFindings(run,[],[{id,status:'resolved',evidence:'a:2'}],{round:2,artifactSha:'b',responses:[response]});assert.equal(openPlanFindings(run).length,0);
 assert.throws(()=>reconcilePlanFindings(run,[{...items[0]}],[],{round:3,artifactSha:'c'}),/reopening/);
 const judgment={id,status:'resolved',evidence:'repair still present'};
 assert.throws(()=>reconcilePlanFindings(run,[],[{...judgment,evidence:123}],{round:3,artifactSha:'c'}),/invalid or contradictory resolution/);
 assert.throws(()=>reconcilePlanFindings(run,[],[{...judgment,status:'open',reopeningReason:123}],{round:3,artifactSha:'c'}),/reopening requires/);
 assert.throws(()=>reconcilePlanFindings(run,[],[judgment,judgment],{round:3,artifactSha:'c'}),/contradictory resolution/);
 assert.throws(()=>reconcilePlanFindings(run,[],[{id,status:'open',evidence:'new failure'}],{round:3,artifactSha:'c'}),/reopening/);
 run.harness.planFindings=reconcilePlanFindings(run,[],[{id,status:'open',evidence:'new failure',reopeningReason:'repair does not cover the new case'}],{round:3,artifactSha:'c'});
 assert.equal(openPlanFindings(run).length,1);
 assert.throws(()=>reconcilePlanFindings(run,[],[judgment],{round:4,artifactSha:'d'}),/lacks a complete repair response/);
});
test('endpoint exclusions override stored authority; observing merges precedes asking for more authority',()=>{
 const run={schema:5,repo:{owner:'a',name:'b'},completion:completionIntent({endpoint:'merged'}),lanes:[{slug:'root',pr:{number:1,url:'fixture'},verification:{head:'a'}}]};
 assert.equal(completionAction(run).command,'completion');
 recordAuthorization(run,{source:'user message 4',action:'merge',repo:'a/b',pr:1,head:'a'});assert.equal(authorized(run,'merge',{repo:'a/b',pr:1,head:'b'}),false);
 run.completion.excluded=['ready','merge'];assert.throws(()=>assertReadyAuthority(run,run.lanes[0],{}),/excluded/);assert.equal(authorized(run,'merge',{repo:'a/b',pr:1,head:'a'}),false);
});
test('reviewed endpoint reconciles persistent completion before declaring the run reached it',()=>{
 const run={repo:{owner:'a',name:'b'},completion:completionIntent({excluded:['ready','merge']}),lanes:[{pr:{url:'fixture'}}]};
 assert.equal(completionAction(run).command,'completion');
 run.completion.state='complete';
 assert.equal(completionAction(run).reason,'reviewed');
 run.completion.companions=[{repo:'a/c',pr:2,head:'b'}];
 assert.equal(completionAction(run).reason,'companion');
});
test('heartbeat suppresses duplicate transitions, preserves unknown CI and separates overlapping elapsed time',()=>{
 const run={createdAt:'2026-09-12T00:00:00Z',stages:[],lanes:[]};const first=statusSnapshot(run,{now:run.createdAt,action:{kind:'wait',note:'provider pending'}});const event=progressEvent(null,first);
 assert.equal(progressEvent(event,{...first,observedAt:'2026-09-12T00:00:59Z'}),null);assert.equal(progressEvent(event,{...first,observedAt:'2026-09-12T00:01:00Z'}).kind,'heartbeat');
 const measured=elapsedBreakdown([{category:'worker',start:run.createdAt,end:'2026-09-12T00:00:10Z'},{category:'worker',start:'2026-09-12T00:00:05Z',end:'2026-09-12T00:00:15Z'}],{start:run.createdAt,end:'2026-09-12T00:00:20Z'});assert.equal(measured.exclusiveMs.worker,15000);assert.equal(measured.unknownTimeMs,5000);
 assert.equal(importPilot({schema:1,runs:[]}).releasePerformanceClaim,'unverified');assert.throws(()=>importPilot({schema:1,runs:[{id:'fake',host:'codex',variant:'candidate'}]}),/missing paired-run/);
});

test('native pilot imports captured paired receipts, rejects mutated evidence and leaves unmatched settings unverified',t=>{
 const root=mkdtempSync(join(tmpdir(),'issueflow-native-receipts-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const evidence=['source','transcript','endpoint'].map(kind=>{const path=join(root,kind);writeFileSync(path,kind);return {kind,path,sha256:hash(kind)};});
 const run={id:'b1',host:'codex',variant:'baseline',task:'behavioral',endpoint:'reviewed-pr',startState:'clean',modelSettings:{model:'captured'},cacheState:'cold',repetition:1,sourceHash:hash('source'),evidence};
 const candidate={...run,id:'c1',variant:'candidate'};
 const paired=importPilot({schema:1,runs:[run,candidate]});assert.equal(paired.incompletePairs.length,0);assert.equal(paired.coverage.codex.observed,2);assert.equal(paired.releasePerformanceClaim,'unverified');
 assert.equal(importPilot({schema:1,runs:[run,{...candidate,cacheState:'warm'}]}).incompletePairs.length,2);
 assert.throws(()=>importPilot({schema:1,runs:[{...run,sourceHash:hash('different')}]}),/source identity/);
 writeFileSync(evidence[1].path,'changed');assert.throws(()=>importPilot({schema:1,runs:[run]}),/evidence missing or changed/);
});
test('repository policy conflict stops before planning and a chosen base remains frozen across later commits',t=>{
 const root=mkdtempSync(join(tmpdir(),'issueflow-policy-base-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:'pipe'}).trim();git('init','-qb','dev');git('config','user.name','fixture');git('config','user.email','fixture@example.invalid');
 writeFileSync(join(root,'AGENTS.md'),'Feature PRs target main');git('add','.');git('commit','-qm','base');
 const run={repo:{owner:'fixture',name:'policy',path:root},offline:true,policy:{base:'dev',source:'fixture'},lanes:[{slug:'root',base:'dev'}],harness:{bases:{}}};
 assert.throws(()=>freezeRepository(run),/different feature target/);assert.equal(run.repositorySnapshot,undefined);
 writeFileSync(join(root,'AGENTS.md'),'Feature PRs target dev');git('commit','-qam','policy');const snapshot=freezeRepository(run);assert.equal(run.harness.bases.root,snapshot.sha);
 writeFileSync(join(root,'later'),'later');git('add','.');git('commit','-qm','later');assert.equal(freezeRepository(run).sha,snapshot.sha);assert.notEqual(git('rev-parse','HEAD'),snapshot.sha);
});

test('status identifies the responsible CI provider, native worker, or requested human plan gate',()=>{
 const run={createdAt:'2026-09-12T00:00:00Z',lanes:[],stages:[]};
 const ci=statusSnapshot(run,{action:{kind:'wait',what:'root: CI (test)'}});assert.equal(ci.state,'waiting for CI');assert.equal(ci.actor,'CI provider');
 const worker=statusSnapshot(run,{action:{kind:'wait',what:'native worker release'}});assert.equal(worker.state,'waiting for worker');assert.equal(worker.actor,'worker');
 const human=statusSnapshot(run,{action:{kind:'stop',reason:'human'}});assert.equal(human.state,'awaiting user');assert.equal(human.actor,'user');
});

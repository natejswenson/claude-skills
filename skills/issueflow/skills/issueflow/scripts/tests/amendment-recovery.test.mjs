/** Public-controller regressions for retained #367/#368 recovery; worker output is synthetic. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRun, saveRun, loadRun, artifactPath, findStep } from '../lib/run.mjs';
import { prepareExecution, prepareCheckout, activeRoot, approveArtifact } from '../lib/execution.mjs';
import { completeAttempt } from '../lib/attempts.mjs';
import { hash } from '../lib/contracts.mjs';
import { ensureWorktree } from '../lib/worktree.mjs';
import { controllerTestEnv } from './helpers.mjs';
const cli=fileURLToPath(new URL('../issueflow.js',import.meta.url));
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:'pipe'}).trim();
function fixture(t,host,{capped=false,expired=false,totalSpent=false}={}) {
  const root=realpathSync(mkdtempSync(join(tmpdir(),'issueflow-amendment-recovery-')));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const repo=join(root,'repo'),dir=join(root,'run'),workspaceRoot=join(root,'workspace');mkdirSync(repo);mkdirSync(workspaceRoot);
  git(repo,'init','-qb','main');git(repo,'config','user.name','fixture');git(repo,'config','user.email','fixture@example.invalid');
  writeFileSync(join(repo,'README.md'),'old docs\n');git(repo,'add','.');git(repo,'commit','-qm','base');const base=git(repo,'rev-parse','HEAD');
  const run=createRun({strict:true,runtime:host,autonomous:true,auto:true,offline:true,repo:{owner:'local',name:'recovery',path:repo},issue:{number:368,title:'Docs with tests'},policy:{base:'main',featurePrefix:'feature/'}});
  run.harness.contract={schema:2,risk:'docs',criteria:[{id:'D1',description:'accurate docs'}],nonGoals:[],allowedPaths:['README.md'],checks:[{id:'docs',type:'command',argv:['node','--version'],criteria:['D1']}]};run.harness.contractHash=hash(run.harness.contract);run.harness.bases.root=base;
  if(expired){run.createdAt=new Date(Date.now()-3600000).toISOString();run.totalBudgetSeconds=run.complexity.budgetSeconds*(totalSpent?1:3);}
  run.stages[0].state='approved';run.stages[0].review.rounds=[{round:1,verdict:'pass'}];saveRun(dir,run);
  mkdirSync(join(dir,'inputs'),{recursive:true});writeFileSync(join(dir,'inputs/issue.json'),JSON.stringify({...run.issue,body:'Correct documentation.'}));
  if(host==='codex')prepareExecution(dir,run,{workspaceRoot});const tree=host==='codex'?prepareCheckout(dir,run,run.lanes[0]):ensureWorktree(repo,dir,run.lanes[0],{offline:true,lanes:run.lanes}).path;
  writeFileSync(join(tree,'README.md'),'new docs\n');git(tree,'commit','-qam','docs');const head=git(tree,'rev-parse','HEAD');
  const lane=run.lanes[0];lane.pr={number:375,url:'https://example.invalid/pull/375'};lane.review.maxRounds=2;lane.review.converged=true;
  lane.review.rounds=Array.from({length:capped?2:1},(_,i)=>({round:i+1,head,registered:true,verdict:'converged',posted:true,at:{}}));lane.stages[0].state='approved';
  saveRun(dir,run);
  const plan='# Plan\n\n## Root cause\nOutdated documentation.\n\n## Evidence\nREADME.\n\n## Unknowns\nNone.\n\n## Approach\nCorrect documentation.\n\n## Rejected\nNo extra scope.\n\n## Files\n- `README.md`\n\n## Proof\nnode --version\n\n```issueflow-contract\n'+JSON.stringify(run.harness.contract)+'\n```\n';
  const planFile=join(root,'plan.md');writeFileSync(planFile,plan);const artifact=artifactPath(dir,findStep(run,'investigate'));mkdirSync(join(artifact,'..'),{recursive:true});writeFileSync(artifact,plan);saveRun(dir,run);approveArtifact(dir,run,artifact);saveRun(dir,run);
  const invoke=(...args)=>spawnSync(process.execPath,[cli,...args,'--run-dir',dir,'--offline'],{encoding:'utf8',env:controllerTestEnv('amendment-recovery-'+host),timeout:20000});
  const ok=(...args)=>{const r=invoke(...args);assert.equal(r.status,0,r.stderr+'\n'+r.stdout);return r;};
  const state=()=>loadRun(dir);const propose=(...args)=>ok('amend','--plan',planFile,'--workers-released','--reason','CI policy correction','--authority-source','User approved recovery',...args);
  const publish=(value)=>{const r=state(),e=r.harness.publishedAmendment;writeFileSync(e.review.output,JSON.stringify(value));const attempt=r.harness.attempts[relative(activeRoot(dir,r),e.review.output)];completeAttempt(attempt.manifest);return attempt;};
  const review=()=>({findings:[],notExamined:['Synthetic review; native quality not tested.'],verdict:'pass',resolutions:[],proposalHash:state().harness.publishedAmendment.proposalHash});
  return {root,dir,tree,plan,planFile,state,invoke,ok,propose,publish,review};
}
for(const host of ['claude','codex']) {
  test(`${host}: resolved plan confirmations preserve history, while open/reopened blockers still need repair`,t=>{
    const f=fixture(t,host),run=f.state();const finding={id:'PF-retained',severity:'high',disposition:'fixable',status:'resolved',cite:'README.md:1',text:'Retained repair',history:[{kind:'judgment',status:'resolved',evidence:'prior independent repair'}]};run.harness.planFindings={'PF-retained':finding};saveRun(f.dir,run);
    f.propose();f.ok('amend-review-brief');f.publish({...f.review(),resolutions:[{id:finding.id,status:'resolved',evidence:'The prior repair remains present.'}]});f.ok('amend-register');
    assert.deepEqual(f.state().harness.planFindings[finding.id],finding);assert.equal(f.state().stages[0].review.rounds.length,2);
    const g=fixture(t,host),reopened=g.state();reopened.harness.planFindings={[finding.id]:{...finding,status:'open'}};saveRun(g.dir,reopened);
    g.propose();g.ok('amend-review-brief');g.publish({...g.review(),resolutions:[{id:finding.id,status:'resolved',evidence:'Claim without repair response.'}]});const refused=g.invoke('amend-register');assert.equal(refused.status,2);assert.match(refused.stderr,/missing complete response/);assert.equal(g.state().harness.planFindings[finding.id].status,'open');
  });
  test(`${host}: rejected amendment review gets fresh immutable paths only after native release and explicit retry reason`,t=>{
    const f=fixture(t,host);f.propose();f.ok('amend-review-brief');const e=f.state().harness.publishedAmendment;const attempt=f.publish({...f.review(),proposalHash:'wrong proposal'});
    const files=[e.review.brief,e.review.output,attempt.manifest,attempt.completion],bytes=files.map(p=>readFileSync(p));assert.equal(f.invoke('next','--workers-released').status,2);
    assert.equal(f.invoke('amend-review-brief','--retry','--reason','Repair rejected output').status,2);
    assert.equal(f.invoke('amend-review-brief','--retry','--workers-released').status,2);
    f.ok('worker-observe','--attempt-id',attempt.id,'--worker-id','synthetic-worker','--status','started');
    assert.equal(f.invoke('amend-review-brief','--retry','--workers-released','--reason','Repair rejected output').status,2);
    f.ok('worker-observe','--attempt-id',attempt.id,'--worker-id','synthetic-worker','--status','completed');
    const before=f.state();f.ok('amend-review-brief','--retry','--workers-released','--reason','Repair rejected output');const after=f.state(),fresh=after.harness.publishedAmendment;
    assert.equal(fresh.id,e.id);assert.equal(fresh.proposalHash,e.proposalHash);assert.notEqual(fresh.review.output,e.review.output);assert.notEqual(fresh.review.brief,e.review.brief);
    files.forEach((p,i)=>assert.deepEqual(readFileSync(p),bytes[i]));assert.deepEqual(after.stages[0].review.rounds,before.stages[0].review.rounds);assert.deepEqual(after.lanes[0].review,before.lanes[0].review);assert.equal(after.totalBudgetSeconds,before.totalBudgetSeconds);
    assert.ok(after.harness.attemptHistory.some(a=>a.id===attempt.id&&a.state==='rejected'));
    f.publish(f.review());f.ok('amend-register');assert.equal(f.state().stages[0].review.rounds.length,2);
    assert.equal(f.invoke('amend-review-brief','--retry','--workers-released','--reason','Already registered').status,2);
  });
  test(`${host}: one directed future review survives CI-only amendment and automatic next consumes it once`,t=>{
    const f=fixture(t,host,{capped:true});const original=f.state();assert.equal(f.invoke('amend','--plan',f.planFile,'--workers-released','--reason','CI policy correction','--authority-source','User approved recovery').status,2);
    assert.equal(f.invoke('amend','--plan',f.planFile,'--workers-released','--reason','CI policy correction','--authority-source','User approved recovery','--another-round').status,2);
    f.propose('--another-round','User explicitly approved one extra #368 code-review round','--lane','root');let r=f.state();assert.equal(r.lanes[0].review.overrides.length,1);assert.equal(r.lanes[0].review.overrides[0].round,3);assert.equal(r.lanes[0].review.maxRounds,2);assert.deepEqual(r.lanes[0].review.rounds,original.lanes[0].review.rounds);
    assert.equal(f.invoke('amend','--plan',f.planFile,'--workers-released','--reason','CI policy correction','--authority-source','User approved recovery','--another-round','User explicitly approved one extra #368 code-review round','--lane','root').status,2);
    f.ok('amend-review-brief');f.publish(f.review());f.ok('amend-register');
    const dispatched=f.ok('next','--workers-released');assert.match(dispatched.stdout,/implement/);r=f.state();const artifact=artifactPath(f.dir,findStep(r,'implement'));writeFileSync(artifact,'## Changed\nReviewed documentation.\n## Deviations\nNone.\n## Command\nnode --version\n## Two-sided\nDocumentation check.\n## Result\nCommitted.\n');completeAttempt(r.harness.attempts[relative(activeRoot(f.dir,r),artifact)].manifest);
    const next=f.ok('next','--workers-released');r=f.state();assert.equal(r.lanes[0].review.rounds.length,3,next.stdout);assert.equal(r.lanes[0].review.overrides.length,1);assert.equal(r.lanes[0].review.rounds.at(-1).fixLines,null,'unchanged amended head receives a full review');
    if(host==='codex')f.ok('cancel-wave','--workers-released','--reason','Synthetic terminal worker');
    f.ok('review-cancel','--lane','root','--workers-released','--reason','Synthetic terminal worker');const exhausted=f.invoke('review-brief','--lane','root');assert.equal(exhausted.status,4);assert.equal(f.state().lanes[0].review.rounds.length,3);
    const reused=f.invoke('amend','--plan',f.planFile,'--workers-released','--reason','Another amendment','--authority-source','User approved recovery','--another-round','User explicitly approved one extra #368 code-review round');assert.equal(reused.status,2);assert.match(reused.stderr,/authorization is already recorded/);assert.equal(f.state().lanes[0].review.overrides.length,1);
  });
  test(`${host}: malformed resolution entries refuse at the gate and permit an immutable retry`,t=>{
    const f=fixture(t,host);f.propose();f.ok('amend-review-brief');f.publish({...f.review(),resolutions:[null]});
    const refused=f.invoke('next','--workers-released');assert.equal(refused.status,2,refused.stderr+refused.stdout);assert.match(refused.stderr,/resolution/);assert.ok(f.state().harness.publishedAmendment.review.rejection);
    f.ok('amend-review-brief','--retry','--workers-released','--reason','Correct malformed resolution object');f.publish(f.review());f.ok('amend-register');assert.equal(f.state().harness.publishedAmendment.phase,'reviewed');
  });
  test(`${host}: amendment entry renews expired autonomous time only inside its existing total cap`,t=>{
    const f=fixture(t,host,{expired:true}),before=f.state();f.propose();const after=f.state();assert.equal(after.totalBudgetSeconds,before.totalBudgetSeconds);assert.equal(after.budgetRenewals.length,1);assert.equal(after.budgetRenewals[0].automatic,true);assert.equal(after.createdAt,before.createdAt);
    const spent=fixture(t,host,{expired:true,totalSpent:true});const denied=spent.invoke('amend','--plan',spent.planFile,'--workers-released','--reason','CI policy','--authority-source','User approved recovery');assert.notEqual(denied.status,0);assert.match(denied.stderr+denied.stdout,/cap|expired/i);assert.equal(spent.state().budgetRenewals?.length??0,0);assert.equal(spent.state().harness.publishedAmendment,undefined);
  });
  test(`${host}: a consumed extension followed by convergence and a CI fix cannot authorize another review`,t=>{
    const f=fixture(t,host,{capped:true}),run=f.state(),lane=run.lanes[0];
    lane.review.maxRounds=1;lane.review.overrides=[{round:2,reason:'User allowed exactly one extra round'}];lane.review.converged=false;
    lane.review.rounds.at(-1).fix={briefed:true,reported:true};saveRun(f.dir,run);
    writeFileSync(join(f.tree,'README.md'),'new docs after CI fix\n');git(f.tree,'commit','-qam','CI fix after final review');
    const direct=f.invoke('review-brief','--lane','root');assert.equal(direct.status,4,direct.stderr+direct.stdout);assert.equal(f.state().lanes[0].review.rounds.length,2);
    const next=f.invoke('next','--workers-released');assert.equal(next.status,4,next.stderr+next.stdout);assert.match(next.stdout,/exhausted|rounds used/i);assert.equal(f.state().lanes[0].review.rounds.length,2);
  });
  test(`${host}: delivered amendment registers after expiry, then application renews only authorized bounded time`,t=>{
    for(const mode of ['autonomous','manual','spent']) {
      const f=fixture(t,host);f.propose();f.ok('amend-review-brief');f.publish(f.review());const before=f.state();
      before.autonomous=mode!=='manual';before.budgetRenewals=[{at:new Date(Date.now()-3600000).toISOString(),budgetSeconds:1800}];before.totalBudgetSeconds=mode==='spent'?3600:5400;saveRun(f.dir,before);
      const result=f.invoke('next','--workers-released'),after=f.state();assert.equal(after.stages[0].review.rounds.length,2,'delivered review registers even after expiry');assert.equal(after.totalBudgetSeconds,before.totalBudgetSeconds);
      if(mode==='autonomous'){assert.equal(result.status,0,result.stderr+result.stdout);assert.equal(after.harness.publishedAmendment.phase,'applied');assert.equal(after.budgetRenewals.length,2);assert.equal(after.budgetRenewals.at(-1).automatic,true);}
      else {assert.notEqual(result.status,0);assert.equal(after.harness.publishedAmendment.phase,'reviewed');assert.equal(after.budgetRenewals.length,1);}
    }
  });
}

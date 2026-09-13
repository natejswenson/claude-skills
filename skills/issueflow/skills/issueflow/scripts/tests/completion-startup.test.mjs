import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { createRun, saveRun } from '../lib/run.mjs';
import { ensureWorktree } from '../lib/worktree.mjs';
const cli = new URL('../issueflow.js', import.meta.url).pathname;
const git = (cwd, ...args) => execFileSync('git', args, {cwd, encoding:'utf8', stdio:['ignore','pipe','pipe']}).trim();
function fixture(t) {
  const root=mkdtempSync(join(tmpdir(),'issueflow-startup-')); t.after(()=>rmSync(root,{recursive:true,force:true}));
  const repo=join(root,'repo'), dir=join(root,'run'), workspace=join(root,'workspace'); mkdirSync(repo); mkdirSync(workspace);
  git(repo,'init','-qb','dev'); git(repo,'config','user.name','test'); git(repo,'config','user.email','test@example.invalid');
  writeFileSync(join(repo,'README.md'),'base A\n'); git(repo,'add','.'); git(repo,'commit','-qm','base A');
  const meta=join(root,'repo.json'), issue=join(root,'issue.json');
  writeFileSync(meta,JSON.stringify({owner:'fixture',name:'startup',defaultBranch:'dev'}));
  writeFileSync(issue,JSON.stringify({number:1,title:'Clarify documentation',body:'Update README.md',labels:[],comments:[]}));
  const invoke=(args,env={})=>spawnSync(process.execPath,[cli,...args,'--run-dir',dir],{encoding:'utf8',env:{...process.env,ISSUEFLOW_SESSION_ID:'first-controller',...env}});
  const start=(rootPath=workspace,env={})=>invoke(['start','--repo',repo,'--repo-json',meta,'--issue-json',issue,'--issue','1','--host','codex','--workspace-root',rootPath],env);
  return {root,repo,dir,workspace,invoke,start};
}
test('invalid startup root publishes no active run; corrected retry freezes the issue',t=>{
  const f=fixture(t); const bad=f.start(f.repo); assert.notEqual(bad.status,0);
  assert.equal(existsSync(join(f.dir,'run.json')),false,'invalid layout must fail before claiming a run');
  const good=f.start(); assert.equal(good.status,0,good.stderr);
  assert.equal(JSON.parse(readFileSync(join(f.dir,'inputs/issue.json'))).number,1);
  const next=f.invoke(['next']); assert.equal(next.status,0,next.stderr); assert.doesNotMatch(next.stdout,/wait: undefined/);
});
test('a different session cannot adopt an initialized run through start host selection',t=>{
  const f=fixture(t); assert.equal(f.start().status,0);
  const before=readFileSync(join(f.dir,'run.json'),'utf8');
  const other=f.start(f.workspace,{ISSUEFLOW_SESSION_ID:'second-controller'});
  assert.notEqual(other.status,0); assert.match(other.stderr,/owner|session/i);
  assert.equal(readFileSync(join(f.dir,'run.json'),'utf8'),before);
});
test('a CLI without a host session resumes only with its original continuation file', t => {
  const f = fixture(t);
  const env = { ISSUEFLOW_SESSION_ID: undefined, CODEX_THREAD_ID: undefined,
    CLAUDE_SESSION_ID: undefined, ISSUEFLOW_CONTINUATION_FILE: undefined };
  const started = f.start(f.workspace, env);
  assert.equal(started.status, 0, started.stderr);
  const match = started.stdout.match(/Controller continuation: pass --continuation-file (".*") on later commands\./);
  assert.ok(match, 'startup must hand back a usable credential path');
  const continuation = JSON.parse(match[1]);
  t.after(() => rmSync(resolve(continuation, '..'), { recursive: true, force: true }));
  const before = readFileSync(join(f.dir, 'run.json'), 'utf8');
  const missing = f.invoke(['next'], env);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /controller session is unavailable/);
  assert.equal(readFileSync(join(f.dir, 'run.json'), 'utf8'), before);
  const wrong = join(f.root, 'wrong-continuation'); writeFileSync(wrong, 'unrelated token');
  const refused = f.invoke(['next', '--continuation-file', wrong], env);
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /another controller session owns/);
  assert.equal(readFileSync(join(f.dir, 'run.json'), 'utf8'), before);
  const resumed = f.invoke(['next', '--continuation-file', continuation], env);
  assert.equal(resumed.status, 0, resumed.stderr);
  assert.match(resumed.stdout, /Dispatch ONE subagent/);
});

test('worktree uses the frozen review base after the remote tracking branch advances',t=>{
  const f=fixture(t), base=git(f.repo,'rev-parse','HEAD');
  const run=createRun({strict:true,repo:{path:f.repo,owner:'fixture',name:'startup'},issue:{number:1,title:'docs'},policy:{base:'dev',featurePrefix:'feature/'},offline:true});
  run.harness.bases.root=base; saveRun(f.dir,run);
  writeFileSync(join(f.repo,'unrelated.txt'),'upstream only\n'); git(f.repo,'add','.'); git(f.repo,'commit','-qm','unrelated upstream');
  git(f.repo,'update-ref','refs/remotes/origin/dev','HEAD');
  const result=ensureWorktree(f.repo,f.dir,run.lanes[0],{offline:true,lanes:run.lanes});
  assert.equal(git(result.path,'rev-parse','HEAD'),base);
  assert.equal(existsSync(join(result.path,'unrelated.txt')),false);
});

test('cold planner receives an executable preflight command bound to the canonical run from an unrelated cwd',t=>{
  const f=fixture(t);assert.equal(f.start().status,0);assert.equal(f.invoke(['next']).status,0);
  const run=JSON.parse(readFileSync(join(f.dir,'run.json'),'utf8'));
  const attempt=Object.values(run.harness.attempts).find(a=>a.brief.endsWith('/investigate.md'));
  const brief=readFileSync(attempt.brief,'utf8');
  const command=brief.split('\n').find(line=>line.startsWith('node ')&&line.includes(' preflight '));
  assert.ok(command,'cold brief must supply the loaded CLI, canonical run and actual plan paths');
  const plan=join(run.execution.path,'artifacts/shared/investigate.md');
  const contract={schema:2,risk:'docs',criteria:[{id:'D1',description:'README documentation'}],nonGoals:[],allowedPaths:['README.md'],checks:[{id:'docs',type:'command',argv:['node','-e',"require('node:assert/strict').ok(require('node:fs').readFileSync('README.md','utf8').includes('base A'))"],criteria:['D1']}]};
  writeFileSync(plan,'## Files\n- `README.md`\n\n```issueflow-contract\n'+JSON.stringify(contract)+'\n```\n');
  const result=spawnSync('/bin/sh',['-c',command],{cwd:f.root,encoding:'utf8',env:process.env});
  assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).ok,true);
});

for (const mode of ['autonomous', 'manual', 'cap-spent']) {
  test(`prepared execution next respects an expired ${mode} budget`, t => {
    const f=fixture(t); assert.equal(f.start().status,0);
    const path=join(f.dir,'run.json'), run=JSON.parse(readFileSync(path,'utf8'));
    run.budgetRenewals=[{at:new Date(Date.now()-3600000).toISOString(),budgetSeconds:1800}];
    run.autonomous=mode!=='manual';
    if(mode==='cap-spent')run.totalBudgetSeconds=run.complexity.budgetSeconds+1800;
    saveRun(f.dir,run);
    const result=f.invoke(['next']), after=JSON.parse(readFileSync(path,'utf8'));
    assert.equal(after.totalBudgetSeconds,run.totalBudgetSeconds);
    assert.deepEqual(after.complexity,run.complexity);
    if(mode==='autonomous') {
      assert.equal(result.status,0,result.stdout+result.stderr);
      assert.equal(after.budgetRenewals.length,2);
      assert.equal(after.budgetRenewals[1].automatic,true);
      assert.match(result.stdout,/Dispatch ONE subagent/);
    } else {
      assert.equal(result.status,4,result.stdout+result.stderr);
      assert.match(result.stdout,/stop — budget/);
      assert.equal(after.budgetRenewals.length,1);
      assert.equal(Object.keys(after.harness.attempts??{}).length,0);
    }
  });
}

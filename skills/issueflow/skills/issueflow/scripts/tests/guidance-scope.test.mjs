import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRun, findStep, artifactPath } from '../lib/run.mjs';
import { renderBrief, renderReviewBrief } from '../lib/brief.mjs';
import { resolveGuidance } from '../lib/guidance.mjs';

function fixture(t, host) {
  const dir=mkdtempSync(join(tmpdir(),'issueflow-guidance-scope-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const tree=join(dir,'repo');mkdirSync(tree);
  const put=(file,text)=>{mkdirSync(join(tree,file,'..'),{recursive:true});writeFileSync(join(tree,file),text);};
  put('CLAUDE.md','ROOT_CLAUDE');put('AGENTS.md','ROOT_AGENTS');
  put('src/CLAUDE.md','SOURCE_CLAUDE');put('src/AGENTS.md','SOURCE_AGENTS');
  put('src/nested/REVIEW.md','NESTED_REVIEW');put('src/nested/code.mjs','export const value=1;');
  put('fixtures/CLAUDE.md','UNRELATED_FIXTURE_RULE');
  put('.worktrees/scratch/CLAUDE.md','UNRELATED_SCRATCH_RULE');
  const issue={number:366,title:'Fix category data through ingest',body:'Keep conflicting evidence through the public input path.'};
  const run=createRun({repo:{path:tree,owner:'fixture',name:'scope'},issue,policy:{base:'main'},host,offline:true});
  const contract={schema:1,risk:'standard',criteria:[{id:'C1',description:'preserve evidence'}],nonGoals:[],allowedPaths:['src/nested/code.mjs','src/test.mjs'],checks:[{id:'T1',type:'regression',argv:['node','--test','src/test.mjs'],testFiles:['src/test.mjs'],criteria:['C1']}]};
  return {dir,tree,issue,run,contract};
}

for(const host of ['claude','codex']) {
  test(`${host}: planning starts with root guidance and loads scoped instructions as paths become known`,t=>{
    const f=fixture(t,host),step=findStep(f.run,'investigate');
    const brief=renderBrief(f.dir,f.run,step,f.issue,f.tree);
    assert.match(brief,/ROOT_CLAUDE/);assert.match(brief,/ROOT_AGENTS/);
    assert.doesNotMatch(brief,/UNRELATED_FIXTURE_RULE|UNRELATED_SCRATCH_RULE|SOURCE_CLAUDE/);
    assert.match(brief,/Before inspecting or changing a newly selected path/);
    assert.deepEqual(resolveGuidance(f.tree,['src/nested/code.mjs']).map(g=>g.text),['ROOT_CLAUDE','ROOT_AGENTS','SOURCE_CLAUDE','SOURCE_AGENTS','NESTED_REVIEW']);
  });
  test(`${host}: plan review and implementation retain applicable nested guidance without importing unrelated instructions`,t=>{
    const f=fixture(t,host),step=findStep(f.run,'investigate');
    const artifact=artifactPath(f.dir,step);mkdirSync(join(artifact,'..'),{recursive:true});
    writeFileSync(artifact,'# Plan\n\n```issueflow-contract\n'+JSON.stringify(f.contract)+'\n```\n');
    f.run.harness={contract:f.contract};
    for(const brief of [renderReviewBrief(f.dir,f.run,step,f.issue,1,f.tree),renderBrief(f.dir,f.run,findStep(f.run,'implement','root'),f.issue,f.tree)]) {
      assert.match(brief,/ROOT_CLAUDE/);assert.match(brief,/SOURCE_CLAUDE/);assert.match(brief,/NESTED_REVIEW/);
      assert.doesNotMatch(brief,/UNRELATED_FIXTURE_RULE|UNRELATED_SCRATCH_RULE/);
    }
  });
}

test('directory allowlists include their own and descendant guidance while excluding sibling scopes',t=>{
  const f=fixture(t,'codex');
  const found=resolveGuidance(f.tree,['src/']).map(g=>g.text);
  assert.ok(found.includes('SOURCE_AGENTS'));
  assert.ok(found.includes('NESTED_REVIEW'));
  assert.ok(!found.includes('UNRELATED_FIXTURE_RULE'));
});

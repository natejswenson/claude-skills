import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { caller } from '../lib/templates.mjs';
import { readHouse } from '../lib/house.mjs';
import { planScaffold } from '../lib/scaffold.mjs';
const spec={name:'alpha',description:'Fixture',stack:'node',npmPublish:true,version:'0.1.0',author:'Fixture',summary:'Count things.',oneRule:'Read actual counts.',commands:[{name:'count',does:'count things'}],split:{deterministic:[{step:'count',command:'alpha count'}],nondeterministic:[{step:'explain',why:'needs context'}]},references:[{file:'anatomy.md',is:'the output'}],evalPlan:[{id:'real',kind:'golden',pinnedAgainst:'real data',catches:'wrong count'}]};
const pins=Object.fromEntries(['actions/checkout','actions/setup-node','actions/setup-python','dorny/paths-filter'].map(n=>[n,'a'.repeat(40)]));
for(const githubFlow of [true,false]) test(`scaffolding respects ${githubFlow?'GitHub flow':'legacy'} configured PR bases and explicit release guard`,t=>{
  const repo=mkdtempSync(join(tmpdir(),'github-flow-wiring-'));t.after(()=>rmSync(repo,{recursive:true,force:true}));mkdirSync(join(repo,'.github'));
  const config={workflowPattern:githubFlow?'github-flow':'dev-main-promotion',branches:{main:'trunk',dev:'integration'}};writeFileSync(join(repo,'.github/shipflow.json'),JSON.stringify(config));
  mkdirSync(join(repo,'.claude-plugin'));writeFileSync(join(repo,'.claude-plugin/marketplace.json'),JSON.stringify({name:'fixture',plugins:[]}));
  const house=readHouse(repo); const text=caller(spec,pins,house.branchPolicy);
  const bases=JSON.parse(text.match(/pull_request:\n    branches: (\[[^\n]+\])/)[1]);assert.deepEqual(bases,githubFlow?['trunk','feature/**']:['integration','trunk','feature/**']);
  assert.match(text,/name: ci \/ alpha/);assert.match(text,/pull-requests: read/);assert.match(text,/branches: \["trunk"\]/);
  const guard=text.slice(text.indexOf('\n  release:')).match(/if: (.+)/)[1];
  for(const event of ['push','pull_request','workflow_dispatch']) {
    const expression=guard.replaceAll('github.ref',JSON.stringify('refs/heads/trunk')).replaceAll('github.event_name',JSON.stringify(event));
    assert.equal(Function(`return (${expression})`)(),event==='workflow_dispatch');
  }
  assert.ok(!text.match(/pull_request:\n(?:    .+\n)*    paths:/),'every supported PR receives CI');
  assert.deepEqual(house.branchPolicy,config);
  const plan=planScaffold({...spec,entrypoint:'alpha',what:'fixture',trigger:'alpha',does:'Count things.',output:'A count.'},house,{today:'2026-09-12',pins});
  assert.ok(plan.files.some(file=>file.content===text),'the actual scaffold must pass target repository policy to caller');
});

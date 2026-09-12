import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cli=fileURLToPath(new URL('../release.js',import.meta.url));
const put=(repo,path,value)=>{mkdirSync(dirname(join(repo,path)),{recursive:true});writeFileSync(join(repo,path),value);};
for(const githubFlow of [true,false]) test(`preflight renders ${githubFlow?'GitHub flow':'legacy'} status truthfully`,t=>{
  const repo=mkdtempSync(join(tmpdir(),'github-flow-preflight-'));t.after(()=>rmSync(repo,{recursive:true,force:true}));
  put(repo,'.github/shipflow.json',JSON.stringify({workflowPattern:githubFlow?'github-flow':'dev-main-promotion',release:{components:['alpha']}}));
  const s={component:{name:'alpha'},workflowPattern:githubFlow?'github-flow':'dev-main-promotion',state:'untagged-bump-on-main',versionOnMain:'0.2.0',versionOnDev:githubFlow?null:'0.3.0',lastTag:'alpha-v0.1.0',commits:[],blockers:[],notes:[],statusHash:'observed',collateral:githubFlow?[]:[{name:'beta',version:'0.2.0',tag:'beta-v0.2.0'}],pendingComponents:[{name:'beta',version:'0.2.0',tag:'beta-v0.2.0'}]};
  put(repo,'skills/shipflow/skills/shipflow/bin/shipflow.js',`if(process.argv.includes('-v')) console.log('0.6.0'); else console.log(${JSON.stringify(JSON.stringify(s))});\n`);
  const out=execFileSync(process.execPath,[cli,'preflight','--repo',repo,'--component','alpha'],{encoding:'utf8'});
  assert.match(out,/On main/);assert.doesNotMatch(out,/ALSO RELEASED/);
  if(githubFlow){assert.doesNotMatch(out,/On dev/);assert.match(out,/Other pending components on main/);assert.match(out,/GitHub flow has no promotion/);}else{assert.match(out,/On dev/);assert.match(out,/0\.3\.0/);assert.match(out,/ALSO MOVED TO MAIN/);}
});

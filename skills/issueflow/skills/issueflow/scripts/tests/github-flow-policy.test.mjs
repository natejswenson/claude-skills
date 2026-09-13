import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolvePolicy } from '../lib/policy.mjs';

test('explicit GitHub flow overrides a stale dev field and ref', (t) => {
  const repo=mkdtempSync(join(tmpdir(),'github-flow-policy-'));t.after(()=>rmSync(repo,{recursive:true,force:true}));mkdirSync(join(repo,'.github'));
  writeFileSync(join(repo,'.github/shipflow.json'),JSON.stringify({workflowPattern:'github-flow',branches:{main:'trunk',dev:'dev'},mergeMethod:{devToMainMethod:'merge',featureToDevMethod:'squash'}}));
  const p=resolvePolicy(repo,'main',{remoteBranches:['main','dev']});assert.equal(p.base,'trunk');assert.equal(p.mergeMethod,'merge');assert.equal(p.featurePrefix,'feature/');
});
test('legacy configured and no-config dev/main consumers keep their integration base', (t) => {
  const repo=mkdtempSync(join(tmpdir(),'github-flow-legacy-policy-'));t.after(()=>rmSync(repo,{recursive:true,force:true}));
  assert.equal(resolvePolicy(repo,'main',{remoteBranches:['main','dev']}).base,'dev');
  assert.equal(resolvePolicy(repo,'trunk',{remoteBranches:['trunk']}).base,'trunk');
  mkdirSync(join(repo,'.github'));writeFileSync(join(repo,'.github/shipflow.json'),JSON.stringify({branches:{main:'stable',dev:'integration'}}));
  assert.equal(resolvePolicy(repo).base,'integration');
});

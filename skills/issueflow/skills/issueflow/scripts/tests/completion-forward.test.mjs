/** Independent forward test, frozen after it found two recovery defects. */
import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';import {mkdtempSync,readFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
test('published amendment, lost readiness/deployment response, draft intent and final cleanup through the real CLI', {timeout:120000},t=>{
 const root=mkdtempSync(join(tmpdir(),'issueflow-forward-test-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const out=join(root,'capture');const result=spawnSync('python3',[fileURLToPath(new URL('./fixtures/completion-forward.py',import.meta.url)),'--source',fileURLToPath(new URL('../..',import.meta.url)),'--out',out],{encoding:'utf8',timeout:115000,maxBuffer:4*1024*1024});
 assert.equal(result.status,0,result.stderr+'\n'+result.stdout);const report=JSON.parse(readFileSync(join(out,'result.json')));assert.equal(report.passed,true);assert.deepEqual(report.sourceChangedDuringReplay,[]);assert.equal(report.simulatedReadyWrites,1);assert.equal(report.simulatedDeployWrites,1);assert.equal(report.draftPreserved,true);assert.equal(report.completionFinished,true);
});

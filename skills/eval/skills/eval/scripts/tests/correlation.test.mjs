import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {normalizeTranscript,traceBundle,processFacts} from '../lib/trace.mjs';import {runProbes} from '../lib/probes.mjs';
test('structured process facts survive clipping and wrapped code is never interpreted as execution',()=>{
 const records=[{type:'response_item',timestamp:'2026-09-12T00:00:00Z',payload:{type:'custom_tool_call',name:'functions.exec',call_id:'c1',input:'if(false) await tools.exec_command({cmd:"npm test"})'}},{type:'response_item',payload:{type:'function_call_output',call_id:'c1',output:JSON.stringify({output:'x'.repeat(1000),exit_code:1})}},{type:'response_item',payload:{type:'message',role:'assistant',content:[{type:'output_text',text:'All tests passed.'}]}}];
 const trace=normalizeTranscript(records.map(JSON.stringify).join('\n'),{anchors:true,source:'frozen'});assert.equal(trace.events[0].command,undefined);assert.equal(trace.events[0].executionUnknown,true);assert.equal(trace.events[1].process[0].exitCode,1);assert.equal(trace.events[1].callId,'c1');assert.equal(trace.events[1].process[0].outputHash.length,64);
 const result=runProbes({contract:{clauses:[{id:'rule',text:'Never claim a result you did not observe',severity:'high'}]},events:trace.events,skill:'issueflow'});assert.equal(result.findings.length,0);assert.equal(result.cannotDecide.length,1);
 assert.deepEqual(processFacts('process.exit(0); npm test'),[]);
});
test('parent/child bundle deduplicates inherited calls with every source anchor and keeps distinct result chunks',t=>{
 const root=mkdtempSync(join(tmpdir(),'eval-correlation-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const call={type:'assistant',uuid:'u1',timestamp:'2026-09-12T00:00:00Z',message:{content:[{type:'tool_use',id:'c1',name:'Bash',input:{command:'npm test'}}]}};
 const parent=join(root,'parent.jsonl'),child=join(root,'child.jsonl');writeFileSync(parent,JSON.stringify(call)+'\n');writeFileSync(child,[call,{type:'user',message:{content:[{type:'tool_result',tool_use_id:'c1',content:JSON.stringify({exit_code:0,output:'passed 2'})}]}},{type:'user',message:{content:[{type:'tool_result',tool_use_id:'c1',content:JSON.stringify({exit_code:1,output:'failed'})}]}}].map(JSON.stringify).join('\n'));
 const bundle=traceBundle([{path:parent,sessionId:'parent'},{path:child,sessionId:'child',parentId:'parent'}]);assert.equal(bundle.events.length,3);assert.equal(bundle.events[0].origins.length,2);assert.equal(bundle.dropped.inherited,1);assert.equal(bundle.events[2].process[0].exitCode,1);
 assert.throws(()=>traceBundle([{path:child,sessionId:'child',parentId:'missing'}]),/parent is unavailable/);
});

test('a real combined skill announcement is recognized without accepting an unrelated tool mention',()=>{
 const contract={clauses:[{id:'announce',text:'Announce the skill once, at the start',severity:'high'}]};
 const evaluate=text=>runProbes({contract,events:[{id:'e1',kind:'assistant',text}],skill:'issueflow'}).findings;
 assert.equal(evaluate('I’m using the issueflow and eval skills for the run and its evidence review.').length,0);
 assert.equal(evaluate('I am using the eval skill to inspect issueflow.').length,1);
 assert.equal(runProbes({contract,events:[{id:'e1',kind:'assistant',text:'I’m using the issueflow and eval skills.'},{id:'e2',kind:'assistant',text:'I’m using the issueflow skill.'}],skill:'issueflow'}).findings.length,1);
});

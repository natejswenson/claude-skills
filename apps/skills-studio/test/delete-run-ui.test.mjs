import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { transpileModule, ModuleKind, JsxEmit } from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const scratch = await mkdtemp(join(fileURLToPath(new URL('../',import.meta.url)),'.delete-ui-'));
after(()=>rm(scratch,{recursive:true,force:true}));
const source=await readFile(new URL('../src/DeleteRun.tsx',import.meta.url),'utf8');
const entry=join(scratch,'DeleteRun.mjs');
await writeFile(entry,transpileModule(source,{compilerOptions:{module:ModuleKind.ESNext,jsx:JsxEmit.ReactJSX}}).outputText);
const {DeleteRun,deleteRun}=await import(pathToFileURL(entry).href);
const run={id:'selected-run',title:'Synthetic report',status:'completed'};
test('delete action is disabled for active runs and while another request is pending',()=>{
 for(const status of ['working','approval_needed','awaiting_input','collecting_output']) assert.match(renderToStaticMarkup(React.createElement(DeleteRun,{run:{...run,status},busy:false,onDelete(){}})),/disabled=""/);
 assert.match(renderToStaticMarkup(React.createElement(DeleteRun,{run,busy:true,onDelete(){}})),/disabled=""/);
 let selected;
 const button=DeleteRun({run,busy:false,onDelete:value=>{selected=value}});
 assert.equal(button.props.disabled,false); button.props.onClick(); assert.equal(selected,run);
});
function callbacks(overrides={}) {
 const states=[];
 return {states,options:{confirm:()=>true,request:async()=>({ok:true,json:async()=>({deleted:run.id})}),onStart:()=>states.push('pending'),onDeleted:()=>states.push('cleared'),onError:error=>states.push(error),onFinish:()=>states.push('idle'),...overrides}};
}
test('cancelling identifies the run and preservation boundary and sends no HTTP request',async()=>{
 let text; const {states,options}=callbacks({confirm:value=>{text=value;return false},request:()=>{throw new Error('Must not send')}});
 await deleteRun(run,options);
 assert.match(text,/Synthetic report/); assert.match(text,/permanently/i); assert.match(text,/Studio.*copies/); assert.match(text,/source.*preserv|source.*remain/i); assert.match(text,/native Codex history.*preserv|native Codex history.*remain/i);
 assert.deepEqual(states,[]);
});
test('confirmed deletion uses DELETE and clears selection before completing the pending operation',async()=>{
 let request; const {states,options}=callbacks({request:async(...args)=>{request=args;return {ok:true,json:async()=>({deleted:run.id})}}});
 await deleteRun(run,options);
 assert.deepEqual(request,['/api/runs/selected-run',{method:'DELETE'}]); assert.deepEqual(states,['pending','cleared','idle']);
});
test('failed deletion leaves selection intact and reports an actionable retry error',async()=>{
 const {states,options}=callbacks({request:async()=>({ok:false,status:409,json:async()=>({error:'Run is busy. Try again.'})})});
 await deleteRun(run,options); assert.deepEqual(states,['pending','Run is busy. Try again.','idle']);
 await deleteRun(run,{...options,request:async()=>({ok:true,json:async()=>({deleted:run.id})})});
 assert.deepEqual(states.slice(-3),['pending','cleared','idle']);
});

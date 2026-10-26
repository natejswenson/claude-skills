import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
import {transpileModule,ModuleKind,JsxEmit} from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const require=createRequire(import.meta.url);
async function compile(name){return transpileModule(await readFile(new URL('../src/'+name,import.meta.url),'utf8'),{compilerOptions:{module:ModuleKind.CommonJS,jsx:JsxEmit.ReactJSX}}).outputText;}
const history={};runInNewContext(await compile('history.ts'),{exports:history,AbortController});const code=await compile('RunHistory.tsx');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return{promise,resolve};};
function mount(){
 const values=[],cleanups=[],effects=[],timers=new Map(),requests=[];let index=0,timerId=0;
 const hooks={useState(initial){const slot=index++;if(!(slot in values))values[slot]=initial;return[values[slot],value=>{values[slot]=typeof value==='function'?value(values[slot]):value;}];},useRef(initial){const slot=index++;return values[slot]||=( {current:initial} );},useEffect(effect,deps){const slot=index++;if(!(slot in values)||deps.some((d,n)=>!Object.is(d,values[slot][n]))){values[slot]=deps;effects.push(()=>{cleanups[slot]?.();cleanups[slot]=effect();});}}};
 const exports={};runInNewContext(code,{exports,require:name=>name==='react'?hooks:name==='./history'?history:require(name),AbortController,encodeURIComponent,setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id),fetch:(url,options)=>{const pending=deferred();requests.push({url,options,...pending});return pending.promise;}});
 return {requests,render(revision='0'){index=0;const tree=exports.RunHistory({totalCount:1,revision,skills:[],busy:false,onOpen(){},onAgain(){},onNew(){}});while(effects.length)effects.shift()();return tree;},timers(){for(const [id,fn]of timers){timers.delete(id);fn();}},unmount(){cleanups.forEach(fn=>fn?.());}};
}
const page=runs=>new Response(JSON.stringify({runs,total:runs.length,nextOffset:null}));
const row={id:'live',title:'New matching run',status:'working',createdAt:'2026-10-20',updatedAt:'2026-10-20'};
test('content invalidation coalesces instead of aborting a slow history request',async()=>{
 const app=mount();app.render();app.timers();assert.equal(app.requests.length,1);
 app.render('1');assert.equal(app.requests[0].options.signal.aborted,false);assert.equal(app.requests.length,1);
 app.requests[0].resolve(page([]));await settle();assert.equal(app.requests.length,2);
 app.requests[1].resolve(page([row]));await settle();assert.match(renderToStaticMarkup(app.render('1')),/New matching run/);app.unmount();
});
test('a changed search cancels stale requests and a late response cannot replace its matches',async()=>{
 const app=mount();const tree=app.render();app.timers();
 function input(node){if(!node)return;if(node.type==='input')return node;return React.Children.toArray(node.props?.children).map(input).find(Boolean);}
 input(tree).props.onChange({target:{value:'needle'}});app.render();app.timers();assert.equal(app.requests[0].options.signal.aborted,true);
 app.requests[1].resolve(page([row]));await settle();app.requests[0].resolve(page([]));await settle();
 assert.match(renderToStaticMarkup(app.render()),/New matching run/);assert.match(app.requests[1].url,/query=needle/);app.unmount();
});

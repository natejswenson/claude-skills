import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {makeClient,checkChapter,checkRecord,parseReference} from '../bible-data.mjs';
const read=n=>JSON.parse(fs.readFileSync(new URL(`../../evals/input/api/${n}.json`,import.meta.url)));
const books=read('books-web'),chapter=read('john-3');
function setup(t,fetchImpl){const cacheDir=fs.mkdtempSync(path.join(os.tmpdir(),'bible-api-test-'));t.after(()=>fs.rmSync(cacheDir,{recursive:true,force:true}));return {cacheDir,interval:0,fetchImpl};}
const response=d=>new Response(JSON.stringify(d),{status:200,headers:{'content-type':'application/json'}});
test('real John 3 API data supplies 36 verses, retains context for ranges, and replays offline',async t=>{
 const urls=[];const options=setup(t,async url=>{urls.push(url);return response(url.endsWith('/web')?books:chapter);});
 const client=makeClient(options);const full=await client.passage('John 3');
 assert.equal(full.verses.length,36);assert.equal(full.verses.at(-1).verse,36);
 const range=await client.passage('John 3:14-21');assert.equal(range.verses.length,8);assert.equal(range.contextVerses.length,36);
 const cached=await makeClient({...options,offline:true,fetchImpl:()=>{throw Error('network forbidden');}}).passage('John 3:14-21');
 assert.deepEqual(cached,range);assert.equal(urls.length,2);
 assert.equal(full.translation.license,'Public Domain');assert.equal(full.url,'https://bible-api.com/data/web/JHN/3');
});
test('single-chapter books use the chapter endpoint instead of the ambiguous user-input API',async t=>{
 let url;const jude={translation:chapter.translation,verses:Array.from({length:25},(_,i)=>({book_id:'JUD',book:'Jude',chapter:1,verse:i+1,text:'Test verse'}))};
 const client=makeClient(setup(t,async u=>{url=u;return response(u.endsWith('/web')?books:jude);}));
 const result=await client.passage('Jude 1');assert.equal(result.verses.length,25);assert.equal(url,'https://bible-api.com/data/web/JUD/1');
});
for(const [name,change] of [
 ['translation substitution',d=>d.translation.identifier='kjv'],
 ['wrong chapter',d=>d.verses[0].chapter=4],
 ['wrong book',d=>d.verses[0].book_id='1JN'],
 ['missing interior verse',d=>d.verses.splice(10,1)],
 ['duplicate verse',d=>d.verses[1].verse=1],
 ['empty verse',d=>d.verses[0].text='']
])test(`rejects ${name}`,()=>{const d=structuredClone(chapter);change(d);assert.throws(()=>checkChapter(d,{translation:'web',bookId:'JHN',chapter:3}));});
test('does not truncate an out-of-range request',async t=>{
 const c=makeClient(setup(t,async u=>response(u.endsWith('/web')?books:chapter)));
 await assert.rejects(c.passage('John 3:35-40'),/absent/);
});
test('rate limits, HTTP errors, malformed JSON and offline misses fail clearly',async t=>{
 for(const [result,pattern] of [[new Response('',{status:429,headers:{'retry-after':'30'}}),/rate limit/],[new Response('',{status:503}),/HTTP 503/],[new Response('broken',{status:200}),/valid JSON/]]){
  await assert.rejects(makeClient(setup(t,async()=>result)).passage('John 3'),pattern);
 }
 await assert.rejects(makeClient({...setup(t),offline:true}).passage('John 3'),/No cached/);
});
test('refresh bypasses a cache, unsupported books fail, and URLs cannot be supplied as references',async t=>{
 let calls=0;const options=setup(t,async u=>{calls++;return response(u.endsWith('/web')?books:chapter);});
 await makeClient(options).passage('John 3');await makeClient({...options,refresh:true}).passage('John 3');assert.equal(calls,4);
 await assert.rejects(makeClient(options).passage('Imaginary 1'),/unavailable/);
 for(const ref of ['https://evil.example/John3','John 0','John 3:21-14','John 3-4'])assert.throws(()=>parseReference(ref));
});
test('record validation detects mismatched provenance and selected text',async t=>{
 const c=makeClient(setup(t,async u=>response(u.endsWith('/web')?books:chapter)));const record=await c.passage('John 3:16');
 const wrongURL=structuredClone(record);wrongURL.url='https://example.com';assert.throws(()=>checkRecord(wrongURL));
 const wrongText=structuredClone(record);wrongText.verses[0].text='invented';assert.throws(()=>checkRecord(wrongText));
});

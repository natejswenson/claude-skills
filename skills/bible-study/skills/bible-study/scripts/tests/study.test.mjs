import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validate,render} from '../bible-study.js';
const good=JSON.parse(fs.readFileSync(new URL('../../evals/input/john-3.json',import.meta.url)));
const copy=()=>structuredClone(good);
test('reviewed John 3 study retains all required coverage and source links',()=>{
 assert.deepEqual(validate(good),[]);const html=render(good);
 for(const c of [good.composition,good.events,good.historicalContext,good.literaryContext,good.bigIdea,...good.meaning,...good.related])assert.ok(html.includes(c.text.replaceAll('&','&amp;').replaceAll("'",'&#39;')));
 for(const s of good.sources)assert.ok(html.includes(s.url));
 assert.ok(html.includes('3:22-36'));assert.ok(html.includes('John 3:30'));
});
for(const [name,change] of [
 ['non-Christian source',d=>{d.sources[1].kind='secular';}],
 ['unread source',d=>{d.sources[1].read=false;}],
 ['unresolved citation',d=>{d.meaning[0].sources=['S999'];}],
 ['uncited historical claim',d=>{d.events.sources=[];}],
 ['false review attestation',d=>{d.review.claimsChecked=false;}],
 ['missing uncertainty',d=>{delete d.composition.uncertainty;}],
 ['missing identity evidence',d=>{delete d.sources[2].identityEvidence;}],
 ['injected URL',d=>{d.sources[0].url='javascript:alert(1)';}],
 ['duplicate source IDs',d=>{d.sources[1].id=d.sources[0].id;}],
 ['lost chapter ending',d=>{d.meaning.pop();}],
 ['excessively long copy',d=>{d.application='word '.repeat(700);}]
])test(`rejects ${name}`,()=>{const d=copy();change(d);assert.ok(validate(d).length);assert.throws(()=>render(d));});
test('source text is escaped rather than executed',()=>{
 const d=copy();d.title='<script>alert(1)</script>';d.questions[0]='<img src=x onerror=alert(1)>';
 const h=render(d);assert.ok(h.includes('&lt;script&gt;'));assert.ok(!h.includes('<script>'));assert.ok(!h.includes('<img src=x'));
});
test('invalid root is rejected',()=>{for(const d of [null,[],false])assert.ok(validate(d).length);});

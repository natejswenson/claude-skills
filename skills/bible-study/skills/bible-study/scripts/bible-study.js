#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const words = s => String(s).trim().split(/\s+/).filter(Boolean).length;
const nonempty = s => typeof s === 'string' && s.trim().length > 0;
const webURL = s => { try { const u=new URL(s); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; } };
export function validate(d) {
  const errors=[]; const need=(ok,msg)=>{if(!ok)errors.push(msg);};
  if(!d || typeof d !== 'object' || Array.isArray(d))return ['Study must be an object'];
  for(const k of ['passage','title','subtitle','translation','translationNotice','audience','reviewedOn'])need(nonempty(d[k]),`Missing ${k}`);
  need(/^\d{4}-\d{2}-\d{2}$/.test(d.reviewedOn??''),'reviewedOn must be YYYY-MM-DD');
  need(d.review?.christianSourcesOnly === true,'Christian-only source review required');
  need(d.review?.claimsChecked === true,'Claim support review required');
  need(d.review?.passageReadInContext === true,'Passage context review required');
  const sources=Array.isArray(d.sources)?d.sources:[];
  need(sources.length>=4 && sources.length<=10,'Use 4-10 sources, including Scripture and at least 3 Christian research sources');
  const ids=new Set();let bible=0, christian=0;const hosts=new Set();
  for(const s of sources){
    need(s && typeof s==='object','Invalid source');if(!s || typeof s!=='object')continue;
    need(/^S[1-9]\d*$/.test(s.id??'') && !ids.has(s.id),'Invalid or duplicate source ID');ids.add(s.id);
    for(const k of ['title','publisher','identityEvidence','supportNotes','accessed'])need(nonempty(s[k]),`Source ${s.id}: missing ${k}`);
    need(webURL(s.url),`Source ${s.id}: HTTPS URL required`);
    need(webURL(s.identityURL),`Source ${s.id}: identity evidence URL required`);
    need(s.read === true,`Source ${s.id}: must be read, not just discovered`);
    need(['bible','christian'].includes(s.kind),`Source ${s.id}: only Bible or Christian sources allowed`);
    if(s.kind==='bible')bible++;
    if(s.kind==='christian'){christian++; if(webURL(s.url))hosts.add(new URL(s.url).hostname);}
  }
  need(bible>=1 && christian>=3 && hosts.size>=3,'Need Scripture and 3 Christian publishers, not mirrors of one source');
  const cited=new Set();
  function claim(c,label){
    need(c && typeof c==='object' && nonempty(c.text),`${label}: text required`);
    const refs=Array.isArray(c?.sources)?c.sources:[];
    need(refs.length>0 && refs.every(x=>ids.has(x)),`${label}: missing or unresolved citation`);
    refs.forEach(x=>cited.add(x));
  }
  for(const k of ['composition','events','historicalContext','literaryContext','interpretiveNote','bigIdea'])claim(d[k],k);
  need(nonempty(d.composition?.uncertainty),'Composition date must state uncertainty');
  need(nonempty(d.composition?.author),'Composition must distinguish authorship/tradition');
  claim(d.quote,'quote');need(nonempty(d.quote?.reference),'Quote reference required');
  for(const [key,min,max] of [['meaning',3,4],['related',3,4]]){
    const rows=Array.isArray(d[key])?d[key]:[];need(rows.length>=min && rows.length<=max,`${key}: ${min}-${max} entries required`);
    rows.forEach((c,i)=>{claim(c,`${key} ${i+1}`);need(nonempty(c.reference),`${key}: verse reference required`);need(nonempty(c.title),`${key}: title required`);});
  }
  const questions=Array.isArray(d.questions)?d.questions:[];
  need(questions.length===3 && questions.every(nonempty),'Exactly 3 discussion questions required');
  need(nonempty(d.application) && nonempty(d.prayer),'Application and prayer required');
  const flow=Array.isArray(d.flow)?d.flow:[];need(flow.length===3 && flow.every(x=>nonempty(x.title)&&nonempty(x.reference)),'Three-part passage map required');
  sources.forEach(s=>need(cited.has(s.id),`Unused source ${s.id}`));
  const content=[d.title,d.subtitle,d.quote?.text,d.bigIdea?.text,d.composition?.text,d.composition?.author,d.composition?.uncertainty,d.events?.text,d.historicalContext?.text,d.literaryContext?.text,d.interpretiveNote?.text,...(d.meaning??[]).map(x=>x.text),...(d.related??[]).map(x=>x.text),...questions,d.application,d.prayer].join(' ');
  need(words(content)<=620,'Handout exceeds 620-word content budget; condense before export');
  need(words(d.title)<=9,'Title exceeds 9 words');
  return errors;
}
export const escape = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function render(d){
  const errors=validate(d);if(errors.length)throw new Error(errors.join('\n'));
  const e=escape;
  const refs=c=>` <span class="refs">${c.sources.map(id=>`<a href="${e(d.sources.find(s=>s.id===id).url)}">[${e(id.slice(1))}]</a>`).join('')}</span>`;
  const p=c=>`<p>${e(c.text)}${refs(c)}</p>`;
  const sourceLinks=d.sources.map(s=>`<a href="${e(s.url)}">[${e(s.id.slice(1))}] ${e(s.publisher)}</a>`).join(' ');
  const css=fs.readFileSync(path.join(ROOT,'assets/study.css'),'utf8');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(d.passage)} | Bible study</title><style>${css}</style></head><body><main class="sheet">
<header class="mast"><span class="eyebrow">Bible study / ${e(d.passage)}</span><span class="byline">${e(d.audience)} · 45 minutes</span></header>
<h1>${e(d.title)} <span class="sig">${e(d.passage)}</span></h1><p class="stand">${e(d.subtitle)}</p>
<div class="quote">“${e(d.quote.text)}”<span class="label">${e(d.quote.reference)} · ${e(d.translation)}${refs(d.quote)}</span></div>
<div class="flow">${d.flow.map(f=>`<div><strong>${e(f.title)}</strong><span>${e(f.reference)}</span></div>`).join('')}</div>
<div class="columns"><div>
<section><h2>01 / When & where</h2><h3>When the book was written</h3>${p(d.composition)}<p>${e(d.composition.author)} ${e(d.composition.uncertainty)}${refs(d.composition)}</p><h3>When the events happened</h3>${p(d.events)}<h3>What was happening around it</h3>${p(d.historicalContext)}${p(d.literaryContext)}</section>
<section><h2>02 / What it means</h2>${p(d.bigIdea)}${d.meaning.map(c=>`<h3>${e(c.reference)} · ${e(c.title)}</h3>${p(c)}`).join('')}<p><strong>Interpretive note.</strong> ${e(d.interpretiveNote.text)}${refs(d.interpretiveNote)}</p></section>
</div><div>
<section><h2>03 / Read alongside</h2>${d.related.map(c=>`<h3>${e(c.reference)} · ${e(c.title)}</h3>${p(c)}`).join('')}</section>
<section><h2>04 / Study together</h2><p class="label">Read 8 min / explore 12 / discuss 20 / pray 5</p><ol>${d.questions.map(q=>`<li>${e(q)}</li>`).join('')}</ol></section>
<section><h2>05 / Put it into practice</h2><p>${e(d.application)}</p><h3>Pray</h3><p>${e(d.prayer)}</p></section>
</div></div>
<footer class="sources">READ & VERIFY · ${sourceLinks}</footer><div class="colophon">${e(d.translationNotice)} · Research checked ${e(d.reviewedOn)}<br>Read the full passage in your Bible. Questions and prayer are study prompts.</div>
</main></body></html>\n`;
}
function main(args){
  const [command,...rest]=args;const opts={};
  if(!command || command==='--help'){console.log('bible-study validate --file study.json\nbible-study render --file study.json --out output-dir');return;}
  for(let i=0;i<rest.length;i+=2){if(!['--file','--out'].includes(rest[i])||!rest[i+1]||rest[i+1].startsWith('--'))throw new Error('Use --file study.json and, for render, --out output-dir');opts[rest[i]]=rest[i+1];}
  if(!['validate','render'].includes(command))throw new Error('Unknown command');
  if(!opts['--file'])throw new Error('--file required');
  const d=JSON.parse(fs.readFileSync(opts['--file'],'utf8'));const errors=validate(d);
  if(errors.length)throw new Error(errors.join('\n'));
  if(command==='validate'){console.log('Study structure and source attestations valid. Human source review and visual export QA remain required.');return;}
  if(!opts['--out'])throw new Error('--out required');
  const out=path.resolve(opts['--out']);fs.mkdirSync(out,{recursive:true});
  fs.writeFileSync(path.join(out,'study.html'),render(d));
  console.log(`Rendered ${path.join(out,'study.html')}; export and inspect before sharing.`);
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{main(process.argv.slice(2));}catch(err){console.error(`bible-study: ${err.message}`);process.exitCode=1;}
}

#!/usr/bin/env node
import fs from 'node:fs';
import {registry,checkRecord,parseReference,normalizeText} from './bible-data.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const words = s => String(s).trim().split(/\s+/).filter(Boolean).length;
const nonempty = s => typeof s === 'string' && s.trim().length > 0;
const webURL = s => { try { const u=new URL(s); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; } };
export function validate(d) {
  const errors=[]; const need=(ok,msg)=>{if(!ok)errors.push(msg);};
  if(!d || typeof d !== 'object' || Array.isArray(d))return ['Study must be an object'];
  for(const k of ['passage','title','subtitle','translation','translationNotice','audience','reviewedOn','opening'])need(nonempty(d[k]),`Missing ${k}`);
  need(/^\d{4}-\d{2}-\d{2}$/.test(d.reviewedOn??''),'reviewedOn must be YYYY-MM-DD');
  need(d.review?.christianSourcesOnly === true,'Christian-only source review required');
  need(d.review?.claimsChecked === true,'Claim support review required');
  need(d.review?.passageReadInContext === true,'Passage context review required');
  const scripture=Array.isArray(d.scripture)?d.scripture:[];
  need(scripture.length>0,'Fetched Scripture records are required');
  for(const record of scripture){try{checkRecord(record);}catch(error){errors.push(error.message);}}
  const translationIds=new Set(scripture.map(r=>r?.translation?.identifier));
  need(translationIds.size===1,'Use one consistent Scripture translation per study');
  need(scripture.every(r=>r?.translation?.name===d.translation),'Study translation label must match fetched Scripture');
  need(scripture.some(r=>r?.reference===d.passage || r?.requestedReference===d.passage),'Requested study passage is missing from fetched Scripture');
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
    if(s.kind==='bible'){
      bible++;
      need(s.providerId===registry.bible.id,'Bible sources must use the shared Bible API provider');
      need(scripture.some(r=>r?.url===s.url && r?.reference===s.scriptureReference),`Source ${s.id}: fetched Scripture provenance is missing`);
    }
    if(s.kind==='christian'){
      const publisher=registry.research.find(p=>p.id===s.providerId);
      if(publisher)need(webURL(s.url)&&new URL(s.url).hostname.replace(/^www\./,'')===publisher.host,`Source ${s.id}: URL does not match registered publisher`);
      else need(s.providerId==='supplemental' && nonempty(s.supplementReason),`Source ${s.id}: use a registered Christian publisher or explain a supplemental source`);
    }
    if(s.kind==='christian'){christian++; if(webURL(s.url))hosts.add(new URL(s.url).hostname.replace(/^www\./,''));}
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
  try{
    const q=parseReference(d.quote?.reference);
    const matching=scripture.filter(r=>r?.contextVerses?.[0]?.book===q.book && r.contextVerses[0].chapter===q.chapter);
    const supported=matching.some(r=>{
      const verses=r.contextVerses.filter(v=>q.first===null || v.verse>=q.first&&v.verse<=q.last);
      return verses.length>0 && normalizeText(verses.map(v=>v.text).join(' ')).includes(normalizeText(d.quote.text)) && sources.some(s=>d.quote.sources.includes(s.id)&&s.kind==='bible'&&s.url===r.url);
    });
    need(supported,'Scripture quote must match the cited API text and verse reference');
  }catch{errors.push('Scripture quote requires a valid reference and fetched text');}
  for(const [key,min,max] of [['meaning',3,4],['related',3,4]]){
    const rows=Array.isArray(d[key])?d[key]:[];need(rows.length>=min && rows.length<=max,`${key}: ${min}-${max} entries required`);
    rows.forEach((c,i)=>{claim(c,`${key} ${i+1}`);need(nonempty(c.reference),`${key}: verse reference required`);need(nonempty(c.title),`${key}: title required`);});
  }
  const questions=Array.isArray(d.questions)?d.questions:[];
  need(questions.length===6 && questions.every(nonempty),'Exactly 6 discussion questions required: observation and interpretation for each passage section');
  for(const c of d.related??[])need(nonempty(c?.prompt),'Each related passage needs a comparison prompt');
  need(nonempty(d.application) && nonempty(d.prayer),'Application and prayer required');
  const flow=Array.isArray(d.flow)?d.flow:[];need(flow.length===3 && flow.every(x=>nonempty(x.title)&&nonempty(x.reference)),'Three-part passage map required');
  sources.forEach(s=>need(cited.has(s.id),`Unused source ${s.id}`));
  const content=[d.title,d.subtitle,d.opening,...(d.related??[]).map(x=>x.prompt),d.quote?.text,d.bigIdea?.text,d.composition?.text,d.composition?.author,d.composition?.uncertainty,d.events?.text,d.historicalContext?.text,d.literaryContext?.text,d.interpretiveNote?.text,...(d.meaning??[]).map(x=>x.text),...(d.related??[]).map(x=>x.text),...questions,d.application,d.prayer].join(' ');
  need(words(content)<=520,'Handout exceeds 520-word content budget; condense before export');
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
<header class="mast"><span class="eyebrow">Bible study guide / ${e(d.passage)}</span><span class="byline">${e(d.audience)} · 45 minutes</span></header>
<h1>${e(d.title)} <span class="sig">${e(d.passage)}</span></h1><p class="stand">${e(d.subtitle)}</p>
<p class="opening"><strong>Begin · 3 min</strong> ${e(d.opening)}</p>
<div class="columns"><div class="workbook">
${d.flow.map((f,i)=>`<section class="study-step"><h2>0${i+1} / ${e(f.title)}</h2><p class="label">Read ${e(f.reference)} aloud · 11 min</p><ol start="${i*2+1}">${d.questions.slice(i*2,i*2+2).map(q=>`<li>${e(q)}</li>`).join('')}</ol><p class="connection"><strong>Compare ${e(d.related[i].reference)}.</strong> ${e(d.related[i].prompt)}</p><div class="write-lines" aria-label="Space for observations and verse references"><span>Notes / verse</span><div></div></div></section>`).join('')}
<section class="response"><h2>04 / Respond & pray · 9 min</h2><p>${e(d.application)}</p><div class="commitment"><span>This week I will</span><div></div><span>When / follow-up</span><div></div></div><p><strong>Pray together.</strong> ${e(d.prayer)}</p></section>
</div><aside>
<section><h2>Context to keep nearby</h2><h3>Writing &amp; authorship</h3>${p(d.composition)}<p>${e(d.composition.author)} ${e(d.composition.uncertainty)}${refs(d.composition)}</p><h3>Setting of the events</h3>${p(d.events)}${p(d.historicalContext)}${p(d.literaryContext)}</section>
<section><h2>Meaning to reflect on</h2>${p(d.bigIdea)}${d.meaning.map(c=>`<p><strong>${e(c.reference)}</strong> ${e(c.text)}${refs(c)}</p>`).join('')}<p class="interpretive">${e(d.interpretiveNote.text)}${refs(d.interpretiveNote)}</p></section>
<section><h2>Connections</h2>${d.related.map(c=>`<p><strong>${e(c.reference)}</strong> ${e(c.text)}${refs(c)}</p>`).join('')}</section>
<div class="quote">“${e(d.quote.text)}”<span class="label">${e(d.quote.reference)} · ${e(d.translation)}${refs(d.quote)}</span></div>
</aside></div>
<footer class="sources">SOURCES · ${sourceLinks}</footer><div class="colophon">${e(d.translationNotice)} · Research checked ${e(d.reviewedOn)}</div>
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

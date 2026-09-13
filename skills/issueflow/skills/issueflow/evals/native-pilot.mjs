#!/usr/bin/env node
/** Import real native campaign receipts; this command never launches models or GitHub writes. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash } from '../scripts/lib/contracts.mjs';
export function importPilot(manifest) {
  if(manifest.schema!==1||!Array.isArray(manifest.runs))throw Error('native pilot manifest requires schema 1 and runs');
  const ids=new Set(),pairs=new Map();
  const runs=manifest.runs.map(run=>{
    if(!run.id||ids.has(run.id)||!['claude','codex'].includes(run.host)||!['baseline','candidate'].includes(run.variant))throw Error('unique run ID, host and variant required');ids.add(run.id);
    for(const field of ['task','endpoint','startState','modelSettings','cacheState','repetition','sourceHash'])if(run[field]==null)throw Error(`missing paired-run field ${field}`);
    if(!Array.isArray(run.evidence)||!run.evidence.length)throw Error('native run needs captured source/transcript/endpoint receipts');
    const kinds=new Set();
    for(const e of run.evidence){if(!e.path||!e.sha256||hash(readFileSync(e.path))!==e.sha256)throw Error('native evidence missing or changed');kinds.add(e.kind);}
    if(!['source','transcript','endpoint'].every(k=>kinds.has(k)))throw Error('source, transcript and endpoint evidence are all required');
    if(!Number.isSafeInteger(run.repetition)||run.repetition<1||run.repetition>3)throw Error('pilot repetition must be 1–3');
    if(!run.evidence.some(e=>e.kind==='source'&&e.sha256===run.sourceHash))throw Error('source identity does not match captured source bytes');
    const key=hash({repetition:run.repetition,host:run.host,task:run.task,endpoint:run.endpoint,startState:run.startState,modelSettings:run.modelSettings,cacheState:run.cacheState});
    const pair=pairs.get(key)??{};if(pair[run.variant])throw Error('duplicate variant in paired native task');pair[run.variant]=run.id;pairs.set(key,pair);
    return {...run,observed:true};
  });
  const coverage=Object.fromEntries(['claude','codex'].map(host=>[host,{observed:runs.filter(r=>r.host===host).length,required:18,status:runs.filter(r=>r.host===host).length>=18?'sample-count-met':'unverified'}]));
  const incompletePairs=[...pairs.values()].filter(p=>!p.baseline||!p.candidate);
  return {schema:1,runs,coverage,incompletePairs,releasePerformanceClaim:incompletePairs.length===0&&Object.values(coverage).every(c=>c.status==='sample-count-met')?'requires independent quality and outcome analysis':'unverified'};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try{const args=process.argv.slice(2);const input=args[args.indexOf('--manifest')+1],output=args[args.indexOf('--out')+1];if(!args.includes('--manifest')||!args.includes('--out'))throw Error('usage: native-pilot.mjs --manifest manifest.json --out report.json');const report=importPilot(JSON.parse(readFileSync(input,'utf8')));mkdirSync(dirname(resolve(output)),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(`Imported ${report.runs.length} real native runs; performance claim: ${report.releasePerformanceClaim}`);}catch(error){console.error(error.message);process.exitCode=2;}
}

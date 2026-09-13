#!/usr/bin/env node
/** Project a registered real finding into a portable handoff regression input. */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
const args={};
for(let i=2;i<process.argv.length;i+=2) {
  const key=process.argv[i],value=process.argv[i+1];
  if(!['--run-dir','--lane','--round','--finding','--brief','--out'].includes(key)||!value||value.startsWith('--'))throw new Error('Use --run-dir <run> --lane <slug> --round <n> --finding <id> --brief <captured-brief> --out <file>');
  args[key.slice(2)]=value;
}
for(const key of ['run-dir','lane','round','finding','brief','out'])if(!args[key])throw new Error(`missing --${key}`);
if(!/^[a-z0-9][a-z0-9_-]*$/.test(args.lane)||!/^\d+$/.test(args.round)||Number(args.round)<1)throw new Error('invalid lane or round');
const run=JSON.parse(readFileSync(join(args['run-dir'],'run.json'),'utf8'));
const lane=run.lanes.find(l=>l.slug===args.lane),round=Number(args.round);
const entry=lane?.review?.rounds.find(r=>r.round===round);
if(!entry?.registered)throw new Error('the requested round has no registered review');
const roots=[run.execution?.path&&join(run.execution.path,'artifacts'),args['run-dir']].filter(Boolean);
const root=roots.find(r=>existsSync(join(r,args.lane,'review',`r${round}`,'registered.json')));
if(!root)throw new Error('restore the original registered round artifacts before freezing');
const dir=join(root,args.lane,'review',`r${round}`);
const registered=JSON.parse(readFileSync(join(dir,'registered.json'),'utf8'));
const finding=registered.findings.find(f=>f.id===args.finding);
if(!finding||registered.head!==entry.head||registered.round!==round)throw new Error('finding or registered round identity does not match');
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const verdictSources=readdirSync(dir).filter(n=>/^verdicts-\d+\.json$/.test(n)).sort().map(name=>({name,sha256:hash(join(dir,name))}));
if(!verdictSources.length)throw new Error('no real verifier outputs to freeze');
const data={source:`${run.repo.owner}/${run.repo.name}#${run.issue.number}`,reviewUrl:entry.posted?.url??null,
  head:registered.head,round,finding,verdictSources,briefSha256:hash(args.brief),
  projection:'Exact registered finding and round identity; no rewritten verifier prose.'};
mkdirSync(dirname(args.out),{recursive:true});writeFileSync(args.out,JSON.stringify(data,null,2)+'\n');
console.log(`Frozen ${args.finding} at round ${round} into ${args.out}`);

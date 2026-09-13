/** Read-only repository facts and reviewed-command validation. No command execution. */
import { existsSync, lstatSync, statSync, readFileSync, realpathSync } from 'node:fs';
import { delimiter, isAbsolute, join, relative } from 'node:path';
import { allowsPath, gitText, hash, observedRisk, safeRelative, validateContract } from './contracts.mjs';
import { RunError } from './run.mjs';
import { claudeSkillsOutputs } from './adapters/claude-skills.mjs';
const fail = text => { throw new RunError(`preflight: ${text}`); };
export function inspectRepository(repo, paths = []) {
  let recipes=[]; const unknown=[];
  const declaration=join(repo,'.issueflow/preflight.json');
  let declared=[];
  if (existsSync(declaration)) {
    const value=JSON.parse(readFileSync(declaration,'utf8'));
    if (value.schema!==1 || !Array.isArray(value.generators)) fail('invalid .issueflow/preflight.json');
    declared=value.generators.flatMap(g=>{
      if (!Array.isArray(g.inputs) || !Array.isArray(g.outputs) || [...g.inputs,...g.outputs].some(p=>!safeRelative(p)) || typeof g.name!=='string') fail('generator relationships need explicit relative inputs/outputs and a name');
      return g.inputs.flatMap(input=>g.outputs.map(output=>({input,output,generator:g.name})));
    });
  }
  const selected=new Set(paths), provenance=[];
  for (let round=0;round<100;round++) {
    const relationships=[...declared,...claudeSkillsOutputs(repo,[...selected])];
    const added=relationships.filter(g=>[...selected].some(p=>allowsPath([g.input],p) || allowsPath([p],g.input)) && !selected.has(g.output));
    if (!added.length) break;
    for (const item of added) { selected.add(item.output); provenance.push(item); }
    if (round===99) fail('generator closure exceeded its bounded traversal');
  }
  for (const file of gitText(repo,'ls-files','-z').split('\0').filter(p=>/(?:^|\/)package\.json$/.test(p))) {
    try { const pkg=JSON.parse(readFileSync(join(repo,file),'utf8')); recipes.push({cwd:file.slice(0,-'package.json'.length)||'.',scripts:pkg.scripts??{},dependencies:!!(pkg.dependencies||pkg.devDependencies)}); }
    catch { unknown.push(`unreadable package recipe: ${file}`); }
  }
  if (!declared.length && !provenance.length) unknown.push('no generator relationship applies to the proposed paths');
  const files=[...selected].sort();
  const risk=observedRisk(files,p=>{try{return readFileSync(join(repo,p),'utf8')}catch{return ''}});
  return {schema:1,head:gitText(repo,'rev-parse','HEAD'),files,filesSection:files.map(p=>`- \`${p}\``).join('\n'),generators:provenance,recipes,risk,unknown};
}
export function contractPreflight(repo, contract, { planText } = {}) {
  validateContract(contract);
  const facts=inspectRepository(repo,contract.allowedPaths), problems=[];
  for (const file of facts.files) if (!allowsPath(contract.allowedPaths,file)) problems.push(`generated output missing from reviewed scope: ${file}`);
  if (contract.risk==='docs' && facts.risk.kind!=='fast-docs') problems.push(`${facts.risk.reason}; use behavioral evidence`);
  for (const check of contract.checks) {
    const cwd=join(repo,check.cwd??'.');
    if (!existsSync(cwd) || !statSync(cwd).isDirectory()) { problems.push(`${check.id}: missing check directory ${check.cwd??'.'}`); continue; }
    const rel=relative(realpathSync(repo),realpathSync(cwd));
    if (isAbsolute(rel)||rel==='..'||rel.startsWith('../')) problems.push(`${check.id}: cwd escapes repository`);
    const exe=check.argv[0];
    const candidates=exe.includes('/')?[isAbsolute(exe)?exe:join(cwd,exe)]:(process.env.PATH??'').split(delimiter).map(p=>join(p,exe));
    if (!candidates.some(p=>{try{return statSync(p).isFile()&&(statSync(p).mode&0o111)}catch{return false}})) problems.push(`${check.id}: executable unavailable: ${exe}`);
    if (['npm','pnpm','yarn'].includes(exe) && existsSync(join(cwd,'package.json'))) {
      const pkg=JSON.parse(readFileSync(join(cwd,'package.json'),'utf8'));
      const script=check.argv[1]==='run'?check.argv[2]:check.argv[1]==='test'?'test':null;
      if (script && !pkg.scripts?.[script]) problems.push(`${check.id}: missing package script ${script}`);
      if ((Object.keys(pkg.dependencies??{}).length||Object.keys(pkg.devDependencies??{}).length) && !existsSync(join(cwd,'node_modules'))) problems.push(`${check.id}: dependencies need setup in ${check.cwd??'.'} under existing task permissions`);
    }
  }
  if (contract.schema===2 && planText!=null) {
    const section=/^## Files\s*\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(planText)?.[1]??'';
    for (const path of contract.allowedPaths) if (!section.includes('`'+path+'`')) problems.push(`Files section must render contract path ${path}`);
  }
  return {...facts,contractHash:hash(contract),problems,ok:problems.length===0};
}
export function assertPreflight(repo,contract,options) {
  const facts=contractPreflight(repo,contract,options);
  if (!facts.ok) fail(facts.problems.join('; '));
  return facts;
}

/** Optional local advice. The runner is untrusted; only proposal eligibility and scores cross this boundary. */
import { execFile } from 'node:child_process';
import { existsSync, realpathSync, statSync, mkdtempSync, chmodSync, writeFileSync, rmSync, accessSync, constants } from 'node:fs';
import { resolve, dirname, join, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { propose } from './plan.mjs';
import { validateRuleSet, SYSTEM_LABELS } from './rules.mjs';

const thresholds = { minScore: 0.8, minMargin: 0.2 };
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const fields = (v, keys) => object(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v,k));
const text = (v, max) => typeof v === 'string' && v.trim() && [...v].length <= max;
const fail = message => { throw new Error(`suggest-local: ${message}`); };

export function prepareLocalRequest(threads, { labels, choices, rules = [], minCount = 3 }) {
  if (!Number.isInteger(minCount) || minCount < 1) fail('--min-count must be a positive integer');
  validateRuleSet({rules});
  if (!Array.isArray(threads) || !Array.isArray(labels)) fail('expected thread and label arrays');
  if (!Array.isArray(choices) || choices.length < 2 || choices.length > 12) fail('provide 2..12 existing label choices');
  const names = new Set();
  const mapped = choices.map(c => {
    if (!fields(c,['label','description']) || !text(c.label,Infinity) || !text(c.description,200)) fail('invalid choice fields or description (maximum 200 characters)');
    const matches = labels.filter(l => l.name === c.label);
    const upper = c.label.toUpperCase();
    if (names.has(c.label) || matches.length !== 1 || SYSTEM_LABELS.includes(upper) || upper.startsWith('CATEGORY_')) fail('choices must name unique, unambiguous existing user labels');
    names.add(c.label);
    return {id:randomUUID(),label:c.label,description:c.description};
  });
  const proposal = propose(threads,{minCount,labels,rules});
  const candidates = proposal.sortable.filter(r => r.keepInInbox !== true && r.destination === null)
    .map(r => ({id:randomUUID(),from:r.from,subject:r.sample}));
  if (candidates.length > 20) fail('more than 20 eligible senders; use a smaller sample');
  for (const c of candidates) {
    if (!text(c.from,254) || !text(c.subject,160) || !text(c.id,64)) fail('eligible sender or subject exceeds classifier bounds or is empty');
  }
  return { request:{schemaVersion:1, choices:mapped.map(({id,description}) => ({id,description})),
    items:candidates.map(c => ({id:c.id,sender:c.from,subjects:[c.subject]}))}, candidates, choices:mapped,
    counts:{sampled:threads.length,eligible:candidates.length} };
}

export function validateLocalResponse(response, prepared) {
  const bad = () => fail('invalid local classifier response');
  if (!fields(response,['schemaVersion','model','scoreKind','calibration','thresholds','decisions']) || response.schemaVersion !== 1 ||
      response.scoreKind !== 'uncalibrated_entailment' || response.calibration !== 'none' ||
      !fields(response.model,['id','revision']) || !text(response.model.id,Infinity) || !text(response.model.revision,Infinity) ||
      !fields(response.thresholds,['minScore','minMargin']) || response.thresholds.minScore !== .8 || response.thresholds.minMargin !== .2 ||
      !Array.isArray(response.decisions) || response.decisions.length !== prepared.candidates.length) bad();
  const seen = new Set();
  const suggestions = response.decisions.map(row => {
    if (!fields(row,['itemId','decision','choiceId','scores','topScore','margin','reason'])) bad();
    const candidate = prepared.candidates.find(c => c.id === row.itemId);
    if (!candidate || seen.has(row.itemId) || !fields(row.scores,prepared.choices.map(c => c.id))) bad();
    seen.add(row.itemId);
    const ranked = prepared.choices.map(c => ({...c,score:row.scores[c.id]}));
    if (ranked.some(c => typeof c.score !== 'number' || !Number.isFinite(c.score) || c.score < 0 || c.score > 1)) bad();
    ranked.sort((a,b) => b.score-a.score);
    const topScore = ranked[0].score, margin = topScore-ranked[1].score;
    const reason = margin === 0 ? 'tied_top_scores' : topScore < .8 ? 'below_min_score' : margin < .2 ? 'below_min_margin' : 'thresholds_met';
    const decision = reason === 'thresholds_met' ? 'suggest' : 'abstain';
    if (row.decision !== decision || row.reason !== reason || row.choiceId !== (decision === 'suggest' ? ranked[0].id : null) ||
        ![row.topScore,row.margin].every(v => typeof v === 'number' && Number.isFinite(v)) ||
        Math.abs(row.topScore-topScore)>1e-6 || Math.abs(row.margin-margin)>1e-6) bad();
    return {candidateId:candidate.id,from:candidate.from,decision,destination:decision === 'suggest' ? ranked[0].label : null,topScore,margin,reason};
  });
  return {schemaVersion:1,kind:'local-label-suggestions',scoreKind:'uncalibrated_entailment',calibration:'none',model:response.model,
    thresholds:{...thresholds},counts:{...prepared.counts,suggested:suggestions.filter(s => s.decision === 'suggest').length,abstained:suggestions.filter(s => s.decision === 'abstain').length},suggestions};
}

export function validateLocalConfig(config) {
  if (!fields(config,['version','python','script','modelDir']) || config.version !== 1) fail('invalid local runner config');
  try {
    for (const key of ['python','script','modelDir']) {
      if (typeof config[key] !== 'string' || !isAbsolute(config[key]) || !(key === 'modelDir' ? statSync(config[key]).isDirectory() : statSync(config[key]).isFile())) throw Error();
    }
  } catch { fail('local runner paths must be absolute existing files and model directory'); }
  return config;
}

// Check lexical and resolved ancestors: aliases must never bypass the repository boundary.
export function assertLocalPath(path, { directory = false } = {}) {
  if (typeof path !== 'string' || !path.trim()) fail('an explicit scratch/output path is required');
  const absolute = resolve(path);
  let ancestor = absolute;
  while (!existsSync(ancestor)) ancestor = dirname(ancestor);
  const canonical = realpathSync(ancestor);
  for (const start of [absolute,canonical]) {
    for (let dir = start;;dir=dirname(dir)) {
      if (existsSync(join(dir,'.git'))) fail('scratch and output must be outside Git repositories; --allow-repo is unsupported');
      if (dirname(dir) === dir) break;
    }
  }
  if (directory && (!existsSync(absolute) || !statSync(absolute).isDirectory())) fail('scratch directory must exist');
  if (!directory && existsSync(absolute) && !statSync(absolute).isFile()) fail('output must be a file');
  if (!directory && !existsSync(absolute) && !statSync(ancestor).isDirectory()) fail('output parent must be a directory');
  accessSync(directory ? absolute : ancestor,constants.W_OK);
  return absolute;
}

export async function suggestLocal(prepared, config, scratchDir, { execute = execFile } = {}) {
  validateLocalConfig(config);
  const scratch = assertLocalPath(scratchDir,{directory:true});
  if (prepared.request.items.length === 0) return {schemaVersion:1,kind:'local-label-suggestions',scoreKind:'uncalibrated_entailment',calibration:'none',model:null,thresholds:{...thresholds},counts:{...prepared.counts,suggested:0,abstained:0},suggestions:[]};
  const temporary = mkdtempSync(join(scratch,'gmailtriage-local-'));
  try {
    chmodSync(temporary,0o700);
    const input = join(temporary,'request.json');
    writeFileSync(input,JSON.stringify(prepared.request),{mode:0o600,flag:'wx'});
    let stdout;
    try {
      stdout = await new Promise((ok,no) => execute(config.python,[config.script,'--input',input,'--model-dir',config.modelDir,'--min-score','0.8','--min-margin','0.2'],
        {shell:false,timeout:90_000,killSignal:'SIGKILL',maxBuffer:1024*1024,encoding:'utf8',env:{...process.env,HF_HUB_OFFLINE:'1',HF_HUB_DISABLE_IMPLICIT_TOKEN:'1',TRANSFORMERS_OFFLINE:'1'}},
        (error,output) => error ? no(error) : ok(output)));
    } catch { fail('local classifier failed or timed out'); }
    try { return validateLocalResponse(JSON.parse(stdout),prepared); }
    catch { fail('invalid local classifier response'); }
  } finally { rmSync(temporary,{recursive:true,force:true}); }
}

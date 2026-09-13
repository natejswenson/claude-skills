/** One decision for controller status, readiness and completion. Unknown is not green. */
import { RunError } from './run.mjs';
import { hash } from './contracts.mjs';
const identity = r => typeof r==='string'?{name:r}:r;
const conclusion = c => c.conclusion ?? ({pass:'success',skipping:'skipped',fail:'failure',pending:'pending',cancel:'cancelled'}[c.bucket] ?? c.state ?? 'unknown');
export function evaluateCi({checks,expectedHead,observedHead,policy,observation,expectedBase,epoch}) {
  const blockers=[],limitations=[];
  if (!expectedHead || expectedHead!==observedHead) blockers.push('PR head differs from the reviewed and verified head');
  if (!Array.isArray(checks)) blockers.push('CI evidence is unavailable');
  if (observation && observation.requirementsAvailable!==true) blockers.push('required-check policy is unavailable');
  if (expectedBase && observation?.baseRef!==expectedBase) blockers.push('PR target differs from the reviewed target');
  const required=[...(policy?.requiredChecks??[]),...(observation?.required??[])].map(identity);
  const optional=(policy?.optionalChecks??[]).map(identity);
  const rows=Array.isArray(checks)?checks:[];
  if (!rows.length && Array.isArray(checks) && !(policy?.mode==='none' && policy.reason?.trim() && !required.length)) blockers.push('no CI checks observed; require passing checks or an explicitly reviewed no-CI policy');
  const matches=(c,r)=>c.name===r.name && (r.appId==null || r.appId===c.appId);
  for (const req of required) {
    const found=rows.filter(c=>matches(c,req));
    if (!found.length) blockers.push(`missing required check ${req.name}${req.appId!=null?' from app '+req.appId:''}`);
    else if (new Set(found.map(c=>c.appId)).size>1 && req.appId==null) blockers.push(`ambiguously identified required check ${req.name}`);
  }
  for (const c of rows) {
    const status=conclusion(c), reqs=required.filter(r=>matches(c,r));
    const exception=optional.find(r=>matches(c,r));
    if (c.head && c.head!==expectedHead && c.head!==observation?.mergeSha) blockers.push(`stale head for ${c.name}`);
    if (epoch && (!c.startedAt || Date.parse(c.startedAt)<Date.parse(epoch))) blockers.push(`check ${c.name} predates the target/contract change`);
    if (c.baseRef && c.baseRef!==observation?.baseRef) blockers.push(`stale target context for ${c.name}`);
    if (observation?.strict && c.head!==observation.mergeSha && c.baseSha!==observation.baseSha) blockers.push(`merge-result context unknown for ${c.name}`);
    if (status==='success') continue;
    if (!reqs.length && exception?.reason?.trim() && exception.acceptConclusions?.includes(status)) {
      limitations.push(`${c.name}: expected ${status} (${exception.reason})`); continue;
    }
    if (reqs.length && reqs.every(r=>r.acceptConclusions?.includes(status)) && policy?.acceptedRequiredConclusions?.[c.name]?.includes(status)) continue;
    blockers.push(`CI is not passing: ${c.name} (${status})`);
  }
  return {ready:blockers.length===0,blockers:[...new Set(blockers)],limitations,
    policyHash:hash({policy:policy??null,required,strict:observation?.strict??false}),
    context:observation?{head:observedHead,baseRef:observation.baseRef,baseSha:observation.baseSha,mergeSha:observation.mergeSha,observedAt:observation.observedAt}:null};
}
export function assertCiReady(input) {
  const result=evaluateCi(input);
  if (!result.ready) throw new RunError(`cannot ready: ${result.blockers.join('; ')}`);
  return result;
}

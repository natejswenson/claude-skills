/** Stable plan findings survive wording changes, retries and contract amendments. */
import { randomUUID } from 'node:crypto';
import { RunError } from './run.mjs';
const blocking=f=>['critical','high'].includes(f.severity)&&f.disposition==='fixable';
const fail=text=>{throw new RunError(`plan repair: ${text}`)};
const nonempty=value=>typeof value==='string'&&value.trim();
export function openPlanFindings(run) { return Object.values(run.harness?.planFindings??{}).filter(f=>f.status!=='resolved'&&blocking(f)); }
export function repairResponses(text) {
  const blocks=[...text.matchAll(/^```issueflow-repair\s*\n([\s\S]*?)^```\s*$/gm)];
  if (!blocks.length) return [];
  if (blocks.length!==1) fail('exactly one repair response block is allowed');
  let value; try {value=JSON.parse(blocks[0][1])} catch {fail('repair responses are not valid JSON')}
  if (!Array.isArray(value)) fail('repair responses must be an array');
  return value;
}
export function assertRepairComplete(run,text) {
  const open=openPlanFindings(run); if (!open.length) return [];
  const responses=repairResponses(text);
  if(responses.some(r=>!r||typeof r!=='object'||!nonempty(r.id)))fail('repair responses need an object with a finding id');
  if (new Set(responses.map(r=>r.id)).size!==responses.length) fail('duplicate repair response IDs');
  for (const finding of open) {
    const response=responses.find(r=>r.id===finding.id);
    if (!response || !nonempty(response.response) || !nonempty(response.evidence) || !['addressed','unresolved'].includes(response.disposition)) fail(`missing complete response/evidence for ${finding.id}; preserve every open blocker before another review`);
  }
  return responses;
}
export function reconcilePlanFindings(run, findings, resolutions, {round,artifactSha,responses=[]}) {
  const ledger=structuredClone(run.harness?.planFindings??{});
  const addressed=new Set();
  for (const finding of findings) {
    const existing=finding.id?ledger[finding.id]:null;
    if (finding.id&&!existing) fail(`unknown finding ${finding.id}; omit id for a newly found defect`);
    const id=existing?.id??`PF-${randomUUID()}`;
    if (addressed.has(id)) fail(`duplicate finding ${id}`); addressed.add(id);
    if (existing?.status==='resolved' && !nonempty(finding.reopeningReason)) fail(`${id}: reopening requires a reason and current evidence`);
    ledger[id]={...existing,...finding,id,status:'open',origin:existing?.origin??{round,artifactSha,cite:finding.cite},
      history:[...(existing?.history??[]),{round,artifactSha,kind:existing?.status==='resolved'?'reopened':'observed',cite:finding.cite,text:finding.text,reason:finding.reopeningReason??null}]};
    finding.id=id;
  }
  if (!Array.isArray(resolutions)) fail('resolutions must be an array');
  const judged=new Set();
  for (const resolution of resolutions) {
    if(!resolution||typeof resolution!=='object'||!nonempty(resolution.id))fail('resolution must be an object with a finding id');
    const item=ledger[resolution.id];
    if (!item||addressed.has(resolution.id)||judged.has(resolution.id)||!['resolved','open'].includes(resolution.status)||!nonempty(resolution.evidence)) fail(`invalid or contradictory resolution for ${resolution.id}`);
    judged.add(resolution.id);
    // Confirmation is not a new repair judgment. Preserve the independently
    // recorded resolution, including its original evidence and history.
    if (item.status==='resolved'&&resolution.status==='resolved') continue;
    if (item.status==='resolved'&&resolution.status==='open'&&!nonempty(resolution.reopeningReason)) fail(`${resolution.id}: reopening requires a reason and current evidence`);
    const response=responses.find(r=>r.id===resolution.id);
    if (resolution.status==='resolved'&&blocking(item)&&(!response||response.disposition!=='addressed')) fail(`resolution ${resolution.id} lacks a complete repair response`);
    item.status=resolution.status; item.history.push({...resolution,round,artifactSha,kind:'judgment',response});
  }
  const unresolved=Object.values(ledger).filter(f=>f.status!=='resolved'&&blocking(f));
  for (const item of unresolved) if (!findings.some(f=>f.id===item.id)) findings.push({...item});
  return ledger;
}

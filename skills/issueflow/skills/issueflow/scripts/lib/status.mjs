/** Factual host presentation with a bounded heartbeat and stable milestones. */
import { hash } from './contracts.mjs';
import { runState } from './run.mjs';
import { openPlanFindings } from './plan-repair.mjs';
export function statusSnapshot(run,{now=new Date().toISOString(),action=null}={}) {
  const completed=[],remaining=[],unknown=[];
  for(const lane of run.lanes) {
    if(lane.verification?.complete)completed.push(`${lane.slug}: local verification at ${lane.verification.head}`);
    else remaining.push(`${lane.slug}: local verification`);
    if(lane.review?.converged)completed.push(`${lane.slug}: code review converged`);
    else remaining.push(`${lane.slug}: code review`);
    const ci=lane.ciDecision,observation=lane.ciObservation;
    if(ci&&observation&&observation.head===lane.verification?.head&&observation.baseRef===lane.base) {
      completed.push(`${lane.slug}: CI observed ${observation.observedAt}`);
      if(!ci.ready)remaining.push(...ci.blockers.map(reason=>`${lane.slug}: ${reason}`));
    } else unknown.push(`${lane.slug}: current remote CI`);
  }
  for(const finding of openPlanFindings(run))remaining.push(`${finding.id}: ${finding.text}`);
  for(const [id,item] of Object.entries(run.completion?.obligations??{}))if(item.observed)completed.push(`${id}: observed`);else remaining.push(id);
  const human=['authorization','human'].includes(action?.reason);
  const ciWait=action?.kind==='wait'&&(action.waitFor==='ci'||/: CI \(/.test(action.what??''));
  const state=human?'awaiting user':ciWait?'waiting for CI':action?.kind==='wait'?'waiting for worker':action?.kind==='stop'&&!['done','reviewed'].includes(action.reason)?'blocked':runState(run);
  return {schema:1,observedAt:now,state,completed,remaining,unknown,
    nextAction:action?.detail??action?.note??action?.command??'Run next for the current controller decision',
    actor:human?'user':ciWait?'CI provider':action?.kind==='wait'?'worker':'controller',
    elapsedSeconds:Math.max(0,(Date.parse(now)-Date.parse(run.createdAt))/1000)};
}
export function progressEvent(previous,snapshot,{heartbeatMs=60000}={}) {
  const {observedAt,elapsedSeconds,...semantic}=snapshot;
  const fingerprint=hash(semantic),now=Date.parse(observedAt);
  if(!previous||previous.fingerprint!==fingerprint)return {kind:'milestone',fingerprint,emittedAt:observedAt,snapshot};
  if(now-Date.parse(previous.emittedAt)>=heartbeatMs)return {kind:'heartbeat',fingerprint,emittedAt:observedAt,state:snapshot.state,elapsedSeconds,lastProgress:previous.snapshot?.nextAction??previous.lastProgress};
  return null;
}

/** Requested endpoint, user authority and provider observations are separate facts. */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { RunError, saveRun } from './run.mjs';
import { recordTelemetry } from './telemetry.mjs';
import { hash } from './contracts.mjs';
import { operation } from './operations.mjs';
import { apiRead, apiPages, apiWrite, observeCi } from './gh.mjs';
import { assertCiReady } from './readiness.mjs';
import { assertVerified } from './verification.mjs';
const endpoints=['reviewed-pr','merged','deployed'];
const fail=text=>{throw new RunError(`completion: ${text}`)};
export function completionIntent({endpoint='reviewed-pr',source=null,excluded=[],deployments=[],companions=[]}={}) {
  if(!endpoints.includes(endpoint)||!Array.isArray(excluded)||!Array.isArray(deployments)||!Array.isArray(companions))fail('invalid endpoint or obligations');
  for(const target of deployments)if(!target.service||!target.environment||target.adapter!=='github-deployments')fail('deployment requires service, environment and supported adapter');
  for(const target of companions)if(!target.repo||!Number.isSafeInteger(target.pr)||!target.head)fail('companion requires repository, PR number and exact reviewed head');
  return {schema:1,endpoint,source,excluded,deployments,companions,authorizations:[],obligations:{},state:'pending'};
}
export function recordAuthorization(run,{source,action,repo,pr=null,head=null,environment=null}) {
  if(!source?.trim()||!['ready','merge','deploy','close-issue','rewrite'].includes(action)||!repo?.trim())fail('record the existing user source, action and repository scope');
  if(run.completion.excluded.includes(action))fail(`${action} is explicitly excluded by the requested endpoint`);
  const entry={source,action,repo,pr,head,environment};
  if(!run.completion.authorizations.some(a=>hash(a)===hash(entry)))run.completion.authorizations.push(entry);
  return entry;
}
export function authorized(run,action,{repo,pr,head,environment}={}) {
  if(!run.completion||run.completion.excluded.includes(action))return false;
  return run.completion.authorizations.some(a=>a.action===action&&a.repo===repo&&(a.pr==null||a.pr===pr)&&(a.head==null||a.head===head)&&(a.environment==null||a.environment===environment));
}
export function completionPolicy(run) {
  const path=join(run.repo.path,'.issueflow/completion.json');
  if(!existsSync(path))return {schema:1,readyCanMerge:'unknown',source:null};
  const bytes=readFileSync(path),value=JSON.parse(bytes);
  if(value.schema!==1||typeof value.readyCanMerge!=='boolean'||!value.source?.trim())fail('invalid repository completion policy');
  return {...value,hash:hash(bytes),path};
}
export function assertReadyAuthority(run,lane,observation) {
  if(run.schema<5)return;
  if(run.completion?.excluded.includes('ready'))fail('lifting draft is excluded by the requested endpoint');
  const policy=completionPolicy(run);
  if(policy.readyCanMerge==='unknown')fail('repository readiness automation is unknown; record the applicable policy in .issueflow/completion.json before lifting draft');
  if(policy.readyCanMerge||observation?.autoMerge) {
    const repo=`${run.repo.owner}/${run.repo.name}`;
    if(!authorized(run,'merge',{repo,pr:lane.pr.number,head:lane.verification.head}))fail('ready can trigger merging; the concrete merge still needs user authority');
    // prReady has no conditional-head write. Reading back cannot undo an auto-merge.
    fail('ready-triggered merge has no server-enforced expected-head precondition; keep draft and use an adapter with a verified conditional merge capability');
  }
}
export function completionAction(run) {
  const intent=run.completion;if(!intent)return null;
  const urls=run.lanes.map(l=>l.pr?.url).filter(Boolean),repo=`${run.repo.owner}/${run.repo.name}`;
  if(intent.endpoint==='reviewed-pr'&&intent.companions.some(c=>!intent.obligations[`companion:${c.repo}:${c.pr}`]?.observed))return {kind:'stop',reason:'companion',detail:`Primary PR review is complete. Companion outcomes remain unverified: ${intent.companions.map(c=>`https://github.com/${c.repo}/pull/${c.pr}`).join(', ')}. Continue those obligations before claiming the full requested endpoint.`};
  if(intent.endpoint==='reviewed-pr'&&intent.state!=='complete')return {kind:'run',command:'completion',args:{},note:'record the observed review endpoint before declaring completion'};
  if(intent.endpoint==='reviewed-pr')return {kind:'stop',reason:'reviewed',detail:`Reviewed pull requests: ${urls.join(', ')}. Required checks and review receipts are recorded. ${intent.excluded.includes('merge')||intent.excluded.includes('ready')?'The requested draft/review endpoint is reached.':'Ready to merge these PRs and finish cleanup?'}`};
  if(intent.state==='complete')return !run.finished?{kind:'run',command:'finish',args:{},note:'endpoint observed; finish retained cleanup obligations'}:{kind:'stop',reason:'done',detail:`Requested ${intent.endpoint} endpoint observed; receipts retained.`};
  return {kind:'run',command:'completion',args:{},note:'reconcile the remaining authorized completion obligations'};
}
export const githubMergeAdapter={
  id:'github-merge',version:1,
  // REST merge accepts an expected head SHA but no expected base/policy identity.
  // https://docs.github.com/en/rest/pulls/pulls#merge-a-pull-request
  capabilities:{expectedHead:true,targetContext:false},
  observe(run,lane,expected){
    const p=apiRead(run.repo.path,`repos/${run.repo.owner}/${run.repo.name}/pulls/${lane.pr.number}`);
    if(p.head?.sha!==expected.head||p.base?.ref!==expected.base)fail('PR content or target changed during merge reconciliation');
    if(!p.merged)return null;
    if(!p.merge_commit_sha)fail('merged PR has no observed merge commit');
    return {repo:expected.repo,pr:lane.pr.number,head:p.head.sha,base:p.base.ref,commit:p.merge_commit_sha,mergedAt:p.merged_at};
  },
  submit(run,lane,expected,path){return apiWrite(run.repo.path,`repos/${run.repo.owner}/${run.repo.name}/pulls/${lane.pr.number}/merge`,'PUT',{sha:expected.head,merge_method:run.policy.mergeMethod??'squash'},path);}
};
export function completeRun(dir,run,{mergeAdapter=githubMergeAdapter}={}) {
  if(run.offline)fail('offline execution cannot observe remote completion');
  const intent=run.completion;if(!intent)fail('no persisted endpoint');
  if(intent.endpoint==='reviewed-pr') {
    for(const lane of run.lanes){assertVerified(dir,run,lane);if(!lane.review?.converged)fail('reviewed PR endpoint has unfinished code review');const observation=observeCi(run.repo.path,run.repo,lane.pr.number);assertCiReady({checks:observation.checks,expectedHead:lane.verification.head,observedHead:observation.head,expectedBase:lane.base,policy:run.harness.contract.ci,observation,epoch:lane.ciEpoch});}
    if(intent.companions.length)fail('companion review receipts remain unverified; retain those obligations');
    if(intent.state!=='complete')recordTelemetry(dir,run,'endpoint',{endpoint:intent.endpoint});
    intent.state='complete';intent.completedAt??=new Date().toISOString();saveRun(dir,run);return intent;
  }
  const repo=`${run.repo.owner}/${run.repo.name}`,storage=join(dir,'completion');mkdirSync(storage,{recursive:true});
  for(const lane of run.lanes) {
    const key=`merge:${lane.slug}`,prior=intent.obligations[key];if(prior?.observed)continue;
    const expected=prior?.expected??{repo,pr:lane.pr.number,head:lane.verification?.head,base:lane.base,adapter:mergeAdapter.id,version:mergeAdapter.version};
    if(!expected.head)fail('merge lacks an exact reviewed head');
    // Read first: user-performed merges and lost responses can be reconciled without a new write.
    const already=mergeAdapter.observe(run,lane,expected);
    if(already){operation(dir,run,{kind:'merge',target:lane.pr.url,intent:expected,read:()=>already,write:()=>fail('unexpected merge write')});intent.obligations[key]={expected,observed:already};saveRun(dir,run);continue;}
    if(!authorized(run,'merge',expected))fail(`merge authority is missing for ${lane.pr.url}`);
    assertVerified(dir,run,lane);
    if(!lane.review?.converged)fail('current code review has not converged');
    if(!mergeAdapter.capabilities.expectedHead||!mergeAdapter.capabilities.targetContext)fail(`${mergeAdapter.id} cannot atomically enforce the reviewed target context; merge is pending and the verified PR remains available`);
    const observation=observeCi(run.repo.path,run.repo,lane.pr.number);
    const ci=assertCiReady({checks:observation.checks,expectedHead:expected.head,observedHead:observation.head,expectedBase:expected.base,policy:run.harness.contract.ci,observation,epoch:lane.ciEpoch});
    expected.policyHash=ci.policyHash;
    intent.obligations[key]={expected,state:'submitted-or-uncertain'};saveRun(dir,run);
    const observed=operation(dir,run,{kind:'merge',target:lane.pr.url,intent:expected,retrySafe:false,read:()=>mergeAdapter.observe(run,lane,expected),write:()=>mergeAdapter.submit(run,lane,expected,join(storage,`merge-${randomUUID()}.json`))});
    intent.obligations[key]={expected,observed};saveRun(dir,run);
  }
  for(const companion of intent.companions) {
    const p=apiRead(run.repo.path,`repos/${companion.repo}/pulls/${companion.pr}`);
    if(!p.merged||p.head?.sha!==companion.head||!p.merge_commit_sha)fail(`companion ${companion.repo}#${companion.pr} has not landed the reviewed head`);
    intent.obligations[`companion:${companion.repo}:${companion.pr}`]={observed:{head:p.head.sha,commit:p.merge_commit_sha}};saveRun(dir,run);
  }
  if(intent.endpoint==='deployed') {
    if(!intent.deployments.length)fail('deployment target is missing; name service/environment before claiming the endpoint');
    for(const target of intent.deployments) {
      const lane=run.lanes.find(l=>l.slug===(target.lane??'root'));
      const commit=intent.obligations[`merge:${lane?.slug}`]?.observed.commit;if(!commit)fail('deployment has no observed landing commit');
      const expected={repo,commit,service:target.service,environment:target.environment,adapter:target.adapter,version:1};
      const key=`deploy:${target.service}:${target.environment}`;
      const observe=()=>{
        const deployments=apiPages(run.repo.path,`repos/${repo}/deployments?sha=${commit}&environment=${encodeURIComponent(target.environment)}&per_page=100`)
          .filter(d=>d.sha===commit&&d.environment===target.environment&&d.task===`deploy:${target.service}`);
        if(deployments.length>1)fail('multiple matching deployments; reconcile provider operation identity');
        if(!deployments.length)return null;
        const deployment=deployments[0],statuses=apiPages(run.repo.path,`repos/${repo}/deployments/${deployment.id}/statuses?per_page=100`).sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at));
        if(statuses[0]?.state!=='success')fail(`deployment ${deployment.id} is ${statuses[0]?.state??'pending'}; merge receipts retained`);
        return {...expected,id:deployment.id,statusId:statuses[0].id,url:statuses[0].environment_url,observedAt:new Date().toISOString()};
      };
      const existing=observe();if(existing){operation(dir,run,{kind:'deploy',target:`${repo}/${target.service}/${target.environment}`,intent:expected,read:()=>existing,write:()=>fail('unexpected deployment write')});intent.obligations[key]={expected,observed:existing};saveRun(dir,run);continue;}
      if(!authorized(run,'deploy',{repo,environment:target.environment,head:commit}))fail(`deployment authority is missing for ${target.service}/${target.environment}`);
      const observed=operation(dir,run,{kind:'deploy',target:`${repo}/${target.service}/${target.environment}`,intent:expected,retrySafe:false,read:observe,
        write:()=>apiWrite(run.repo.path,`repos/${repo}/deployments`,'POST',{ref:commit,environment:target.environment,task:`deploy:${target.service}`,auto_merge:false},join(storage,`deploy-${randomUUID()}.json`))});
      intent.obligations[key]={expected,observed};saveRun(dir,run);
    }
  }
  recordTelemetry(dir,run,'endpoint');intent.state='complete';intent.completedAt=new Date().toISOString();saveRun(dir,run);return intent;
}

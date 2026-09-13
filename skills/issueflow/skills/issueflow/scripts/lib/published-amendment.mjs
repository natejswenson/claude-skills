/** Review a proposed published-plan delta before changing its live contract. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import { RunError, artifactPath, findStep, laneTree, saveRun } from './run.mjs';
import { activeRoot, approveArtifact, gitStore, prepareOutputs, readDelivery, recordDispatch } from './execution.mjs';
import { contractFromPlan, gitText, hash, checkScope, contractForLane } from './contracts.mjs';
import { assertPreflight } from './preflight.mjs';
import { budgetStatus } from './budget.mjs';
import { MAX_ROUNDS, MAX_TOTAL_ROUNDS, parseFindings, deriveVerdict, resolveCitation } from './reviews.mjs';
import { operation } from './operations.mjs';
import { apiRead, apiWrite } from './gh.mjs';
import { assertRepairComplete, reconcilePlanFindings } from './plan-repair.mjs';
const fail=s=>{throw new RunError(`published amendment: ${s}`)};
const proposalHash=e=>hash({planHash:e.planHash,contractHash:e.contractHash,previousContractHash:e.previousContractHash,lanes:e.lanes,reason:e.reason,authoritySource:e.authoritySource,rewriteAuthoritySource:e.rewriteAuthoritySource});
const remotePath=(run,lane)=>`repos/${run.repo.owner}/${run.repo.name}/pulls/${lane.pr.number}`;
export function amendmentCapacity(run) {
  const budget=budgetStatus(run);
  if (budget?.expired) fail('time window expired; resume within the existing cumulative cap before proposing changes');
  const review=findStep(run,'investigate').stage.review;
  const count=review?.rounds.length??0;
  if(run.lanes.some(l=>l.review?.rounds?.length >= (l.review.maxRounds??3)))fail('cumulative code-review capacity is exhausted; retain the proposed delta');
  if (count>=MAX_TOTAL_ROUNDS || count>=MAX_ROUNDS && !review?.overrides?.some(o=>o.round===count+1)) fail('cumulative plan-review capacity is exhausted; retain the delta without applying it');
}
function eligible(run,workersReleased) {
  if (run.schema<5 || !run.harness?.contract) fail('explicit schema-5 migration and an approved contract are required');
  if (run.finished||run.lanes.some(l=>l.landed)) fail('partially landed work needs a separate follow-up scope');
  if (!workersReleased||run.dispatch?.queue) fail('observe and drain every native writer first');
  if (Object.values(run.operations??{}).some(o=>o.state!=='confirmed')) fail('reconcile uncertain remote effects first');
}
export function proposePublishedAmendment(dir,run,{plan,reason,authoritySource,workersReleased,base=null,strategy='target-only',rewriteAuthoritySource=null}) {
  eligible(run,workersReleased); amendmentCapacity(run);
  if (!reason?.trim()||!authoritySource?.trim()) fail('reason and existing user authority source are required; a flag cannot create authority');
  if (run.harness.publishedAmendment && !['applied','blocked'].includes(run.harness.publishedAmendment.phase)) fail('finish or resolve the existing amendment first');
  const proposed=contractFromPlan(plan),id=randomUUID(),archive=join(dir,'evolution',id);
  const lanes=[];
  const pending=[...run.lanes];
  while(pending.length) {
    const index=pending.findIndex(l=>!run.lanes.some(p=>p.branch===l.base)||lanes.some(c=>run.lanes.find(p=>p.slug===c.slug)?.branch===l.base));
    if(index<0)fail("cyclic lane bases prevent retargeting");
    const lane=pending.splice(index,1)[0];
    const parent=run.lanes.find(p=>p.branch===lane.base),parentChange=parent?lanes.find(c=>c.slug===parent.slug):null;
    const tree=laneTree(dir,run,lane),head=gitText(tree,'rev-parse','HEAD');
    if (gitText(tree,'status','--porcelain','--untracked-files=all')) fail(`preserve dirty work in ${tree} before amendment`);
    let view=null;
    if (lane.pr&&!run.offline) {view=apiRead(run.repo.path,remotePath(run,lane));if(view.merged||view.state!=='open'||view.head?.sha!==head)fail('PR head or landing state changed');}
    const target=parent?lane.base:(base??lane.base); let baseSha=run.harness.bases[lane.slug],candidateHead=head,candidateTree=tree;
    if (base) {
      const store=gitStore(dir,run); gitText(store,'check-ref-format',`refs/heads/${target}`);
      if (!parent && !run.offline) gitText(store,'fetch','--quiet','origin',`+refs/heads/${base}:refs/remotes/origin/${base}`);
      baseSha=parentChange?.candidateHead??gitText(store,'rev-parse',`${run.offline?target:'refs/remotes/origin/'+target}^{commit}`);
      if (!['target-only','merge','rebase'].includes(strategy)) fail('strategy must be target-only, merge or rebase');
      if (strategy==='rebase'&&!rewriteAuthoritySource?.trim()) fail('reviewable rewrite authority source is required before preparing history changes');
      if (strategy!=='target-only') {
        candidateTree=join(run.execution?.path??dir,'retargets',id,lane.slug); mkdirSync(join(candidateTree,'..'),{recursive:true});
        gitText(store,'worktree','add','--detach',candidateTree,head);
        try {
          if(strategy==='merge')gitText(candidateTree,'merge','--no-edit',baseSha);
          else gitText(candidateTree,'rebase','--onto',baseSha,run.harness.bases[lane.slug]);
        } catch(error) {fail(`Git transition needs conflict resolution at ${candidateTree}; previous lane preserved: ${error.message}`)}
        candidateHead=gitText(candidateTree,'rev-parse','HEAD');
        run.auxiliaryTrees??=[];run.auxiliaryTrees.push({path:candidateTree,head:candidateHead,kind:'retarget'});
      }
      checkScope(candidateTree,baseSha,candidateHead,contractForLane(proposed,lane.slug));
    }
    assertPreflight(candidateTree,proposed,{planText:plan});
    lanes.push({slug:lane.slug,head,remoteHead:view?.head.sha??head,oldBase:lane.base,oldBaseSha:run.harness.bases[lane.slug],target,baseSha,candidateHead,candidateTree,strategy});
  }
  mkdirSync(archive,{recursive:true});writeFileSync(join(archive,'run.json'),JSON.stringify(run,null,2),{flag:'wx'});
  writeFileSync(join(archive,'plan.md'),plan,{flag:'wx'});
  const entry={id,phase:'proposed',archive,planHash:hash(plan),contract:proposed,contractHash:hash(proposed),previousContract:run.harness.contract,previousContractHash:run.harness.contractHash,lanes,reason,authoritySource,rewriteAuthoritySource,createdAt:new Date().toISOString()};
  entry.proposalHash=proposalHash(entry);
  run.harness.amendments.push(entry);run.harness.publishedAmendment=entry;saveRun(dir,run);return entry;
}
export function briefPublishedAmendment(dir,run) {
  const entry=run.harness.publishedAmendment;if(entry?.phase!=='proposed')fail('no proposed amendment');amendmentCapacity(run);
  const root=join(activeRoot(dir,run),'amendments',entry.id),brief=join(root,'review.md'),output=join(root,'review.json');
  prepareOutputs(dir,run,[brief,output]);
  writeFileSync(brief,`Independently review this proposed change before it is applied. Read ${join(entry.archive,'plan.md')} and ${join(entry.archive,'run.json')}. Inspect the current/candidate trees listed below. Validate every added path, check, Git transition, unresolved finding and authorization scope. Do not mutate repository/state.\n\n${JSON.stringify(entry.lanes,null,2)}\n\nPrior findings: ${JSON.stringify(run.harness.planFindings??{})}\nReturn findings, notExamined, verdict and resolutions in the normal plan-review JSON format, plus proposalHash ${entry.proposalHash}. Cite exact sources. Write only ${output}. Complete your attempt manifest when done.\n`);
  recordDispatch(dir,run,brief,[output]);entry.review={brief,output};entry.phase='reviewing';saveRun(dir,run);return {brief,output};
}
export function registerPublishedAmendment(dir,run) {
  const entry=run.harness.publishedAmendment;if(entry?.phase!=='reviewing')fail('no amendment review in flight');
  const text=readDelivery(dir,entry.review.output,run),raw=JSON.parse(text),review=parseFindings(text);
  if(review.error||raw.proposalHash!==entry.proposalHash||proposalHash(entry)!==entry.proposalHash)fail(review.error??'review names another proposal');
  const plan=readFileSync(join(entry.archive,'plan.md'),'utf8');if(hash(plan)!==entry.planHash)fail('proposal changed after dispatch');
  if(!review.findings.length&&!review.notExamined.length)fail('empty review coverage');
  for(const f of review.findings)if(!resolveCitation(f.cite,{roots:[entry.archive,...entry.lanes.map(l=>l.candidateTree)],artifactText:plan}).ok)fail(`unresolved citation ${f.cite}`);
  const step=findStep(run,'investigate'),round=step.stage.review.rounds.length+1;
  const ledger=reconcilePlanFindings(run,review.findings,review.resolutions??[],{round,artifactSha:entry.planHash,responses:assertRepairComplete(run,plan)});
  const verdict=deriveVerdict(review.findings);if(verdict!==review.verdict)fail('review verdict disagrees with findings');
  step.stage.review.rounds.push({round,verdict,artifactSha:entry.planHash,items:review.findings,findings:Object.fromEntries(['critical','high','medium','low'].map(s=>[s,review.findings.filter(f=>f.severity===s).length])),dispositions:Object.fromEntries(['fixable','accepted-risk','out-of-scope'].map(d=>[d,review.findings.filter(f=>f.disposition===d).length])),notExamined:review.notExamined,amendment:entry.id,at:new Date().toISOString()});
  run.harness.planFindings=ledger;entry.phase=verdict==='pass'?'reviewed':'blocked';entry.review.verdict=verdict;entry.review.hash=hash(text);saveRun(dir,run);return entry;
}
export function applyPublishedAmendment(dir,run,{workersReleased}) {
  const entry=run.harness.publishedAmendment;
  if(!entry||!['reviewed','applying'].includes(entry.phase))fail('a passing independent review is required before application');
  if(!workersReleased||run.dispatch?.queue)fail('observe reviewer termination before applying');
  if(budgetStatus(run)?.expired)fail('time window exhausted; delta retained without resetting the budget');
  if(proposalHash(entry)!==entry.proposalHash||hash(readFileSync(join(entry.archive,'plan.md'),'utf8'))!==entry.planHash || hash(readFileSync(entry.review.output))!==entry.review.hash)fail('review/proposal bytes changed');
  entry.phase='applying';saveRun(dir,run);
  for(const change of entry.lanes) {
    const lane=run.lanes.find(l=>l.slug===change.slug),tree=laneTree(dir,run,lane);
    if (![change.head,change.candidateHead].includes(gitText(tree,'rev-parse','HEAD')))fail('lane head changed during amendment');
    if (gitText(tree,'status','--porcelain','--untracked-files=all')) fail('lane acquired dirty work before application; preserve it first');
    gitText(gitStore(dir,run),'update-ref',`refs/issueflow/amendments/${entry.id}/${lane.slug}`,change.head);
    if(change.candidateHead!==change.head) {
      if(!run.offline) operation(dir,run,{kind:'retarget-push',target:lane.pr.url,intent:change,retrySafe:false,
        read:()=>{const p=apiRead(run.repo.path,remotePath(run,lane));if(p.head.sha===change.candidateHead)return {head:p.head.sha};if(p.head.sha!==change.remoteHead)fail('remote advanced before retarget push');return null;},
        write:()=>gitText(gitStore(dir,run),'push',`--force-with-lease=refs/heads/${lane.branch}:${change.remoteHead}`,'origin',`${change.candidateHead}:refs/heads/${lane.branch}`)});
      // Both tips are retained in the amendment archive and remote journal.
      gitText(tree,'reset','--hard',change.candidateHead);
    }
    if(lane.pr&&!run.offline&&change.target!==change.oldBase) operation(dir,run,{kind:'retarget-base',target:lane.pr.url,intent:{head:change.candidateHead,base:change.target},retrySafe:true,
      read:()=>{const p=apiRead(run.repo.path,remotePath(run,lane));if(p.head.sha!==change.candidateHead)fail('remote head changed before base update');if(p.base.ref===change.target)return {head:p.head.sha,base:p.base.ref};if(p.base.ref!==change.oldBase)fail('remote base changed unexpectedly');return null;},
      write:()=>apiWrite(run.repo.path,remotePath(run,lane),'PATCH',{base:change.target},join(entry.archive,`base-${lane.slug}-${randomUUID()}.json`))});
    lane.base=change.target;run.harness.bases[lane.slug]=change.baseSha;lane.ciEpoch=new Date().toISOString();
    delete lane.verification;delete lane.ciDecision;delete lane.ciObservation;
    lane.review.converged=false;for(const round of lane.review.rounds??[])round.supersededBy??=entry.id;
    for(const stage of lane.stages){stage.state='pending';stage.at={};delete stage.verificationBatch;delete stage.result;}
  }
  const rootChange=entry.lanes.find(change=>change.oldBase===run.policy.base && change.target!==change.oldBase);
  if (rootChange) {run.policy.base=rootChange.target;run.repositorySnapshot={...run.repositorySnapshot,ref:rootChange.target,sha:rootChange.baseSha,policyHash:hash(run.policy),observedAt:entry.createdAt};if(run.initialization)run.initialization.policyHash=hash(run.policy);}
  run.harness.attemptHistory??=[];
  for(const attempt of new Set(Object.values(run.harness.attempts??{})))run.harness.attemptHistory.push({...attempt,state:'superseded',amendment:entry.id});
  run.harness.attempts={};run.harness.contract=entry.contract;run.harness.contractHash=entry.contractHash;
  const planStep=findStep(run,'investigate'),artifact=artifactPath(dir,planStep);
  writeFileSync(artifact,readFileSync(join(entry.archive,'plan.md')));
  if(run.execution?.approved)delete run.execution.approved[relative(activeRoot(dir,run),artifact)];
  planStep.stage.state='approved';
  entry.phase='applied';entry.appliedAt=new Date().toISOString();saveRun(dir,run);
  approveArtifact(dir,run,artifact);saveRun(dir,run);return entry;
}

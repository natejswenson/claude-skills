/** Explicit plan evolution: retain evidence, reopen gates, never renew a budget. */
import { initializeRecord } from './initialization.mjs';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { artifactPath, gateSteps, laneTree, RunError, saveRun, SCHEMA } from './run.mjs';
import { gitStore } from './execution.mjs';
import { allowsPath, gitText, hash } from './contracts.mjs';
import { freezeRepository } from './repository.mjs';
import { reconcilePlanFindings } from './plan-repair.mjs';

export function authorizeAmendment(run, proposed) {
  const pending = run.harness?.pendingAmendment;
  if (!pending?.previousContract) return;
  const old = pending.previousContract;
  const expands = hash(old.criteria) !== hash(proposed.criteria) ||
    proposed.allowedPaths.some((p) => !allowsPath(old.allowedPaths, p)) ||
    (old.ci?.mode !== 'none' && proposed.ci?.mode === 'none');
  if (expands && !pending.authorityNote) throw new RunError('amendment changes objective, scope, or CI authority; explicit user direction recorded with amend --authority-note is required');
}

export function evolveRun(dir, run, { kind, reason, workersReleased, authorityNote = null, controller = {} }) {
  if (!['amend', 'migrate'].includes(kind)) throw new RunError('unknown evolution operation');
  if (!workersReleased || typeof reason !== 'string' || !reason.trim()) throw new RunError('evolution requires --workers-released and --reason after all native writers are terminal');
  if (authorityNote != null && (typeof authorityNote !== 'string' || !authorityNote.trim())) throw new RunError('authority-note must record explicit user direction, not a bare flag');
  if (run.finished || run.lanes.some((l) => l.landed)) throw new RunError('completed/partially landed runs remain historical; start a separately authorized run');
  if (run.dispatch?.queue) throw new RunError('cancel or drain the active wave before evolution');
  if (kind === 'migrate' && run.schema >= SCHEMA) throw new RunError('run already uses the current schema');
  if (kind === 'amend' && run.harness?.pendingAmendment && authorityNote) {
    const pending = run.harness.pendingAmendment;
    pending.authorityNote = authorityNote;
    run.harness.amendments.find((a) => a.id === pending.id).authorityNote = authorityNote;
    saveRun(dir, run); return pending;
  }
  if (kind === 'amend' && !run.harness?.contract) throw new RunError('amend requires an approved strict contract');
  if (Object.values(run.operations ?? {}).some((o) => o.state !== 'confirmed')) throw new RunError('reconcile pending remote effects before evolving the plan');
  // Preserve posted review semantics; amending these requires a new issue/run,
  // not changing criteria under already-published findings.
  if (kind !== 'migrate' && run.lanes.some((l) => l.pr)) throw new RunError('plan evolution is pre-PR only; retain published review history and start a separately authorized follow-up');
  let frozenIssue;
  if(kind==='migrate'){try{frozenIssue=JSON.parse(readFileSync(join(dir,'inputs/issue.json'),'utf8'))}catch{throw new RunError('migration needs the original frozen issue input; recover it before upgrading')}if(frozenIssue.number!==run.issue.number)throw new RunError('frozen migration issue differs from the run');}
  let selection=null;
  if(controller.base!=null) {
    if(kind!=='migrate'||run.lanes.length!==1||run.harness?.contract||run.lanes.some(l=>l.pr||l.stages.some(s=>s.at?.briefed||s.state!=='pending')))throw new RunError('migration base selection is only available before implementation; retain existing work and use a reviewed retarget');
    if(!controller.authoritySource?.trim())throw new RunError('migration --base requires --authority-source recording the existing user choice');
    const policy={...run.policy,base:controller.base};
    selection={...run,policy,repositorySnapshot:null,harness:{bases:{}},lanes:run.lanes.map(l=>({...l,base:policy.base}))};
    freezeRepository(selection,{policyFromSelectedBase:true});
    const store=gitStore(dir,run);
    if(store!==run.repo.path)gitText(store,'fetch','--quiet',run.repo.path,selection.repositorySnapshot.sha);
  }
  const bases = { ...(selection?.harness.bases??run.harness?.bases) };
  for (const lane of run.lanes) {
    bases[lane.slug] ??= gitText(gitStore(dir, run), 'rev-parse', `${lane.base}^{commit}`);
    if (lane.stages.some((s) => s.at?.briefed)) {
      const tree = laneTree(dir, run, lane);
      if (gitText(tree, 'status', '--porcelain', '--untracked-files=all')) throw new RunError('commit or preserve dirty work before evolution; no files were discarded');
    }
  }
  const id = randomUUID(); const archive = join(dir, 'evolution', id);
  mkdirSync(archive, { recursive: true });
  const state = JSON.stringify(run, null, 2);
  writeFileSync(join(archive, 'run.json'), state, { flag: 'wx' });
  const artifacts = [];
  for (const step of gateSteps(run)) {
    const path = artifactPath(dir, step);
    if (!existsSync(path)) continue;
    const bytes = readFileSync(path); const name = `${artifacts.length}-${hash(bytes)}.md`;
    writeFileSync(join(archive, name), bytes, { flag: 'wx' });
    artifacts.push({ source: path, archive: name, hash: hash(bytes) });
  }
  const previousContract = run.harness?.contract ?? null;
  const record = { id, kind, reason: reason.trim(), authorityNote, at: new Date().toISOString(), archive, stateHash: hash(state), artifacts, previousContract };
  if(selection) {
    record.baseTransition={previousPolicy:run.policy,previousBases:run.harness?.bases??{},policy:selection.policy,sha:selection.repositorySnapshot.sha,authoritySource:controller.authoritySource};
    run.policy=selection.policy;run.repositorySnapshot=selection.repositorySnapshot;
    for(const lane of run.lanes)lane.base=selection.policy.base;
  }
  run.schema = SCHEMA;
  if (run.harness) run.harness.version = 2;
  run.harness ??= { version: 2, contract: null, contractHash: null, bases: {}, amendments: [] };
  if(kind==='migrate'){
    const prior=run.stages.find(s=>s.id==='investigate')?.review?.rounds?.at(-1);
    if(!run.harness.planFindings&&prior?.verdict==='blocked')run.harness.planFindings=reconcilePlanFindings(run,structuredClone(prior.items??[]),[],{round:prior.round,artifactSha:prior.artifactSha});
    initializeRecord(run,frozenIssue,controller);run.initialization.phase='active';run.initialization.completed=['inputs'];
    const lane=run.lanes.find(l=>l.base===run.policy.base)??run.lanes[0];
    run.repositorySnapshot??={repository:`${run.repo.owner}/${run.repo.name}`,ref:run.policy.base,sha:bases[lane.slug],policyHash:hash(run.policy),policySources:[],observedAt:record.at,offline:run.offline};
  }
  run.harness.amendments.push(record);
  run.harness.pendingAmendment = record;
  run.harness.bases = bases;
  run.harness.contract = null; run.harness.contractHash = null;
  run.harness.attemptHistory ??= [];
  for (const attempt of new Set(Object.values(run.harness.attempts ?? {}))) run.harness.attemptHistory.push({ ...attempt, state: 'superseded', evolution: id });
  run.harness.attempts = {};
  for (const step of gateSteps(run)) {
    step.stage.state = 'pending'; step.stage.at = {};
    delete step.stage.verificationBatch; delete step.stage.result; delete step.stage.autoApproved;
    // Keep cumulative review limits and reviews. The next round binds new bytes.
    if (step.stage.review) {
      delete step.stage.review.briefed;
      delete step.stage.review.feedback;
      for (const round of step.stage.review.rounds) round.supersededBy ??= id;
    }
  }
  for (const lane of run.lanes) { delete lane.verification; delete lane.ciObservation; delete lane.ciDecision; if(lane.review){lane.review.converged=false;for(const round of lane.review.rounds??[])round.supersededBy??=id;} }
  saveRun(dir, run);
  return record;
}

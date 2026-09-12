/** Explicit plan evolution: retain evidence, reopen gates, never renew a budget. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { artifactPath, gateSteps, laneTree, RunError, saveRun, SCHEMA } from './run.mjs';
import { gitStore } from './execution.mjs';
import { allowsPath, gitText, hash } from './contracts.mjs';

export function authorizeAmendment(run, proposed) {
  const pending = run.harness?.pendingAmendment;
  if (!pending?.previousContract) return;
  const old = pending.previousContract;
  const expands = hash(old.criteria) !== hash(proposed.criteria) ||
    proposed.allowedPaths.some((p) => !allowsPath(old.allowedPaths, p)) ||
    (old.ci?.mode !== 'none' && proposed.ci?.mode === 'none');
  if (expands && !pending.authorityNote) throw new RunError('amendment changes objective, scope, or CI authority; explicit user direction recorded with amend --authority-note is required');
}

export function evolveRun(dir, run, { kind, reason, workersReleased, authorityNote = null }) {
  if (!['amend', 'migrate'].includes(kind)) throw new RunError('unknown evolution operation');
  if (!workersReleased || typeof reason !== 'string' || !reason.trim()) throw new RunError('evolution requires --workers-released and --reason after all native writers are terminal');
  if (authorityNote != null && (typeof authorityNote !== 'string' || !authorityNote.trim())) throw new RunError('authority-note must record explicit user direction, not a bare flag');
  if (run.finished || run.lanes.some((l) => l.landed)) throw new RunError('completed/partially landed runs remain historical; start a separately authorized run');
  if (run.dispatch?.queue) throw new RunError('cancel or drain the active wave before evolution');
  if (kind === 'migrate' && run.harness) throw new RunError('run already uses strict evidence');
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
  if (run.lanes.some((l) => l.pr)) throw new RunError('plan evolution is pre-PR only; retain published review history and start a separately authorized follow-up');
  const bases = { ...run.harness?.bases };
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
  run.schema = SCHEMA;
  run.harness ??= { version: 1, contract: null, contractHash: null, bases: {}, amendments: [] };
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
  for (const lane of run.lanes) delete lane.verification;
  saveRun(dir, run);
  return record;
}

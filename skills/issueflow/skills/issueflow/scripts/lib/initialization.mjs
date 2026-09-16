/** Durable initialization identity is distinct from a short command lease. */
import { initializeApprovedSpec } from './approved-spec.mjs';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { completionIntent } from './completion.mjs';
import { hash } from './contracts.mjs';
import { WorktreeError } from './worktree.mjs';
import { RunError, saveRun } from './run.mjs';
import { prepareCheckout, prepareExecution } from './execution.mjs';

const session = (args) => args.sessionId ?? process.env.ISSUEFLOW_SESSION_ID ?? process.env.CODEX_THREAD_ID ?? process.env.CLAUDE_SESSION_ID;
function credential(args, create = false) {
  const id = args.continuationFile || process.env.ISSUEFLOW_CONTINUATION_FILE ? null : session(args);
  if (id) return { kind: 'session', digest: hash(String(id)) };
  let path = args.continuationFile ?? process.env.ISSUEFLOW_CONTINUATION_FILE;
  if (!path && create) {
    path = join(mkdtempSync(join(tmpdir(), 'issueflow-controller-')), 'continuation');
    writeFileSync(path, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
    args.continuationFile = path;
    console.log(`Controller continuation: pass --continuation-file ${JSON.stringify(path)} on later commands.`);
  }
  if (!path) throw new RunError('controller session is unavailable; supply the original --continuation-file or recover ownership explicitly');
  return { kind: 'token', digest: hash(readFileSync(resolve(path))) };
}
export function assertControllerOwner(run, args = {}) {
  const owner = run.initialization?.owner;
  if (!owner) return; // Schema 3/4 retain their original continuation behavior.
  const observed = credential(args);
  if (owner.kind !== observed.kind || owner.digest !== observed.digest) throw new RunError('another controller session owns this run; retain its state and use an explicit ownership recovery decision');
  if (args.expectedRevision != null && Number(args.expectedRevision) !== (run.revision ?? 0)) throw new RunError('stale expected run revision; reload before changing state');
}
export function initializeRecord(run, issue, args) {
  run.completion=completionIntent(args.completionIntent?JSON.parse(readFileSync(args.completionIntent,'utf8')):{endpoint:args.endpoint??'reviewed-pr',source:args.intentSource??null});
  run.initialization = { phase: 'initializing', owner: credential(args, true),
    issue, issueHash: hash(issue), policyHash: hash(run.policy), completed: [],
    noWorktree: Boolean(args.noWorktree), workspaceRoot: args.workspaceRoot ? resolve(args.workspaceRoot) : null,
    checkpoint: run.offline ? 'offline' : 'pending' };
}
function completed(dir, run, step) {
  if (!run.initialization.completed.includes(step)) run.initialization.completed.push(step);
  saveRun(dir, run);
  // Explicit diagnostic fault point: only initialization uses this environment variable.
  if (process.env.ISSUEFLOW_INIT_FAIL_AFTER === step) throw new RunError(`injected initialization failure after ${step}; resume start with the same controller identity`);
}
function resumeSteps(dir, run, args = {}) {
  assertControllerOwner(run, args);
  const init = run.initialization;
  if (!init || init.phase === 'active') return run;
  if (hash(init.issue) !== init.issueHash || hash(run.policy) !== init.policyHash) throw new RunError('initialization input identity changed; recover the frozen inputs');
  mkdirSync(join(dir, 'inputs'), { recursive: true });
  const path = join(dir, 'inputs/issue.json');
  if (existsSync(path)) {
    if (hash(JSON.parse(readFileSync(path, 'utf8'))) !== init.issueHash) throw new RunError('frozen issue differs from initialization claim');
  } else {
    const pending = path + '.pending';
    writeFileSync(pending, JSON.stringify(init.issue, null, 2) + '\n'); renameSync(pending, path);
  }
  completed(dir, run, 'inputs');
  const workspaceRoot = args.workspaceRoot ?? init.workspaceRoot;
  if (workspaceRoot) prepareExecution(dir, run, { workspaceRoot });
  if (init.noWorktree) prepareCheckout(dir, run, run.lanes[0], { ...args, reserve: true });
  completed(dir, run, 'execution');
  initializeApprovedSpec(dir, run);
  if (run.approvedSpec) completed(dir, run, 'approved-spec');
  run.initialization.phase = 'active'; delete run.initialization.lastError;
  completed(dir, run, 'active');
  return run;
}
export function initializationProblems(dir, run) {
  if (!run.initialization) return [];
  const problems = [];
  if (run.initialization.phase !== 'active') problems.push('initialization incomplete: resume start with the original controller identity');
  try {
    const issue = JSON.parse(readFileSync(join(dir, 'inputs/issue.json'), 'utf8'));
    if (hash(issue) !== run.initialization.issueHash) problems.push('frozen issue identity differs from the initialization claim');
  } catch { problems.push('missing or unreadable frozen issue input'); }
  if (hash(run.policy) !== run.initialization.policyHash) problems.push('repository policy changed outside a reviewed amendment');
  return problems;
}

export function resumeInitialization(dir, run, args = {}) {
  try { return resumeSteps(dir, run, args); }
  catch (error) {
    if (error.code) throw new WorktreeError(`initialization infrastructure: ${error.code}; frozen inputs retained, resume start with the same controller identity`);
    throw error;
  }
}

/** Explicit recovery transfers coordination ownership; it cannot release a native worker. */
export function recoverOwner(dir,run,args) {
  if(!args.authoritySource?.trim()||!args.workersReleased||Number(args.expectedRevision)!==run.revision)throw new RunError('ownership recovery requires the existing user decision, observed worker release and current --expected-revision');
  if(run.dispatch?.queue||Object.values(run.operations??{}).some(o=>o.state!=='confirmed'))throw new RunError('drain workers and reconcile uncertain operations before ownership recovery');
  const previous=run.initialization?.owner;if(!previous)throw new RunError('legacy runs retain their original ownership semantics');
  run.initialization.ownerHistory??=[];run.initialization.ownerHistory.push({previous,source:args.authoritySource,revision:run.revision,at:new Date().toISOString()});
  run.initialization.owner=credential(args,true);saveRun(dir,run);return run.initialization.owner;
}

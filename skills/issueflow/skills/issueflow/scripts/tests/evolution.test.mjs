import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRun, loadRun, saveRun, artifactPath, findStep } from '../lib/run.mjs';
import { evolveRun, authorizeAmendment } from '../lib/evolution.mjs';
import { contractForLane, validateContract, hash } from '../lib/contracts.mjs';
import { approvePlan } from './helpers.mjs';
import { decide } from '../lib/next.mjs';
import { latestRound, nextRound } from '../lib/reviews.mjs';
import { renderBrief } from '../lib/brief.mjs';

const contract = { schema: 1, risk: 'docs', criteria: [{ id: 'D1', description: 'docs accurate' }], nonGoals: [], allowedPaths: ['README.md'], checks: [{ id: 'docs', type: 'command', argv: ['node', '--version'], criteria: ['D1'] }] };
function fixture(t, strict = false) {
  const root = mkdtempSync(join(tmpdir(), 'issueflow-evolution-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, 'repo'); mkdirSync(repo); const dir = join(root, 'run');
  execFileSync('git', ['init', '-qb', 'main'], { cwd: repo });
  writeFileSync(join(repo, 'README.md'), 'old docs');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'base'], { cwd: repo });
  const run = createRun({ strict, repo: { path: repo, owner: 'test', name: 'docs' }, issue: { number: 1, title: 'Fix docs' }, policy: { base: 'main' }, offline: true, auto: true });
  saveRun(dir, run); mkdirSync(join(dir, 'inputs'), { recursive: true });
  writeFileSync(join(dir, 'inputs', 'issue.json'), JSON.stringify({ number: 1, title: 'Fix docs', body: 'Keep the documentation accurate.' }));
  approvePlan(dir, run, { auto: true });
  return { dir, run, repo };
}

test('legacy migration is explicit, preserves history and caps, and never invents strict approval', (t) => {
  const f = fixture(t); const old = JSON.stringify(f.run); const bytes = readFileSync(artifactPath(f.dir, { run: f.run, stage: f.run.stages[0] }));
  const cli = fileURLToPath(new URL('../issueflow.js', import.meta.url));
  const invoke = (...args) => spawnSync(process.execPath, [cli, 'migrate-run', '--run-dir', f.dir, ...args], { encoding: 'utf8' });
  assert.equal(invoke('--reason', 'strict proof').status, 2);
  const r = invoke('--workers-released', '--reason', 'strict proof'); assert.equal(r.status, 0, r.stderr);
  const run = loadRun(f.dir); const record = run.harness.amendments[0];
  assert.equal(run.schema, 5); assert.equal(run.stages[0].state, 'pending'); assert.equal(run.harness.contract, null);
  assert.equal(run.createdAt, JSON.parse(old).createdAt); assert.deepEqual(run.complexity, JSON.parse(old).complexity);
  assert.equal(JSON.parse(readFileSync(join(record.archive, 'run.json'))).schema, 3);
  assert.deepEqual(readFileSync(join(record.archive, record.artifacts[0].archive)), bytes);
  assert.equal(run.stages[0].review.rounds.length, 1, 'review budget/history retained');
  assert.equal(latestRound({ stage: run.stages[0] }), null, 'old verdict is history, not approval');
  assert.equal(nextRound({ stage: run.stages[0] }), 2, 'migration does not replenish review rounds');
  const next = spawnSync(process.execPath, [cli, 'next', '--run-dir', f.dir, '--workers-released'], { encoding: 'utf8' });
  assert.equal(next.status, 0, next.stderr);
  assert.match(next.stdout, /the plan has not been briefed/);
  assert.doesNotMatch(next.stdout, /approving the plan/);
});

test('amendment invalidates dependent gates but cannot silently expand objective or scope', (t) => {
  const f = fixture(t, true); const before = structuredClone(f.run.harness.contract);
  const record = evolveRun(f.dir, f.run, { kind: 'amend', reason: 'better checks', workersReleased: true });
  assert.equal(f.run.harness.contractHash, null); assert.equal(f.run.stages[0].state, 'pending');
  assert.equal(decide(f.dir, f.run).command, 'brief', 'identical old plan bytes cannot inherit the old pass');
  authorizeAmendment(f.run, before);
  const proposed = { ...before, allowedPaths: [...before.allowedPaths, 'outside.js'] };
  assert.throws(() => authorizeAmendment(f.run, proposed), /explicit user direction/);
  evolveRun(f.dir, f.run, { kind: 'amend', reason: 'user approved scope', authorityNote: 'User authorized outside.js for the same issue', workersReleased: true });
  authorizeAmendment(loadRun(f.dir), proposed);
  assert.equal(f.run.harness.amendments.length, 1); assert.equal(f.run.harness.pendingAmendment.id, record.id);
});

test('migration refuses live queues, completed runs and unresolved remote outcomes', (t) => {
  const f = fixture(t);
  for (const [key, value, pattern] of [['dispatch', { queue: {} }, /active wave/], ['finished', { at: 'now' }, /historical/], ['operations', { uncertain: { state: 'uncertain' } }, /remote effects/]]) {
    const run = { ...f.run, [key]: value };
    assert.throws(() => evolveRun(f.dir, run, { kind: 'migrate', reason: 'test', workersReleased: true }), pattern);
  }
});

test('explicit pre-implementation migration selects current policy while retaining the prior base and review history', (t) => {
  const f=fixture(t), cli=fileURLToPath(new URL('../issueflow.js',import.meta.url));
  execFileSync('git',['branch','dev'],{cwd:f.repo});
  mkdirSync(join(f.repo,'.github'));
  writeFileSync(join(f.repo,'.github/shipflow.json'),JSON.stringify({branches:{main:'main'}}));
  writeFileSync(join(f.repo,'AGENTS.md'),'Feature PRs target `main`.\n');
  execFileSync('git',['add','AGENTS.md','.github/shipflow.json'],{cwd:f.repo});
  execFileSync('git',['-c','user.name=test','-c','user.email=test@example.invalid','commit','-qm','main policy'],{cwd:f.repo});
  const dirtyPolicy=JSON.stringify({branches:{main:'main',dev:'dev'}});
  writeFileSync(join(f.repo,'.github/shipflow.json'),dirtyPolicy);
  f.run.policy.base='dev';f.run.lanes[0].base='dev';saveRun(f.dir,f.run);
  const before=readFileSync(join(f.dir,'run.json'),'utf8');
  const invoke=(...args)=>spawnSync(process.execPath,[cli,'migrate-run','--run-dir',f.dir,'--workers-released','--reason','retry issue against current policy','--base','main',...args],{encoding:'utf8'});
  const missing=invoke();assert.equal(missing.status,2,missing.stdout+missing.stderr);
  assert.equal(readFileSync(join(f.dir,'run.json'),'utf8'),before);
  const result=invoke('--authority-source','User chose main for this retry');assert.equal(result.status,0,result.stdout+result.stderr);
  const after=loadRun(f.dir),record=after.harness.amendments.at(-1);
  assert.equal(after.policy.base,'main');assert.equal(after.lanes[0].base,'main');
  assert.equal(after.repositorySnapshot.sha,execFileSync('git',['rev-parse','HEAD'],{cwd:f.repo,encoding:'utf8'}).trim());
  assert.equal(after.harness.bases.root,after.repositorySnapshot.sha);
  assert.equal(JSON.parse(readFileSync(join(record.archive,'run.json'),'utf8')).policy.base,'dev');
  assert.equal(after.stages[0].review.rounds.length,f.run.stages[0].review.rounds.length);
  assert.equal(after.createdAt,f.run.createdAt);assert.deepEqual(after.complexity,f.run.complexity);
  assert.equal(record.baseTransition.authoritySource,'User chose main for this retry');
  assert.equal(readFileSync(join(f.repo,'.github/shipflow.json'),'utf8'),dirtyPolicy,'unrelated working policy stays untouched');
});

test('base selection during migration refuses implemented or published lanes', (t) => {
  const f=fixture(t);
  for(const change of [{pr:{number:1}},{stages:[{id:'implement',state:'briefed',at:{briefed:'now'}}]}]) {
    const run=structuredClone(f.run);Object.assign(run.lanes[0],change);
    assert.throws(()=>evolveRun(f.dir,run,{kind:'migrate',reason:'test',workersReleased:true,controller:{base:'main',authoritySource:'user'}}),/before implementation/);
  }
});

test('migration carries legacy blockers into repair without altering archived reviews or replenishing rounds', (t) => {
  const f=fixture(t);
  const prior=f.run.stages[0].review.rounds[0];
  prior.verdict='blocked';
  prior.items=[{severity:'high',disposition:'fixable',cite:'plan proof',text:'Conflicting category sources must not authorize an action.'}];
  const original=structuredClone(prior);
  const record=evolveRun(f.dir,f.run,{kind:'migrate',reason:'retry with retained blockers',workersReleased:true});
  const findings=Object.values(f.run.harness.planFindings);
  assert.equal(findings.length,1);assert.equal(findings[0].status,'open');
  assert.equal(findings[0].text,original.items[0].text);
  assert.equal(findings[0].origin.round,original.round);
  assert.equal(findings[0].origin.artifactSha,original.artifactSha);
  assert.deepEqual(JSON.parse(readFileSync(join(record.archive,'run.json'),'utf8')).stages[0].review.rounds[0],original);
  assert.deepEqual(f.run.stages[0].review.rounds[0].items,original.items);
  assert.equal(nextRound({stage:f.run.stages[0]}),2);
});

test('migration without an approved contract requests fresh scope while a real amendment preserves its allowlist', (t) => {
  const f=fixture(t);
  evolveRun(f.dir,f.run,{kind:'migrate',reason:'retry incomplete planning',workersReleased:true});
  const render=()=>renderBrief(f.dir,f.run,findStep(f.run,'investigate'),JSON.parse(readFileSync(join(f.dir,'inputs/issue.json'),'utf8')),f.repo);
  const migrated=render();
  assert.match(migrated,/No prior approved contract/);
  assert.match(migrated,/required generated outputs/);
  assert.doesNotMatch(migrated,/preserve the previous objective and allowed paths/);
  f.run.harness.pendingAmendment.previousContract=contract;
  assert.match(render(),/preserve the previous objective and allowed paths/);
});

test('lane obligation partition covers every check without expanding scope', () => {
  const c = { ...contract, criteria: [...contract.criteria, { id: 'D2', description: 'more docs' }], allowedPaths: ['README.md', 'docs/'], checks: [...contract.checks, { id: 'other', type: 'command', argv: ['node', '--version'], criteria: ['D2'] }], lanes: { first: { criteria: ['D1'], checks: ['docs'], allowedPaths: ['README.md'] }, second: { criteria: ['D2'], checks: ['other'], allowedPaths: ['docs/'] } } };
  validateContract(c); assert.equal(contractForLane(c, 'first').checks.length, 1); assert.equal(contractForLane(c, 'second').checks[0].id, 'other');
  assert.throws(() => contractForLane(c, 'missing'), /no approved/);
  const bad = structuredClone(c); bad.lanes.second.allowedPaths = ['src/'];
  assert.throws(() => validateContract(bad), /escapes/);
  assert.equal(hash(c), hash(structuredClone(c)));
});

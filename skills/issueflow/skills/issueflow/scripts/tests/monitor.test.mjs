import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../issueflow.js', import.meta.url));
const hash = (v) => createHash('sha256').update(v).digest('hex');
const write = (path, value) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value)); };
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'monitor-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function state(root, number = 1, host = 'codex') {
  const dir = join(root, host, `issue-${number}`);
  const run = { schema: 5, createdAt: '2026-09-01T00:00:00.000Z', runtime: host,
    repo: { owner: 'sample', name: host }, issue: { number, title: 'Monitor fixture' },
    initialization: { owner: { kind: 'session', digest: hash(host), token: 'MUST-NOT-LEAK' } },
    harness: { version: 2, attempts: {}, attemptHistory: [] },
    stages: [{ id: 'investigate', state: 'approved', artifact: 'investigate.md' }],
    lanes: [{ slug: 'root', stages: [{ id: 'implement', state: 'briefed', artifact: 'implement.md' }] }],
    presentation: { emittedAt: new Date().toISOString(), snapshot: { state: 'waiting for worker', nextAction: 'Wait for observed worker' } } };
  const save = () => write(join(dir, 'run.json'), run);
  save();
  return { dir, run, save };
}
function attempt(f, id, status = 'started') {
  const output = join(f.dir, 'root', 'implement.md');
  return { id, generation: f.run.createdAt, outputs: [output], brief: join(f.dir, 'briefs', 'root-implement.md'),
    completion: join(f.dir, 'attempts', id, 'completed.json'), manifestHash: hash(id), state: 'dispatched',
    native: { workerId: 'same-native-id', status, startedAt: '2020-01-01T00:00:00.000Z',
      terminalAt: status === 'started' ? null : '2020-01-01T00:01:00.000Z' } };
}
function archive(f, a, contents) {
  const outputs = a.outputs.map((path, i) => {
    const bytes = contents[i], digest = hash(bytes);
    write(join(f.dir, 'attempts', a.id, 'outputs', `${i}-${digest}`), bytes);
    return { path, hash: digest };
  });
  write(a.completion, { schema: 1, id: a.id, generation: a.generation, manifestHash: a.manifestHash, status: 'completed', outputs });
}
function invoke(args, env = {}) {
  return spawnSync(process.execPath, [cli, 'monitor', ...args], { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 10000 });
}
function snapshot(root, extra = []) {
  const result = invoke(['--json', '--run-root', root, ...extra]);
  assert.equal(result.status, 0, `monitor JSON must be available: ${result.stderr}`);
  return JSON.parse(result.stdout);
}
const tree = (dir) => readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((e) => {
  const path = join(dir, e.name);
  return e.isDirectory() ? tree(path) : e.isFile() ? [[path, hash(readFileSync(path))]] : [[path, 'symlink']];
});

test('public observer groups two hosts and deduplicates outputs while retaining immutable replacement history', (t) => {
  const root = fixture(t), a = state(root), b = state(root, 2, 'claude');
  const old = attempt(a, 'old', 'completed'), current = attempt(a, 'new');
  archive(a, old, ['old immutable output']);
  current.outputs.push(join(a.dir, 'root', 'test-output.txt'));
  a.run.harness.attemptHistory = [old, structuredClone(old)];
  a.run.harness.attempts = { 'root/implement.md': current, 'root/test-output.txt': structuredClone(current) };
  const other = attempt(b, 'new', 'failed');
  b.run.harness.attempts = { 'root/implement.md': other };
  write(current.outputs[0], 'codex current only'); write(current.outputs[1], 'test details');
  write(other.outputs[0], 'claude current only');
  a.save(); b.save();
  const before = tree(root), out = snapshot(root);
  assert.equal(out.runs.length, 2);
  const codex = out.runs.find((r) => r.host === 'codex'), claude = out.runs.find((r) => r.host === 'claude');
  assert.equal(codex.repository, 'sample/codex'); assert.equal(claude.issue, 2);
  assert.notEqual(codex.key, claude.key); assert.notEqual(codex.ownerFingerprint, claude.ownerFingerprint);
  assert.equal(codex.agents.length, 2); assert.equal(claude.agents.length, 1);
  const worker = codex.agents.find((r) => r.attemptId === 'new'), historical = codex.agents.find((r) => r.attemptId === 'old');
  assert.notEqual(worker.key, claude.agents[0].key);
  assert.equal(worker.state, 'started'); assert.equal(worker.freshness, 'fresh');
  assert.equal(worker.details[0].text, 'codex current only'); assert.equal(worker.details[1].text, 'test details');
  assert.equal(historical.membership, 'historical'); assert.equal(historical.state, 'completed');
  assert.equal(historical.details[0].text, 'old immutable output');
  assert.equal(claude.agents[0].state, 'failed'); assert.equal(claude.agents[0].details[0].text, 'claude current only');
  assert.ok(!JSON.stringify(out).includes('MUST-NOT-LEAK'));
  assert.deepEqual(tree(root), before, 'observing must leave all run and ownership bytes unchanged');
  delete current.native; delete old.native;
  a.run.harness.attempts['root/test-output.txt'] = structuredClone(current);
  a.run.harness.attemptHistory = [old, structuredClone(old)]; a.save();
  const missingNative = snapshot(root).runs.find((r) => r.host === 'codex');
  for (const agent of missingNative.agents) {
    assert.equal(agent.state, 'unknown'); assert.equal(agent.workerId, null);
    assert.equal(agent.role, 'root/implement'); assert.ok(agent.outputs.length);
    assert.equal(agent.details[0].status, 'available');
  }
  assert.equal(missingNative.agents.find((r) => r.attemptId === 'old').details[0].text, 'old immutable output');
});

test('a replacement cannot inherit canonical output left by its predecessor', (t) => {
  const root = fixture(t), f = state(root), old = attempt(f, 'predecessor', 'failed');
  const replacement = attempt(f, 'replacement');
  replacement.native.startedAt = '2026-09-01T01:00:00.000Z';
  f.run.harness.attemptHistory = [old];
  f.run.harness.attempts['root/implement.md'] = replacement;
  write(replacement.outputs[0], 'predecessor bytes');
  utimesSync(replacement.outputs[0], 1, 1); f.save();
  const before = tree(root), observed = snapshot(root).runs[0];
  const worker = observed.agents.find((a) => a.attemptId === replacement.id);
  assert.equal(worker.state, 'started');
  assert.equal(worker.details[0].status, 'unavailable');
  assert.equal(worker.details[0].text, null);
  assert.ok(!JSON.stringify(observed.agents).includes('predecessor bytes'));
  assert.deepEqual(tree(root), before);
  write(replacement.outputs[0], 'replacement bytes');
  assert.equal(snapshot(root).runs[0].agents.find((a) => a.attemptId === replacement.id).details[0].text, 'replacement bytes');
});

test('refresh exposes stages, terminal observations, stage activity and attention-required controller transitions', (t) => {
  const root = fixture(t), f = state(root), a = attempt(f, 'worker');
  f.run.harness.attempts['root/implement.md'] = a; f.save();
  const first = snapshot(root).runs[0];
  write(join(f.dir, 'progress/root-implement.log'), 'working on replacement\n');
  a.native.status = 'completed'; a.native.terminalAt = new Date().toISOString();
  f.run.lanes[0].stages[0].state = 'approved';
  f.run.presentation = { emittedAt: new Date().toISOString(), snapshot: { state: 'awaiting user', nextAction: 'Review the result' } };
  f.save();
  const second = snapshot(root).runs[0];
  assert.equal(second.key, first.key); assert.equal(second.agents[0].key, first.agents[0].key);
  assert.equal(second.agents[0].state, 'completed'); assert.equal(second.agents[0].freshness, 'fresh');
  assert.equal(second.state, 'awaiting user'); assert.equal(second.nextAction, 'Review the result');
  f.run.lanes[0].stages[0].state = 'briefed';
  f.run.presentation = { kind: 'heartbeat', emittedAt: new Date().toISOString(), state: 'blocked', lastProgress: 'Needs attention' }; f.save();
  const third = snapshot(root).runs[0];
  assert.equal(third.state, 'blocked'); assert.match(third.stageActivity[0].text, /replacement/);
  assert.match(third.stageActivity[0].source, /not worker-specific/);
  assert.ok(!JSON.stringify(third.agents).includes('working on replacement'));
  assert.equal(third.stageActivity[0].freshness, 'fresh');
  utimesSync(join(f.dir, 'progress/root-implement.log'), 1, 1);
  assert.equal(snapshot(root).runs[0].stageActivity[0].freshness, 'stale');
});

test('conflicting duplicates fail closed independent of source order', (t) => {
  const root = fixture(t), f = state(root), a = attempt(f, 'duplicate', 'completed');
  for (const change of [
    (b) => { b.native.workerId = 'other-worker'; },
    (b) => { b.native.status = 'failed'; },
    (b) => { delete b.native; },
    (b) => { b.generation = 'different-generation'; },
    (b) => { b.outputs = [join(f.dir, 'other.md')]; },
    ...['outputs', 'generation', 'completion', 'brief', 'manifestHash'].map((field) => (b) => { delete b[field]; }),
  ]) {
    const b = structuredClone(a); change(b);
    f.run.harness.attemptHistory = [a, b]; f.save();
    const first = snapshot(root).runs[0].agents[0];
    f.run.harness.attemptHistory.reverse(); f.save();
    const second = snapshot(root).runs[0].agents[0];
    assert.equal(first.state, 'conflict'); assert.equal(second.state, 'conflict');
    assert.equal(first.workerId, null); assert.equal(first.details[0].status, 'unavailable');
    assert.equal(first.key, second.key);
    assert.deepEqual(first, second, 'conflict rendering is independent of record order');
  }
});

test('missing, empty, legacy, corrupt and unsupported observations are explicit without controller or host calls', (t) => {
  const root = fixture(t);
  assert.deepEqual(snapshot(join(root, 'missing')).runs, []);
  assert.match(snapshot(join(root, 'missing')).problems[0], /unavailable/);
  assert.deepEqual(snapshot(root).runs, []);
  write(join(root, 'extra-file'), 'not a directory');
  const f = state(root);
  f.run.schema = 3; delete f.run.harness; delete f.run.runtime; delete f.run.initialization; f.save();
  let run = snapshot(root).runs[0];
  assert.equal(run.host, 'unknown'); assert.equal(run.ownerFingerprint, null); assert.deepEqual(run.agents, []);
  assert.match(run.agentsNote, /unavailable/);
  const bin = join(root, 'bin'), calls = join(root, 'calls');
  for (const name of ['git', 'gh', 'claude', 'codex']) {
    write(join(bin, name), '#!/bin/sh\nprintf called >> "$MONITOR_CALLS"\nexit 97\n'); chmodSync(join(bin, name), 0o755);
  }
  const guarded = invoke(['--json', '--run-dir', f.dir], { PATH: bin, MONITOR_CALLS: calls });
  assert.equal(guarded.status, 0); assert.ok(!existsSync(calls));
  write(join(f.dir, 'run.json'), '{broken');
  assert.equal(snapshot(root).runs[0].status, 'unavailable');
  f.run.schema = 99; f.save(); assert.match(snapshot(root).runs[0].problems[0], /unsupported/);
  rmSync(join(f.dir, 'run.json')); assert.equal(snapshot(root).runs[0].status, 'unavailable');
  f.run.schema = 3; f.save(); chmodSync(join(f.dir, 'run.json'), 0);
  try { assert.equal(snapshot(root).runs[0].status, 'unavailable'); }
  finally { chmodSync(join(f.dir, 'run.json'), 0o600); }
});

test('prepared artifacts require matching execution ownership and immutable archive correlation', (t) => {
  const root = realpathSync(fixture(t)), f = state(root), source = join(root, 'source');
  mkdirSync(source); execFileSync('git', ['init', '-q', source]);
  f.run.repo.path = source;
  const owner = { dir: f.dir, createdAt: f.run.createdAt, issue: f.run.issue.number };
  const key = hash(JSON.stringify(owner)), generation = '12345678-1234-1234-1234-123456789abc';
  const storage = join(root, 'storage'), path = join(storage, 'issueflow', key, generation);
  f.run.execution = { version: 1, owner, key, generation, root: storage, path, source, common: join(source, '.git') };
  write(join(path, 'owner.json'), { ...owner, generation, source, common: join(source, '.git') });
  const a = attempt(f, 'prepared', 'completed'), artifacts = join(path, 'artifacts');
  a.generation = generation; a.outputs = [join(artifacts, 'root/implement.md')];
  a.completion = join(artifacts, 'attempts/prepared/completed.json');
  f.run.harness.attempts['root/implement.md'] = a;
  archive({ dir: artifacts }, a, ['owned prepared result']);
  f.save();
  const before = tree(root), observed = snapshot(root).runs.find((r) => r.issue === 1);
  assert.equal(observed.agents[0].details[0].text, 'owned prepared result');
  assert.deepEqual(observed.problems, []); assert.deepEqual(tree(root), before);
  const dotGit = join(source, '.git'), heldGit = join(root, 'held-git');
  renameSync(dotGit, heldGit);
  assert.match(snapshot(root).runs.find((r) => r.issue === 1).problems[0], /ownership/);
  const other = join(root, 'other-repository');
  mkdirSync(other); execFileSync('git', ['init', '-q', other]);
  write(dotGit, 'gitdir: ' + join(other, '.git') + '\n');
  assert.match(snapshot(root).runs.find((r) => r.issue === 1).problems[0], /ownership/);
  rmSync(dotGit); renameSync(heldGit, dotGit);
  execFileSync('git', ['-C', source, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    'commit', '--allow-empty', '-qm', 'fixture']);
  const linked = join(root, 'linked');
  execFileSync('git', ['-C', source, 'worktree', 'add', '-qb', 'linked', linked]);
  f.run.repo.path = linked; f.run.execution.source = linked;
  write(join(path, 'owner.json'), { ...owner, generation, source: linked, common: dotGit }); f.save();
  assert.deepEqual(snapshot(root).runs.find((r) => r.issue === 1).problems, []);
  const pointer = readFileSync(join(linked, '.git'));
  write(join(linked, '.git'), 'gitdir: ' + join(other, '.git') + '\n');
  assert.match(snapshot(root).runs.find((r) => r.issue === 1).problems[0], /ownership/);
  writeFileSync(join(linked, '.git'), pointer);
  const marker = join(path, 'owner.json'), markerBytes = readFileSync(marker);
  rmSync(marker); execFileSync('mkfifo', [marker]);
  assert.match(snapshot(root).runs.find((r) => r.issue === 1).problems[0], /ownership/);
  rmSync(marker); write(marker, 'x'.repeat(1024 * 1024 + 1));
  assert.match(snapshot(root).runs.find((r) => r.issue === 1).problems[0], /ownership/);
  writeFileSync(marker, markerBytes);
  const envelope = JSON.parse(readFileSync(a.completion));
  envelope.generation = 'wrong-generation'; write(a.completion, envelope);
  assert.equal(snapshot(root).runs.find((r) => r.issue === 1).agents[0].details[0].status, 'unavailable');
  // Even touching the predecessor's bytes cannot turn an excluded delivery into
  // replacement output; a changed delivery must still remain observable.
  f.run.execution.dispatches = { 'root/implement.md': { at: 1, excluded: [hash('prior bytes')] } };
  f.save(); write(a.outputs[0], 'prior bytes');
  assert.equal(snapshot(root).runs.find((r) => r.issue === 1).agents[0].details[0].status, 'unavailable');
  write(a.outputs[0], 'new bytes');
  assert.equal(snapshot(root).runs.find((r) => r.issue === 1).agents[0].details[0].text, 'new bytes');
  f.run.execution.owner.issue = 999; f.save();
  assert.match(snapshot(root).runs[0].problems[0], /ownership/);
});

test('confined bounded reads reject traversal, symlinks, nonregular files and unsafe terminal controls', (t) => {
  const root = fixture(t), f = state(root), a = attempt(f, 'safe');
  f.run.harness.attempts['root/implement.md'] = a;
  f.run.issue.title = '\x1b[31mTitle\x1b[0m\x1b]0;evil\x07\u202e';
  write(a.outputs[0], '\x1b[2Jsafe\x00 text\n' + 'x'.repeat(20000)); f.save();
  let run = snapshot(root).runs[0];
  assert.equal(run.title, 'Title'); assert.ok(run.agents[0].details[0].text.length <= 16384);
  assert.equal(run.agents[0].details[0].truncated, true);
  const secret = join(root, 'outside.txt'); write(secret, 'OUTSIDE-SECRET');
  rmSync(a.outputs[0]); symlinkSync(secret, a.outputs[0]);
  assert.equal(snapshot(root).runs[0].agents[0].details[0].status, 'unavailable');
  rmSync(a.outputs[0]); execFileSync('mkfifo', [a.outputs[0]]);
  assert.equal(snapshot(root).runs[0].agents[0].details[0].status, 'unavailable');
  a.outputs = [join(f.dir, 'root', '..', '..', 'outside.txt')]; f.save();
  assert.ok(!JSON.stringify(snapshot(root)).includes('OUTSIDE-SECRET'));
  rmSync(join(f.dir, 'run.json')); symlinkSync(secret, join(f.dir, 'run.json'));
  assert.equal(snapshot(root).runs[0].status, 'unavailable');
});

test('missing prepared execution fails closed and custom directories and flag errors are supported', (t) => {
  const root = fixture(t), f = state(root), a = attempt(f, 'worker');
  f.run.harness.attempts['root/implement.md'] = a; f.run.execution = { version: 1, root: '/unavailable' }; f.save();
  write(a.outputs[0], 'must not fall back to legacy artifact');
  const run = snapshot(root).runs[0];
  assert.match(run.problems[0], /Execution artifacts unavailable/);
  assert.equal(run.agents[0].details[0].status, 'unavailable');
  assert.ok(!JSON.stringify(run).includes('must not fall back'));
  const direct = invoke(['--json', '--run-dir', f.dir]);
  assert.equal(direct.status, 0); assert.equal(JSON.parse(direct.stdout).runs[0].key, run.key);
  assert.notEqual(invoke(['--json', '--run-root', root, '--run-dir', f.dir]).status, 0);
  assert.notEqual(invoke(['--json', '--run-root']).status, 0);
  const terminal = invoke([]);
  assert.notEqual(terminal.status, 0); assert.match(terminal.stderr, /monitor --json/);
});

test('ancestor aliases preserve current output and historical archives without following artifact symlinks', (t) => {
  const root = realpathSync(fixture(t)), alias = join(root, 'alias'), actual = join(root, 'actual');
  mkdirSync(actual); symlinkSync(actual, alias);
  const f = state(alias), current = attempt(f, 'current'), old = attempt(f, 'old', 'completed');
  f.run.harness.attempts['root/implement.md'] = current; f.run.harness.attemptHistory = [old];
  write(current.outputs[0], 'current aliased output'); archive(f, old, ['historical aliased output']); f.save();
  for (const discovery of [alias, actual]) {
    const run = snapshot(discovery).runs[0];
    assert.equal(run.agents.find((a) => a.attemptId === 'current').state, 'started');
    assert.equal(run.agents.find((a) => a.attemptId === 'current').details[0].text, 'current aliased output');
    assert.equal(run.agents.find((a) => a.attemptId === 'old').details[0].text, 'historical aliased output');
  }
  const secret = join(root, 'secret'); write(secret, 'outside secret');
  rmSync(current.outputs[0]); symlinkSync(secret, current.outputs[0]);
  assert.equal(snapshot(alias).runs[0].agents.find((a) => a.attemptId === 'current').details[0].status, 'unavailable');
});

test('output timestamps refresh workers and runs, and finished state overrides presentation', (t) => {
  const root = fixture(t), f = state(root), a = attempt(f, 'fresh-output');
  delete f.run.presentation;
  f.run.harness.attempts['root/implement.md'] = a; f.save();
  utimesSync(join(f.dir, 'run.json'), 1, 1);
  const before = snapshot(root).runs[0];
  assert.equal(before.freshness, 'stale'); assert.equal(before.agents[0].freshness, 'stale');
  write(a.outputs[0], 'new activity');
  const after = snapshot(root).runs[0];
  assert.equal(after.freshness, 'fresh'); assert.equal(after.agents[0].freshness, 'fresh');
  assert.equal(after.lastObservedAt, after.agents[0].details[0].observedAt);
  f.run.finished = { at: new Date().toISOString() };
  f.run.presentation = { snapshot: { state: 'waiting for worker' } }; f.save();
  assert.equal(snapshot(root).runs[0].state, 'finished');
});

test('current stages exclude future work and expose plan and code review activity without attempts', (t) => {
  const root = fixture(t), f = state(root);
  f.run.stages[0].state = 'briefed';
  f.run.stages.push({ id: 'future', state: 'pending' });
  f.run.lanes[0].stages[0].state = 'pending'; f.save();
  assert.equal(snapshot(root).runs[0].currentStage, 'investigate');
  f.run.stages[0].state = 'submitted';
  f.run.stages[0].review = { briefed: { round: 1 }, rounds: [] };
  write(join(f.dir, 'progress/review-investigate-r1.log'), 'plan review underway'); f.save();
  const plan = snapshot(root).runs[0];
  assert.match(plan.currentStage, /review-investigate-r1/);
  assert.equal(plan.stageActivity.find((s) => s.stage === 'review-investigate-r1').text, 'plan review underway');
  f.run.stages[0].state = 'approved'; f.run.lanes[0].stages[0].state = 'approved';
  f.run.lanes[0].review = { rounds: [{ round: 1, angles: ['correctness'], registered: null }] };
  write(join(f.dir, 'progress/root-review-r1-finder-1.log'), 'code review underway'); f.save();
  const code = snapshot(root).runs[0];
  assert.equal(code.currentStage, 'root-review-r1-finder-1');
  assert.equal(code.stageActivity.find((s) => s.stage === code.currentStage).text, 'code review underway');
  f.run.lanes[0].review.rounds[0].cancelled = 'cancelled';
  f.run.lanes[0].review.rounds[0].verifiers = 1;
  f.run.lanes[0].review.rounds.push({ round: 2, angles: ['correctness'], registered: null }); f.save();
  const next = snapshot(root).runs[0];
  assert.equal(next.currentStage, 'root-review-r2-finder-1');
  assert.equal(next.stageActivity.find((s) => s.stage === 'root-review-r1-finder-1').text, 'code review underway');
  f.run.lanes[0].review.rounds[1].registered = 'registered'; f.save();
  assert.equal(snapshot(root).runs[0].currentStage, 'unavailable');
  for (const name of ['bad\x1b[2J\u202ename', 'x'.repeat(20000)]) {
    f.run.stages[0].id = name; f.run.stages[0].state = 'submitted';
    f.run.stages[0].review = { briefed: { round: 1 }, rounds: [] };
    f.run.lanes[0].slug = name;
    f.run.lanes[0].review.rounds[1].registered = null; f.save();
    const sanitized = snapshot(root).runs[0];
    for (const label of [sanitized.currentStage, ...sanitized.stageActivity.map((s) => s.stage)]) {
      assert.doesNotMatch(label, /[\x1b\u202e]/);
      assert.ok(label.length <= 16384);
    }
  }
});

test('a replacement during a detail read cannot publish new bytes under the old attempt', (t) => {
  const root = realpathSync(fixture(t)), f = state(root), a = attempt(f, 'old');
  f.run.harness.attempts['root/implement.md'] = a; write(a.outputs[0], 'old output'); f.save();
  const replacement = structuredClone(f.run);
  replacement.harness.attempts['root/implement.md'] = attempt(f, 'replacement');
  const preload = join(root, 'replace-on-read.mjs');
  write(preload, `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const original = fs.openSync;
    let replaced = false;
    fs.openSync = function(path, ...args) {
      if (!replaced && path === ${JSON.stringify(a.outputs[0])}) {
        replaced = true;
        fs.writeFileSync(${JSON.stringify(join(f.dir, 'run.json'))}, ${JSON.stringify(JSON.stringify(replacement))});
        fs.writeFileSync(path, 'replacement output');
      }
      return original.call(this, path, ...args);
    };
    syncBuiltinESMExports();
  `);
  const result = spawnSync(process.execPath, ['--import', preload, cli, 'monitor', '--json', '--run-dir', f.dir],
    { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(readFileSync(join(f.dir, 'run.json'))).harness.attempts['root/implement.md'].id,
    'replacement', 'the canonical artifact read must trigger the replacement');
  const run = JSON.parse(result.stdout).runs[0];
  assert.equal(run.status, 'unavailable'); assert.match(run.problems[0], /changed during observation/);
  assert.ok(!result.stdout.includes('replacement output'));
});

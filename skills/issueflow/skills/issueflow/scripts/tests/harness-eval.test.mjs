import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { compare, evaluate, loadCases } from '../../evals/harness.mjs';
import { judge, reportVerdict, repositoryOutcome, verdictExit } from '../../evals/harness/oracles.mjs';

const harness = fileURLToPath(new URL('../../evals/harness.mjs', import.meta.url));
const guard = fileURLToPath(new URL('../../evals/harness/offline.cjs', import.meta.url));
const temporary = (t) => {
  const path = mkdtempSync(join(tmpdir(), "issueflow eval's "));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
};

test('foundation corpus has all six reproduced defects and positive controls', () => {
  const manifest = loadCases();
  for (const id of ['E01', 'E02', 'E03', 'R01', 'M01', 'M02', 'C01', 'C02', 'CLI01', 'CLI02']) assert.ok(manifest.cases.some((c) => c.id === id));
  assert.ok(manifest.cases.filter((c) => c.kind === 'real-run-replay').length >= 2);
});

test('empty, duplicate and unimplemented cases cannot pass manifest validation', (t) => {
  const dir = temporary(t);
  for (const mutate of [
    (m) => { m.cases = []; },
    (m) => { m.cases[1] = m.cases[0]; },
    (m) => { m.cases[0].probe = 'made-up'; },
    (m) => { m.minimumCases = 0; },
  ]) {
    const manifest = loadCases(); mutate(manifest);
    const path = join(dir, 'cases.json'); writeFileSync(path, JSON.stringify(manifest));
    assert.throws(() => loadCases(path), /invalid/);
  }
});

test('outcome oracle checks files and process status, not a success claim', () => {
  const expected = { 'answer.js': 'return 42' };
  assert.equal(repositoryOutcome({ expected, observed: expected, exitCode: 0 }), true);
  assert.equal(repositoryOutcome({ expected, observed: { 'answer.js': 'return 41', report: 'success' }, exitCode: 0 }), false);
  assert.equal(repositoryOutcome({ expected, observed: expected, exitCode: 1 }), false);
  assert.throws(() => repositoryOutcome({ expected: {}, observed: {}, exitCode: 0 }), /empty/);
});

test('all foundation oracles have good and bad controls', () => {
  for (const probe of ['invented-evidence', 'zero-tests', 'exit-conflict', 'green-only']) {
    assert.equal(judge(probe, { ok: false }).pass, true);
    assert.equal(judge(probe, { ok: true }).pass, false);
  }
  assert.equal(judge('unknown-time', { unknownAgentTime: true, agentTimeMs: null }).pass, true);
  assert.equal(judge('unknown-time', { unknownAgentTime: false, agentTimeMs: 0 }).pass, false);
  assert.equal(judge('concurrent-time', { workerWallTimeMs: 200, wallTimeMs: null }).pass, true);
  assert.equal(judge('concurrent-time', { wallTimeMs: 200 }).pass, false);
  assert.equal(judge('copy-risk', { kind: 'deep' }).pass, true);
  assert.equal(judge('copy-risk', { kind: 'fast-docs' }).pass, false);
  assert.equal(judge('real-evidence', { ok: true, executions: [{ status: 1 }, { status: 0 }] }).pass, true);
  assert.equal(judge('real-evidence', { ok: true, executions: [{ status: 0 }] }).pass, false);
  assert.throws(() => judge('unknown', {}), /no oracle/);
  assert.throws(() => judge('copy-risk', null), /missing/);
});

test('unexecuted and failed cases cannot become passes', () => {
  assert.throws(() => reportVerdict([]), /no evaluated/);
  assert.equal(reportVerdict([{ status: 'pass' }]), 'pass');
  assert.equal(reportVerdict([{ status: 'inconclusive' }]), 'inconclusive');
  assert.equal(reportVerdict([{ status: 'pass' }, { status: 'fail' }]), 'fail');
  assert.equal(verdictExit('pass'), 0);
  assert.notEqual(verdictExit('fail'), 0);
  assert.notEqual(verdictExit('inconclusive'), 0);
});

test('offline guard observes and rejects model, shell, network and Git transport attempts', (t) => {
  const dir = temporary(t);
  const log = join(dir, 'network.log');
  for (const script of [
    "require('node:child_process').spawnSync('codex', ['exec'])",
    "require('node:child_process').execSync('curl https://example.invalid')",
    "require('node:child_process').spawnSync('git', ['fetch', 'origin'])",
    "require('node:https').get('https://example.invalid')",
    "require('node:net').createConnection({port: 443})",
  ]) {
    const result = spawnSync(process.execPath, ['--require', guard, '-e', script], { encoding: 'utf8', env: { ...process.env, ISSUEFLOW_EVAL_NETWORK_LOG: log } });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /offline evaluation forbids/);
  }
  assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, 5);
});

test('real candidate CLI and test processes execute offline with immutable captured outputs', async (t) => {
  const dir = temporary(t);
  const out = join(dir, 'results');
  const report = await evaluate({ out, selected: ['C01', 'C02', 'CLI01', 'CLI02'] });
  assert.equal(report.verdict, 'pass', JSON.stringify(report.results));
  assert.equal(report.coverage.selected, 4);
  assert.ok(report.coverage.notSelected.includes('E01'));
  assert.equal(report.performance.verdict, 'inconclusive');
  assert.equal(report.environment.model, null);
  assert.equal(report.source.snapshotHash.length, 64);
  assert.equal(existsSync(join(out, 'network-attempts.log')), false);
  assert.ok(readFileSync(join(out, 'C01/evidence.txt'), 'utf8').includes('not ok'));
  assert.ok(existsSync(join(out, 'CLI01/run/briefs/investigate.md')));
  assert.equal(JSON.parse(readFileSync(join(out, 'CLI02/run/run.json'))).runtime, 'codex');
  await assert.rejects(() => evaluate({ out, selected: ['C01'] }), /EEXIST/);
  await assert.rejects(() => evaluate({ out: join(dir, 'empty'), selected: [] }), /empty case/);
  assert.equal(existsSync(join(dir, 'empty')), false);
});

test('CLI refuses native claims before running an unsupported campaign', (t) => {
  const dir = temporary(t);
  const out = join(dir, 'native');
  const result = spawnSync(process.execPath, [harness, 'run', '--mode', 'native', '--out', out], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unverified/);
  assert.equal(existsSync(out), false);
});

test('comparison re-derives outcome and refuses mismatched evaluations', () => {
  const report = { schema: 1, mode: 'offline', scope: 'foundation', source: { snapshotHash: 'a' }, evaluatorHash: 'e', manifestHash: 'm', coverage: {}, results: [{ id: 'E01', status: 'fail' }], verdict: 'pass' };
  assert.equal(compare(report, report).verdict, 'fail');
  assert.equal(compare(report, { ...report, evaluatorHash: 'changed' }).verdict, 'inconclusive');
  assert.equal(compare(report, { ...report, results: [{ id: 'different', status: 'pass' }] }).verdict, 'inconclusive');
  assert.equal(compare(report, { ...report, results: [{ id: 'E01', status: 'pass' }] }).performance, 'inconclusive');
  assert.throws(() => compare(report, { ...report, results: [] }), /invalid/);
});

#!/usr/bin/env node
/** Offline foundation evaluations. Native campaigns remain explicitly unverified. */
import { createHash, randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, lstatSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { judge, reportVerdict, verdictExit } from './harness/oracles.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const skillRoot = resolve(here, '..');
const skillRelative = 'skills/issueflow/skills/issueflow';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const put = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 }).trim();

export function loadCases(path = join(here, 'harness/cases.json')) {
  return validateManifest(json(path));
}

function validateManifest(manifest) {
  if (manifest.schema !== 1 || manifest.scope !== 'foundation' || !Array.isArray(manifest.cases)
      || !Number.isInteger(manifest.minimumCases) || manifest.minimumCases < 12 || manifest.cases.length < manifest.minimumCases
      || !Array.isArray(manifest.notCovered) || !manifest.notCovered.length) throw new Error('invalid or empty evaluation manifest');
  const ids = new Set();
  const probes = new Set(['invented-evidence', 'zero-tests', 'exit-conflict', 'copy-risk', 'unknown-time', 'concurrent-time', 'real-evidence', 'green-only', 'cli', 'replay']);
  for (const item of manifest.cases) {
    if (!/^[A-Z]+\d+$/.test(item.id) || ids.has(item.id) || !item.title || !probes.has(item.probe)
        || !['regression', 'control', 'synthetic-workflow', 'real-run-replay'].includes(item.kind)
        || item.probe === 'cli' && !['claude', 'codex'].includes(item.host)
        || item.probe === 'replay' && (!['baseline.test.mjs', 'review-round.test.mjs'].includes(item.test) || !Number.isInteger(item.minimumTests) || item.minimumTests < 3)) throw new Error(`invalid case ${item.id}`);
    ids.add(item.id);
  }
  for (const id of ['E01', 'E02', 'E03', 'R01', 'M01', 'M02', 'C01', 'C02', 'CLI01', 'CLI02', 'REPLAY01', 'REPLAY02']) {
    if (!ids.has(id)) throw new Error(`missing required case ${id}`);
  }
  return manifest;
}

function evaluatorHash() {
  return digest(JSON.stringify(['harness.mjs', 'harness/offline.cjs', 'harness/probe.mjs', 'harness/oracles.mjs']
    .map((path) => ({ path, sha256: digest(readFileSync(join(here, path))) }))));
}

function files(root, dir = root) {
  return readdirSync(dir).sort().flatMap((name) => {
    if (['node_modules', '.git', '.DS_Store'].includes(name)) return [];
    const path = join(dir, name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(`source snapshot refuses symlink ${relative(root, path)}`);
    return stat.isDirectory() ? files(root, path) : [{ path: relative(root, path), mode: stat.mode & 0o777, sha256: digest(readFileSync(path)) }];
  });
}

function captureSource(out, ref) {
  const repo = git(['rev-parse', '--show-toplevel'], skillRoot);
  const commit = git(['rev-parse', '--verify', ref ? `${ref}^{commit}` : 'HEAD'], repo);
  if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new Error('invalid source commit');
  const destination = join(out, 'source');
  mkdirSync(destination);
  if (ref) {
    const archive = execFileSync('git', ['archive', commit, skillRelative], { cwd: repo, maxBuffer: 128 * 1024 * 1024, timeout: 30000 });
    execFileSync('tar', ['-x', '-C', destination], { input: archive, timeout: 30000 });
  } else {
    // Include untracked implementation files, but never the user's unrelated work.
    files(skillRoot); // validate symlinks before copying
    cpSync(skillRoot, join(destination, skillRelative), { recursive: true, filter: (p) => !relative(skillRoot, p).split(sep).some((s) => ['node_modules', '.git', '.DS_Store'].includes(s)) });
    const patch = execFileSync('git', ['diff', '--binary', 'HEAD', '--', skillRelative], { cwd: repo, maxBuffer: 32 * 1024 * 1024 });
    writeFileSync(join(out, 'candidate.patch'), patch, { flag: 'wx' });
  }
  const root = join(destination, skillRelative);
  const inventory = files(root);
  put(join(out, 'source-files.json'), inventory);
  return { root, identity: { commit, snapshotHash: digest(JSON.stringify(inventory)), files: inventory.length, version: json(join(root, 'package.json')).version, dirtySnapshot: !ref && git(['status', '--porcelain', '--untracked-files=all', '--', skillRelative], repo) !== '' } };
}

function processRun(args, cwd, dir, label, env) {
  const start = performance.now();
  const result = spawnSync(process.execPath, args, { cwd, env, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
  const record = { command: [process.execPath, ...args], exitCode: result.status, signal: result.signal, error: result.error?.message ?? null, wallTimeMs: performance.now() - start };
  writeFileSync(join(dir, `${label}.stdout`), result.stdout ?? '', { flag: 'wx' });
  writeFileSync(join(dir, `${label}.stderr`), result.stderr ?? '', { flag: 'wx' });
  put(join(dir, `${label}.process.json`), record);
  return record;
}

function fixture(dir) {
  const repo = join(dir, 'repo');
  mkdirSync(repo);
  git(['init', '-q', '-b', 'dev'], repo);
  git(['config', 'user.name', 'Issueflow evaluation'], repo);
  git(['config', 'user.email', 'fixture@example.invalid'], repo);
  writeFileSync(join(repo, 'README.md'), '# Fixture\n');
  git(['add', 'README.md'], repo);
  git(['commit', '-qm', 'fixture'], repo);
  put(join(dir, 'repo.json'), { owner: 'fixture', name: 'harness', defaultBranch: 'dev' });
  put(join(dir, 'issue.json'), { number: 1, title: 'Fix a behavior', body: 'Return the correct value.', labels: [], comments: [], state: 'OPEN', url: 'https://example.invalid/1' });
  return repo;
}

function cliCase(source, dir, host, env) {
  const repo = fixture(dir);
  const run = join(dir, 'run');
  const cli = join(source, 'scripts/issueflow.js');
  for (const [label, args] of [
    ['start', ['start', '--issue', '1', '--repo', repo, '--repo-json', join(dir, 'repo.json'), '--issue-json', join(dir, 'issue.json'), '--runtime', host]],
    ['status', ['status']], ['next', ['next']],
  ]) {
    const result = processRun([cli, ...args, '--run-dir', run], repo, dir, label, env);
    if (result.exitCode !== 0) return { pass: false, detail: `${label} exited ${result.exitCode}: ${result.error ?? result.signal ?? 'see captured stderr'}` };
  }
  const state = json(join(run, 'run.json'));
  const output = readFileSync(join(dir, 'next.stdout'), 'utf8');
  const persisted = state.runtime === host && state.offline === true && state.issue.number === 1;
  const next = host === 'claude' ? state.stages[0].state === 'briefed' && existsSync(join(run, 'briefs/investigate.md'))
    : /approved Codex workspace/.test(output) && state.stages[0].state === 'pending';
  return { pass: persisted && next, detail: host === 'claude' ? 'real CLI persisted state and delivered a plan brief' : 'real CLI preserved Codex identity and withheld dispatch without prepared storage' };
}

function forgedGateCase(source, dir, env) {
  const repo = fixture(dir);
  const run = join(dir, 'run');
  const cli = join(source, 'scripts/issueflow.js');
  const invoke = (label, args) => processRun([cli, ...args, '--run-dir', run, '--offline'], repo, dir, label, env);
  const requireSuccess = (label, args) => {
    const result = invoke(label, args);
    if (result.exitCode !== 0) throw new Error(`gate fixture ${label} did not complete: exit ${result.exitCode}`);
  };
  const complete = (label, output) => {
    const attempt = json(join(run, 'run.json')).harness?.attempts?.[output];
    if (!attempt) return; // The baseline predates completion envelopes.
    const result = processRun([join(source, 'scripts/complete-worker.mjs'), attempt.manifest], repo, dir, label, env);
    if (result.exitCode !== 0) throw new Error(`completion fixture ${label} failed`);
  };
  requireSuccess('start', ['start', '--issue', '1', '--repo', repo, '--repo-json', join(dir, 'repo.json'), '--issue-json', join(dir, 'issue.json')]);
  requireSuccess('brief-plan', ['brief', '--stage', 'investigate']);
  writeFileSync(join(run, 'shared/investigate.md'), [
    '## Root cause\nA fixture describes a behavior.', '## Evidence\nREADME.md:1',
    '## Unknowns\nNone for this synthetic gate case.', '## Approach\nProve the evidence boundary.',
    '## Rejected\nA claimed success is insufficient.', '## Files\nREADME.md', '## Proof\nRequire observed verification.',
    '```issueflow-contract\n' + JSON.stringify({ schema: 1, risk: 'docs', criteria: [{ id: 'C1', description: 'Verify the documentation edit' }], nonGoals: [], allowedPaths: ['README.md'], checks: [{ id: 'D1', type: 'command', argv: ['node', '--version'], criteria: ['C1'] }] }) + '\n```',
  ].join('\n\n'));
  complete('complete-plan', 'shared/investigate.md');
  requireSuccess('brief-review', ['brief', '--stage', 'investigate', '--review']);
  put(join(run, 'reviews/investigate-r1.findings.json'), {
    findings: [{ severity: 'low', cite: 'investigate.md § Root cause', text: 'Synthetic fixture; not a live independent review.' }],
    notExamined: ['All live-agent behavior; this case injects artifacts to test the deterministic acceptance boundary.'], verdict: 'pass',
  });
  complete('complete-review', 'reviews/investigate-r1.findings.json');
  requireSuccess('review', ['review', '--stage', 'investigate']);
  requireSuccess('accept-plan', ['accept', '--stage', 'investigate', '--auto']);
  requireSuccess('brief-implement', ['brief', '--stage', 'implement']);
  writeFileSync(join(run, 'root/implement.md'), [
    '## Changed\nNo source changes in this acceptance-boundary fixture.', '## Deviations\nNone.',
    '## Command\nA worker claims it ran tests.', '## Two-sided\nA worker claims a red and green run.', '## Result\nA worker claims success.',
  ].join('\n\n'));
  writeFileSync(join(run, 'root/test-output.txt'), '# pass 0\n# fail 1\n# pass 1\n# fail 0\n');
  complete('complete-implementation', 'root/implement.md');
  const result = invoke('accept-implement', ['accept', '--stage', 'implement']);
  const approved = json(join(run, 'run.json')).lanes[0].stages[0].state === 'approved';
  const error = readFileSync(join(dir, 'accept-implement.stderr'), 'utf8');
  if (result.exitCode !== 0 && !(result.exitCode === 2 && /receipt|verification|provenance/i.test(error))) {
    throw new Error(`gate did not exercise provenance refusal: exit ${result.exitCode}; see accept-implement.stderr`);
  }
  return { pass: result.exitCode === 2 && !approved, detail: approved ? 'real CLI approved an implementation from invented summaries' : 'real CLI refused unobserved verification and retained the unapproved stage' };
}

export async function evaluate({ out, ref = null, selected = null, manifest = loadCases() }) {
  validateManifest(manifest);
  out = resolve(out);
  if (out === skillRoot || out.startsWith(skillRoot + sep)) throw new Error('evaluation output must be outside the skill source');
  const cases = selected ? manifest.cases.filter((c) => selected.includes(c.id)) : manifest.cases;
  if (!cases.length || selected && (new Set(selected).size !== selected.length || cases.length !== selected.length)) throw new Error('unknown, duplicate, or empty case selection');
  // A run's outputs are immutable. Never replace an earlier report or fixture.
  mkdirSync(out);
  const source = captureSource(out, ref);
  const networkLog = join(out, 'network-attempts.log');
  const preload = join(here, 'harness/offline.cjs');
  const env = { ...process.env, NODE_OPTIONS: `--require ${JSON.stringify(preload)}`, ISSUEFLOW_EVAL_NETWORK_LOG: networkLog, ISSUEFLOW_NATIVE_HOST: '', NODE_TEST_CONTEXT: undefined, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' };
  const start = performance.now();
  const results = [];
  for (const item of cases) {
    const dir = join(out, item.id);
    mkdirSync(dir);
    const begun = performance.now();
    let result;
    try {
      let outcome;
      if (item.probe === 'cli') outcome = cliCase(source.root, dir, item.host, env);
      else if (item.probe === 'invented-evidence') outcome = forgedGateCase(source.root, dir, env);
      else if (item.probe === 'replay') {
        const execution = processRun(['--test', '--test-reporter=tap', join(source.root, 'scripts/tests', item.test)], source.root, dir, 'replay', env);
        const output = readFileSync(join(dir, 'replay.stdout'), 'utf8');
        const passed = Number(/^# pass (\d+)$/m.exec(output)?.[1]);
        const clean = /^# fail 0$/m.test(output) && /^# skipped 0$/m.test(output) && /^# cancelled 0$/m.test(output);
        outcome = { pass: execution.exitCode === 0 && passed >= item.minimumTests && clean, detail: `real-run replay suite exited ${execution.exitCode}; ${passed || 0} passed, minimum ${item.minimumTests}` };
      } else {
        const observation = join(dir, 'actual.json');
        const execution = processRun([join(here, 'harness/probe.mjs'), source.root, item.probe, observation, dir], source.root, dir, 'probe', env);
        if (execution.exitCode !== 0 || !existsSync(observation)) throw new Error(`probe did not complete; exit=${execution.exitCode}, ${execution.error ?? 'see captured stderr'}`);
        outcome = judge(item.probe, json(observation));
      }
      result = { status: outcome.pass ? 'pass' : 'fail', detail: outcome.detail };
    } catch (err) { result = { status: 'inconclusive', detail: err.message }; }
    results.push({ id: item.id, kind: item.kind, title: item.title, ...result, wallTimeMs: performance.now() - begun });
  }
  const networkAttempts = existsSync(networkLog) ? readFileSync(networkLog, 'utf8').trim().split('\n').filter(Boolean) : [];
  if (networkAttempts.length) results.push({ id: 'OFFLINE', kind: 'control', title: 'Offline boundary', status: 'fail', detail: `${networkAttempts.length} forbidden operation(s) attempted`, wallTimeMs: 0 });
  if (digest(JSON.stringify(files(source.root))) !== source.identity.snapshotHash) {
    results.push({ id: 'SOURCE', kind: 'control', title: 'Source integrity', status: 'fail', detail: 'evaluated source changed during the campaign; the source identity is invalid', wallTimeMs: 0 });
  }
  const report = {
    schema: 1, id: randomUUID(), mode: 'offline', scope: manifest.scope, baselineCapture: Boolean(ref),
    source: source.identity, evaluatorHash: evaluatorHash(), manifestHash: digest(JSON.stringify(manifest)),
    environment: { node: process.version, git: git(['--version'], source.root), platform: process.platform, architecture: process.arch, host: null, model: null, reasoning: null, usage: null },
    verdict: reportVerdict(results), coverage: { selected: cases.length, available: manifest.cases.length, notSelected: manifest.cases.filter((c) => !cases.includes(c)).map((c) => c.id), notCovered: manifest.notCovered },
    wallTimeMs: performance.now() - start, results,
    performance: { verdict: 'inconclusive', reason: 'offline process durations are not live-agent time-to-success measurements' },
  };
  put(join(out, 'report.json'), report);
  const escape = (value) => String(value).replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
  writeFileSync(join(out, 'report.md'), [
    '# Issueflow foundation evaluation', '', `Verdict: ${report.verdict}. Baseline capture: ${report.baselineCapture}.`,
    `Coverage: ${cases.length}/${manifest.cases.length} foundation cases. ${manifest.notCovered.length} broader capability groups are unverified.`,
    '', '| Case | Result | Evidence |', '|---|---|---|', ...results.map((r) => `| ${r.id} | ${r.status} | ${escape(r.detail)} |`),
    '', `Performance: ${report.performance.reason}.`, '', 'Not covered:', ...manifest.notCovered.map((s) => `- ${s}`), '',
  ].join('\n'), { flag: 'wx' });
  return report;
}

export function compare(baseline, candidate) {
  for (const report of [baseline, candidate]) {
    if (report?.schema !== 1 || report.mode !== 'offline' || report.scope !== 'foundation' || !report.source?.snapshotHash
        || !Array.isArray(report.results) || !report.results.length || !report.coverage || report.results.some((r) => !['pass', 'fail', 'inconclusive'].includes(r.status))) throw new Error('invalid foundation report');
  }
  const compatible = baseline.manifestHash === candidate.manifestHash && baseline.evaluatorHash === candidate.evaluatorHash
    && JSON.stringify(baseline.results.map((r) => r.id)) === JSON.stringify(candidate.results.map((r) => r.id));
  if (!compatible) return { verdict: 'inconclusive', reason: 'evaluators, manifests, or selected cases differ', performance: 'inconclusive' };
  return { verdict: reportVerdict(candidate.results), coverage: candidate.coverage,
    changes: candidate.results.map((r, i) => ({ id: r.id, before: baseline.results[i].status, after: r.status })),
    performance: 'inconclusive', reason: 'foundation behavior compared; live-agent performance is not measured' };
}

async function main() {
  const [command, ...raw] = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < raw.length; i += 2) {
    if (!['--out', '--ref', '--mode', '--cases', '--baseline', '--candidate'].includes(raw[i]) || !raw[i + 1] || raw[i + 1].startsWith('--') || options[raw[i]]) throw new Error(`invalid option ${raw[i]}`);
    options[raw[i]] = raw[i + 1];
  }
  if (command === 'compare') {
    if (!options['--baseline'] || !options['--candidate']) throw new Error('compare requires --baseline and --candidate report.json paths');
    const result = compare(json(options['--baseline']), json(options['--candidate']));
    console.log(JSON.stringify(result, null, 2)); process.exitCode = verdictExit(result.verdict); return;
  }
  if (!['baseline', 'run'].includes(command) || !options['--out'] || command === 'baseline' && !options['--ref'] || command === 'run' && options['--ref']) throw new Error('usage: harness.mjs baseline --ref <sha> --out <new-dir> | run --mode offline --out <new-dir> [--cases E01,C01] | compare --baseline <report.json> --candidate <report.json>');
  if (options['--mode'] && options['--mode'] !== 'offline') throw new Error('native evaluation is not implemented; required native gates remain unverified');
  const ref = options['--ref'];
  if (ref && (!/^[a-zA-Z0-9][a-zA-Z0-9_./-]*$/.test(ref))) throw new Error('invalid baseline ref');
  const report = await evaluate({ out: options['--out'], ref, selected: options['--cases']?.split(',') });
  console.log(`${report.verdict}: ${report.results.filter((r) => r.status === 'pass').length}/${report.results.length} cases passed; ${report.coverage.notCovered.length} capability groups unverified. ${resolve(options['--out'], 'report.json')}`);
  process.exitCode = verdictExit(report.verdict);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((err) => { console.error(`harness: ${err.message}`); process.exitCode = 2; });

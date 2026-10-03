import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { loadConfig, validateConfig, validateCoverage, filters, plan, commands, runChecks } from '../skills-ci.mjs';
import { parseConfig } from '../../skills/skillfactory/skills/skillfactory/scripts/lib/ci-config.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(join(root, 'skills/shipflow/skills/shipflow/package.json'));
const { parse } = require('yaml');
const config = loadConfig(root);
const read = path => readFileSync(join(root, path), 'utf8');
const workflow = name => parse(read(`.github/workflows/${name}.yml`));
const before = JSON.parse(read('tools/tests/fixtures/pre-consolidation-workflows.json'));

test('migration preserves all actual caller commands, runtimes, cache, limits, filters and release options', () => {
  assert.equal(Object.keys(before.skills).length, 26);
  for (const [n, old] of Object.entries(before.skills)) {
    const c = config.skills[n]; assert.ok(c, `${n}: missing`);
    assert.deepEqual(commands(config, n), old.commands, `${n}: commands/cwd`);
    assert.equal(c.python, old.python); assert.equal(c.node, old.node['node-version'] ?? '');
    assert.equal(c.npmCache, old.node['cache-dependency-path'] ?? '');
    assert.equal(c.timeoutMinutes, old.timeoutMinutes);
    assert.equal(c.concurrency, !old.concurrency ? 'none' : old.concurrency['cancel-in-progress'] === false ? 'queue' : 'cancel-pr');
    assert.deepEqual(c.paths, old.paths.filter(p => !['tools/score_skill.py', 'tools/lint_plugin.py', old.source].includes(p)));
    assert.equal(c.release.npmPublish, old.release['npm-publish'] ?? false);
    assert.equal(c.release.versionSource, old.release['version-source'] ?? 'auto');
    assert.equal(c.release.propagate, old.propagate);
  }
});
test('PR matrix emits every stable check and only executes changed skills', () => {
  const matrix = plan(config, { changed: ['resume'] }).include;
  assert.deepEqual(matrix.map(r => r.skill).sort(), Object.keys(config.skills).sort());
  assert.deepEqual(matrix.filter(r => r.changed).map(r => r.skill), ['resume']);
  assert.equal(plan(config).include.filter(r => r.changed).length, 0);
  const ci = workflow('ci');
  assert.equal(ci.jobs.ci.name, 'ci / ${{ matrix.skill }}');
  assert.equal(ci.jobs.ci.strategy['fail-fast'], false);
  assert.deepEqual(ci.on.pull_request.branches, ['main', 'feature/**']);
  assert.equal(ci.on.pull_request.paths, undefined);
  assert.deepEqual(ci.jobs.ci.permissions, { contents: 'read' });
});
test('release CI forces one skill, ordinary dispatch forces all, invalid selection fails closed', () => {
  assert.deepEqual(plan(config, { skill: 'press' }).include.map(r => [r.skill, r.changed]), [['press', true]]);
  assert.ok(plan(config, { force: true }).include.every(r => r.changed));
  for (const skill of ['../press', 'press\n', 'missing', '__proto__']) assert.throws(() => plan(config, { skill }));
  assert.throws(() => plan(config, { changed: ['missing'] }));
  const r = spawnSync('node', ['tools/skills-ci.mjs', 'plan'], { cwd: root, encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: '', EVENT_NAME: 'workflow_dispatch', SKILL: 'press', CHANGED_SKILLS: '[]' } });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout.slice('matrix='.length)).include.map(r => [r.skill, r.changed]), [['press', true]]);
});
test('filters preserve cross-skill dependencies and invalidate all skills for shared config/code changes', () => {
  const f = filters(config);
  assert.ok(f.skillhelp.includes('skills/**'));
  assert.ok(f.press.includes('skills/resume/skills/resume/assets/themes/press.css'));
  for (const paths of Object.values(f)) for (const p of config.sharedPaths) assert.ok(paths.includes(p));
});
test('malformed, duplicate, empty and unknown config is rejected', () => {
  assert.throws(() => parseConfig('{"skills":{},"skills":{}}'), /duplicate/);
  assert.throws(() => parseConfig('{"a":{"x":1,"\\u0078":2}}'), /duplicate/);
  for (const change of [c => c.schemaVersion = 2, c => c.skills = {}, c => c.extra = true,
    c => c.skills.press.python = '', c => c.skills.press.release.npmPublish = 'true',
    c => c.skills.press.paths = [], c => c.skills.press.checks[0].cwd = '../outside',
    c => c.skills.press.checks[0].run = 'echo ${{ github.event.title }}',
    c => c.skills.press.timeoutMinutes = 0]) {
    const c = structuredClone(config); change(c); assert.throws(() => validateConfig(c));
  }
});
test('coverage rejects missing/extra skill entries and duplicate components or required checks', t => {
  const c = structuredClone(config); delete c.skills.press;
  assert.throws(() => validateCoverage(root, c), /skill directories/);
  c.skills.extra = config.skills.press; assert.throws(() => validateCoverage(root, c), /skill directories/);
  const repo = mkdtempSync(join(tmpdir(), 'ci-coverage-')); t.after(() => rmSync(repo, { recursive: true, force: true }));
  mkdirSync(join(repo, '.github')); mkdirSync(join(repo, 'skills'));
  for (const n of Object.keys(config.skills)) mkdirSync(join(repo, 'skills', n));
  const policy = JSON.parse(read('.github/shipflow.json'));
  writeFileSync(join(repo, '.github/repo-settings.sh'), read('.github/repo-settings.sh'));
  for (const mutate of [p => p.release.components.push('press'), p => p.requiredChecks.pop(), p => p.requiredChecks.push(p.requiredChecks[0])]) {
    const p = structuredClone(policy); mutate(p); writeFileSync(join(repo, '.github/shipflow.json'), JSON.stringify(p));
    assert.throws(() => validateCoverage(repo, config), /registrations/);
  }
});
test('runner executes commands with pipefail and stops on the first failure', () => {
  const seen = [];
  assert.throws(() => runChecks(root, config, 'press', (bin, args, options) => { seen.push({ bin, args, options }); return { status: 7 }; }), /check failed/);
  assert.equal(seen.length, 1); assert.equal(seen[0].bin, 'bash');
  assert.deepEqual(seen[0].args.slice(0, 6), ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c']);
  const c = structuredClone(config); c.skills.press.checks = [{ run: 'false | true', cwd: '.' }];
  let calls = 0;
  assert.throws(() => runChecks(root, c, 'press', (bin, args, opts) => ++calls < 3 ? { status: 0 } : spawnSync(bin, args, { ...opts, stdio: 'pipe' })), /check failed/);
  assert.equal(calls, 3);
});
test('release dispatch selects one skill, runs isolated read-only CI first, and propagates only press', () => {
  const r = workflow('release-dispatch');
  assert.deepEqual(Object.keys(r.on), ['workflow_dispatch']);
  assert.equal(r.jobs.verify.uses, './.github/workflows/ci.yml');
  assert.equal(r.jobs.verify.with.skill, '${{ needs.select.outputs.skill }}');
  assert.deepEqual(r.jobs.verify.permissions, { contents: 'read', 'pull-requests': 'read' });
  assert.equal(r.jobs.verify.secrets, undefined);
  assert.deepEqual(r.jobs.release.needs, ['select', 'verify']);
  assert.equal(r.jobs.release.with.skill, '${{ needs.select.outputs.skill }}');
  assert.equal(r.jobs.release.with['npm-publish'], '${{ fromJSON(needs.select.outputs.npm-publish) }}');
  for (const n of ['select', 'release']) assert.equal(r.jobs[n].if, "github.ref == 'refs/heads/main' && github.event_name == 'workflow_dispatch'");
  assert.deepEqual(r.jobs.propagate.needs, ['select', 'release']);
  assert.equal(r.jobs.propagate.if, "needs.select.outputs.propagate == 'true'");
  assert.deepEqual(r.jobs.propagate.permissions, { contents: 'read' });
  assert.deepEqual(Object.entries(config.skills).filter(([, c]) => c.release.propagate).map(([n]) => n), ['press']);
  assert.deepEqual(Object.entries(config.skills).filter(([, c]) => c.release.npmPublish).map(([n]) => n), ['devlog', 'press', 'shipflow']);
});

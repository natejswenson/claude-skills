#!/usr/bin/env node
// Shared CI planner/runner. Config is strict JSON, a dependency-free YAML 1.2 subset.
import { appendFileSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { CONFIG_PATH, validateConfig, parseConfig } from '../skills/skillfactory/skills/skillfactory/scripts/lib/ci-config.mjs';
export { CONFIG_PATH, validateConfig };

function same(actual, expected, label) {
  if (!Array.isArray(actual) || new Set(actual).size !== actual.length || JSON.stringify([...actual].sort()) !== JSON.stringify([...expected].sort())) throw new Error(`${label}: missing, extra or duplicate skill/check registrations`);
}
export function validateCoverage(repo, config) {
  const names = Object.keys(config.skills);
  const dirs = readdirSync(join(repo, 'skills'), { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.')).map(d => d.name);
  const policy = JSON.parse(readFileSync(join(repo, '.github/shipflow.json'), 'utf8'));
  same(dirs, names, 'skill directories');
  same(policy.release.components, names, 'release components');
  const contexts = names.map(n => `ci / ${n}`);
  same(policy.requiredChecks, contexts, 'shipflow required checks');
  const settings = readFileSync(join(repo, '.github/repo-settings.sh'), 'utf8').match(/"contexts"\s*:\s*(\[[^\]]*\])/);
  if (!settings) throw new Error('repo-settings.sh: missing contexts');
  same(JSON.parse(settings[1]), contexts, 'repository required checks');
  return config;
}
export function loadConfig(repo) {
  return validateCoverage(repo, validateConfig(parseConfig(readFileSync(join(repo, CONFIG_PATH), 'utf8'))));
}
export function filters(config) {
  return Object.fromEntries(Object.entries(config.skills).map(([n, c]) => [n, [...new Set([...config.sharedPaths, ...c.paths])]]));
}
export function plan(config, { changed = [], skill = '', force = false } = {}) {
  if (!Array.isArray(changed) || changed.some(n => !Object.hasOwn(config.skills, n))) throw new Error('invalid changed skill list');
  if (skill && !Object.hasOwn(config.skills, skill)) throw new Error(`unknown skill: ${skill}`);
  const names = skill ? [skill] : Object.keys(config.skills);
  return { include: names.map(n => ({ skill: n, changed: Boolean(force || skill || changed.includes(n)), ...Object.fromEntries(['python', 'node', 'npmCache', 'timeoutMinutes', 'concurrency'].map(k => [k, config.skills[n][k]])) })) };
}
export function commands(config, name) {
  if (!Object.hasOwn(config.skills, name)) throw new Error(`unknown skill: ${name}`);
  return [
    { run: `python tools/score_skill.py skills/${name}/skills/${name} --min 100`, cwd: '.' },
    { run: `python tools/lint_plugin.py skills/${name}`, cwd: '.' },
    ...config.skills[name].checks,
  ];
}
export function runChecks(repo, config, name, execute = spawnSync) {
  const root = realpathSync(repo);
  for (const step of commands(config, name)) {
    const cwd = realpathSync(join(repo, step.cwd));
    if (cwd !== root && !cwd.startsWith(root + sep)) throw new Error('working directory escapes repository');
    // Commands are reviewed repository code, never evaluated from matrix outputs.
    console.log(`::group::${JSON.stringify(step.cwd)}: ${JSON.stringify(step.run)}`);
    const r = execute('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', step.run], { cwd, stdio: 'inherit' });
    console.log('::endgroup::');
    if (r.error || r.status !== 0) throw new Error(`check failed (${r.status ?? r.error?.message}): ${step.run}`);
  }
}
function output(key, value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (/[\r\n]/.test(text)) throw new Error('invalid multiline output');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${text}\n`);
  else console.log(`${key}=${text}`);
}
function main() {
  const repo = resolve(process.env.SKILLS_REPO || '.');
  const config = loadConfig(repo);
  const mode = process.argv[2];
  const skill = process.env.SKILL || '';
  if (mode === 'validate') console.log(`Validated ${Object.keys(config.skills).length} skills and required checks`);
  else if (mode === 'filters') output('filters', filters(config));
  else if (mode === 'plan') output('matrix', plan(config, { skill, force: ['workflow_dispatch', 'workflow_call'].includes(process.env.EVENT_NAME), changed: JSON.parse(process.env.CHANGED_SKILLS || '[]') }));
  else if (mode === 'select') {
    if (!Object.hasOwn(config.skills, skill)) throw new Error(`unknown skill: ${skill}`);
    output('skill', skill);
    output('npm-publish', config.skills[skill].release.npmPublish);
    output('version-source', config.skills[skill].release.versionSource);
    output('propagate', config.skills[skill].release.propagate);
  } else if (mode === 'run') runChecks(repo, config, skill);
  else throw new Error('usage: node tools/skills-ci.mjs validate|filters|plan|select|run (SKILL, CHANGED_SKILLS, EVENT_NAME via env)');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) { console.error(e.message); process.exitCode = 1; }
}

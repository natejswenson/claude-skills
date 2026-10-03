// Bundled config contract, shared by skillfactory and this repository's CI runner.
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
export const CONFIG_PATH = '.github/skills-config.yml';

// JSON.parse alone silently accepts duplicate keys. Reject them before parsing,
// including escaped spellings of the same key, without a YAML dependency.
export function parseConfig(text) {
  if (Buffer.byteLength(text) > 1024 * 1024) throw new Error('CI config exceeds 1 MiB');
  JSON.parse(text); // Establish valid JSON syntax before the structural walk.
  const tokens = text.match(/"(?:\\.|[^"\\])*"|[{}\[\]:,]|[^\s{}\[\]:,]+/g) ?? [];
  let i = 0;
  function value() {
    const token = tokens[i++];
    if (token === '{') {
      const seen = new Set();
      while (tokens[i] !== '}') {
        const key = JSON.parse(tokens[i++]);
        if (seen.has(key)) throw new Error(`duplicate CI config key: ${key}`);
        seen.add(key); i++; value();
        if (tokens[i] === ',') i++;
      }
      i++;
    } else if (token === '[') {
      while (tokens[i] !== ']') { value(); if (tokens[i] === ',') i++; }
      i++;
    }
  }
  value();
  return JSON.parse(text);
}

export function readCiConfig(repo) {
  const file = join(repo, CONFIG_PATH);
  // A present malformed/unreadable config is an error, never a legacy fallback.
  try { lstatSync(file); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  return validateConfig(parseConfig(readFileSync(file, 'utf8')));
}

export function ciEntry(spec) {
  const inner = `skills/${spec.name}/skills/${spec.name}`;
  const commands = spec.stack === 'node'
    ? ['npm install --no-fund', 'npm test', 'npm run audit']
    : ['pip install -r requirements-dev.txt', 'python -m pytest'];
  return {
    paths: [`skills/${spec.name}/**`, 'skills/press/skills/press/**'],
    python: '3.12', node: spec.stack === 'node' ? '22' : '', npmCache: '',
    timeoutMinutes: 360, concurrency: 'none',
    checks: [
      { run: `node skills/press/skills/press/bin/press.js check --repo . --target ${spec.name}-readme`, cwd: '.' },
      ...commands.map(run => ({ run, cwd: inner })),
    ],
    release: { versionSource: 'auto', npmPublish: Boolean(spec.npmPublish), propagate: false },
  };
}
const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function keys(value, allowed, label) {
  if (!object(value) || Object.keys(value).some(k => !allowed.includes(k))) throw new Error(`${label}: invalid object or unknown fields`);
}
function strings(value, label) {
  if (!Array.isArray(value) || !value.length || value.some(v => typeof v !== 'string' || !v.trim() || /[\r\n\0]/.test(v)) || new Set(value).size !== value.length) throw new Error(`${label}: expected unique nonempty strings`);
}
function inside(path, label) {
  if (typeof path !== 'string' || !path || path.startsWith('/') || path.split('/').includes('..') || /[\r\n\0]/.test(path)) throw new Error(`${label}: expected a repository-relative path`);
}
export function validateConfig(config) {
  keys(config, ['schemaVersion', 'sharedPaths', 'skills'], 'config');
  if (config.schemaVersion !== 1) throw new Error('unsupported config schemaVersion');
  strings(config.sharedPaths, 'sharedPaths');
  config.sharedPaths.forEach(p => inside(p, 'sharedPaths'));
  if (!object(config.skills) || !Object.keys(config.skills).length || Object.keys(config.skills).length > 256) throw new Error('skills must be a nonempty map of at most 256 entries');
  for (const [name, c] of Object.entries(config.skills)) {
    if (!slug.test(name)) throw new Error(`invalid skill name: ${name}`);
    keys(c, ['paths', 'python', 'node', 'npmCache', 'timeoutMinutes', 'concurrency', 'checks', 'release'], name);
    strings(c.paths, `${name}.paths`); c.paths.forEach(p => inside(p, `${name}.paths`));
    if (!c.paths.includes(`skills/${name}/**`) && !c.paths.includes('skills/**')) throw new Error(`${name}: missing own change path`);
    for (const field of ['python', 'node']) if (typeof c[field] !== 'string' || (field === 'python' && !c[field]) || (c[field] && !/^\d+(?:\.\d+){0,2}$/.test(c[field]))) throw new Error(`${name}: invalid ${field} runtime`);
    if (typeof c.npmCache !== 'string' || (c.npmCache && !c.node)) throw new Error(`${name}: invalid npmCache`);
    if (c.npmCache) inside(c.npmCache, `${name}.npmCache`);
    if (!Number.isInteger(c.timeoutMinutes) || c.timeoutMinutes < 1 || c.timeoutMinutes > 360) throw new Error(`${name}: invalid timeoutMinutes`);
    if (!['none', 'queue', 'cancel-pr'].includes(c.concurrency)) throw new Error(`${name}: invalid concurrency`);
    if (!Array.isArray(c.checks) || !c.checks.length) throw new Error(`${name}: missing checks`);
    for (const step of c.checks) {
      keys(step, ['run', 'cwd'], `${name}.checks`);
      if (typeof step.run !== 'string' || !step.run.trim() || step.run.includes('\0') || step.run.includes('${{')) throw new Error(`${name}: invalid command (Actions expressions belong in the workflow)`);
      inside(step.cwd, `${name}.cwd`);
    }
    keys(c.release, ['versionSource', 'npmPublish', 'propagate'], `${name}.release`);
    if (!['auto', 'package-json', 'skill-md'].includes(c.release.versionSource) || typeof c.release.npmPublish !== 'boolean' || typeof c.release.propagate !== 'boolean' || (c.release.propagate && name !== 'press')) throw new Error(`${name}: invalid release options`);
  }
  return config;
}

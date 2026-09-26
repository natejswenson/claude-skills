import { lstatSync, realpathSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, join, isAbsolute, sep } from 'node:path';

export const STATES = ['linked', 'missing', 'conflict', 'wrong-link', 'broken-link', 'parent-symlink', 'parent-file'];
const reserved = new Set(['scripts', 'tests', 'specs', 'docs', 'node_modules']);
const packageName = n => typeof n === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(n) && !reserved.has(n);
const within = (child, parent) => child === parent || child.startsWith(parent + sep);
export function stat(path) {
  try { return lstatSync(path); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
export function safeRelative(p) {
  return typeof p === 'string' && p.length > 0 && !isAbsolute(p) && !/[\\\x00-\x1f\x7f]/.test(p)
    && p.split('/').every(x => x && x !== '.' && x !== '..');
}
function fail(message) { throw new Error(message); }
export function protectedPath(p) {
  const parts = p.split('/');
  if (parts.some(x => /^(?:\.git|node_modules|__pycache__|\.DS_Store|\.env(?:\..*)?|hosts\.yml|auth\.json|credentials(?:\.json)?|settings\.local\.json)$/.test(x)
    || /\.(?:pyc|local|secret|bak|backup|swp|key|pem)$/.test(x))) return true;
  return /^(?:\.ssh|\.aws|\.gnupg|\.local\/share)(?:\/|$)/.test(p)
    || /^(?:\.claude\/(?:CLAUDE\.md|\.credentials\.json|plugins|projects|sessions|history\.jsonl)|\.codex\/(?:config\.toml|AGENTS\.md|auth\.json|history\.jsonl|sessions|plugins|sqlite))(?:(?:\/|$))/.test(p);
}
function readJSONFile(path) {
  const s = stat(path);
  if (!s?.isFile() || s.isSymbolicLink() || s.size > 1024 * 1024) fail('Expected a regular JSON file no larger than 1 MiB');
  return JSON.parse(readFileSync(path, 'utf8'));
}
export function readSnapshot(path) { return validateSnapshot(readJSONFile(path)); }
function directory(path, label) {
  const canonical = realpathSync(resolve(path));
  if (!stat(canonical)?.isDirectory()) fail(`${label} must be an existing directory`);
  return canonical;
}
function collision(paths) {
  const sorted = [...paths].sort();
  const seen = new Set();
  for (const p of sorted) {
    if (seen.has(p)) fail(`Overlapping managed destination: ${p}`);
    const parts = p.split('/');
    for (let i = 1; i < parts.length; i++) {
      if (seen.has(parts.slice(0, i).join('/'))) fail(`Ancestor destination collision: ${p}`);
    }
    seen.add(p);
  }
}
function policyFile(path, label, policies) {
  if (stat(path)) policies.add(label); // Presence only: never read arbitrary policy bodies.
}
export function inspect({ repo, target, packages = [] }) {
  if (!repo || !target) fail('--repo and --target are required');
  repo = directory(repo, 'Checkout');
  target = directory(target, 'Target');
  if (within(target, repo)) fail('Target cannot be at or inside the checkout');
  const manifest = readJSONFile(join(repo, 'packages.json'));
  if (!Array.isArray(manifest) || !manifest.length || !manifest.every(packageName)
      || new Set(manifest).size !== manifest.length) fail('packages.json must be a nonempty array of unique, safe package names; tooling directories are reserved');
  if (!Array.isArray(packages) || !packages.every(packageName) || new Set(packages).size !== packages.length) fail('Invalid or duplicate package selection');
  const selected = [...(packages.length ? packages : manifest)].sort();
  for (const p of selected) if (!manifest.includes(p)) fail(`Unknown package: ${p}`);
  const all = [], excluded = [], policies = new Set();
  policyFile(join(repo, '.stowrc'), 'checkout/.stowrc', policies);
  policyFile(join(target, '.stowrc'), 'target/.stowrc', policies);
  policyFile(join(target, '.stow-global-ignore'), 'target/.stow-global-ignore', policies);
  for (const name of [...manifest].sort()) {
    const base = join(repo, name);
    if (!stat(base)?.isDirectory() || stat(base).isSymbolicLink()) fail(`Package must be a real directory: ${name}`);
    const before = all.length;
    function walk(dir, prefix = '') {
      for (const item of readdirSync(dir).sort()) {
        const p = prefix ? `${prefix}/${item}` : item;
        if (!safeRelative(p)) fail(`Unsafe path in package ${name}`);
        if (item === '.stow-local-ignore') { policies.add(`package/${name}/${p}`); continue; }
        if (protectedPath(p)) { excluded.push({ package: name, path: p }); continue; }
        const source = join(dir, item), s = stat(source);
        if (!s || s.isSymbolicLink()) fail(`Source symlinks or disappearing files require review: ${name}/${p}`);
        if (s.isDirectory()) walk(source, p);
        else if (s.isFile()) all.push({ package: name, path: p });
        else fail(`Special source file requires review: ${name}/${p}`);
      }
    }
    walk(base);
    if (all.length === before) fail(`Package has no eligible managed files: ${name}`);
  }
  collision(all.map(x => x.path)); // Include unselected packages.
  for (const { path } of all) {
    const destination = join(target, path);
    if (within(destination, repo) || within(repo, destination)) fail(`Managed destination overlaps checkout: ${path}`);
  }
  const files = all.filter(x => selected.includes(x.package)).map(row => {
    let parent = target, state;
    for (const part of row.path.split('/').slice(0, -1)) {
      parent = join(parent, part);
      const s = stat(parent);
      if (s?.isSymbolicLink()) { state = 'parent-symlink'; break; }
      if (s && !s.isDirectory()) { state = 'parent-file'; break; }
      if (!s) break;
    }
    if (!state) {
      const destination = join(target, row.path), s = stat(destination);
      if (!s) state = 'missing';
      else if (!s.isSymbolicLink()) state = 'conflict';
      else {
        try { state = realpathSync(destination) === join(repo, row.package, row.path) ? 'linked' : 'wrong-link'; }
        catch (e) { if (['ENOENT', 'ENOTDIR', 'ELOOP'].includes(e.code)) state = 'broken-link'; else throw e; }
      }
    }
    return { ...row, state };
  });
  const result = {
    schemaVersion: 1,
    packages: selected,
    files,
    excluded: excluded.filter(x => selected.includes(x.package)),
    policyFiles: [...policies].sort(),
    counts: Object.fromEntries(STATES.map(s => [s, files.filter(x => x.state === s).length])),
    linkPolicy: 'review-required',
  };
  return validateSnapshot(result);
}
export function validateSnapshot(s) {
  const keysMatch = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
  if (!keysMatch(s, ['schemaVersion', 'packages', 'files', 'excluded', 'policyFiles', 'counts', 'linkPolicy'])) fail('Unexpected inspection fields');
  if (!s || s.schemaVersion !== 1 || s.linkPolicy !== 'review-required'
      || !Array.isArray(s.packages) || !s.packages.length || !s.packages.every(packageName)
      || new Set(s.packages).size !== s.packages.length || !Array.isArray(s.files) || !s.files.length
      || !Array.isArray(s.excluded) || !Array.isArray(s.policyFiles)) fail('Invalid inspection schema');
  for (const row of [...s.files, ...s.excluded]) {
    if (!row || !s.packages.includes(row.package) || !safeRelative(row.path)) fail('Unsafe inspection row');
  }
  for (const row of s.files) if (!keysMatch(row, ['package', 'path', 'state']) || !STATES.includes(row.state) || protectedPath(row.path)) fail('Invalid managed row');
  for (const row of s.excluded) if (!keysMatch(row, ['package', 'path']) || !protectedPath(row.path)) fail('Invalid excluded row');
  if (!s.policyFiles.every(p => safeRelative(p))) fail('Unsafe policy path');
  collision(s.files.map(x => x.path));
  for (const p of s.packages) if (!s.files.some(x => x.package === p)) fail('Inspection package has no managed rows');
  if (!keysMatch(s.counts, STATES)) fail('Unexpected count fields');
  for (const state of STATES) if (s.counts?.[state] !== s.files.filter(x => x.state === state).length) fail('Inspection counts disagree with rows');
  return s;
}
export function verify(snapshot) {
  validateSnapshot(snapshot);
  return snapshot.files.every(x => x.state === 'linked');
}
const escapeCell = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('|', '&#124;').replaceAll('`', '&#96;');
export function render(snapshot) {
  const s = validateSnapshot(snapshot);
  return ['# Dotfiles inspection', '', '| Package | Managed path | State |', '|---|---|---|',
    ...s.files.map(x => `| ${escapeCell(x.package)} | ${escapeCell(x.path)} | ${x.state} |`), '',
    `${s.files.length} managed files across ${s.packages.length} packages; ${s.counts.linked} linked.`, '',
    'Link policy: review required before mutation; inspection does not model Stow ignore rules.',
    ...(s.policyFiles.length ? ['', 'Policy files to review:', ...s.policyFiles.map(p => `- ${escapeCell(p)}`)] : []),
    ...(s.excluded.length ? ['', 'Protected paths excluded (metadata only):', ...s.excluded.map(x => `- ${escapeCell(x.package + '/' + x.path)}`)] : []), ''].join('\n');
}

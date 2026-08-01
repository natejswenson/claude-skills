import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import { loadTokens } from '../lib/tokens.mjs';
import { emitBody } from '../lib/emit.mjs';
import { renderRegion } from '../lib/region.mjs';
import { checkAll, checkTarget, lineDiff } from '../lib/check.mjs';
import { selectTargets, loadTargets, repoRoot, TargetError } from '../lib/targets.mjs';

const tokens = loadTokens();
const V = '9.9.9';

const TARGET = {
  id: 'demo',
  repo: 'demo',
  path: 'theme.css',
  region: 'tokens',
  syntax: 'css',
  emitter: 'css-vars',
  params: { vars: ['paper', 'ink'], comments: false },
};

function sandbox(contents) {
  const root = mkdtempSync(join(tmpdir(), 'press-check-'));
  for (const [rel, text] of Object.entries(contents)) {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text, 'utf8');
  }
  return root;
}

const inSync = () =>
  `/* head */\n${renderRegion('tokens', 'css', emitBody(tokens, 'css-vars', TARGET.params), V)}\n/* tail */\n`;

test('an in-sync region reports ok', () => {
  const root = sandbox({ 'theme.css': inSync() });
  assert.equal(checkTarget(TARGET, root, tokens, V).status, 'ok');
});

test('a hand-edited region reports drift, with a diff naming the changed line', () => {
  const root = sandbox({ 'theme.css': inSync().replace('#F5F0E6', '#FFFFFF') });
  const result = checkTarget(TARGET, root, tokens, V);
  assert.equal(result.status, 'drift');
  assert.match(result.diff, /^- {3}--paper: #FFFFFF;$/m);
  assert.match(result.diff, /^\+ {3}--paper: #F5F0E6;$/m);
});

test('a region deleted from the file reports missing — it must never pass as clean', () => {
  const root = sandbox({ 'theme.css': ':root { --paper: #F5F0E6; }\n' });
  assert.equal(checkTarget(TARGET, root, tokens, V).status, 'missing');
});

test('a declared file that is not there reports absent', () => {
  assert.equal(checkTarget(TARGET, sandbox({}), tokens, V).status, 'absent');
});

test('malformed markers report corrupt rather than throwing out of the run', () => {
  const root = sandbox({ 'theme.css': `${inSync().split('\n')[1]}\n:root {}\n` });
  const result = checkTarget(TARGET, root, tokens, V);
  assert.equal(result.status, 'corrupt');
  assert.match(result.detail, /never closes/);
});

test('a run that resolved zero targets is a failure, not a pass', () => {
  const report = checkAll({ tokens, targets: [TARGET], root: sandbox({}), ids: [], version: V });
  assert.equal(report.empty, true);
  assert.equal(report.ok, false, 'an empty run must never report ok');
});

test('checkAll is ok only when something was actually checked and all of it passed', () => {
  const root = sandbox({ 'theme.css': inSync() });
  const report = checkAll({ tokens, targets: [TARGET], root, ids: [], version: V });
  assert.equal(report.ok, true);
  assert.equal(report.results.length, 1);
});

test('a stale token value in one target fails the whole run', () => {
  const root = sandbox({ 'theme.css': inSync().replace('#181510', '#000000') });
  const report = checkAll({ tokens, targets: [TARGET], root, ids: [], version: V });
  assert.equal(report.ok, false);
  assert.equal(report.failures[0].status, 'drift');
});

test('selectTargets picks by file presence, so one registry serves every repo', () => {
  const root = sandbox({ 'theme.css': inSync() });
  const other = { ...TARGET, id: 'elsewhere', path: 'nope/other.css' };
  const picked = selectTargets([TARGET, other], { root, ids: [] });
  assert.deepEqual(picked.map((t) => t.id), ['demo']);
});

test('an explicit --target that does not exist is an error, not an empty selection', () => {
  assert.throws(() => selectTargets([TARGET], { root: '/tmp', ids: ['ghost'] }), TargetError);
});

test('lineDiff elides the identical body so a one-line change reads as one line', () => {
  const a = 'x\ny\nz\n1\n2\n3';
  const diff = lineDiff(a, a.replace('1', '9'));
  assert.match(diff, /… 3 identical lines/);
  assert.match(diff, /^- 9$/m);
  assert.match(diff, /^\+ 1$/m);
});

test('every registered target names a real emitter and syntax', () => {
  const targets = loadTargets();
  assert.ok(targets.length >= 8, 'the registry must not shrink silently');
  for (const t of targets) {
    assert.doesNotThrow(
      () => emitBody(tokens, t.emitter, t.params ?? {}),
      `target ${t.id} does not emit`,
    );
    assert.ok(['python', 'css', 'md'].includes(t.syntax), `${t.id}: ${t.syntax}`);
  }
});

test('the live repo is in sync and covers every in-repo consumer', () => {
  const root = repoRoot(dirname(new URL(import.meta.url).pathname));
  const report = checkAll({ tokens, targets: loadTargets(), root, ids: [], version: V });
  assert.ok(report.results.length >= 5, `only ${report.results.length} targets resolved in-repo`);
  assert.deepEqual(
    report.failures.map((f) => `${f.target.id}:${f.status}`),
    [],
    'run `node bin/press.js emit` to resync',
  );
});

// --- repo identity --------------------------------------------------------
// File presence alone cannot identify a consumer: README.md exists in every
// repo, so a README target would select inside any checkout and be compared
// against the wrong file.

test('a checkout that names itself only matches its own targets', async () => {
  const { execFileSync } = await import('node:child_process');
  const root = sandbox({ 'README.md': 'hello\n', 'theme.css': inSync() });
  execFileSync('git', ['-C', root, 'init', '-q']);
  execFileSync('git', ['-C', root, 'remote', 'add', 'origin',
    'https://github.com/someone/other-repo.git']);

  const readmeTarget = { ...TARGET, id: 'readme', path: 'README.md', region: 'version', syntax: 'md' };
  const picked = selectTargets([TARGET, readmeTarget], { root, ids: [] });
  assert.deepEqual(picked, [], 'this checkout is other-repo; neither target belongs to it');
});

test('a checkout matching a target\'s repo still selects it', async () => {
  const { execFileSync } = await import('node:child_process');
  const root = sandbox({ 'theme.css': inSync() });
  execFileSync('git', ['-C', root, 'init', '-q']);
  execFileSync('git', ['-C', root, 'remote', 'add', 'origin',
    'https://github.com/natejswenson/demo.git']);
  assert.deepEqual(selectTargets([TARGET], { root, ids: [] }).map((t) => t.id), ['demo']);
});

test('with no remote at all, selection falls back to file presence', () => {
  const root = sandbox({ 'theme.css': inSync() });
  assert.deepEqual(selectTargets([TARGET], { root, ids: [] }).map((t) => t.id), ['demo']);
});

test('the github field wins over repo when resolving identity', async () => {
  const { execFileSync } = await import('node:child_process');
  const root = sandbox({ 'theme.css': inSync() });
  execFileSync('git', ['-C', root, 'init', '-q']);
  execFileSync('git', ['-C', root, 'remote', 'add', 'origin',
    'https://github.com/natejswenson/local-budget.git']);
  const t = { ...TARGET, repo: 'budget', github: 'local-budget' };
  assert.deepEqual(selectTargets([t], { root, ids: [] }).map((x) => x.id), ['demo']);
});

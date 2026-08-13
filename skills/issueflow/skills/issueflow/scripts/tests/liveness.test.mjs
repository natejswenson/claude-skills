/**
 * Liveness: making a run's state legible to a user who is looking at it right
 * now, rather than only after a stage finishes.
 *
 * unreadable-run-row (#223) is the first piece: `runs` used to discard a
 * `RunError` that `loadRun` already wrote to be actionable, rendering the row
 * as a bare `(unreadable run)` with no reason and no remedy.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRun } from '../lib/run.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = join(HERE, '..', '..');
const CLI = join(SKILL, 'scripts', 'issueflow.js');

const cli = (args) => {
  try {
    const out = execFileSync(process.execPath, [CLI, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_TEST_CONTEXT: undefined },
    });
    return { code: 0, out, err: '' };
  } catch (e) {
    return { code: e.status ?? 1, out: String(e.stdout ?? ''), err: String(e.stderr ?? '') };
  }
};

const policy = { base: 'dev', featurePrefix: 'feature/', mergeMethod: 'squash', source: 'test', shipflow: false };

/** A well-formed run root: one readable schema-2 run, one schema-1 run `loadRun` refuses. */
function mixedRunRoot() {
  const root = mkdtempSync(join(tmpdir(), 'issueflow-runs-'));

  const readableDir = join(root, 'x__y', 'issue-1');
  mkdirSync(readableDir, { recursive: true });
  const readable = createRun({
    repo: { owner: 'x', name: 'y', path: '/tmp/x' },
    issue: { number: 1, title: 'a readable run', url: 'https://github.com/x/y/issues/1' },
    policy,
  });
  writeFileSync(join(readableDir, 'run.json'), `${JSON.stringify(readable, null, 2)}\n`);

  const staleDir = join(root, 'x__y', 'issue-2');
  mkdirSync(staleDir, { recursive: true });
  const stale = createRun({
    repo: { owner: 'x', name: 'y', path: '/tmp/x' },
    issue: { number: 2, title: 'a schema-1 run', url: 'https://github.com/x/y/issues/2' },
    policy,
  });
  writeFileSync(join(staleDir, 'run.json'), `${JSON.stringify({ ...stale, schema: 1 }, null, 2)}\n`);

  return { root, staleDir };
}

// ---------------------------------------------------------------------------
// unreadable-run-row (trap) — the known-bad side. Without this, `runs`
// swallowing the reason regresses silently the day someone touches its catch.
// ---------------------------------------------------------------------------
test('unreadable-run-row: a schema-1 run names the reason and the remedy', () => {
  const { root, staleDir } = mixedRunRoot();
  const r = cli(['runs', '--run-root', root]);
  assert.equal(r.code, 0, `runs exited ${r.code}: ${r.err}`);
  assert.doesNotMatch(r.out, /\(unreadable run\)/, 'the row still says nothing — the catch was not bound');
  assert.match(r.out, /schema 1/, 'the reason lost which schema the run is');
  assert.match(r.out, /start the issue again/, 'the remedy loadRun already wrote got discarded');
  rmSync(root, { recursive: true, force: true });
});

test('unreadable-run-row: the unreadable row keeps its directory name in Title, not a placeholder', () => {
  const { root } = mixedRunRoot();
  const r = cli(['runs', '--run-root', root]);
  // Anchored on the Title *cell*, not on the output as a whole — the Issue
  // cell (column 1) already contains "x__y/issue-2" on both sides of this
  // fix, so a bare /\bissue-2\b/ against the whole table would pass even
  // against the pre-fix '(unreadable run)' placeholder. Parse the row and
  // check column 2 specifically.
  const row = r.out.split('\n')
    .filter((line) => line.startsWith('|'))
    .map((line) => line.split('|').map((cell) => cell.trim()))
    .find((cells) => cells[1] === 'x__y/issue-2');
  assert.ok(row, `no table row found for x__y/issue-2 in:\n${r.out}`);
  assert.equal(row[2], 'issue-2', `the Title cell must carry the directory name, not a placeholder — got ${JSON.stringify(row[2])}`);
  rmSync(root, { recursive: true, force: true });
});

test('unreadable-run-row: two-sided — a readable run in the same table still renders its title and position', () => {
  const { root } = mixedRunRoot();
  const r = cli(['runs', '--run-root', root]);
  assert.match(r.out, /x\/y#1/, 'the readable row went missing — the bound catch must not have swallowed it too');
  assert.match(r.out, /a readable run/, 'the readable row lost its title');
  assert.match(r.out, /0\/\d+/, 'the readable row lost its approved count');
  rmSync(root, { recursive: true, force: true });
});

test('unreadable-run-row: no padded table cell carries an absolute path', () => {
  const { root } = mixedRunRoot();
  const r = cli(['runs', '--run-root', root]);
  for (const line of r.out.split('\n')) {
    if (!line.startsWith('|')) continue;
    assert.doesNotMatch(line, /\/(tmp|var|home|Users)\//, `a padded cell carries a machine-dependent path: ${line}`);
  }
  // The full reason, path included, is allowed — just not inside the table.
  assert.match(r.out, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'the full reason lost the path entirely — nothing tells the user which directory to look at');
  rmSync(root, { recursive: true, force: true });
});

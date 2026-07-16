import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadStyleGuide, getRecentCovers, mergeManifestEntries } from '../lib/cover_gen.mjs';
import { CONFIG_DIR } from '../lib/core.mjs';

function makeDirs(t) {
  const root = mkdtempSync(join(tmpdir(), 'devlog-cover-gen-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cloneDir = join(root, 'clone');
  mkdirSync(cloneDir);
  return { root, cloneDir };
}

function writeManifest(cloneDir, project, entries) {
  const dir = join(cloneDir, project);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ entries }));
}

const config = (...keys) => ({ projects: keys.map((key) => ({ key, path: '/x', remote: `me/${key}` })) });

test('loadStyleGuide reflects whether the real install exists at CONFIG_DIR', () => {
  // Not asserting a specific outcome (depends on this machine's real ~/.claude state) —
  // just that the function does not throw an unexpected error shape either way.
  try {
    const text = loadStyleGuide();
    assert.equal(typeof text, 'string');
  } catch (e) {
    assert.match(e.message, /Cover style guide not found/);
  }
  void CONFIG_DIR;
});

test('mergeManifestEntries merges multiple projects, tagging each entry with its project', (t) => {
  const { cloneDir } = makeDirs(t);
  writeManifest(cloneDir, 'proj-a', [{ date: '2026-07-01', file: 'v0.1.0.md', version: 'v0.1.0' }]);
  writeManifest(cloneDir, 'proj-b', [{ date: '2026-07-02', file: 'v0.2.0.md', version: 'v0.2.0' }]);

  const merged = mergeManifestEntries(cloneDir, config('proj-a', 'proj-b'));
  assert.deepEqual(merged.map((e) => `${e.project}/${e.version}`).sort(), ['proj-a/v0.1.0', 'proj-b/v0.2.0']);
});

test('mergeManifestEntries treats a never-published project (no directory) as zero entries, not an error', (t) => {
  const { cloneDir } = makeDirs(t);
  writeManifest(cloneDir, 'proj-a', [{ date: '2026-07-01', file: 'v0.1.0.md', version: 'v0.1.0' }]);
  // 'never-published' has no directory in the clone at all.
  const merged = mergeManifestEntries(cloneDir, config('proj-a', 'never-published'));
  assert.deepEqual(merged.map((e) => e.project), ['proj-a']);
});

test('mergeManifestEntries throws a clear error naming a project whose directory exists but has no manifest.json', (t) => {
  const { cloneDir } = makeDirs(t);
  mkdirSync(join(cloneDir, 'drifted'), { recursive: true });
  assert.throws(() => mergeManifestEntries(cloneDir, config('drifted')), /manifest\.json missing for project "drifted"/);
});

test('mergeManifestEntries throws a clear error naming a project whose manifest.json fails to parse', (t) => {
  const { cloneDir } = makeDirs(t);
  mkdirSync(join(cloneDir, 'broken'), { recursive: true });
  writeFileSync(join(cloneDir, 'broken', 'manifest.json'), '{not json');
  assert.throws(() => mergeManifestEntries(cloneDir, config('broken')), /failed to parse/);
});

test('getRecentCovers returns [] when no covers exist anywhere and no stagingDir is given', (t) => {
  const { cloneDir } = makeDirs(t);
  writeManifest(cloneDir, 'proj-a', [{ date: '2026-07-01', file: 'v0.1.0.md', version: 'v0.1.0' }]);
  assert.deepEqual(getRecentCovers({ cloneDir, config: config('proj-a'), n: 3 }), []);
});

test('getRecentCovers returns the N most recent cover-bearing entries across all projects, newest first', (t) => {
  const { cloneDir } = makeDirs(t);
  writeManifest(cloneDir, 'proj-a', [
    { date: '2026-07-01', file: 'v0.1.0.md', version: 'v0.1.0', cover: { file: 'v0.1.0.png', bytes: 10 } },
    { date: '2026-07-05', file: 'v0.2.0.md', version: 'v0.2.0', cover: { file: 'v0.2.0.png', bytes: 10 } },
  ]);
  writeManifest(cloneDir, 'proj-b', [
    { date: '2026-07-03', file: 'v0.5.0.md', version: 'v0.5.0', cover: { file: 'v0.5.0.png', bytes: 10 } },
  ]);

  const result = getRecentCovers({ cloneDir, config: config('proj-a', 'proj-b'), n: 3 });
  assert.deepEqual(result.map((r) => `${r.project}/${r.slug}`), ['proj-a/v0.2.0', 'proj-b/v0.5.0', 'proj-a/v0.1.0']);
  assert.equal(result[0].path, join(cloneDir, 'proj-a', 'v0.2.0.png'));
});

test('getRecentCovers never counts entries missing a cover field', (t) => {
  const { cloneDir } = makeDirs(t);
  writeManifest(cloneDir, 'proj-a', [
    { date: '2026-07-01', file: 'v0.1.0.md', version: 'v0.1.0' }, // no cover
    { date: '2026-07-05', file: 'v0.2.0.md', version: 'v0.2.0', cover: { file: 'v0.2.0.png', bytes: 10 } },
  ]);
  const result = getRecentCovers({ cloneDir, config: config('proj-a'), n: 3 });
  assert.deepEqual(result.map((r) => r.slug), ['v0.2.0']);
});

test('getRecentCovers tops up from stagingDir (freshest-first) when fewer than n published covers exist', (t) => {
  const { cloneDir, root } = makeDirs(t);
  writeManifest(cloneDir, 'proj-a', [
    { date: '2026-07-01', file: 'v0.1.0.md', version: 'v0.1.0', cover: { file: 'v0.1.0.png', bytes: 10 } },
  ]);
  const stagingDir = join(root, 'staging');
  mkdirSync(join(stagingDir, 'proj-b'), { recursive: true });
  mkdirSync(join(stagingDir, 'proj-c'), { recursive: true });
  writeFileSync(join(stagingDir, 'proj-b', 'v0.1.0.png'), 'older');
  writeFileSync(join(stagingDir, 'proj-c', 'v0.1.0.png'), 'newer');
  const now = Date.now() / 1000;
  utimesSync(join(stagingDir, 'proj-b', 'v0.1.0.png'), now - 100, now - 100);
  utimesSync(join(stagingDir, 'proj-c', 'v0.1.0.png'), now, now);

  const result = getRecentCovers({ cloneDir, config: config('proj-a'), stagingDir, n: 3 });
  assert.deepEqual(result.map((r) => `${r.project}/${r.slug}`), ['proj-a/v0.1.0', 'proj-c/v0.1.0', 'proj-b/v0.1.0']);
});

test('getRecentCovers ignores stagingDir entirely once n published covers already exist', (t) => {
  const { cloneDir, root } = makeDirs(t);
  writeManifest(cloneDir, 'proj-a', [
    { date: '2026-07-01', file: 'v0.1.0.md', version: 'v0.1.0', cover: { file: 'v0.1.0.png', bytes: 10 } },
  ]);
  const stagingDir = join(root, 'staging');
  mkdirSync(join(stagingDir, 'proj-z'), { recursive: true });
  writeFileSync(join(stagingDir, 'proj-z', 'v9.0.0.png'), 'x');

  const result = getRecentCovers({ cloneDir, config: config('proj-a'), stagingDir, n: 1 });
  assert.deepEqual(result.map((r) => `${r.project}/${r.slug}`), ['proj-a/v0.1.0']);
});

test('getRecentCovers given a project directory that does not exist at all does not throw (zero entries for it)', (t) => {
  const { cloneDir } = makeDirs(t);
  writeManifest(cloneDir, 'proj-a', [
    { date: '2026-07-01', file: 'v0.1.0.md', version: 'v0.1.0', cover: { file: 'v0.1.0.png', bytes: 10 } },
  ]);
  const result = getRecentCovers({ cloneDir, config: config('proj-a', 'never-published'), n: 3 });
  assert.deepEqual(result.map((r) => r.project), ['proj-a']);
});

test('getRecentCovers given a project whose manifest.json is missing/unparseable throws', (t) => {
  const { cloneDir } = makeDirs(t);
  mkdirSync(join(cloneDir, 'drifted'), { recursive: true });
  assert.throws(() => getRecentCovers({ cloneDir, config: config('drifted'), n: 3 }), /manifest\.json missing/);
});

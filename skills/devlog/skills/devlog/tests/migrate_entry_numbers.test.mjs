import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { migrateEntryNumbers } from '../lib/migrate_entry_numbers.mjs';

function makeCorpus(t) {
  const corpusDir = mkdtempSync(join(tmpdir(), 'devlog-migrate-'));
  t.after(() => rmSync(corpusDir, { recursive: true, force: true }));
  return corpusDir;
}

function writeManifest(corpusDir, project, entries) {
  mkdirSync(join(corpusDir, project), { recursive: true });
  writeFileSync(join(corpusDir, project, 'manifest.json'), JSON.stringify({ entries }, null, 2) + '\n');
}

function readManifest(corpusDir, project) {
  return JSON.parse(readFileSync(join(corpusDir, project, 'manifest.json'), 'utf8'));
}

function row(date, file, extra = {}) {
  return { date, file, title: 't', summary: 's', version: file.replace(/\.md$/, ''), tags: [], ...extra };
}

test('migrateEntryNumbers assigns 1..N ascending by date across projects', (t) => {
  const corpusDir = makeCorpus(t);
  writeManifest(corpusDir, 'alpha', [row('2026-06-02', 'v2.md'), row('2026-06-01', 'v1.md')]);
  writeManifest(corpusDir, 'beta', [row('2026-06-03', 'v3.md')]);

  const result = migrateEntryNumbers(corpusDir);
  assert.equal(result.assigned.length, 3);
  assert.equal(result.startingNo, 1);
  assert.equal(result.endingNo, 3);

  const alpha = readManifest(corpusDir, 'alpha').entries;
  const beta = readManifest(corpusDir, 'beta').entries;
  assert.equal(alpha.find((e) => e.file === 'v1.md').no, 1);
  assert.equal(alpha.find((e) => e.file === 'v2.md').no, 2);
  assert.equal(beta.find((e) => e.file === 'v3.md').no, 3);
});

test('migrateEntryNumbers breaks same-date ties by project name, then filename', (t) => {
  const corpusDir = makeCorpus(t);
  const date = '2026-06-01';
  // Project names deliberately out of manifest-array order to prove the
  // tiebreak sorts by project name, not by directory listing/write order.
  writeManifest(corpusDir, 'zzz-project', [row(date, 'v1.md')]);
  writeManifest(corpusDir, 'aaa-project', [row(date, 'v2.md'), row(date, 'v1.md')]);

  const result = migrateEntryNumbers(corpusDir);
  const byNo = result.assigned.slice().sort((a, b) => a.no - b.no);
  assert.deepEqual(
    byNo.map((r) => `${r.project}/${r.file}`),
    ['aaa-project/v1.md', 'aaa-project/v2.md', 'zzz-project/v1.md'],
  );
});

test('migrateEntryNumbers continues from the existing max `no`, skipping already-numbered rows', (t) => {
  const corpusDir = makeCorpus(t);
  writeManifest(corpusDir, 'proj', [
    row('2026-06-01', 'v1.md', { no: 5 }),
    row('2026-06-02', 'v2.md'),
  ]);

  const result = migrateEntryNumbers(corpusDir);
  assert.equal(result.assigned.length, 1);
  assert.equal(result.assigned[0].no, 6);
  const entries = readManifest(corpusDir, 'proj').entries;
  assert.equal(entries.find((e) => e.file === 'v1.md').no, 5);
  assert.equal(entries.find((e) => e.file === 'v2.md').no, 6);
});

test('migrateEntryNumbers is idempotent: re-running assigns nothing new', (t) => {
  const corpusDir = makeCorpus(t);
  writeManifest(corpusDir, 'alpha', [row('2026-06-02', 'v2.md'), row('2026-06-01', 'v1.md')]);
  writeManifest(corpusDir, 'beta', [row('2026-06-03', 'v3.md')]);

  migrateEntryNumbers(corpusDir);
  const before = {
    alpha: readFileSync(join(corpusDir, 'alpha', 'manifest.json'), 'utf8'),
    beta: readFileSync(join(corpusDir, 'beta', 'manifest.json'), 'utf8'),
  };

  const second = migrateEntryNumbers(corpusDir);
  assert.equal(second.assigned.length, 0);
  assert.equal(second.touchedProjects.length, 0);

  const after = {
    alpha: readFileSync(join(corpusDir, 'alpha', 'manifest.json'), 'utf8'),
    beta: readFileSync(join(corpusDir, 'beta', 'manifest.json'), 'utf8'),
  };
  assert.equal(after.alpha, before.alpha);
  assert.equal(after.beta, before.beta);
});

test('migrateEntryNumbers only mutates the `no` field — other fields and key order survive untouched', (t) => {
  const corpusDir = makeCorpus(t);
  writeManifest(corpusDir, 'proj', [
    { date: '2026-06-01', file: 'v1.md', title: 'Real title', summary: 'Real summary.', version: 'v1', tags: ['a'], cover: { file: 'v1.png', bytes: 123 } },
  ]);

  migrateEntryNumbers(corpusDir);
  const entry = readManifest(corpusDir, 'proj').entries[0];
  assert.deepEqual(Object.keys(entry), ['date', 'file', 'title', 'summary', 'version', 'tags', 'no', 'cover']);
  assert.equal(entry.title, 'Real title');
  assert.equal(entry.summary, 'Real summary.');
  assert.deepEqual(entry.cover, { file: 'v1.png', bytes: 123 });
});

test('migrateEntryNumbers appends `no` at the end when the row has no cover field', (t) => {
  const corpusDir = makeCorpus(t);
  writeManifest(corpusDir, 'proj', [row('2026-06-01', 'v1.md')]);

  migrateEntryNumbers(corpusDir);
  const entry = readManifest(corpusDir, 'proj').entries[0];
  assert.deepEqual(Object.keys(entry), ['date', 'file', 'title', 'summary', 'version', 'tags', 'no']);
});

test('migrateEntryNumbers dryRun computes the assignment but writes nothing', (t) => {
  const corpusDir = makeCorpus(t);
  writeManifest(corpusDir, 'proj', [row('2026-06-01', 'v1.md')]);
  const before = readFileSync(join(corpusDir, 'proj', 'manifest.json'), 'utf8');

  const result = migrateEntryNumbers(corpusDir, { dryRun: true });
  assert.equal(result.assigned.length, 1);
  assert.equal(readFileSync(join(corpusDir, 'proj', 'manifest.json'), 'utf8'), before);
});

test('migrateEntryNumbers throws on a malformed manifest rather than silently skipping it', (t) => {
  const corpusDir = makeCorpus(t);
  mkdirSync(join(corpusDir, 'broken'));
  writeFileSync(join(corpusDir, 'broken', 'manifest.json'), JSON.stringify({ notEntries: [] }));

  assert.throws(() => migrateEntryNumbers(corpusDir), /Malformed manifest/);
});

test('migrateEntryNumbers throws when the corpus directory does not exist', () => {
  assert.throws(() => migrateEntryNumbers('/nonexistent/path/for/sure'), /Corpus directory not found/);
});

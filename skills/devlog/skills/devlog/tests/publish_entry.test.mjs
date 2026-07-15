import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { publishEntry } from '../lib/publish_entry.mjs';

function makeDirs(t) {
  const root = mkdtempSync(join(tmpdir(), 'devlog-publish-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cloneDir = join(root, 'clone');
  mkdirSync(cloneDir);
  return { root, cloneDir };
}

function draft(root, version, { date = '2026-07-11', title = 'A real title', summary = 'A summary.' } = {}) {
  const path = join(root, `draft-${version}.md`);
  writeFileSync(path, `---
title: "${title}"
date: ${date}
project: proj
version: ${version}
tags: [a, b]
summary: "${summary}"
---

## Shipped

Things.
`);
  return path;
}

function readManifest(cloneDir) {
  return JSON.parse(readFileSync(join(cloneDir, 'proj', 'manifest.json'), 'utf8'));
}

test('publishEntry writes the entry and creates a fresh manifest', (t) => {
  const { root, cloneDir } = makeDirs(t);
  const result = publishEntry({ cloneDir, project: 'proj', version: 'v0.1.0', entryPath: draft(root, 'v0.1.0') });

  assert.equal(result.manifestUpdated, true);
  assert.ok(existsSync(join(cloneDir, 'proj', 'v0.1.0.md')));
  const manifest = readManifest(cloneDir);
  assert.deepEqual(manifest.entries, [{
    date: '2026-07-11',
    file: 'v0.1.0.md',
    title: 'A real title',
    summary: 'A summary.',
    version: 'v0.1.0',
    tags: ['a', 'b'],
  }]);
});

test('publishEntry writes tags from frontmatter into the manifest entry', (t) => {
  const { root, cloneDir } = makeDirs(t);
  const path = join(root, 'draft-v0.1.0.md');
  writeFileSync(path, `---
title: "A real title"
date: 2026-07-11
project: proj
version: v0.1.0
tags: [mcp, python, cli, testing, ci]
summary: "A summary."
---

## Shipped

Things.
`);

  publishEntry({ cloneDir, project: 'proj', version: 'v0.1.0', entryPath: path });
  const entry = readManifest(cloneDir).entries.find((e) => e.version === 'v0.1.0');
  assert.deepEqual(entry.tags, ['mcp', 'python', 'cli', 'testing', 'ci']);
});

test('publishEntry refuses to overwrite an existing entry', (t) => {
  const { root, cloneDir } = makeDirs(t);
  publishEntry({ cloneDir, project: 'proj', version: 'v0.1.0', entryPath: draft(root, 'v0.1.0') });
  assert.throws(
    () => publishEntry({ cloneDir, project: 'proj', version: 'v0.1.0', entryPath: draft(root, 'v0.1.0') }),
    /immutable, refusing to overwrite/,
  );
});

test('publishEntry keeps the manifest newest-first by date', (t) => {
  const { root, cloneDir } = makeDirs(t);
  publishEntry({ cloneDir, project: 'proj', version: 'v0.2.0', entryPath: draft(root, 'v0.2.0', { date: '2026-07-01' }) });
  // Backported release: OLDER date published later must sort BELOW v0.2.0.
  publishEntry({ cloneDir, project: 'proj', version: 'v0.1.9', entryPath: draft(root, 'v0.1.9', { date: '2026-06-01' }) });
  publishEntry({ cloneDir, project: 'proj', version: 'v0.3.0', entryPath: draft(root, 'v0.3.0', { date: '2026-07-10' }) });

  assert.deepEqual(readManifest(cloneDir).entries.map((e) => e.version), ['v0.3.0', 'v0.2.0', 'v0.1.9']);
});

test('publishEntry breaks same-date ties by version, newest first', (t) => {
  // Several releases cut on one day (the 0.4.2/0.5.0/0.5.1 case): date-only
  // stable sorting buried the newest post under its predecessors.
  const { root, cloneDir } = makeDirs(t);
  const date = '2026-07-11';
  publishEntry({ cloneDir, project: 'proj', version: 'v0.4.2', entryPath: draft(root, 'v0.4.2', { date }) });
  publishEntry({ cloneDir, project: 'proj', version: 'v0.5.0', entryPath: draft(root, 'v0.5.0', { date }) });
  publishEntry({ cloneDir, project: 'proj', version: 'v0.5.1', entryPath: draft(root, 'v0.5.1', { date }) });
  // Multi-digit component: v0.10.0 must beat v0.9.0 (numeric, not lexicographic).
  publishEntry({ cloneDir, project: 'proj', version: 'v0.10.0', entryPath: draft(root, 'v0.10.0', { date }) });
  publishEntry({ cloneDir, project: 'proj', version: 'v0.9.0', entryPath: draft(root, 'v0.9.0', { date }) });

  assert.deepEqual(readManifest(cloneDir).entries.map((e) => e.version),
    ['v0.10.0', 'v0.9.0', 'v0.5.1', 'v0.5.0', 'v0.4.2']);
});

test('publishEntry tolerates legacy manifest entries without a version field', (t) => {
  const { root, cloneDir } = makeDirs(t);
  mkdirSync(join(cloneDir, 'proj'));
  writeFileSync(join(cloneDir, 'proj', 'manifest.json'), JSON.stringify({
    entries: [{ date: '2026-05-01', file: '2026-05-01.md', title: 'Legacy day entry', summary: 'Old format.' }],
  }));

  publishEntry({ cloneDir, project: 'proj', version: 'v0.1.0', entryPath: draft(root, 'v0.1.0') });
  const entries = readManifest(cloneDir).entries;
  assert.deepEqual(entries.map((e) => e.file), ['v0.1.0.md', '2026-05-01.md']);
});

test('publishEntry does not duplicate a manifest row that already exists', (t) => {
  const { root, cloneDir } = makeDirs(t);
  mkdirSync(join(cloneDir, 'proj'));
  // Manifest row present but the .md file missing (a dead entry) — the file is
  // written, the row is left alone.
  writeFileSync(join(cloneDir, 'proj', 'manifest.json'), JSON.stringify({
    entries: [{ date: '2026-07-11', file: 'v0.1.0.md', title: 'Existing row', summary: 's', version: 'v0.1.0' }],
  }));

  const result = publishEntry({ cloneDir, project: 'proj', version: 'v0.1.0', entryPath: draft(root, 'v0.1.0') });
  assert.equal(result.manifestUpdated, false);
  assert.equal(readManifest(cloneDir).entries.length, 1);
  assert.equal(readManifest(cloneDir).entries[0].title, 'Existing row');
});

test('publishEntry rejects malformed manifests instead of clobbering them', (t) => {
  const { root, cloneDir } = makeDirs(t);
  mkdirSync(join(cloneDir, 'proj'));
  writeFileSync(join(cloneDir, 'proj', 'manifest.json'), JSON.stringify({ notEntries: [] }));
  assert.throws(
    () => publishEntry({ cloneDir, project: 'proj', version: 'v0.1.0', entryPath: draft(root, 'v0.1.0') }),
    /Malformed manifest/,
  );
});

test('publishEntry validates project key and version shape', (t) => {
  const { root, cloneDir } = makeDirs(t);
  const entryPath = draft(root, 'v0.1.0');
  assert.throws(() => publishEntry({ cloneDir, project: '../escape', version: 'v0.1.0', entryPath }), /Invalid project key/);
  assert.throws(() => publishEntry({ cloneDir, project: 'proj', version: 'v0.1.0-rc.1', entryPath }), /Invalid version label/);
  assert.throws(() => publishEntry({ cloneDir, project: 'proj', version: 'v0.1.0+build', entryPath }), /Invalid version label/);
});

test('publishEntry requires readable paths and complete frontmatter', (t) => {
  const { root, cloneDir } = makeDirs(t);
  assert.throws(
    () => publishEntry({ cloneDir, project: 'proj', version: 'v0.1.0', entryPath: join(root, 'missing.md') }),
    /Entry draft not found/,
  );
  assert.throws(
    () => publishEntry({ cloneDir: join(root, 'nope'), project: 'proj', version: 'v0.1.0', entryPath: draft(root, 'v0.1.0') }),
    /Clone directory not found/,
  );

  const bare = join(root, 'bare.md');
  writeFileSync(bare, '## Shipped\n\nNo frontmatter.\n');
  assert.throws(
    () => publishEntry({ cloneDir, project: 'proj', version: 'v0.1.0', entryPath: bare }),
    /frontmatter must include/,
  );
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { publishEntry, addCoverToExistingEntry } from '../lib/publish_entry.mjs';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const fakePng = (label = 'x') => Buffer.concat([PNG_MAGIC, Buffer.from(label)]);

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

test('publishEntry defaults tags to [] when frontmatter has no tags field', (t) => {
  const { root, cloneDir } = makeDirs(t);
  const path = join(root, 'draft-v0.1.0.md');
  writeFileSync(path, `---
title: "A real title"
date: 2026-07-11
project: proj
version: v0.1.0
summary: "A summary."
---

## Shipped

Things.
`);

  publishEntry({ cloneDir, project: 'proj', version: 'v0.1.0', entryPath: path });
  const entry = readManifest(cloneDir).entries.find((e) => e.version === 'v0.1.0');
  assert.deepEqual(entry.tags, []);
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

// ─── publishEntry: coverImageBuffer ───────────────────────────────────────────

test('publishEntry writes the cover PNG and the manifest cover field when given a buffer', (t) => {
  const { root, cloneDir } = makeDirs(t);
  const buf = fakePng('cover-bytes');
  const result = publishEntry({ cloneDir, project: 'proj', version: 'v0.1.0', entryPath: draft(root, 'v0.1.0'), coverImageBuffer: buf });

  assert.equal(result.coverWritten, true);
  assert.ok(existsSync(join(cloneDir, 'proj', 'v0.1.0.png')));
  assert.deepEqual(readFileSync(join(cloneDir, 'proj', 'v0.1.0.png')), buf);
  const entry = readManifest(cloneDir).entries.find((e) => e.version === 'v0.1.0');
  assert.deepEqual(entry.cover, { file: 'v0.1.0.png', bytes: buf.length });
});

test('publishEntry omits the cover field entirely when no coverImageBuffer is given', (t) => {
  const { root, cloneDir } = makeDirs(t);
  const result = publishEntry({ cloneDir, project: 'proj', version: 'v0.1.0', entryPath: draft(root, 'v0.1.0') });
  assert.equal(result.coverWritten, false);
  assert.equal(existsSync(join(cloneDir, 'proj', 'v0.1.0.png')), false);
  const entry = readManifest(cloneDir).entries.find((e) => e.version === 'v0.1.0');
  assert.equal('cover' in entry, false);
});

// ─── addCoverToExistingEntry ───────────────────────────────────────────────────

function publishBareEntry(root, cloneDir, version = 'v0.1.0') {
  return publishEntry({ cloneDir, project: 'proj', version, entryPath: draft(root, version) });
}

test('addCoverToExistingEntry writes the cover and sets the manifest cover field on a fresh entry', (t) => {
  const { root, cloneDir } = makeDirs(t);
  publishBareEntry(root, cloneDir);
  const buf = fakePng('a');
  const result = addCoverToExistingEntry({ cloneDir, project: 'proj', slug: 'v0.1.0', coverImageBuffer: buf });

  assert.equal(result.manifestUpdated, true);
  assert.deepEqual(readFileSync(join(cloneDir, 'proj', 'v0.1.0.png')), buf);
  const entry = readManifest(cloneDir).entries.find((e) => e.version === 'v0.1.0');
  assert.deepEqual(entry.cover, { file: 'v0.1.0.png', bytes: buf.length });
});

test('addCoverToExistingEntry never touches <slug>.md and never pushes a new manifest row', (t) => {
  const { root, cloneDir } = makeDirs(t);
  publishBareEntry(root, cloneDir);
  const before = readFileSync(join(cloneDir, 'proj', 'v0.1.0.md'), 'utf8');
  addCoverToExistingEntry({ cloneDir, project: 'proj', slug: 'v0.1.0', coverImageBuffer: fakePng() });
  assert.equal(readFileSync(join(cloneDir, 'proj', 'v0.1.0.md'), 'utf8'), before);
  assert.equal(readManifest(cloneDir).entries.length, 1);
});

test('addCoverToExistingEntry without force throws when the row already has a cover', (t) => {
  const { root, cloneDir } = makeDirs(t);
  publishBareEntry(root, cloneDir);
  addCoverToExistingEntry({ cloneDir, project: 'proj', slug: 'v0.1.0', coverImageBuffer: fakePng('first') });
  assert.throws(
    () => addCoverToExistingEntry({ cloneDir, project: 'proj', slug: 'v0.1.0', coverImageBuffer: fakePng('second') }),
    /already has a cover/,
  );
});

test('addCoverToExistingEntry with force: true always overwrites, even when an already-valid PNG exists', (t) => {
  const { root, cloneDir } = makeDirs(t);
  publishBareEntry(root, cloneDir);
  addCoverToExistingEntry({ cloneDir, project: 'proj', slug: 'v0.1.0', coverImageBuffer: fakePng('first') });
  const second = fakePng('second-and-longer-payload');
  const result = addCoverToExistingEntry({ cloneDir, project: 'proj', slug: 'v0.1.0', coverImageBuffer: second, force: true });

  assert.equal(result.manifestUpdated, true);
  assert.deepEqual(readFileSync(join(cloneDir, 'proj', 'v0.1.0.png')), second);
  assert.equal(readManifest(cloneDir).entries.find((e) => e.version === 'v0.1.0').cover.bytes, second.length);
});

test('addCoverToExistingEntry (no force, no cover yet) adopts an existing valid clone-destination PNG instead of rewriting it', (t) => {
  const { root, cloneDir } = makeDirs(t);
  publishBareEntry(root, cloneDir);
  // Simulate an orphaned clone-destination PNG from a hypothetical prior interrupted call:
  // present on disk, but the manifest row doesn't have `cover` yet.
  const existing = fakePng('orphaned-but-valid');
  writeFileSync(join(cloneDir, 'proj', 'v0.1.0.png'), existing);

  const freshBuffer = fakePng('this-should-not-be-written');
  const result = addCoverToExistingEntry({ cloneDir, project: 'proj', slug: 'v0.1.0', coverImageBuffer: freshBuffer });

  assert.equal(result.manifestUpdated, true);
  // Adopted, not rewritten: the file on disk is still the orphaned one, not freshBuffer.
  assert.deepEqual(readFileSync(join(cloneDir, 'proj', 'v0.1.0.png')), existing);
  assert.equal(readManifest(cloneDir).entries.find((e) => e.version === 'v0.1.0').cover.bytes, existing.length);
});

test('addCoverToExistingEntry (no force, no cover yet) discards a corrupt clone-destination PNG and writes fresh bytes', (t) => {
  const { root, cloneDir } = makeDirs(t);
  publishBareEntry(root, cloneDir);
  writeFileSync(join(cloneDir, 'proj', 'v0.1.0.png'), Buffer.from('not a real png'));

  const freshBuffer = fakePng('fresh-and-valid');
  const result = addCoverToExistingEntry({ cloneDir, project: 'proj', slug: 'v0.1.0', coverImageBuffer: freshBuffer });

  assert.equal(result.manifestUpdated, true);
  assert.deepEqual(readFileSync(join(cloneDir, 'proj', 'v0.1.0.png')), freshBuffer);
});

test('addCoverToExistingEntry throws when no manifest row matches the given slug', (t) => {
  const { root, cloneDir } = makeDirs(t);
  publishBareEntry(root, cloneDir);
  assert.throws(
    () => addCoverToExistingEntry({ cloneDir, project: 'proj', slug: 'v9.9.9', coverImageBuffer: fakePng() }),
    /No manifest row for proj\/v9\.9\.9/,
  );
});

test('addCoverToExistingEntry validates project key and slug shape', (t) => {
  const { root, cloneDir } = makeDirs(t);
  publishBareEntry(root, cloneDir);
  assert.throws(
    () => addCoverToExistingEntry({ cloneDir, project: '../escape', slug: 'v0.1.0', coverImageBuffer: fakePng() }),
    /Invalid project key/,
  );
  assert.throws(
    () => addCoverToExistingEntry({ cloneDir, project: 'proj', slug: '../escape', coverImageBuffer: fakePng() }),
    /Invalid slug/,
  );
});

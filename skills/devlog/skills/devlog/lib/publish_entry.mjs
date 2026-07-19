// Move a drafted entry into the target-repo clone and update the project's
// manifest. This is the code-enforced immutability guard: a cut release's
// entry is never overwritten, and manifest mutation is no longer done by
// hand-editing JSON in the agent loop.
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, statSync, openSync, readSync, closeSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { RE_PROJECT_KEY, RE_FINAL_RELEASE, atomicWriteJSON } from './core.mjs';
import { parseFrontmatter, splitSections } from './lint_post.mjs';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function isValidPng(path) {
  let fd;
  try {
    fd = openSync(path, 'r');
    const buf = Buffer.alloc(8);
    const n = readSync(fd, buf, 0, 8, 0);
    return n === 8 && buf.equals(PNG_MAGIC);
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function assertSafeSlug(slug) {
  if (typeof slug !== 'string' || slug === '' || slug.includes('/') || slug.includes('..') || /[\x00-\x1f]/.test(slug)) {
    throw new Error(`Invalid slug: ${JSON.stringify(slug)}`);
  }
}

// Newest-first by date; same-date ties break by version, highest first.
// Without the tiebreak, several releases cut on one day render oldest-on-top
// in the feed (stable sort keeps insertion order), burying the newest post
// under its predecessors. Date still wins overall because a backported tag
// (v1.9.1 tagged after v2.0.0) must sort by when it was released.
function versionNums(entry) {
  const m = /^v(\d+(?:\.\d+)*)$/.exec(entry.version || '');
  return m ? m[1].split('.').map(Number) : null;
}

function compareVersionsDesc(a, b) {
  const va = versionNums(a);
  const vb = versionNums(b);
  if (!va || !vb) return 0; // legacy rows without a version keep their order
  for (let i = 0; i < Math.max(va.length, vb.length); i++) {
    const d = (vb[i] ?? 0) - (va[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function sortEntries(entries) {
  return entries.slice().sort((a, b) =>
    String(b.date).localeCompare(String(a.date)) || compareVersionsDesc(a, b));
}

// Tombstoned rows have no date, so they'd sort arbitrarily among the live
// feed rows — keep the live entries date-sorted and park tombstones at the end.
function sortManifestEntries(entries) {
  const live = entries.filter((e) => !(e && e.removed));
  const removed = entries.filter((e) => e && e.removed);
  return [...sortEntries(live), ...removed];
}

function readManifestIfExists(manifestPath) {
  if (!existsSync(manifestPath)) return { entries: [] };
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (!manifest || !Array.isArray(manifest.entries)) {
    throw new Error(`Malformed manifest at ${manifestPath}: expected { "entries": [...] }.`);
  }
  return manifest;
}

// Commit hashes referenced by a post's `## Changelog` section, normalized to
// their 7-char short form so a short link text matches its full-hash URL.
// Only hash-shaped tokens in link syntax count — `[abc1234](...)` texts and
// `/commit/<hash>` URLs — never bare hex words in prose.
export function extractChangelogHashes(body) {
  const section = splitSections(body).find((s) => s.heading === 'Changelog');
  const hashes = new Set();
  if (!section) return hashes;
  for (const m of section.content.matchAll(/\[([0-9a-f]{7,40})\]/g)) hashes.add(m[1].slice(0, 7));
  for (const m of section.content.matchAll(/\/commit\/([0-9a-f]{7,40})\b/g)) hashes.add(m[1].slice(0, 7));
  return hashes;
}

// A commit belongs to exactly one post's Changelog (SKILL.md 3b) — in a
// monorepo, one commit range can feed several projects' releases, and letting
// both posts list it produced twin entries with identical Changelogs. Walks
// every live published entry in the clone and throws on the first collision.
function assertNoChangelogCollision(cloneDir, project, version, draftBody) {
  const draftHashes = extractChangelogHashes(draftBody);
  if (draftHashes.size === 0) return;

  let dirents;
  try {
    dirents = readdirSync(cloneDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue;
    let manifest;
    try {
      manifest = readManifestIfExists(join(cloneDir, dirent.name, 'manifest.json'));
    } catch {
      continue; // a sibling project's broken manifest must not block this publish
    }
    for (const entry of manifest.entries) {
      if (!entry || entry.removed || !entry.file) continue;
      if (dirent.name === project && entry.version === version) continue; // self (idempotent republish)
      const entryPath = join(cloneDir, dirent.name, entry.file);
      if (!existsSync(entryPath)) continue;
      let published;
      try {
        published = parseFrontmatter(readFileSync(entryPath, 'utf8'));
      } catch {
        continue;
      }
      for (const hash of extractChangelogHashes(published.body)) {
        if (draftHashes.has(hash)) {
          throw new Error(
            `Commit ${hash} already appears in ${dirent.name}/${entry.file}'s Changelog — ` +
            `a commit belongs to exactly one post's Changelog (SKILL.md 3b); drop it from this draft's Changelog.`
          );
        }
      }
    }
  }
}

// `no` is a single sequence across ALL projects (issue numbers of one
// publication, not per-project counters), but manifests are stored one per
// project — so "next" means "scan every project's manifest under cloneDir and
// take the highest `no` seen, plus one." Pre-migration rows with no `no` field
// are simply skipped, not treated as 0; a manifest a sibling agent is mid-write
// on is skipped rather than thrown on, since a transient parse failure on
// ANOTHER project must never block publishing to THIS one.
// NOT safe against two publishEntry calls racing in separate processes at the
// same instant (read-then-write with no lock) — acceptable for this single-
// operator CLI; a real lock is not worth the complexity until that changes.
function nextEntryNumber(cloneDir) {
  let dirents;
  try {
    dirents = readdirSync(cloneDir, { withFileTypes: true });
  } catch {
    return 1;
  }

  let max = 0;
  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue;
    const manifestPath = join(cloneDir, dirent.name, 'manifest.json');
    if (!existsSync(manifestPath)) continue;
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch {
      continue;
    }
    if (!manifest || !Array.isArray(manifest.entries)) continue;
    for (const entry of manifest.entries) {
      if (entry && Number.isInteger(entry.no) && entry.no > max) max = entry.no;
    }
  }
  return max + 1;
}

export function publishEntry({ cloneDir, project, version, entryPath, coverImageBuffer }) {
  if (!RE_PROJECT_KEY.test(project) || project.includes('..')) {
    throw new Error(`Invalid project key: ${JSON.stringify(project)}`);
  }
  if (!RE_FINAL_RELEASE.test(version)) {
    throw new Error(`Invalid version label (must be v<digits.digits...>): ${JSON.stringify(version)}`);
  }
  if (!existsSync(cloneDir)) throw new Error(`Clone directory not found: ${cloneDir}`);
  if (!existsSync(entryPath)) throw new Error(`Entry draft not found: ${entryPath}`);

  const projectDir = join(cloneDir, project);
  const destPath = join(projectDir, `${version}.md`);
  const manifestPath = join(projectDir, 'manifest.json');
  const manifest = readManifestIfExists(manifestPath);

  // Tombstone refusal comes before the file check: a tombstoned release's .md
  // is gone by definition, and re-generating it is exactly the failure this
  // state exists to prevent (an editorially moved/consolidated entry must
  // never come back on a later run).
  const tombstoned = manifest.entries.find((e) => e && e.removed && e.version === version);
  if (tombstoned) {
    throw new Error(
      `Entry ${project}/${version} is tombstoned` +
      (tombstoned.reason ? ` (${tombstoned.reason})` : '') +
      ' — this release was editorially retired, refusing to republish.'
    );
  }
  if (existsSync(destPath)) {
    throw new Error(`Entry ${project}/${version}.md already exists — a cut release is immutable, refusing to overwrite.`);
  }

  const content = readFileSync(entryPath, 'utf8');
  const { data, body } = parseFrontmatter(content);
  if (!data || !data.title || !data.date || !data.summary) {
    throw new Error('Entry frontmatter must include title, date, and summary (run lint-post first).');
  }

  assertNoChangelogCollision(cloneDir, project, version, body);

  mkdirSync(projectDir, { recursive: true });
  copyFileSync(entryPath, destPath);

  // Cover write happens between the .md write and the manifest mutation, matching the
  // existing .md-then-manifest crash-recovery convention: a process death after this write
  // but before the manifest mutation leaves an orphaned <version>.png with no matching
  // `cover` field — harmless inert clutter (the manifest is the sole source of truth for
  // "does this post have a cover"), not a correctness bug, and needs no cleanup logic.
  let coverFile = null;
  if (coverImageBuffer) {
    coverFile = `${version}.png`;
    writeFileSync(join(projectDir, coverFile), coverImageBuffer);
  }

  const file = `${version}.md`;
  // Idempotent: legacy manifests may already reference this file/version even
  // when the .md was missing — never duplicate an index row.
  const already = manifest.entries.some((e) => e && (e.file === file || e.version === version));
  let manifestUpdated = false;
  // Frozen at publish, never recomputed: a backdated entry published later must
  // never shift a number already baked into a live published social image.
  // Computed only on the write path — a repeat/idempotent call that hits
  // `already` above must not burn a number on a publish that's a no-op.
  let no = null;
  if (!already) {
    no = nextEntryNumber(cloneDir);
    manifest.entries.push({
      date: String(data.date),
      file,
      title: String(data.title),
      summary: String(data.summary),
      version,
      tags: Array.isArray(data.tags) ? data.tags : [],
      no,
      ...(coverFile ? { cover: { file: coverFile, bytes: coverImageBuffer.length } } : {}),
    });
    manifest.entries = sortManifestEntries(manifest.entries);
    atomicWriteJSON(manifestPath, manifest);
    manifestUpdated = true;
  }

  return { written: destPath, manifestUpdated, coverWritten: !!coverFile, no };
}

// Editorially retire a release: after an entry is manually moved, consolidated,
// or deleted in the target repo, its (project, version) identity must keep
// suppressing generation forever — scan reports it as `entry-tombstoned` and
// publish-entry refuses it. Creates the project manifest if the whole directory
// was removed (the market-research case). Refuses to tombstone a LIVE entry
// (its .md still on disk): move or delete the entry first, deliberately, then
// tombstone the identity it left behind.
export function tombstoneEntry({ cloneDir, project, version, reason }) {
  if (!RE_PROJECT_KEY.test(project) || project.includes('..')) {
    throw new Error(`Invalid project key: ${JSON.stringify(project)}`);
  }
  if (!RE_FINAL_RELEASE.test(version)) {
    throw new Error(`Invalid version label (must be v<digits.digits...>): ${JSON.stringify(version)}`);
  }
  if (typeof reason !== 'string' || reason.trim() === '' || /[\x00-\x1f]/.test(reason)) {
    throw new Error('A tombstone requires a non-empty --reason (where did the entry go, and why?).');
  }
  if (!existsSync(cloneDir)) throw new Error(`Clone directory not found: ${cloneDir}`);

  const projectDir = join(cloneDir, project);
  const manifestPath = join(projectDir, 'manifest.json');
  const manifest = readManifestIfExists(manifestPath);

  const idx = manifest.entries.findIndex((e) => e && e.version === version);
  if (idx !== -1 && manifest.entries[idx].removed) {
    return { tombstoned: false, already: true, project, version };
  }

  const file = `${version}.md`;
  if (idx !== -1 && existsSync(join(projectDir, manifest.entries[idx].file || file))) {
    throw new Error(
      `${project}/${version} is a live published entry — tombstone marks an identity whose ` +
      'file was editorially moved or deleted; remove/move the entry file first, then tombstone.'
    );
  }

  const prior = idx !== -1 ? manifest.entries[idx] : null;
  const row = {
    version,
    file: prior?.file || file,
    removed: true,
    reason: reason.trim(),
    // A dead row that already held a frozen `no` keeps it — numbers are never
    // reused, and dropping the max would let the next publish re-issue it.
    ...(prior && Number.isInteger(prior.no) ? { no: prior.no } : {}),
  };
  if (idx !== -1) manifest.entries[idx] = row;
  else manifest.entries.push(row);

  mkdirSync(projectDir, { recursive: true });
  manifest.entries = sortManifestEntries(manifest.entries);
  atomicWriteJSON(manifestPath, manifest);
  return { tombstoned: true, project, version, manifest: manifestPath };
}

// Post-publish metadata resync: entry prose edits are the user's call, but the
// manifest's title/summary/date/tags (what the site index, RSS, and covers
// read) previously had no legitimate way to follow — a hand-edited post left
// them stale for hours while "rebuilds" chased phantom caches. Reads the
// PUBLISHED .md in the clone and replaces exactly those four fields on its
// manifest row. Never touches `no`, `version`, `file`, or `cover`; reports
// `coverStale` so the caller knows a cover derived from the old title may need
// regenerating.
export function syncEntryFromFrontmatter({ cloneDir, project, slug }) {
  if (!RE_PROJECT_KEY.test(project) || project.includes('..')) {
    throw new Error(`Invalid project key: ${JSON.stringify(project)}`);
  }
  assertSafeSlug(slug);
  if (!existsSync(cloneDir)) throw new Error(`Clone directory not found: ${cloneDir}`);

  const projectDir = join(cloneDir, project);
  const manifestPath = join(projectDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`No manifest found for project "${project}" at ${manifestPath}`);
  }
  const manifest = readManifestIfExists(manifestPath);

  const idx = manifest.entries.findIndex(
    (e) => e && (e.version === slug || (e.file && e.file.replace(/\.md$/, '') === slug))
  );
  if (idx === -1) {
    throw new Error(`No manifest row for ${project}/${slug} — nothing to sync.`);
  }
  const entry = manifest.entries[idx];
  if (entry.removed) {
    throw new Error(`${project}/${slug} is tombstoned — there is no entry to sync.`);
  }

  const entryFilePath = join(projectDir, entry.file);
  if (!existsSync(entryFilePath)) {
    throw new Error(`Published entry file not found at ${entryFilePath} — sync reads the clone's .md, not a draft.`);
  }
  const { data } = parseFrontmatter(readFileSync(entryFilePath, 'utf8'));
  if (!data || !data.title || !data.date || !data.summary) {
    throw new Error('Published entry frontmatter must include title, date, and summary (run lint-post on it first).');
  }

  const next = {
    ...entry,
    date: String(data.date),
    title: String(data.title),
    summary: String(data.summary),
    tags: Array.isArray(data.tags) ? data.tags : [],
  };
  const changedFields = ['date', 'title', 'summary', 'tags'].filter(
    (k) => JSON.stringify(entry[k]) !== JSON.stringify(next[k])
  );
  manifest.entries[idx] = next;
  manifest.entries = sortManifestEntries(manifest.entries);
  atomicWriteJSON(manifestPath, manifest);

  return { synced: true, project, slug, changedFields, coverStale: !!entry.cover };
}

// Backfill path only: add a cover to an entry that was already published without one.
// Never writes/reads <slug>.md, never pushes a new manifest row — its only mutation is the
// `cover` field of an already-existing entry, keyed by that entry's version/file stem.
//
// Three-way branch, in order:
//   1. force: true            -> ALWAYS overwrite the clone-destination PNG unconditionally,
//                                 no magic-byte check, no adoption logic. This is what
//                                 "force" means: --force is used precisely when a row
//                                 already has `cover`, so an ungated adoption check would
//                                 otherwise silently skip the write exactly when the caller
//                                 most clearly intends to overwrite.
//   2. !force, row has cover  -> throw/refuse before any write.
//   3. !force, row lacks cover -> the only branch where magic-byte adopt-or-discard logic
//                                 applies. Kept as cheap, harmless insurance for a resume
//                                 scenario that is NOT reachable via commit-covers's actual
//                                 call pattern (commit-covers always establishes a fresh
//                                 clone and performs exactly one commit+push at the very
//                                 end, so a crash mid-run never leaves this orphan
//                                 discoverable by a later invocation) — not a claim that
//                                 this state occurs in practice.
export function addCoverToExistingEntry({ cloneDir, project, slug, coverImageBuffer, force = false }) {
  if (!RE_PROJECT_KEY.test(project) || project.includes('..')) {
    throw new Error(`Invalid project key: ${JSON.stringify(project)}`);
  }
  assertSafeSlug(slug);
  if (!coverImageBuffer || !Buffer.isBuffer(coverImageBuffer)) {
    throw new Error('coverImageBuffer is required and must be a Buffer');
  }
  if (!existsSync(cloneDir)) throw new Error(`Clone directory not found: ${cloneDir}`);

  const projectDir = join(cloneDir, project);
  const manifestPath = join(projectDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`No manifest found for project "${project}" at ${manifestPath}`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (!manifest || !Array.isArray(manifest.entries)) {
    throw new Error(`Malformed manifest at ${manifestPath}: expected { "entries": [...] }.`);
  }

  const idx = manifest.entries.findIndex(
    (e) => e && (e.version === slug || (e.file && e.file.replace(/\.md$/, '') === slug))
  );
  if (idx === -1) {
    throw new Error(`No manifest row for ${project}/${slug} — cannot add a cover to an entry that doesn't exist.`);
  }
  const entry = manifest.entries[idx];

  if (entry.cover && !force) {
    throw new Error(`${project}/${slug} already has a cover — pass force: true to overwrite.`);
  }

  const coverFile = `${slug}.png`;
  const destPath = join(projectDir, coverFile);
  mkdirSync(projectDir, { recursive: true });

  let written;
  if (force) {
    writeFileSync(destPath, coverImageBuffer);
    written = destPath;
  } else if (existsSync(destPath) && isValidPng(destPath)) {
    // Adopt the existing file as the completed result of a hypothetical interrupted prior
    // write. coverImageBuffer (the staging-dir source the caller already read — a
    // different file from this clone-destination path) is NOT rewritten over it.
    written = destPath;
  } else {
    writeFileSync(destPath, coverImageBuffer);
    written = destPath;
  }

  const bytes = statSync(written).size;
  manifest.entries[idx] = { ...entry, cover: { file: coverFile, bytes } };
  atomicWriteJSON(manifestPath, manifest);

  return { written, manifestUpdated: true };
}

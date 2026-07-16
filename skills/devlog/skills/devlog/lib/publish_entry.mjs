// Move a drafted entry into the target-repo clone and update the project's
// manifest. This is the code-enforced immutability guard: a cut release's
// entry is never overwritten, and manifest mutation is no longer done by
// hand-editing JSON in the agent loop.
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { RE_PROJECT_KEY, RE_FINAL_RELEASE, atomicWriteJSON } from './core.mjs';
import { parseFrontmatter } from './lint_post.mjs';

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
  if (existsSync(destPath)) {
    throw new Error(`Entry ${project}/${version}.md already exists — a cut release is immutable, refusing to overwrite.`);
  }

  const content = readFileSync(entryPath, 'utf8');
  const { data } = parseFrontmatter(content);
  if (!data || !data.title || !data.date || !data.summary) {
    throw new Error('Entry frontmatter must include title, date, and summary (run lint-post first).');
  }

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

  const manifestPath = join(projectDir, 'manifest.json');
  let manifest = { entries: [] };
  if (existsSync(manifestPath)) {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (!manifest || !Array.isArray(manifest.entries)) {
      throw new Error(`Malformed manifest at ${manifestPath}: expected { "entries": [...] }.`);
    }
  }

  const file = `${version}.md`;
  // Idempotent: legacy manifests may already reference this file/version even
  // when the .md was missing — never duplicate an index row.
  const already = manifest.entries.some((e) => e && (e.file === file || e.version === version));
  let manifestUpdated = false;
  if (!already) {
    manifest.entries.push({
      date: String(data.date),
      file,
      title: String(data.title),
      summary: String(data.summary),
      version,
      tags: Array.isArray(data.tags) ? data.tags : [],
      ...(coverFile ? { cover: { file: coverFile, bytes: coverImageBuffer.length } } : {}),
    });
    manifest.entries = sortEntries(manifest.entries);
    atomicWriteJSON(manifestPath, manifest);
    manifestUpdated = true;
  }

  return { written: destPath, manifestUpdated, coverWritten: !!coverFile };
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

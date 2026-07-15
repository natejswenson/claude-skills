// Move a drafted entry into the target-repo clone and update the project's
// manifest. This is the code-enforced immutability guard: a cut release's
// entry is never overwritten, and manifest mutation is no longer done by
// hand-editing JSON in the agent loop.
import { existsSync, mkdirSync, readFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { RE_PROJECT_KEY, RE_FINAL_RELEASE, atomicWriteJSON } from './core.mjs';
import { parseFrontmatter } from './lint_post.mjs';

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

export function publishEntry({ cloneDir, project, version, entryPath }) {
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
    });
    manifest.entries = sortEntries(manifest.entries);
    atomicWriteJSON(manifestPath, manifest);
    manifestUpdated = true;
  }

  return { written: destPath, manifestUpdated };
}

// Move a drafted entry into the target-repo clone and update the project's
// manifest. This is the code-enforced immutability guard: a cut release's
// entry is never overwritten, and manifest mutation is no longer done by
// hand-editing JSON in the agent loop.
import { existsSync, mkdirSync, readFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { RE_PROJECT_KEY, RE_FINAL_RELEASE, atomicWriteJSON } from './core.mjs';
import { parseFrontmatter } from './lint_post.mjs';

// Newest-first by date; ties keep insertion order (Array.prototype.sort is
// stable). Date order is normally also version order, but a backported tag
// (v1.9.1 tagged after v2.0.0) can diverge — sorting by date matches how the
// feed renders.
function sortEntries(entries) {
  return entries.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
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
    });
    manifest.entries = sortEntries(manifest.entries);
    atomicWriteJSON(manifestPath, manifest);
    manifestUpdated = true;
  }

  return { written: destPath, manifestUpdated };
}

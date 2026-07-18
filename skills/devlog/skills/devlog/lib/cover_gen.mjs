// Style guide + reference-image lookup for cover-image composition. Deterministic,
// no LLM/agent involvement — the agent calls `devlog cover-context` (bin/devlog.js),
// which wraps these two functions.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_DIR } from './core.mjs';

const IMAGE_STYLE_DIR = join(CONFIG_DIR, 'image-style');
const STYLE_GUIDE_PATH = join(IMAGE_STYLE_DIR, 'style-guide.md');
const ICON_CATALOG_PATH = join(IMAGE_STYLE_DIR, 'icons.md');

function slugFromFile(file) {
  return String(file || '').replace(/\.md$/, '');
}

// Pure, given explicit paths — exported separately so tests can exercise the
// missing-icons.md degradation deterministically against a temp directory, without
// touching this machine's real installed state at CONFIG_DIR.
export function resolveStyleGuideAndCatalog(styleGuidePath, iconCatalogPath) {
  if (!existsSync(styleGuidePath)) {
    throw new Error(`Cover style guide not found at ${styleGuidePath} — run \`devlog init\` to install it.`);
  }
  const text = readFileSync(styleGuidePath, 'utf8');
  const iconCatalog = existsSync(iconCatalogPath) ? readFileSync(iconCatalogPath, 'utf8') : null;
  return { text, iconCatalog };
}

// Reads the installed style guide (no graceful degradation — Claude has nothing to
// compose from without it; callers (devlog cover-context) catch the throw and surface it
// as a distinct error, never blocking the rest of publish) plus the installed icon catalog
// (graceful degradation here: iconCatalog: null when icons.md isn't installed, mirroring
// the missing-style-guide handling pattern, just one level down — composition proceeds
// without a catalog rather than blocking).
export function loadStyleGuide() {
  return resolveStyleGuideAndCatalog(STYLE_GUIDE_PATH, ICON_CATALOG_PATH);
}

// Read one project's manifest.json out of an already-established clone.
// Two distinct missing-manifest cases (mirrors fetchExistingEntries()'s empty/failed split
// in lib/scan.mjs): a project directory that doesn't exist at all (never published a
// release yet) is zero entries, not an error. A project directory that DOES exist but
// whose manifest.json is missing or fails to parse is a genuine anomaly — surfaced via
// status: 'failed' so the caller can throw a clear, named error rather than silently
// dropping that project's entries from a merged result.
function readProjectManifest(cloneDir, projectKey) {
  const projectDir = join(cloneDir, projectKey);
  if (!existsSync(projectDir)) {
    return { entries: [], status: 'empty' };
  }
  const manifestPath = join(projectDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    return { entries: [], status: 'failed', reason: `manifest.json missing for project "${projectKey}" (expected at ${manifestPath})` };
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    return { entries: [], status: 'failed', reason: `manifest.json for project "${projectKey}" failed to parse: ${e.message}` };
  }
  if (!manifest || !Array.isArray(manifest.entries)) {
    return { entries: [], status: 'failed', reason: `manifest.json for project "${projectKey}" is malformed (expected { "entries": [...] })` };
  }
  return { entries: manifest.entries, status: 'ok' };
}

// Cross-project manifest enumeration/merge — the one mechanism shared by
// getRecentCovers() (below) and `devlog backfill-covers list` (bin/devlog.js). There is no
// merged/aggregated manifest file anywhere in daily-dev-log (confirmed: exactly one
// manifest.json per project directory) — every project's own manifest.json is read
// individually and tagged with `project` as it's read, mirroring getAllEntries() in
// natejswenson.io/src/lib/devlog.js (the site's own equivalent per-project-manifest merge;
// its own empty-vs-corrupt handling is indirect/local-overlay-based, not the same
// mechanism as this direct directory check, though it reaches the same outcome for the
// directory-absent case).
export function mergeManifestEntries(cloneDir, config) {
  const merged = [];
  for (const p of (config.projects || [])) {
    const { entries, status, reason } = readProjectManifest(cloneDir, p.key);
    if (status === 'failed') throw new Error(reason);
    for (const e of entries) merged.push({ ...e, project: p.key });
  }
  return merged;
}

// Staged-but-uncommitted covers from earlier in the same backfill session, freshest first
// by file mtime. Resolved under stagingDir's per-project subdirectory
// (<stagingDir>/<project>/<slug>.png) — never a flat <stagingDir>/<slug>.png, since slugs
// are not globally unique across projects.
function listStagedCovers(stagingDir) {
  if (!stagingDir || !existsSync(stagingDir)) return [];
  const out = [];
  for (const d of readdirSync(stagingDir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue; // skips the top-level index.html contact sheet
    const projectDir = join(stagingDir, d.name);
    for (const f of readdirSync(projectDir)) {
      if (!f.endsWith('.png')) continue;
      const full = join(projectDir, f);
      out.push({ project: d.name, slug: f.replace(/\.png$/, ''), path: full, mtimeMs: statSync(full).mtimeMs });
    }
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out.map(({ project, slug, path }) => ({ project, slug, path }));
}

// Pure given its inputs. Returns the N most recently published covers across every
// configured project (newest by manifest `date`), as local paths inside the already-
// established clone. When stagingDir is given and fewer than n published covers exist,
// tops up the result with covers already staged this session (freshest-first) — what lets
// a from-scratch backfill session bootstrap its own visual consistency instead of every
// candidate composing from the style guide alone. Returns [] when neither source has
// anything yet (the true first-cover case) — never throws for that, never pads.
export function getRecentCovers({ cloneDir, config, stagingDir = null, n = 3 }) {
  const merged = mergeManifestEntries(cloneDir, config);
  const covered = merged
    .filter((e) => e && e.cover && e.file)
    .map((e) => ({ project: e.project, slug: slugFromFile(e.file), date: e.date }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const result = covered.slice(0, n).map(({ project, slug }) => ({
    project,
    slug,
    path: join(cloneDir, project, `${slug}.png`),
  }));

  if (result.length < n) {
    const seen = new Set(result.map((r) => `${r.project}/${r.slug}`));
    for (const staged of listStagedCovers(stagingDir)) {
      if (result.length >= n) break;
      const key = `${staged.project}/${staged.slug}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(staged);
    }
  }

  return result;
}

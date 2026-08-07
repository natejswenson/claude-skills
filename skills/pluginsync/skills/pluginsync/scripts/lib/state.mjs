/**
 * Every fact this skill reports, read from exactly one place.
 *
 * There are four sources and no fifth. `references/sources.md` is the prose
 * version of this file; if the two disagree, this file is right and the prose
 * is stale.
 *
 * Nothing here classifies or renders — a reader that also decides is a reader
 * you cannot test against a fixture.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Read JSON, returning null rather than throwing — a missing file is data. */
export function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * ~/.claude/plugins/known_marketplaces.json → one entry per configured
 * marketplace.
 *
 * `spec` is printed verbatim rather than resolved, on purpose: an absolute
 * install path differs on every machine, and a report that embeds one cannot
 * be byte-compared in CI.
 */
export function readMarketplaces(home) {
  const raw = readJson(join(home, 'plugins', 'known_marketplaces.json'));
  if (!raw) return [];
  return Object.entries(raw).map(([name, m]) => ({
    name,
    kind: m.source?.source ?? 'unknown',
    spec: m.source?.path ?? m.source?.repo ?? m.source?.url ?? '?',
    // Resolved against the home dir when relative, so a fixture home can ship a
    // portable marketplace. A real config is always absolute and unaffected.
    installLocation: m.installLocation ? resolve(home, m.installLocation) : '',
  }));
}

/**
 * A marketplace's own .claude-plugin/marketplace.json, with each entry resolved
 * to the version in its plugin.json.
 *
 * A plugin whose source cannot be read locally becomes an entry with
 * `error` set — never a dropped row. Omitting it would read as "nothing to do",
 * which is the exact silent success the one rule exists to prevent.
 */
export function readCatalog(marketplace) {
  const root = marketplace.installLocation;
  const manifest = readJson(join(root, '.claude-plugin', 'marketplace.json'));
  if (!manifest) {
    return { ok: false, error: `no .claude-plugin/marketplace.json under ${root || '(no install location)'}`, plugins: [] };
  }
  const plugins = (manifest.plugins ?? []).map((entry) => {
    const name = entry.name ?? '?';
    const dir = localSourceDir(root, entry.source);
    if (!dir) return { name, available: null, error: 'source is not resolvable on this machine' };
    const plugin = readJson(join(dir, '.claude-plugin', 'plugin.json'));
    if (!plugin) return { name, available: null, error: `no plugin.json under ${entry.source}` };
    if (!plugin.version) return { name, available: null, error: `plugin.json declares no version` };
    return { name, available: String(plugin.version), error: null };
  });
  return { ok: true, error: null, plugins };
}

/**
 * Marketplace entry sources come in two shapes: a relative path string (this
 * repo) or an object. Only locally-rooted objects can be resolved; a git-subdir
 * source lives somewhere this tool has no business guessing at.
 */
function localSourceDir(root, source) {
  if (typeof source === 'string') return resolve(root, source);
  if (source && typeof source === 'object' && source.path && !source.url) return resolve(root, source.path);
  return null;
}

/**
 * `claude plugin list --json` → what is actually on disk right now.
 *
 * Two shapes, both real: plain `--json` returns a bare array, while
 * `--available --json` returns `{installed, available}`. An unrecognised shape
 * THROWS rather than reading as an empty list — "no plugins installed" and "I
 * could not parse the list" produce identical tables otherwise, and the first
 * one tells you to reinstall everything.
 *
 * Deliberately never `--available`: that array lists only plugins which are
 * *not* installed, so every plugin you already have is absent from it. Diffing
 * against it compares nothing and reports it as clean.
 */
export function readInstalled(raw) {
  const list = Array.isArray(raw) ? raw : raw?.installed;
  if (!Array.isArray(list)) {
    throw new Error('unrecognised `claude plugin list --json` output — expected an array or {installed: [...]}');
  }
  const out = new Map();
  for (const p of list) {
    const [name, marketplace] = String(p.id ?? '').split('@');
    if (!name || !marketplace) continue;
    out.set(p.id, {
      name,
      marketplace,
      version: String(p.version ?? ''),
      enabled: p.enabled !== false,
      scope: p.scope ?? 'user',
    });
  }
  return out;
}

/** Shell out for the installed list. Separated so tests never need the CLI. */
export function claudePluginList(exec = execFileSync) {
  const out = exec('claude', ['plugin', 'list', '--json'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return JSON.parse(out);
}

/**
 * A personal skill at ~/.claude/skills/<name>/SKILL.md shadows the plugin of the
 * same name, and no version number anywhere reveals it: the plugin updates
 * cleanly and the stale copy keeps winning. This has bitten before, which is
 * why it is a checked fact and not a note in the docs.
 */
export function findShadows(home, names) {
  return names
    .filter((n) => existsSync(join(home, 'skills', n, 'SKILL.md')))
    .map((n) => ({ name: n, path: `~/.claude/skills/${n}/SKILL.md` }));
}

#!/usr/bin/env node
/**
 * Rebuild the eval fixtures from real state.
 *
 * Two fixture homes, and they exist for different reasons:
 *
 *   home/    a frozen snapshot of this repo's marketplace as it was on the day
 *            it was captured, plus the real `claude plugin list --json` from
 *            this machine. The golden report is byte-compared against a run
 *            over THIS, not over the live repo — otherwise every unrelated
 *            skill release would break pluginsync's baseline, and a version
 *            bump is not a content change.
 *
 *   broken/  the trap. One marketplace entry points at a source directory with
 *            no plugin.json, and `check` must exit non-zero over it. Without
 *            this the baseline goes green the day the resolver starts swallowing
 *            unreadable sources.
 *
 * The live repo is still covered — by the corpus check in
 * scripts/tests/resolve.test.mjs, which asserts a floor rather than bytes.
 *
 * Usage: node evals/fixtures/update.mjs [--from-live]
 *   --from-live   re-read this machine's `claude plugin list --json` and this
 *                 repo's plugin versions. Without it, only the layout is
 *                 rebuilt from the committed snapshot values.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = resolve(HERE, '..', '..');
const REPO = resolve(SKILL, '..', '..', '..', '..');
const SNAPSHOT = join(HERE, 'snapshot.json');

const writeJson = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

/** Read the live repo: every marketplace plugin and its current version. */
function liveCatalog() {
  const manifest = JSON.parse(readFileSync(join(REPO, '.claude-plugin', 'marketplace.json'), 'utf8'));
  return manifest.plugins.map((p) => ({
    name: p.name,
    version: JSON.parse(readFileSync(join(REPO, p.source, '.claude-plugin', 'plugin.json'), 'utf8')).version,
  }));
}

/** Read this machine: what is installed from the claude-skills marketplace. */
function liveInstalled() {
  const raw = JSON.parse(execFileSync('claude', ['plugin', 'list', '--json'], { encoding: 'utf8' }));
  const list = Array.isArray(raw) ? raw : raw.installed;
  return list
    .filter((p) => String(p.id).endsWith('@claude-skills'))
    .map((p) => ({ id: p.id, version: p.version, scope: p.scope, enabled: p.enabled !== false }));
}

const fromLive = process.argv.includes('--from-live');
let snapshot;
if (fromLive) {
  snapshot = {
    $comment:
      'Captured from a real machine and a real repo. The golden report is pinned against THIS, so it survives unrelated skill releases. Refresh with: node evals/fixtures/update.mjs --from-live',
    capturedFrom: 'natejswenson/claude-skills + the local Claude Code plugin install',
    catalog: liveCatalog(),
    installed: liveInstalled(),
  };
  writeJson(SNAPSHOT, snapshot);
} else {
  if (!existsSync(SNAPSHOT)) throw new Error('no snapshot.json yet — run with --from-live once to capture one');
  snapshot = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
}

// ---- home/ : the good fixture -------------------------------------------
const home = join(HERE, 'home');
rmSync(home, { recursive: true, force: true });
writeJson(join(home, 'plugins', 'known_marketplaces.json'), {
  'claude-skills': {
    source: { source: 'directory', path: './marketplace' },
    installLocation: './marketplace',
  },
});
writeJson(join(home, 'marketplace', '.claude-plugin', 'marketplace.json'), {
  name: 'claude-skills',
  plugins: snapshot.catalog.map((p) => ({ name: p.name, source: `./skills/${p.name}` })),
});
for (const p of snapshot.catalog) {
  writeJson(join(home, 'marketplace', 'skills', p.name, '.claude-plugin', 'plugin.json'), {
    name: p.name,
    version: p.version,
  });
}
writeJson(join(HERE, 'installed.json'), snapshot.installed.map((p) => ({ ...p })));

// ---- broken/ : the trap --------------------------------------------------
// Two entries, one of them unresolvable. A resolver that drops the bad row
// would report the good one as "ok" and exit 0 — success, over a marketplace
// it could not read.
const broken = join(HERE, 'broken');
rmSync(broken, { recursive: true, force: true });
writeJson(join(broken, 'plugins', 'known_marketplaces.json'), {
  'claude-skills': {
    source: { source: 'directory', path: './marketplace' },
    installLocation: './marketplace',
  },
});
writeJson(join(broken, 'marketplace', '.claude-plugin', 'marketplace.json'), {
  name: 'claude-skills',
  plugins: [
    { name: 'intact', source: './skills/intact' },
    { name: 'no-plugin-json', source: './skills/no-plugin-json' },
  ],
});
writeJson(join(broken, 'marketplace', 'skills', 'intact', '.claude-plugin', 'plugin.json'), {
  name: 'intact',
  version: '1.0.0',
});
// no-plugin-json/ deliberately holds a file that is NOT a plugin manifest.
mkdirSync(join(broken, 'marketplace', 'skills', 'no-plugin-json'), { recursive: true });
writeFileSync(join(broken, 'marketplace', 'skills', 'no-plugin-json', 'README.md'), 'a source directory with no manifest\n');
writeJson(join(HERE, 'installed-broken.json'), [
  { id: 'intact@claude-skills', version: '1.0.0', scope: 'user', enabled: true },
]);

console.log(
  `fixtures rebuilt — ${snapshot.catalog.length} catalog entries, ${snapshot.installed.length} installed${fromLive ? ' (recaptured from live)' : ''}`,
);

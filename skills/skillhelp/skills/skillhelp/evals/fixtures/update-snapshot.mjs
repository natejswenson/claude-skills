#!/usr/bin/env node
/**
 * Refresh the frozen snapshot the baseline golden builds over.
 *
 * WHY A SNAPSHOT AND NOT THE LIVE TREE. The golden byte-compares a full build.
 * Run against `skills/` directly it would redden on every edit to any of
 * seventeen skills — a toll booth on every PR in the monorepo, which is a
 * baseline people delete rather than maintain. Pinning the INPUT means the
 * golden moves only when the extractor moves, which is the thing it is actually
 * meant to guard. Live coverage is `skillhelp check`'s job, and it runs in CI
 * against `skills/**` for exactly that reason.
 *
 * These are real files from real shipped skills, not invented ones: the whole
 * point is that extraction is proven against the markdown people really write,
 * including the older heading vocabulary that six skills still use.
 *
 * Run: node evals/fixtures/update-snapshot.mjs
 */
import { mkdirSync, copyFileSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findRepo } from '../../scripts/lib/store.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SNAP = join(HERE, 'snapshot');
// Walked, not counted. A hand-counted '..' chain was off by one and copied
// ZERO files while exiting 0 — the silent-empty-corpus failure this repo's
// anti-vacuity floors exist to catch, reproduced in the tool that feeds them.
const REPO = findRepo(HERE);

/** Chosen to span every extraction path that behaves differently:
 *  - city-report / ghostwriter — python skills, no package.json
 *  - gmailtriage / press       — node skills declaring a `split` in invariants
 *  - shipflow                  — older heading vocabulary, `code` not `split`
 *  - skillhelp                 — self-coverage; the index must describe itself */
const SKILLS = ['city-report', 'ghostwriter', 'gmailtriage', 'press', 'shipflow', 'skillhelp'];

const FLAT = ['README.md', 'CHANGELOG.md'];
const INNER = ['SKILL.md', 'package.json', 'skill-invariants.json'];
const CODE_EXT = /\.(mjs|js|py)$/;

function copyCode(srcDir, dstDir, depth = 0) {
  if (depth > 2 || !existsSync(srcDir)) return;
  for (const e of readdirSync(srcDir).sort()) {
    if (e === 'node_modules' || e.startsWith('.') || e === 'tests') continue;
    const s = join(srcDir, e);
    const d = join(dstDir, e);
    if (statSync(s).isDirectory()) copyCode(s, d, depth + 1);
    else if (CODE_EXT.test(e) && !/\.test\./.test(e)) {
      mkdirSync(dirname(d), { recursive: true });
      copyFileSync(s, d);
    }
  }
}

rmSync(SNAP, { recursive: true, force: true });
let files = 0;
for (const name of SKILLS) {
  const src = join(REPO, 'skills', name);
  const dst = join(SNAP, 'skills', name);
  for (const f of FLAT) {
    if (!existsSync(join(src, f))) continue;
    mkdirSync(dst, { recursive: true });
    copyFileSync(join(src, f), join(dst, f));
    files += 1;
  }
  for (const f of INNER) {
    const s = join(src, 'skills', name, f);
    if (!existsSync(s)) continue;
    mkdirSync(join(dst, 'skills', name), { recursive: true });
    copyFileSync(s, join(dst, 'skills', name, f));
    files += 1;
  }
  for (const d of ['scripts', 'bin', 'lib']) {
    copyCode(join(src, 'skills', name, d), join(dst, 'skills', name, d));
  }
  // The snapshot must look like a repo to `findRepo`, and a skill is only
  // discovered when its nested SKILL.md exists — a snapshot that silently
  // dropped one would shrink the golden without failing it.
}
mkdirSync(join(SNAP, '.claude-plugin'), { recursive: true });
const marketplacePath = join(SNAP, '.claude-plugin', 'marketplace.json');
if (!existsSync(marketplacePath)) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(marketplacePath, `${JSON.stringify({ name: 'snapshot', plugins: SKILLS.map((n) => ({ name: n, source: `./skills/${n}` })) }, null, 2)}\n`);
}
if (files < SKILLS.length * 3) {
  console.error(`snapshot refresh copied only ${files} declared files for ${SKILLS.length} skills — refusing to write an empty corpus the golden would pass over`);
  process.exit(1);
}
console.log(`snapshot refreshed — ${SKILLS.length} skills, ${files} declared files (plus code modules) under evals/fixtures/snapshot/`);
console.log('now re-freeze the golden: node scripts/skillhelp.js build --repo evals/fixtures/snapshot --skill-dir <out>');

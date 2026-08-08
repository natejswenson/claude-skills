/**
 * The index on disk: build it, and prove it still describes the repo.
 *
 * `check` is the honest half. It re-extracts every skill and compares the card
 * it WOULD produce against the committed one, so the failure it reports is
 * "this answer would change", not "some byte moved".
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractSkill, listSkillNames, SECTIONS } from './extract.mjs';
import { renderCard, hashCard, manifestEntry } from './card.mjs';

export const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const indexDir = (skillDir = SKILL_DIR) => join(skillDir, 'index');
export const manifestPath = (skillDir = SKILL_DIR) => join(indexDir(skillDir), '_manifest.json');
export const cardPath = (name, skillDir = SKILL_DIR) => join(indexDir(skillDir), `${name}.md`);

export const REBUILD = 'node scripts/skillhelp.js build';

/** Walk up from the CLI to the repo that owns it, so `--repo` is optional in
 *  the common case. A skill that makes you type a path you could have been
 *  read is a skill with a worse UX than it needed. */
export function findRepo(start = SKILL_DIR) {
  let dir = resolve(start);
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, '.claude-plugin', 'marketplace.json'))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return resolve('.');
}

export function buildAll(repo, { skillDir = SKILL_DIR, write = true } = {}) {
  const names = listSkillNames(repo);
  const prev = readManifest(skillDir);
  const prevBy = new Map((prev?.skills ?? []).map((s) => [s.name, s]));
  const rows = [];
  const cards = new Map();

  for (const name of names) {
    const card = extractSkill(repo, name);
    const text = renderCard(card);
    const entry = manifestEntry(card, text);
    cards.set(name, { card, text, entry });
    const before = prevBy.get(name);
    const status = !before ? 'new' : before.cardHash === entry.cardHash ? 'unchanged' : 'updated';
    rows.push({ ...entry, status });
  }

  if (write) {
    mkdirSync(indexDir(skillDir), { recursive: true });
    // Drop cards for skills that no longer exist — a stale card for a deleted
    // skill answers questions about something that is gone.
    for (const f of existsSync(indexDir(skillDir)) ? readdirSync(indexDir(skillDir)) : []) {
      if (f.endsWith('.md') && !cards.has(f.replace(/\.md$/, ''))) rmSync(join(indexDir(skillDir), f));
    }
    for (const [name, { text }] of cards) writeFileSync(cardPath(name, skillDir), text);
    const manifest = { skills: rows.map(({ status, ...e }) => e) };
    writeFileSync(manifestPath(skillDir), `${JSON.stringify(manifest, null, 2)}\n`);
  }

  return { rows, cards };
}

export function readManifest(skillDir = SKILL_DIR) {
  const p = manifestPath(skillDir);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

export function readCard(name, skillDir = SKILL_DIR) {
  const p = cardPath(name, skillDir);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

/**
 * Five verdicts, and only one of them is green:
 *   ok          — the committed card is byte-identical to what extraction produces now
 *   would-change— the skill changed in a way that changes its answers
 *   missing     — a skill exists under skills/ with no card at all
 *   incomplete  — a committed card is missing one of the five required sections
 *   ungrounded  — a committed card holds a fact with no file:line source
 */
export function checkAll(repo, { skillDir = SKILL_DIR } = {}) {
  const { rows, cards } = buildAll(repo, { skillDir, write: false });
  const manifest = readManifest(skillDir);
  const byName = new Map((manifest?.skills ?? []).map((s) => [s.name, s]));
  const results = [];

  for (const r of rows) {
    const committed = readCard(r.name, skillDir);
    const fresh = cards.get(r.name).text;
    let verdict = 'ok';
    if (committed === null) verdict = 'missing';
    else if (hashCard(committed) !== r.cardHash) verdict = 'would-change';
    else if (!SECTIONS.every((s) => new RegExp(`^## `, 'm').test(committed) && sectionPresent(committed, s))) verdict = 'incomplete';
    else if (hasUngroundedFact(committed)) verdict = 'ungrounded';
    results.push({
      name: r.name,
      indexed: byName.get(r.name)?.version ?? '—',
      live: r.version,
      verdict,
      fresh,
    });
  }

  // A card for a skill that no longer exists is its own failure: it answers
  // confidently about something the repo no longer has.
  const known = new Set(rows.map((r) => r.name));
  for (const f of existsSync(indexDir(skillDir)) ? readdirSync(indexDir(skillDir)).sort() : []) {
    if (!f.endsWith('.md')) continue;
    const name = f.replace(/\.md$/, '');
    if (!known.has(name)) results.push({ name, indexed: byName.get(name)?.version ?? '—', live: '—', verdict: 'orphaned', fresh: null });
  }

  const ok = results.every((r) => r.verdict === 'ok');
  return { results, ok, count: rows.length };
}

const TITLES = ['Setup', 'Usage', 'Commands', 'Architecture', 'Troubleshooting'];
const sectionPresent = (text, s) => text.includes(`## ${TITLES[SECTIONS.indexOf(s)]}`);

/** A bullet in a card body that carries no `path:line` backtick span. The one
 *  rule, expressed as an assertion rather than a promise. */
export function hasUngroundedFact(text) {
  for (const line of text.split('\n')) {
    if (!line.startsWith('- ')) continue;
    if (line.startsWith('- **')) continue;              // the header block
    if (line.startsWith('- _No source')) continue;      // an honest empty section
    if (!/`[^`]+:\d+`\s*$/.test(line)) return true;
  }
  return false;
}

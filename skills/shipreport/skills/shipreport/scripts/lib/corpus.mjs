/**
 * The on-disk corpus: already redacted, merged by id, and watermarked so the
 * second run is cheap.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const defaultCorpusDir = () => join(homedir(), '.shipreport');

const read = (file, fallback) => {
  if (!existsSync(file)) return fallback;
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; }
};

const stable = (obj) => JSON.stringify(obj, null, 2) + '\n';

export function loadCorpus(dir = defaultCorpusDir()) {
  return {
    dir,
    meta: read(join(dir, 'meta.json'), { schema: 1, watermark: {}, redactions: {}, login: null }),
    github: read(join(dir, 'github.json'), {}),
    sessions: read(join(dir, 'sessions.json'), {}),
  };
}

export function saveCorpus(corpus) {
  mkdirSync(corpus.dir, { recursive: true });
  writeFileSync(join(corpus.dir, 'meta.json'), stable(corpus.meta));
  writeFileSync(join(corpus.dir, 'github.json'), stable(sortKeys(corpus.github)));
  writeFileSync(join(corpus.dir, 'sessions.json'), stable(sortKeys(corpus.sessions)));
}

const sortKeys = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

/** Merge new items in by id; returns how many were genuinely new. */
export function mergeItems(store, items) {
  let added = 0;
  for (const it of items) {
    if (!(it.id in store)) added += 1;
    store[it.id] = it;
  }
  return added;
}

/** Every item, both sources, as one array. */
export const allItems = (corpus) => [...Object.values(corpus.github), ...Object.values(corpus.sessions)];

export const inWindow = (items, since, until) =>
  items.filter((i) => i.at && i.at >= since && i.at <= until);

/**
 * Which artifacts have actually been read, and when.
 *
 * SKILL.md says of writing a sentence first and hunting for a receipt after:
 * "the gate cannot catch that, and nothing can". That is true of the sentence,
 * but not of the reading. The third graded run cited three receipts it never
 * passed to `show` — a pull request, a session and a release — writing them from
 * a previous run's memory. Every one resolved, so the gate passed them.
 *
 * This is deliberately a *report*, never a refusal: citing something read
 * through the ranked table alone is legitimate, and a hard gate here would
 * refuse honest work. It only makes the question askable.
 */
export const readsFile = (dir) => join(dir, 'reads.json');

export function loadReads(dir) {
  return read(readsFile(dir), null);
}

export function recordReads(dir, receipts, now) {
  const log = read(readsFile(dir), {});
  for (const r of receipts) log[r] = now;
  mkdirSync(dir, { recursive: true });
  writeFileSync(readsFile(dir), stable(sortKeys(log)));
}

/** Resolve one receipt id against the corpus. The one rule runs through here. */
export function resolveReceipt(corpus, receipt) {
  if (typeof receipt !== 'string' || !receipt) return null;
  if (corpus.github[receipt]) return corpus.github[receipt];
  if (corpus.sessions[receipt]) return corpus.sessions[receipt];
  // session:<id>#<messageUuid> — a citation to one moment inside a session
  const hash = receipt.indexOf('#');
  if (receipt.startsWith('session:') && hash > -1) {
    const base = receipt.slice(0, hash);
    const uuid = receipt.slice(hash + 1);
    const s = corpus.sessions[base];
    if (s && Array.isArray(s.uuids) && s.uuids.includes(uuid)) return s;
  }
  return null;
}

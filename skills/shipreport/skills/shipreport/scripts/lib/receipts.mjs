/**
 * The one rule, as code.
 *
 * A drafted report is checked three ways before it may be rendered:
 *   1. every claim carries at least one receipt
 *   2. every receipt resolves against the corpus
 *   3. no raw identifier appears in the prose
 *
 * (3) is the audience contract — the report is for someone who was not there,
 * so repository names, pull request numbers and commit hashes belong in the
 * appendix, never in a sentence. It is checked here rather than asked for in
 * prose because an instruction is not a gate.
 */
import { resolveReceipt } from './corpus.mjs';

/**
 * The gate refuses raw identifiers. It must not refuse English.
 *
 * The first real run was told that the phrase **"plus/minus"** was a "raw
 * repo-slug" and reworded a true sentence to satisfy it — the exact inversion of
 * "fix the draft, never the checker". `\w+/\w+` also matches "CI/CD", "and/or",
 * "read/write" and "24/7", and `[0-9a-f]{7,40}` matches any seven-digit number
 * and the words "effaced" and "defaced".
 *
 * A false positive here is worse than a miss. A miss puts one identifier in a
 * sentence; a false positive teaches the run that the gate is an obstacle to be
 * worded around, which is how a gate stops being believed.
 *
 * So the two ambiguous classes are checked against the corpus rather than
 * against a shape: a slug is a repo slug when a repo by that name was actually
 * seen, and a hex run is a sha when it could not be an ordinary number.
 */
export const RAW_ID = [
  // Any non-alphanumeric boundary, not whitespace specifically. `stripTags`
  // leaves a bare `>` behind when nested tags collapse (`<<em>em>#412` becomes
  // `em>#412`), and requiring whitespace let that through — the smuggling case
  // was only ever caught by a repo-slug FALSE POSITIVE on `412/em`, which is a
  // test passing for the wrong reason.
  { cls: 'pr-number', re: /(?:^|[^A-Za-z0-9_])#\d+\b/ },
  {
    cls: 'commit-sha',
    re: /\b[0-9a-f]{7,40}\b/g,
    // A sha mixes letters and digits. A run of digits is a number and a run of
    // letters is a word — "1234567" and "effaced" are neither of them shas.
    confirm: (m) => /[0-9]/.test(m) && /[a-f]/.test(m),
  },
  {
    cls: 'repo-slug',
    re: /\b[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*\b/g,
    confirm: (m, corpus) => isRepoSlug(m, corpus),
  },
  { cls: 'receipt-token', re: /\b(?:pr|commit|release|session):[A-Za-z0-9]/ },
];

/**
 * `owner/name` is a repository. `plus/minus` is a sentence.
 *
 * Known-to-the-corpus is the strongest evidence, but it cannot be the only test
 * or a slug for a repo never indexed would read as prose. So the fallback is
 * shape: repository names carry hyphens, dots, underscores or digits, and two
 * plain English words separated by a slash carry none of those.
 */
export function isRepoSlug(slug, corpus) {
  const [owner, name] = slug.split('/');
  if (!owner || !name) return false;
  if (knownRepos(corpus).has(slug.toLowerCase())) return true;
  if (knownOwners(corpus).has(owner.toLowerCase())) return true;
  const plain = (s) => /^[A-Za-z]+$/.test(s);
  // "plus/minus", "read/write", "and/or", "CI/CD" — prose.
  if (plain(owner) && plain(name)) return false;
  // "24/7", "9/10" — a ratio, not a repository.
  if (/^\d+$/.test(owner) && /^\d+$/.test(name)) return false;
  return true;
}

/** Every `owner/repo` the corpus has ever seen, and every owner of one. */
const repoCache = new WeakMap();
function repoSets(corpus) {
  if (repoCache.has(corpus)) return repoCache.get(corpus);
  const repos = new Set();
  const owners = new Set();
  for (const item of Object.values(corpus?.github ?? {})) {
    if (!item?.repo) continue;
    repos.add(String(item.repo).toLowerCase());
    owners.add(String(item.repo).split('/')[0].toLowerCase());
  }
  if (corpus?.meta?.login) owners.add(String(corpus.meta.login).toLowerCase());
  const sets = { repos, owners };
  repoCache.set(corpus, sets);
  return sets;
}
const knownRepos = (corpus) => repoSets(corpus).repos;
const knownOwners = (corpus) => repoSets(corpus).owners;

const proseOf = (draft) => {
  const out = [];
  if (draft.headline) out.push(['headline', draft.headline]);
  for (const [i, p] of (draft.standfirst ?? []).entries()) out.push([`standfirst[${i}]`, p]);
  for (const [si, s] of (draft.sections ?? []).entries()) {
    for (const [ii, it] of (s.items ?? []).entries()) {
      if (it.title) out.push([`sections[${si}].items[${ii}].title`, it.title]);
      if (it.text) out.push([`sections[${si}].items[${ii}].text`, it.text]);
    }
  }
  return out;
};

const claimsOf = (draft) => {
  const out = [];
  for (const [si, s] of (draft.sections ?? []).entries()) {
    for (const [ii, it] of (s.items ?? []).entries()) {
      out.push({ where: `sections[${si}].items[${ii}]`, title: it.title ?? '(untitled)', receipts: it.receipts ?? [] });
    }
  }
  return out;
};

/**
 * Strip tags to a fixed point, not in one pass.
 *
 * One pass is incomplete: `<<em>em>` loses the inner `<em>` and leaves a fresh
 * `<em>` behind. Here that is not an injection — `render` escapes everything and
 * only ever un-escapes a literal `<em>` — but this runs on the *detection* side,
 * so an incomplete strip is a way to hide a raw identifier from the gate. Each
 * pass strictly shortens the string, so this terminates.
 */
const stripTags = (s) => {
  let out = String(s);
  let prev;
  do { prev = out; out = out.replace(/<[^>]*>/g, ''); } while (out !== prev);
  return out;
};

export function checkDraft(draft, corpus) {
  const rows = [];
  const problems = [];

  for (const claim of claimsOf(draft)) {
    if (claim.receipts.length === 0) {
      rows.push([claim.title.slice(0, 46), '(none)', 'NO']);
      problems.push(`${claim.where}: claim carries no receipt — "${claim.title}"`);
      continue;
    }
    for (const r of claim.receipts) {
      const hit = resolveReceipt(corpus, r);
      rows.push([claim.title.slice(0, 46), r, hit ? 'yes' : 'NO']);
      if (!hit) problems.push(`${claim.where}: receipt does not resolve — ${r}`);
    }
  }

  let proseProblems = 0;
  for (const [where, text] of proseOf(draft)) {
    const clean = stripTags(text);
    for (const { cls, re, confirm } of RAW_ID) {
      // `confirm` decides whether a shape is actually an identifier; the first
      // match that shapes alone would have flagged is not necessarily one.
      const hits = re.flags.includes('g')
        ? [...clean.matchAll(re)].map((m) => m[0])
        : [re.exec(clean)?.[0]].filter((x) => x != null);
      const hit = hits.find((h) => !confirm || confirm(h.trim(), corpus));
      if (hit != null) {
        proseProblems += 1;
        problems.push(`${where}: raw ${cls} in prose — "${hit.trim()}" belongs in the appendix, not a sentence`);
      }
    }
  }

  if (claimsOf(draft).length === 0) problems.push('draft has no claims — a report over zero items is not a clean run, it is an empty one');

  return { rows, problems, proseProblems, ok: problems.length === 0 };
}

/** Every distinct resolved receipt, in citation order — the appendix. */
export function appendix(draft, corpus) {
  const seen = new Map();
  for (const claim of claimsOf(draft)) {
    for (const r of claim.receipts) {
      if (seen.has(r)) continue;
      const item = resolveReceipt(corpus, r);
      if (item) seen.set(r, item);
    }
  }
  return [...seen.entries()].map(([receipt, item]) => ({ receipt, item }));
}

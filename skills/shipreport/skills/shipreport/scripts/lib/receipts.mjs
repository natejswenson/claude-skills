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

export const RAW_ID = [
  { cls: 'pr-number', re: /(?:^|[\s(])#\d+\b/ },
  { cls: 'commit-sha', re: /\b[0-9a-f]{7,40}\b/ },
  { cls: 'repo-slug', re: /\b[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*\b/ },
  { cls: 'receipt-token', re: /\b(?:pr|commit|release|session):[A-Za-z0-9]/ },
];

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

const stripTags = (s) => String(s).replace(/<[^>]*>/g, '');

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

  for (const [where, text] of proseOf(draft)) {
    for (const { cls, re } of RAW_ID) {
      const m = re.exec(stripTags(text));
      if (m) problems.push(`${where}: raw ${cls} in prose — "${m[0].trim()}" belongs in the appendix, not a sentence`);
    }
  }

  if (claimsOf(draft).length === 0) problems.push('draft has no claims — a report over zero items is not a clean run, it is an empty one');

  return { rows, problems, ok: problems.length === 0 };
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

/**
 * Ingest: raw MCP tool output → the snapshots every other command reads.
 *
 * The agent used to transcribe `search_threads` responses into `threads.json`
 * by hand — sixty to ninety seconds of JSON authoring per run, re-edited
 * whenever a rule was added mid-run, and the main way a field got dropped or
 * mangled on the way in. Reshaping a tool response is not judgment and never
 * was, so it lives here now: the agent writes each tool result to a file
 * VERBATIM, and this module does the rest.
 *
 * The structural guarantee this file carries: only allowlisted snapshot fields ever reach
 * the output. A raw response carries `snippet` — which on a real mailbox has
 * held live verification codes — and nothing here copies it anywhere. The
 * output objects are built field by field precisely so a new field appearing
 * upstream cannot leak through.
 */

import { resolveCategory, isBulkCategory } from './category.mjs';
import { resolveSender } from './sender.mjs';

/** Ordinary snapshots; ambiguous evidence adds bounded categoryEvidence and/or senderAmbiguous markers. */
export const SNAPSHOT_FIELDS = ['id', 'from', 'subject', 'date', 'labelIds', 'category', 'hasUnsubscribe'];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * One raw `search_threads` response → normalized threads.
 *
 * `{}` is tolerated because it is real: an empty category fetch returns it.
 * Per thread, the first message supplies sender/subject/date — Gmail orders a
 * thread oldest-first, and the first message is the one the sender chose the
 * subject for — and `labelIds` is the union across every message, because a
 * thread is filed if any message in it is.
 */
export function normalizeSearchThreads(raw, what = 'search_threads output') {
  if (!isObj(raw)) {
    throw new Error(`${what}: expected the raw search_threads response object, written to the file verbatim — got ${Array.isArray(raw) ? 'an array' : typeof raw}`);
  }
  const threads = raw.threads ?? [];
  if (!Array.isArray(threads)) throw new Error(`${what}: "threads" is not an array — this is not a search_threads response`);
  const out = [];
  for (const t of threads) {
    if (!isObj(t) || !t.id) throw new Error(`${what}: a thread without an id — this is not a search_threads response`);
    const msgs = Array.isArray(t.messages) ? t.messages : [];
    const first = msgs[0] ?? {};
    // Preserve existing evidence through the raw-response boundary, using only
    // bounded resolver tokens so malformed fields cannot leak into snapshots.
    const evidence = resolveCategory(t);
    out.push({
      id: t.id,
      from: first.sender ?? null,
      ...(resolveSender({ ...t, from: first.sender }, first).ambiguous ? { senderAmbiguous: true } : {}),
      subject: first.subject ?? null,
      date: first.date ?? null,
      ...(evidence.category ? { category: evidence.category } : {}),
      ...(evidence.status === 'conflict' || evidence.invalid ? {
        categoryEvidence: { status: evidence.status, categories: evidence.categories },
      } : {}),
      labelIds: [...new Set(msgs.flatMap((m) => m?.labelIds ?? []))],
    });
  }
  return out;
}

/** Just the thread ids — all a category fetch is for. */
export const threadIds = (raw, what = 'category fetch') =>
  normalizeSearchThreads(raw, what).map((t) => t.id);

/**
 * Union the fetches, deduped by thread id.
 *
 * The inbox fetch and the no-user-label fetch overlap on exactly the threads
 * that are in the inbox and not yet filed — which is most of what a run is
 * about — so dedupe is not an edge case, it is the normal path. Label ids are
 * unioned on collision; the first source to name a sender/subject/date wins.
 */
export function mergeThreadSources(...sources) {
  const byId = new Map();
  for (const list of sources) {
    for (const t of list ?? []) {
      const prev = byId.get(t.id);
      if (!prev) {
        byId.set(t.id, { ...t, ...(resolveSender(t).ambiguous ? { senderAmbiguous: true } : {}) });
        continue;
      }
      if (resolveSender(prev, t).ambiguous) prev.senderAmbiguous = true;
      // A later duplicate contributes evidence, including uncertainty; neither
      // source gets to overwrite or silently discard the other's category.
      const categorySources = [resolveCategory(prev), resolveCategory(t)];
      const evidence = resolveCategory(
        categorySources.some((e) => e.invalid) ? { categoryEvidence: { status: 'unknown', categories: [] } } : {},
        categorySources.flatMap((e) => e.categories),
      );
      prev.category = evidence.category;
      if (evidence.status === 'conflict' || evidence.invalid) {
        prev.categoryEvidence = { status: evidence.status, categories: evidence.categories };
      } else delete prev.categoryEvidence;
      prev.labelIds = [...new Set([...(prev.labelIds ?? []), ...(t.labelIds ?? [])])];
      prev.from ??= t.from;
      prev.subject ??= t.subject;
      prev.date ??= t.date;
    }
  }
  return [...byId.values()];
}

/**
 * Stamp `category` and `hasUnsubscribe` from the category id-sets, and build
 * the final snapshot objects — field by field, which is the allowlist.
 *
 * `hasUnsubscribe` is the documented proxy (references/gmail.md): Gmail's API
 * exposes no List-Unsubscribe header, and membership in the promotions or
 * updates category is the closest structural stand-in.
 */
export function applyCategories(threads, promoIds = [], updateIds = []) {
  const promos = new Set(promoIds);
  const updates = new Set(updateIds);
  return threads.map((t) => {
    const evidence = resolveCategory(t, [
      ...(promos.has(t.id) ? ['promotions'] : []),
      ...(updates.has(t.id) ? ['updates'] : []),
    ]);
    return {
      id: t.id,
      from: t.from,
      ...(resolveSender(t).ambiguous ? { senderAmbiguous: true } : {}),
      subject: t.subject,
      date: t.date,
      labelIds: t.labelIds ?? [],
      category: evidence.category,
      hasUnsubscribe: isBulkCategory(evidence),
      // Null alone loses disagreement/invalid input. Retain only bounded tokens,
      // so another ingest or a legacy true proxy cannot erase that uncertainty.
      ...(evidence.status === 'conflict' || evidence.invalid ? {
        categoryEvidence: { status: evidence.status, categories: evidence.categories },
      } : {}),
    };
  });
}

/**
 * Threads that arrived without a sender or subject.
 *
 * The likely cause is specific and worth naming: THREAD_VIEW_METADATA_ONLY
 * strips both, and a run that fetched the inbox that way produced subject-less
 * threads a later audit reported as unclaimed. Refusing here, before anything
 * is written, is what turns that hour of confusion into one re-fetch.
 */
export const validateIngest = (threads) =>
  threads.filter((t) => !t.from || !t.subject).map((t) => ({
    id: t.id,
    missing: [!t.from ? 'from' : null, !t.subject ? 'subject' : null].filter(Boolean),
  }));

/**
 * One raw `list_labels` response → the labels document every command reads.
 * Entries pass through untouched — `list_labels` carries names, ids and
 * counts, and nothing resembling message content.
 */
export function normalizeLabels(raw, what = 'list_labels output') {
  if (Array.isArray(raw)) return { labels: raw };
  if (isObj(raw) && Array.isArray(raw.labels)) return { labels: raw.labels };
  throw new Error(`${what}: expected the raw list_labels response object, written to the file verbatim`);
}

/**
 * Normalize verbatim MCP output into allowlisted snapshot fields.
 * Deduplication, label union and category evidence are deterministic.
 * Snippets can contain secrets and are never copied to the snapshot.
 */

/** The whole thread schema. Nothing else is ever written to disk. */
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
    out.push({
      id: t.id,
      from: first.sender ?? null,
      subject: first.subject ?? null,
      date: first.date ?? null,
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
      if (!prev) { byId.set(t.id, { ...t }); continue; }
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
    const category = promos.has(t.id) ? 'promotions' : updates.has(t.id) ? 'updates' : null;
    return {
      id: t.id,
      from: t.from,
      subject: t.subject,
      date: t.date,
      labelIds: t.labelIds ?? [],
      category,
      hasUnsubscribe: category !== null,
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

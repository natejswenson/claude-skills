/** Shared interpretation of observed category evidence; absence is never primary. */
const CATEGORIES = ['promotions', 'updates', 'social', 'forums', 'primary'];
const LEGACY = new Map(CATEGORIES.map((c) => [`CATEGORY_${c.toUpperCase()}`, c]));
LEGACY.set('CATEGORY_PERSONAL', 'primary');
const isCategory = (value) => CATEGORIES.includes(value);

/**
 * Combine explicit fields, legacy labels, positive search memberships and a
 * persisted ambiguity marker. No source wins a disagreement. Unrecognized
 * values poison otherwise known evidence; raw values are never returned.
 *
 * Persisted markers are only {status: unknown|conflict, categories: tokens[]}.
 * They can retain uncertainty, never assert that evidence became known.
 */
export function resolveCategory(thread, searchCategories = []) {
  const categories = new Set();
  let invalid = false;
  const add = (value) => {
    if (isCategory(value)) categories.add(value);
    else invalid = true;
  };
  if (thread.category != null) add(thread.category);
  for (const id of thread.labelIds ?? []) {
    const label = String(id).toUpperCase();
    if (label.startsWith('CATEGORY_')) add(LEGACY.get(label));
  }
  for (const category of searchCategories) add(category);

  if (Object.hasOwn(thread, 'categoryEvidence')) {
    const marker = thread.categoryEvidence;
    const valid = marker !== null && typeof marker === 'object' && !Array.isArray(marker)
      && Object.keys(marker).length === 2
      && Object.hasOwn(marker, 'status') && Object.hasOwn(marker, 'categories')
      && ['unknown', 'conflict'].includes(marker.status)
      && Array.isArray(marker.categories) && marker.categories.length <= CATEGORIES.length
      && marker.categories.every(isCategory)
      && new Set(marker.categories).size === marker.categories.length
      && (marker.status === 'conflict' ? marker.categories.length >= 2 : marker.categories.length <= 1);
    if (valid) {
      marker.categories.forEach(add);
      if (marker.status === 'unknown') invalid = true;
    } else invalid = true;
  }

  // Vocabulary order makes persistence and diagnostics deterministic and bounded.
  const tokens = CATEGORIES.filter((c) => categories.has(c));
  const status = tokens.length > 1 ? 'conflict' : invalid || !tokens.length ? 'unknown' : 'known';
  return { status, category: status === 'known' ? tokens[0] : null, categories: tokens, invalid };
}

/** A structural category proxy, not an assertion about List-Unsubscribe headers. */
export const isBulkCategory = (evidence) => evidence.status === 'known'
  && ['promotions', 'updates'].includes(evidence.category);

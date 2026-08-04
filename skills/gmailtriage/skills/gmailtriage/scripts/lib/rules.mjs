/**
 * Rules: the only thing allowed to trash a message.
 *
 * The model may propose a rule. It may never act as one. That is the whole
 * point of this file existing separately from the conversation: a rule is a
 * declared, stored, validated object, and everything downstream matches against
 * it rather than against an opinion.
 *
 * Validation is deliberately harsh. One over-broad rule empties an inbox, and
 * it does it on the run where nobody is watching — so a rule that matches
 * everything, matches nothing, or names no field at all is refused here rather
 * than discovered later.
 */

export const ACTIONS = ['trash', 'label', 'keep'];

/** Every matcher a rule may declare. Anything else is a typo, not a feature. */
export const FIELDS = [
  'from',            // substring or @domain
  'list',            // List-Id / mailing list
  'subjectContains',
  'category',        // promotions | social | updates | forums
  'olderThanDays',
  'hasUnsubscribe',  // true → only bulk mail carrying List-Unsubscribe
];

export const CATEGORIES = ['promotions', 'social', 'updates', 'forums', 'primary'];

export class RuleProblem extends Error {}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * A matcher that constrains nothing would take the entire mailbox. `keep` is
 * exempt only in the sense that it is still refused — a catch-all keep would
 * silently neutralise every other rule, which is just as surprising.
 */
function assertConstrained(match, where) {
  const named = FIELDS.filter((f) => match[f] !== undefined && match[f] !== null && match[f] !== '');
  if (named.length === 0) {
    throw new RuleProblem(`${where}: matches nothing in particular, so it would take the whole mailbox — name at least one of ${FIELDS.join(', ')}`);
  }
  return named;
}

export function validateRule(rule, where = 'rule') {
  if (!isObj(rule)) throw new RuleProblem(`${where}: not an object`);
  const w = rule.id ? `rule "${rule.id}"` : where;

  if (!rule.id || typeof rule.id !== 'string' || !/^[a-z0-9][a-z0-9-]{1,39}$/.test(rule.id)) {
    throw new RuleProblem(`${w}: id must be 2-40 chars of lowercase letters, digits and dashes`);
  }
  if (!ACTIONS.includes(rule.action)) {
    throw new RuleProblem(`${w}: action must be one of ${ACTIONS.join(', ')}`);
  }
  if (rule.action === 'label' && !rule.label) {
    throw new RuleProblem(`${w}: a label rule must name the label to apply`);
  }
  if (!isObj(rule.match)) throw new RuleProblem(`${w}: needs a match object`);

  for (const k of Object.keys(rule.match)) {
    if (!FIELDS.includes(k)) {
      throw new RuleProblem(`${w}: unknown match field "${k}" — a typo here is a rule that never fires; known fields are ${FIELDS.join(', ')}`);
    }
  }
  const named = assertConstrained(rule.match, w);

  if (rule.match.category !== undefined && !CATEGORIES.includes(rule.match.category)) {
    throw new RuleProblem(`${w}: category must be one of ${CATEGORIES.join(', ')}`);
  }
  if (rule.match.olderThanDays !== undefined) {
    const n = rule.match.olderThanDays;
    if (!Number.isInteger(n) || n < 1) throw new RuleProblem(`${w}: olderThanDays must be a positive whole number of days`);
  }
  for (const k of ['from', 'list', 'subjectContains']) {
    if (rule.match[k] !== undefined && (typeof rule.match[k] !== 'string' || rule.match[k].trim().length < 2)) {
      throw new RuleProblem(`${w}: ${k} must be a string of at least 2 characters — a one-character match is an accident`);
    }
  }
  // A trash rule constrained only by age is the classic inbox-emptier.
  if (rule.action === 'trash' && named.length === 1 && named[0] === 'olderThanDays') {
    throw new RuleProblem(`${w}: trashing by age alone would take every old message in the mailbox — pair olderThanDays with a sender, list or category`);
  }
  if (!rule.note || String(rule.note).trim().length < 4) {
    throw new RuleProblem(`${w}: needs a note saying what it is meant to catch — a rule nobody can interpret is a rule nobody will dare edit`);
  }
  return { id: rule.id, action: rule.action, fields: named };
}

export function validateRuleSet(doc) {
  if (!isObj(doc) || !Array.isArray(doc.rules)) {
    throw new RuleProblem('rule file: expected an object with a "rules" array');
  }
  const seen = new Set();
  const rows = [];
  for (const [i, r] of doc.rules.entries()) {
    const summary = validateRule(r, `rules[${i}]`);
    if (seen.has(r.id)) throw new RuleProblem(`rule "${r.id}": duplicate id — two rules with one id makes attribution ambiguous`);
    seen.add(r.id);
    rows.push({ ...summary, query: toGmailQuery(r), note: r.note });
  }
  return rows;
}

const quote = (s) => (/\s/.test(s) ? `"${s}"` : s);

/**
 * The Gmail query a rule compiles to. This is what the agent hands to
 * `search_threads`, and printing it is the point: a user who cannot see the
 * query cannot tell an over-broad rule from a precise one.
 */
export function toGmailQuery(rule) {
  const m = rule.match ?? {};
  const parts = [];
  if (m.from) parts.push(`from:${quote(m.from)}`);
  if (m.list) parts.push(`list:${quote(m.list)}`);
  if (m.subjectContains) parts.push(`subject:${quote(m.subjectContains)}`);
  if (m.category) parts.push(`category:${m.category}`);
  if (m.olderThanDays) parts.push(`older_than:${m.olderThanDays}d`);
  // Bulk mail only: Gmail has no header: operator, so this is the closest
  // structural proxy and it is documented as such in references/rules.md.
  if (m.hasUnsubscribe) parts.push('category:promotions OR category:updates');
  parts.push('in:inbox');
  return parts.join(' ');
}

/** Does one already-fetched thread satisfy a rule? */
export function matches(rule, thread, now = new Date()) {
  const m = rule.match ?? {};
  const from = String(thread.from ?? '').toLowerCase();
  const subject = String(thread.subject ?? '').toLowerCase();
  const labels = (thread.labelIds ?? []).map((l) => String(l).toUpperCase());

  if (m.from && !from.includes(String(m.from).toLowerCase())) return false;
  if (m.list && !String(thread.list ?? '').toLowerCase().includes(String(m.list).toLowerCase())) return false;
  if (m.subjectContains && !subject.includes(String(m.subjectContains).toLowerCase())) return false;
  if (m.category) {
    const want = `CATEGORY_${m.category.toUpperCase()}`;
    if (m.category === 'primary' ? labels.some((l) => l.startsWith('CATEGORY_') && l !== want) : !labels.includes(want)) return false;
  }
  if (m.hasUnsubscribe && !thread.hasUnsubscribe) return false;
  if (m.olderThanDays) {
    const at = Date.parse(thread.date ?? '');
    if (!Number.isFinite(at)) return false;
    if ((now.getTime() - at) / 86400000 < m.olderThanDays) return false;
  }
  return true;
}

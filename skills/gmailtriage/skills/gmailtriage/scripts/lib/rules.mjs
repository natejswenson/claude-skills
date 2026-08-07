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

/**
 * Gmail has no folders. A "move to a folder" is two operations — apply a user
 * label, then remove `INBOX` — and a `label` rule performs both unless it says
 * `keepInInbox: true`. See `references/sorting.md`.
 *
 * These are the labels a rule may never name as a destination. `TRASH` and
 * `SPAM` are the reason the list exists: without it, `{"action":"label",
 * "label":"TRASH"}` is a destructive operation smuggled through the
 * non-destructive action, bypassing every trash guard in this file. The rest
 * are refused because Gmail owns them — `label_thread` on `SENT` or
 * `CATEGORY_PROMOTIONS` either errors or silently lies about what a thread is.
 */
export const SYSTEM_LABELS = [
  'INBOX', 'TRASH', 'SPAM', 'SENT', 'DRAFT', 'DRAFTS',
  'STARRED', 'IMPORTANT', 'UNREAD', 'READ', 'CHAT',
];

/** Gmail's own cap. Nesting counts toward it, since the path is the name. */
export const MAX_LABEL_LENGTH = 225;

/**
 * One destination, one spelling. `Receipts`, `receipts` and `Receipts ` are the
 * same folder to a person, and matching a proposal against the user's real
 * label list has to agree — otherwise a first run cheerfully creates a second
 * "receipts" beside the one they already had.
 *
 * Case and surrounding whitespace are normalised; the `/` structure is not,
 * because `Finance/Chase` and `Chase` are genuinely different places.
 */
export const normaliseLabel = (name) =>
  String(name ?? '')
    .split('/')
    .map((seg) => seg.trim().replace(/\s+/g, ' ').toLowerCase())
    .join('/');

/**
 * Every label a destination implies, outermost first.
 *
 *   `Recruiting/Globex` → ['Recruiting', 'Recruiting/Globex']
 *
 * Filing into a sub-label applies the WHOLE path, and that is what keeps a
 * nested mailbox coherent over time. Gmail's nesting is cosmetic — a thread
 * carrying only `Recruiting/Globex` does not appear under `Recruiting` — so
 * without this, mail filed before a folder was split carries the parent and
 * mail filed after it carries only the child, and the parent view quietly
 * stops being the whole category.
 *
 * The cost is one extra idempotent `label_thread` call per thread. The
 * alternative is a folder whose contents depend on when the rule was written.
 */
export const labelPath = (name) => {
  const segs = String(name ?? '').split('/');
  const out = [];
  for (let i = 0; i < segs.length; i += 1) out.push(segs.slice(0, i + 1).join('/'));
  return out.filter((s) => s.trim() !== '');
};

/**
 * Damerau-Levenshtein, capped — the cap is what keeps this from being a fuzzy
 * matcher. One edit apart is a typo; two is usually two different words.
 *
 * **Damerau**, not plain Levenshtein, and that is the whole reason the check
 * works. `Receipts` → `Reciepts` is an adjacent transposition, which plain edit
 * distance scores at 2 (one substitution each way) and a ≤ 1 threshold
 * therefore misses — and a transposition is the commonest way a folder name
 * gets typed wrong. The `d[i-2][j-2] + 1` case below is what scores it 1.
 */
function editDistance(a, b, cap = 2) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1); // transposition
      }
    }
  }
  return d[a.length][b.length];
}

/** Below this, two labels being one edit apart says nothing. `NPM` vs `PNM`. */
export const MIN_NEAR_DUPLICATE_LENGTH = 5;

/**
 * Are these two labels the same folder, spelled two ways?
 *
 * `normaliseLabel` already collapses case and spacing, which catches
 * `Receipts`/`receipts`. It does not catch `Receipts`/`Reciepts` — a
 * transposition — and that pair is real: this mailbox carried both for months,
 * with mail split across them and no table anywhere saying so.
 *
 * One test, not two. An earlier version paired the edit distance with a
 * sorted-letter (anagram) check "to catch transpositions"; a mutation run
 * showed removing that check broke nothing, because the distance below is
 * **Damerau** and already scores an adjacent transposition at 1. The anagram
 * test only ever added multi-character scrambles, which are not a way anyone
 * mistypes a folder name — so it was two mechanisms claiming one job, and the
 * comment explaining it was wrong.
 *
 * Floored at MIN_NEAR_DUPLICATE_LENGTH: at three characters almost everything
 * is one edit from everything, and a hygiene check that cries wolf stops being
 * read.
 *
 * Compares the LEAF only, so `Finance/Receipts` and `Work/Reciepts` are still
 * flagged — the typo is in the segment, not the path.
 */
export function isNearDuplicateLabel(a, b) {
  if (normaliseLabel(a) === normaliseLabel(b)) return false; // the same label, not a near one
  const leaf = (n) => normaliseLabel(n).split('/').pop().replace(/[^a-z0-9]+/g, '');
  const x = leaf(a);
  const y = leaf(b);
  if (x.length < MIN_NEAR_DUPLICATE_LENGTH || y.length < MIN_NEAR_DUPLICATE_LENGTH) return false;
  // Same word under different parents. `Finance/Receipts` and `Work/Receipts`
  // are two deliberate folders, not one folder misspelled — flagging them would
  // tell the user to merge things they meant to keep apart.
  if (x === y) return false;
  // one edit apart: a substitution, a dropped or added character, or — because
  // this is Damerau — an adjacent transposition
  return editDistance(x, y) <= 1;
}

/** Is `parent` a strict ancestor of `child`? `Recruiting` of `Recruiting/Initech`. */
export const isAncestorLabel = (parent, child) => {
  const p = normaliseLabel(parent);
  const c = normaliseLabel(child);
  return p !== '' && c !== p && c.startsWith(`${p}/`);
};

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

/** Every key a rule may declare, as opposed to every field it may match on. */
export const RULE_KEYS = ['id', 'action', 'label', 'keepInInbox', 'match', 'note'];

/**
 * The destination of a `label` rule, checked before it can ever be applied.
 *
 * A bad destination discovered at apply time is the worst place to discover it:
 * the run is half done, some threads have moved and some have not, and the
 * receipt records a state that no longer matches the mailbox.
 */
export function validateDestination(name, where = 'rule') {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new RuleProblem(`${where}: a label rule must name the label to apply`);
  }
  const label = name.trim();
  if (label.length > MAX_LABEL_LENGTH) {
    throw new RuleProblem(`${where}: label is ${label.length} characters — Gmail's limit is ${MAX_LABEL_LENGTH}`);
  }
  if (label.startsWith('/') || label.endsWith('/') || label.includes('//')) {
    throw new RuleProblem(`${where}: "${label}" has an empty nesting level — "Parent/Child" nests, a bare or doubled "/" is a typo`);
  }
  for (const seg of label.split('/')) {
    if (seg.trim() === '') throw new RuleProblem(`${where}: "${label}" has a blank nesting level`);
  }
  const upper = label.toUpperCase();
  if (SYSTEM_LABELS.includes(upper) || upper.startsWith('CATEGORY_')) {
    throw new RuleProblem(
      `${where}: "${label}" is one of Gmail's own labels and can never be a destination` +
      (upper === 'TRASH' || upper === 'SPAM'
        ? ` — labelling a thread ${upper} would destroy it through the action that exists precisely so nothing is destroyed`
        : ' — Gmail owns it, so applying it either errors or misreports what the thread is'),
    );
  }
  return label;
}

export function validateRule(rule, where = 'rule') {
  if (!isObj(rule)) throw new RuleProblem(`${where}: not an object`);
  const w = rule.id ? `rule "${rule.id}"` : where;

  for (const k of Object.keys(rule)) {
    if (!RULE_KEYS.includes(k)) {
      throw new RuleProblem(`${w}: unknown rule key "${k}" — a typo here is silent, and "keepInbox" for "keepInInbox" archives mail you meant to leave alone; known keys are ${RULE_KEYS.join(', ')}`);
    }
  }

  if (!rule.id || typeof rule.id !== 'string' || !/^[a-z0-9][a-z0-9-]{1,39}$/.test(rule.id)) {
    throw new RuleProblem(`${w}: id must be 2-40 chars of lowercase letters, digits and dashes`);
  }
  if (!ACTIONS.includes(rule.action)) {
    throw new RuleProblem(`${w}: action must be one of ${ACTIONS.join(', ')}`);
  }
  if (rule.action === 'label') validateDestination(rule.label, w);
  else if (rule.label !== undefined) {
    throw new RuleProblem(`${w}: only a label rule has a destination — a "${rule.action}" rule carrying one reads as sorting and does not sort`);
  }
  if (rule.keepInInbox !== undefined) {
    if (typeof rule.keepInInbox !== 'boolean') {
      throw new RuleProblem(`${w}: keepInInbox must be true or false`);
    }
    if (rule.action !== 'label') {
      throw new RuleProblem(`${w}: keepInInbox only means something on a label rule — nothing else archives`);
    }
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
  return { id: rule.id, action: rule.action, fields: named, label: rule.label ?? null, archives: archives(rule) };
}

/**
 * Does this rule take the thread out of the inbox?
 *
 * A label rule archives by default, because "move it to a folder" is what a
 * user means by sorting and a label that leaves the mail exactly where it was
 * has not sorted anything. `keepInInbox: true` is the opt-out.
 */
export const archives = (rule) => rule.action === 'label' && rule.keepInInbox !== true;

const str = (v) => String(v ?? '').trim().toLowerCase();

/**
 * Does `a` take every thread `b` would? Answered from the matchers alone.
 *
 * `plan` gives a thread to the FIRST rule that matches it, so a rule preceded
 * by one that subsumes it can never fire. Detecting that needs an
 * implication test, not an equality test: `{from: "initech.example"}` subsumes
 * `{from: "careers@recruiting.initech.example", subjectContains: "code"}` because
 * `matches` uses substring containment, so anything the narrow rule accepts
 * the broad one accepted first.
 *
 * Deliberately conservative — it must never claim subsumption that is not
 * there, because the caller refuses rule sets on the strength of it. Every
 * field `a` constrains must be constrained at least as tightly by `b`;
 * anything unrecognised means "no".
 */
export function subsumes(a, b) {
  const A = a?.match ?? {};
  const B = b?.match ?? {};
  for (const f of ['from', 'list', 'subjectContains']) {
    if (A[f] === undefined) continue;
    // `matches` does `haystack.includes(needle)`, so a's needle must be inside
    // b's for every thread b accepts to have already satisfied a.
    if (B[f] === undefined || !str(B[f]).includes(str(A[f]))) return false;
  }
  if (A.category !== undefined && B.category !== A.category) return false;
  // Only `true` constrains anything — `matches` ignores a falsy value.
  if (A.hasUnsubscribe === true && B.hasUnsubscribe !== true) return false;
  if (A.olderThanDays !== undefined) {
    if (!Number.isInteger(B.olderThanDays) || B.olderThanDays < A.olderThanDays) return false;
  }
  return true;
}

/**
 * Rules that can never fire, because an earlier rule takes everything they
 * would.
 *
 * Split in two, because the two cases have different costs. A broad trash rule
 * standing in front of a narrow one leaves dead weight in the file and nothing
 * else — worth reporting, not worth refusing, and refusing it would break rule
 * sets that already work.
 *
 * A rule filing into `Recruiting` standing in front of one filing into
 * `Recruiting/Initech` is different, and it is the reason this function exists.
 * That pair does not fail cleanly, it DRIFTS: fresh mail hits the parent rule
 * first and never reaches the sub-rule, while mail already carrying
 * `Recruiting` skips the parent rule (see the already-filed short-circuit in
 * `matches`) and does reach it. Same rule set, two different outcomes decided
 * by when the mail arrived, and no table anywhere says so. That is refused.
 */
export function shadowedRules(rules = []) {
  const fatal = [];
  const dead = [];
  for (let i = 0; i < rules.length; i += 1) {
    for (let j = i + 1; j < rules.length; j += 1) {
      const a = rules[i];
      const b = rules[j];
      // `keep` is evaluated ahead of everything regardless of file order, so a
      // keep rule shadows by existing, not by position.
      if (a.action !== 'keep' && b.action === 'keep') continue;
      if (!subsumes(a, b)) continue;
      const nested = a.action === 'label' && b.action === 'label' && isAncestorLabel(a.label, b.label);
      (nested ? fatal : dead).push({ shadowedBy: a.id, ruleId: b.id, parent: a.label ?? null, child: b.label ?? null });
      break; // one explanation per rule is enough; the first is the one that wins
    }
  }
  return { fatal, dead };
}

export function validateRuleSet(doc, { scope } = {}) {
  if (!isObj(doc) || !Array.isArray(doc.rules)) {
    throw new RuleProblem('rule file: expected an object with a "rules" array');
  }
  const seen = new Set();
  const rows = [];
  for (const [i, r] of doc.rules.entries()) {
    const summary = validateRule(r, `rules[${i}]`);
    if (seen.has(r.id)) throw new RuleProblem(`rule "${r.id}": duplicate id — two rules with one id makes attribution ambiguous`);
    seen.add(r.id);
    rows.push({ ...summary, query: toGmailQuery(r, { scope }), note: r.note, applies: labelPath(r.label ?? '') });
  }

  const { fatal, dead } = shadowedRules(doc.rules);
  if (fatal.length) {
    const f = fatal[0];
    throw new RuleProblem(
      `rule "${f.ruleId}": files into "${f.child}", but rule "${f.shadowedBy}" files the same mail into its parent "${f.parent}" first — ` +
      'so fresh mail would get the parent and mail already carrying it would get the sub-label, and which one a thread ends up with ' +
      `depends only on when it arrived. Change "${f.shadowedBy}" to file into "${f.child}" too, or narrow its match so the two no ` +
      `longer overlap. (Moving "${f.ruleId}" ahead of it also stops the drift — a sub-label applies its parent as well — but leaves ` +
      `"${f.shadowedBy}" unable to ever fire.)`,
    );
  }
  for (const d of dead) {
    const row = rows.find((r) => r.id === d.ruleId);
    if (row) row.shadowedBy = d.shadowedBy;
  }
  return rows;
}

/**
 * Every distinct destination a rule set files into, and which rules use it.
 *
 * Two rules naming "Receipts" and "receipts" are one folder to a person and
 * must be one folder here — otherwise a run creates a second one beside the
 * first and half the mail is filed somewhere the user never looks. The first
 * spelling encountered is the one that would be created; the others are
 * reported as variants so the disagreement is visible rather than silently
 * resolved.
 */
export function destinationsOf(doc) {
  const out = new Map();
  for (const r of doc.rules ?? []) {
    if (r.action !== 'label' || !r.label) continue;
    // Ancestors are destinations too. A rule filing into `Recruiting/Globex`
    // applies `Recruiting` as well (see `labelPath`), so a reconcile that only
    // checked the leaf would pass while the parent did not exist — and then
    // create it implicitly on the first apply, which is the one thing this
    // command exists to stop.
    for (const name of labelPath(r.label)) {
      const key = normaliseLabel(name);
      if (!out.has(key)) out.set(key, { name, key, ruleIds: [], variants: new Set(), implied: name !== r.label });
      const d = out.get(key);
      if (!d.ruleIds.includes(r.id)) d.ruleIds.push(r.id);
      if (name !== d.name) d.variants.add(name);
      // Named outright by any rule beats implied by another's path.
      if (name === r.label) d.implied = false;
    }
  }
  return [...out.values()].map((d) => ({ ...d, variants: [...d.variants] }));
}

/**
 * Reconcile the destinations a rule set needs against the labels the mailbox
 * actually has. `existing` is whatever `list_labels` returned — names, or
 * objects carrying one.
 *
 * This is the gate that stops `apply` dying halfway through a run: a label
 * Gmail does not have is a failed call on thread 27 of 50, with 26 threads
 * moved and a receipt describing a mailbox that no longer exists.
 */
export function reconcileDestinations(doc, existing) {
  const have = new Map();
  for (const l of existing ?? []) {
    const name = typeof l === 'string' ? l : l?.name ?? l?.label;
    const id = typeof l === 'string' ? null : l?.labelId ?? l?.id ?? null;
    if (name) have.set(normaliseLabel(name), { name, id });
  }
  return destinationsOf(doc).map((d) => {
    const hit = have.get(d.key);
    return {
      ...d,
      exists: !!hit,
      existingName: hit?.name ?? null,
      // `label_thread` takes label IDS, not names. Carrying the id here is what
      // saves the agent from re-deriving the mapping and getting it wrong.
      labelId: hit?.id ?? null,
    };
  });
}

const quote = (s) => (/\s/.test(s) ? `"${s}"` : s);

/** The default slice of the mailbox a rule is evaluated against. */
export const DEFAULT_SCOPE = 'in:inbox';

/**
 * The Gmail query a rule compiles to. This is what the agent hands to
 * `search_threads`, and printing it is the point: a user who cannot see the
 * query cannot tell an over-broad rule from a precise one.
 *
 * `scope` used to be the literal `in:inbox`, which made every rule in this
 * skill unable to see mail it had already filed. A retroactive pass — split an
 * existing folder into sub-labels and apply the new rules to what is already
 * in it — is exactly a run whose scope is `label:Recruiting`, and it was not
 * expressible at all. It is a parameter for that reason and no other; a run
 * that does not name one is still an inbox run.
 */
export function toGmailQuery(rule, { scope = DEFAULT_SCOPE } = {}) {
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
  if (String(scope ?? '').trim() !== '') parts.push(String(scope).trim());
  // A sort rule has nothing left to do to a thread already filed there. Saying
  // so in the query keeps the plan's counts meaningful: without it a
  // `keepInInbox` rule reports the same twelve threads every run forever, and
  // "this rule suddenly took ten times its usual volume" stops being a signal.
  if (rule.action === 'label' && rule.label) parts.push(`-label:${quote(rule.label)}`);
  return parts.join(' ');
}

/**
 * Does one already-fetched thread satisfy a rule?
 *
 * `ignoreFiled` turns off the already-filed short-circuit below, and the two
 * modes answer genuinely different questions. `plan` wants "is there work to do
 * on this thread" — a thread sitting in the folder a rule files into needs
 * nothing. `audit` wants "does any rule claim this thread at all", and there
 * the same thread is the most claimed thread in the mailbox. Conflating them
 * made the audit report every correctly-filed thread as unclaimed: 47 of 48,
 * which reads as a broken mailbox rather than a clean one.
 */
export function matches(rule, thread, now = new Date(), { ignoreFiled = false } = {}) {
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
  // Already filed there. `labelIds` carries Gmail's opaque ids, so this reads
  // `thread.labels` — the resolved names — and simply does not fire when the
  // fetch did not supply them. Re-labelling is idempotent in Gmail, so the cost
  // of not knowing is a redundant call, never a wrong outcome.
  if (!ignoreFiled && rule.action === 'label' && Array.isArray(thread.labels)) {
    const want = normaliseLabel(rule.label);
    if (thread.labels.some((l) => normaliseLabel(l) === want)) return false;
  }
  if (m.olderThanDays) {
    const at = Date.parse(thread.date ?? '');
    if (!Number.isFinite(at)) return false;
    if ((now.getTime() - at) / 86400000 < m.olderThanDays) return false;
  }
  return true;
}

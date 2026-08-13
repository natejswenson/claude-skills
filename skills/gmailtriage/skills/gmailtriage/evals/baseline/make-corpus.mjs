/**
 * Generate the entire baseline corpus. Nothing in it is real.
 *
 *   node evals/baseline/make-corpus.mjs
 *
 * This skill's fixtures are somebody's private mail, and a redacted mailbox is
 * still a mailbox: pseudonymising the senders left the *shape* of a person's
 * life in a public repo — which bank, which health system, which school
 * district, which employer they had applied to. Redaction was the wrong tool,
 * because the thing worth hiding was never the addresses.
 *
 * So the corpus is invented instead. Every domain is under a reserved TLD
 * (`.example`, `.invalid`, `.test` — RFC 2606/6761, which can never be
 * registered), every organisation is fictional, and `no-real-data.test.mjs`
 * fails the build if that stops being true.
 *
 * What is preserved is everything the code reasons about — cluster sizes, the
 * category mix, which senders trip which guard, a folder that wants splitting,
 * a folder spelled two ways, and mail no rule claims. Those are properties of
 * the *shape*, and a fixture can have the shape without the biography.
 *
 * The three applicant-tracking domains are the one deliberate exception: the
 * vendor guard matches on product names (`greenhouse`, `workable`, `lever`),
 * so a fixture that avoided them would test nothing. They name software, never
 * a person or an employer, and they sit under `.example` like everything else.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const w = (name, value) => {
  writeFileSync(join(HERE, name), JSON.stringify(value, null, 2) + '\n');
  return name;
};

/** Deterministic ids — no Date.now(), no randomness, so a re-run is byte-identical. */
let seq = 0;
const tid = () => `thr-${(0x1a2b3c4d + (seq += 7919)).toString(16)}`;

const P = 'promotions';
const U = 'updates';

/** One thread. `cat` drives the bulk-mail proxy, exactly as a real fetch does. */
const T = (from, subject, date, labelIds = [], cat = null) => ({
  id: tid(), from, subject, date,
  labelIds, category: cat, hasUnsubscribe: cat === P || cat === U,
});
const many = (n, fn) => Array.from({ length: n }, (_, i) => fn(i));

// ── the label list ──────────────────────────────────────────────────────────
//
// Ids are opaque and meaningless, like Gmail's own. Names are generic category
// words — the kind of folder anybody has — and the two Receipts spellings are
// the near-duplicate pair the hygiene check exists for.
const L = {
  RECRUITING: 'Label_10', R_GLOBEX: 'Label_15', R_INITECH: 'Label_16',
  R_UMBRELLA: 'Label_17', R_SOYLENT: 'Label_18',
  STATEMENTS: 'Label_11', MEDICAL: 'Label_12', BANKING: 'Label_13', SCHOOL: 'Label_14',
  RECEIPTS: 'Label_30', RECIEPTS: 'Label_31', RC_BOOKS: 'Label_19', RC_CLOUD: 'Label_20',
  CLAIM: 'Label_40', CLAIM_WORK: 'Label_21', CLAIM_INS: 'Label_22',
  SECURITY: 'Label_23', BRIEFINGS: 'Label_5', ADVISOR: 'Label_41', REALTY: 'Label_42',
  PAPERWORK: 'Label_43', SCRATCH: 'Label_44', READING: 'Label_45',
};

const SYSTEM = [['CHAT', 0], ['SENT', 6], ['INBOX', 3], ['IMPORTANT', 18],
  ['TRASH', 120], ['DRAFT', 0], ['SPAM', 9], ['STARRED', 0], ['UNREAD', 11]];

// ── the mailbox ─────────────────────────────────────────────────────────────

// Recruiting: four organisations, two of them reachable only through an
// applicant-tracking vendor whose domain names the vendor and not the employer.
const recruiting = [
  ...many(7, (i) => T(`recruiter${i}@globex.example`, `Interview loop with Globex — stage ${i + 1}`,
    `2026-08-0${(i % 6) + 1}T15:0${i}:00Z`, [L.RECRUITING, L.R_GLOBEX])),
  ...many(4, (i) => T('careers@recruiting.initech.example', `Principal Engineer opening at Initech — req ${2300 + i}`,
    `2026-07-2${i + 4}T12:00:00Z`, [L.RECRUITING, L.R_INITECH], U)),
  T('no-reply@greenhouse.example', 'Thanks for applying to Umbrella Corp!',
    '2026-07-24T00:31:00Z', [L.RECRUITING, L.R_UMBRELLA], U),
  T('noreply@candidates.workable.example', 'Thanks for applying to Soylent Industries',
    '2026-07-22T14:12:00Z', [L.RECRUITING, L.R_SOYLENT], U),
];

// The guard cases. Each trips a different NEVER_PROPOSE pattern, and the school
// one carries its marker in the LOCAL part with a marker-free vendor domain —
// the case a domain-only guard silently misses.
const guarded = [
  ...many(4, (i) => T('edocuments@statements.northbank.example', `New statement available (${i + 1})`,
    `2026-07-2${i + 2}T09:00:00Z`, [L.STATEMENTS], U)),
  ...many(2, (i) => T('mychart@valleyhealth.example', i ? 'You have a new statement' : 'New message from your clinic',
    `2026-07-2${i + 3}T18:00:00Z`, [L.MEDICAL], U)),
  ...many(2, (i) => T('alerts@notify.southbank.example', i ? 'Your balance is at or below zero' : 'Insufficient funds notice',
    `2026-07-29T1${i}:00:00Z`, [L.BANKING], U)),
  ...many(2, (i) => T('centralschools@parentvendor.example', `Bus registration reminder ${i + 1}`,
    `2026-07-1${i + 5}T08:00:00Z`, [L.SCHOOL], U)),
  T('records@statearchive.gov', 'Your records request', '2026-06-01T10:00:00Z', [], U),
];

// Bulk mail: the trash candidates. Enough of each to clear the threshold.
const bulk = [
  ...many(9, (i) => T('support@packages.example', `Package published: build ${i + 1}`,
    `2026-07-0${(i % 9) + 1}T10:00:00Z`, [], U)),
  ...many(4, (i) => T('outreach@leadgen.example', `Quick question, #${i + 1}`,
    `2026-06-1${i}T11:00:00Z`, [], P)),
  ...many(3, (i) => T('deals@shopfront.example', `${20 + i * 5}% off this week only`,
    `2026-05-0${i + 1}T12:00:00Z`, [], P)),
  ...many(3, (i) => T('news@readinglist.example', `Your weekly picks, issue ${i + 1}`,
    `2026-04-0${i + 1}T13:00:00Z`, [], P)),
];

// A sender that mixes marketing with credentials — bulky, and un-trashable.
const credentials = [
  T('no-reply@accounts.mailprovider.example', 'Security alert: new sign-in', '2026-08-07T15:40:00Z', [L.SECURITY], U),
  T('website@modelhub.example', 'Click this link to confirm your email address', '2026-08-06T19:20:00Z', [L.SECURITY], U),
  T('billing@cloudvendor.example', 'Your receipt from Cloud Vendor #2563', '2026-07-11T14:21:00Z', [L.RECEIPTS, L.RC_CLOUD], U),
  T('donotreply@bookstore.example', 'Thanks, your order is complete', '2026-08-06T01:35:00Z', [L.RECEIPTS, L.RC_BOOKS], U),
];

// A person: no bulk marker at all, so never proposed for trashing OR sorting.
const people = [
  ...many(5, (i) => T(`advisor${i % 2}@wealthpartners.example`, `Re: your annual review (${i + 1})`,
    `2026-07-2${i + 1}T16:00:00Z`, [L.ADVISOR])),
  ...many(2, (i) => T('agent@realty.example', i ? 'Re: paperwork' : 'Off boarding',
    `2026-08-0${i + 3}T02:00:00Z`, [L.REALTY])),
  T('me@mailprovider.example', 'Morning brief — Wednesday', '2026-07-15T13:36:00Z', [L.BRIEFINGS]),
  T('me@mailprovider.example', 'Evening brief — Friday', '2026-08-07T16:10:00Z', ['INBOX', 'SENT']),
];

// A finished project folder holding two different counterparties.
const claim = [
  ...many(3, (i) => T('invoices@billingplatform.example', `Invoice ${1250 + i} from Roofing Co`,
    `2025-02-1${i + 2}T22:00:00Z`, [L.CLAIM, L.CLAIM_WORK], U)),
  ...many(2, (i) => T('claims@insurepay.example', i ? 'Payment confirmation' : 'A digital payment was issued for your claim',
    `2025-02-1${i + 4}T23:00:00Z`, [L.CLAIM, L.CLAIM_INS], U)),
  T('correspondence@insurer.example', 'Insurance claim 01006543', '2025-02-14T21:14:00Z', [L.CLAIM, L.CLAIM_INS], U),
];

// Signed paperwork, in a folder that no rule manages until the cleanup.
const paperwork = many(4, (i) => T('secure@esignature.example', `Signing complete: document ${i + 1}`,
  `2026-05-0${i + 5}T01:00:00Z`, [L.PAPERWORK], U));

// Mail the owner sent and never filed: SENT only, no user label, not in the
// inbox. The `has:nouserlabels` fetch sweeps these up on every real run, and
// they are the reason audit/propose exclude self-sent mail — the owner's own
// outbox is not unclaimed mail. APPENDED, never inserted: tid() is sequential,
// and inserting a thread reshuffles every id after it.
const sentOnly = [
  T('me@mailprovider.example', 'Thanks for taking the time to meet', '2026-08-06T15:58:00Z', ['SENT']),
  T('me@mailprovider.example', 'Inspection notes from the walkthrough', '2026-05-06T00:40:00Z', ['SENT']),
];

const threads = [...recruiting, ...guarded, ...bulk, ...credentials, ...people, ...claim, ...paperwork, ...sentOnly];

// ── the label lists, before and after the hygiene cleanup ───────────────────

const lbl = (id, name, threadsTotal) => ({ labelId: id, name, threadsTotal });
const system = SYSTEM.map(([n, c]) => lbl(n, n, c));

const countOf = (id) => threads.filter((t) => t.labelIds.includes(id)).length;

const AFTER_LABELS = [
  [L.RECRUITING, 'Recruiting'], [L.R_GLOBEX, 'Recruiting/Globex'], [L.R_INITECH, 'Recruiting/Initech'],
  [L.R_UMBRELLA, 'Recruiting/Umbrella'], [L.R_SOYLENT, 'Recruiting/Soylent'],
  [L.STATEMENTS, 'Statements'], [L.MEDICAL, 'Medical'], [L.BANKING, 'Banking'], [L.SCHOOL, 'School'],
  [L.RECEIPTS, 'Receipts'], [L.RC_BOOKS, 'Receipts/Bookstore'], [L.RC_CLOUD, 'Receipts/Cloud Vendor'],
  [L.CLAIM, 'Home Claim'], [L.CLAIM_WORK, 'Home Claim/Contractor'], [L.CLAIM_INS, 'Home Claim/Insurance'],
  [L.SECURITY, 'Security'], [L.BRIEFINGS, 'Briefings'], [L.ADVISOR, 'Financial Advisor'],
  [L.REALTY, 'Realty'], [L.PAPERWORK, 'Paperwork'],
];
// Before the cleanup: the duplicate spelling still exists, two folders are
// scaffolding nobody ever used, and the sub-labels have not been created yet.
const BEFORE_LABELS = [
  [L.RECRUITING, 'Recruiting'], [L.R_GLOBEX, 'Recruiting/Globex'], [L.R_INITECH, 'Recruiting/Initech'],
  [L.R_UMBRELLA, 'Recruiting/Umbrella'], [L.R_SOYLENT, 'Recruiting/Soylent'],
  [L.STATEMENTS, 'Statements'], [L.MEDICAL, 'Medical'], [L.BANKING, 'Banking'], [L.SCHOOL, 'School'],
  [L.RECEIPTS, 'Receipts'], [L.RECIEPTS, 'Reciepts'],
  [L.CLAIM, 'Old Roof Job'], [L.SECURITY, 'Security'], [L.BRIEFINGS, 'Briefings'],
  [L.ADVISOR, 'Financial Advisor'], [L.REALTY, 'Realty'], [L.PAPERWORK, 'Paperwork'],
  [L.SCRATCH, 'Scratch'], [L.READING, 'Reading List'],
];

const labelDoc = (pairs) => ({
  labels: [...system, ...pairs.map(([id, name]) => lbl(id, name, id === L.RECIEPTS ? 2 : id === L.SCRATCH || id === L.READING ? 0 : countOf(id)))],
});

// ── the rule sets ───────────────────────────────────────────────────────────

const sort = (id, label, match, note, keepInInbox) => ({
  id, action: 'label', label, ...(keepInInbox ? { keepInInbox } : {}), match, note,
});
const trash = (id, match, note) => ({ id, action: 'trash', match, note });

const AFTER_RULES = { version: 1, rules: [
  trash('trash-packages', { from: 'support@packages.example', hasUnsubscribe: true }, 'registry publish notices, already visible in the registry itself'),
  trash('trash-leadgen', { from: '@leadgen.example' }, 'cold sales outreach — the whole domain, because a second sender walked past the narrow rule'),
  trash('trash-shopfront', { from: '@shopfront.example', hasUnsubscribe: true }, 'retail promotions'),
  trash('trash-readinglist', { from: '@readinglist.example', hasUnsubscribe: true }, 'newsletter nobody reads'),
  sort('sort-globex', 'Recruiting/Globex', { from: '@globex.example' }, 'one employer writing from several people, so the whole domain'),
  sort('sort-initech', 'Recruiting/Initech', { from: 'careers@recruiting.initech.example' }, 'applications and outcomes from one employer'),
  sort('sort-umbrella', 'Recruiting/Umbrella', { from: '@greenhouse.example', subjectContains: 'Umbrella' }, 'the vendor hosts many employers, so the subject is what names this one'),
  sort('sort-soylent', 'Recruiting/Soylent', { from: '@candidates.workable.example', subjectContains: 'Soylent' }, 'the vendor hosts many employers, so the subject is what names this one'),
  sort('sort-statements', 'Statements', { from: 'northbank.example' }, 'brokerage document notices — the whole domain, so a second subdomain is still filed'),
  sort('sort-medical', 'Medical', { from: '@valleyhealth.example' }, 'clinic messages and billing'),
  sort('sort-banking', 'Banking', { from: '@notify.southbank.example' }, 'balance and overdraft alerts'),
  sort('sort-school', 'School', { from: 'centralschools@parentvendor.example' }, 'district mail behind a vendor domain that carries no marker of its own'),
  sort('sort-receipts-books', 'Receipts/Bookstore', { from: 'donotreply@bookstore.example' }, 'order confirmations, narrowed off the whole domain so marketing is not filed as a receipt'),
  sort('sort-receipts-cloud', 'Receipts/Cloud Vendor', { from: 'billing@cloudvendor.example' }, 'monthly invoices'),
  sort('sort-claim-work', 'Home Claim/Contractor', { from: '@billingplatform.example', subjectContains: 'Roofing Co' }, 'contractor invoices via a billing platform that sends for many businesses'),
  sort('sort-claim-insurepay', 'Home Claim/Insurance', { from: '@insurepay.example' }, 'claim payments — the insurer side of the same job'),
  sort('sort-claim-insurer', 'Home Claim/Insurance', { from: '@insurer.example' }, 'claim correspondence — the insurer side of the same job'),
  sort('sort-security', 'Security', { from: 'no-reply@accounts.mailprovider.example' }, 'account security alerts', true),
  sort('sort-modelhub', 'Security', { from: '@modelhub.example' }, 'account verification links', true),
  sort('sort-advisor', 'Financial Advisor', { from: '@wealthpartners.example' }, 'the whole firm, so a new person there is still filed'),
  sort('sort-realty', 'Realty', { from: '@realty.example' }, 'the agent handling the sale'),
  sort('sort-paperwork', 'Paperwork', { from: '@esignature.example' }, 'signed documents'),
  sort('sort-briefings', 'Briefings', { from: 'me@mailprovider.example', subjectContains: 'brief' }, 'self-sent daily briefs, morning and evening'),
  sort('sort-gov', 'Paperwork', { from: '@statearchive.gov' }, 'records correspondence'),
] };

// Before the cleanup: the sub-labels do not exist, the duplicate does, two
// folders hold mail nothing manages, and the briefing rule only ever matched
// the morning one.
const BEFORE_RULES = { version: 1, rules: [
  AFTER_RULES.rules[0], AFTER_RULES.rules[1], AFTER_RULES.rules[2], AFTER_RULES.rules[3],
  sort('sort-globex', 'Recruiting', { from: '@globex.example' }, 'one employer writing from several people'),
  sort('sort-initech', 'Recruiting', { from: 'careers@recruiting.initech.example' }, 'applications from one employer'),
  sort('sort-umbrella', 'Recruiting', { from: '@greenhouse.example' }, 'applications via a vendor'),
  sort('sort-soylent', 'Recruiting', { from: '@candidates.workable.example' }, 'applications via a vendor'),
  AFTER_RULES.rules[8], AFTER_RULES.rules[9], AFTER_RULES.rules[10], AFTER_RULES.rules[11],
  sort('sort-receipts', 'Receipts', { from: 'donotreply@bookstore.example' }, 'order confirmations'),
  sort('sort-security', 'Security', { from: 'no-reply@accounts.mailprovider.example' }, 'account security alerts', true),
  sort('sort-advisor', 'Financial Advisor', { from: '@wealthpartners.example' }, 'the whole firm'),
  sort('sort-realty', 'Realty', { from: '@realty.example' }, 'the agent handling the sale'),
  sort('sort-briefings', 'Briefings', { from: 'me@mailprovider.example', subjectContains: 'Morning brief' }, 'the morning brief only — the evening one lands unclaimed'),
] };

// ── the sub-label corpus: one folder, before and after it is split ──────────

const filedBefore = recruiting.map((t) => ({ ...t, labelIds: [L.RECRUITING], labels: ['Recruiting'] }));
const filedAfter = recruiting.map((t) => ({
  ...t,
  labels: ['Recruiting', { [L.R_GLOBEX]: 'Recruiting/Globex', [L.R_INITECH]: 'Recruiting/Initech',
    [L.R_UMBRELLA]: 'Recruiting/Umbrella', [L.R_SOYLENT]: 'Recruiting/Soylent' }[t.labelIds[1]]],
}));

const RECRUITING_RULES = { version: 1, rules: [
  AFTER_RULES.rules[4], AFTER_RULES.rules[5], AFTER_RULES.rules[6], AFTER_RULES.rules[7],
] };

// ── emit ────────────────────────────────────────────────────────────────────

const withNames = (list, pairs) => {
  const byId = new Map(pairs.map(([id, name]) => [id, name]));
  return list.map((t) => ({ ...t, labels: t.labelIds.map((i) => byId.get(i) ?? i) }));
};

/**
 * The duplicate folder has to actually hold something, or `merge` has nothing
 * to fold and the golden freezes an empty operation.
 *
 * It holds the case that matters: a thread carrying BOTH spellings. That is
 * what makes the fold move no mail while still needing to be recorded — the
 * folder is deleted at the end, and only the receipt knows it existed.
 */
const beforeThreads = withNames(threads, BEFORE_LABELS).map((t) => (
  t.labelIds.includes(L.RECEIPTS)
    ? { ...t, labelIds: [...t.labelIds, L.RECIEPTS], labels: [...t.labels, 'Reciepts'] }
    : t));

// ── raw MCP-shaped fixtures, for `ingest` ───────────────────────────────────
//
// The exact shape search_threads and list_labels return, wrapped around a
// slice of the corpus: the inbox thread, the no-user-label threads, and the
// two category id-sets. Every message carries a snippet holding a fake
// verification code — the field `ingest` must never copy to disk, and the
// baseline greps its output for exactly this string. resultCountEstimate is
// deliberately wrong, because Gmail's real one is unreliable too and nothing
// downstream may ever repeat it as a fact.
const SNIPPET_TRAP = 'Your verification code is 000000';
const rawSearch = (list, estimate) => ({
  resultCountEstimate: String(estimate),
  threads: list.map((t) => ({
    id: t.id,
    messages: [{ id: `${t.id}-m0`, date: t.date, sender: t.from, subject: t.subject, labelIds: t.labelIds, snippet: SNIPPET_TRAP }],
  })),
});
// The metadata-only view returns neither sender nor subject — the fetch shape
// `ingest` must refuse for the main searches, and all a category fetch needs.
const rawMetadataOnly = (list, estimate) => ({
  resultCountEstimate: String(estimate),
  threads: list.map((t) => ({
    id: t.id,
    messages: [{ id: `${t.id}-m0`, date: t.date, labelIds: t.labelIds, snippet: SNIPPET_TRAP }],
  })),
});

const isSystemId = (id) => ['INBOX', 'SENT', 'UNREAD', 'IMPORTANT'].includes(id);
const inboxSlice = threads.filter((t) => t.labelIds.includes('INBOX'));
// No user label at all — bulk mail, the gov thread, the self-sent pair, and
// the inbox thread again: the overlap is deliberate, because a real inbox
// fetch and a real has:nouserlabels fetch overlap on exactly the unfiled
// inbox mail, and the dedupe is the normal path, not an edge case.
const nolabelSlice = threads.filter((t) => t.labelIds.every(isSystemId));
const rawUnion = [...new Map([...inboxSlice, ...nolabelSlice].map((t) => [t.id, t])).values()];

const rawFiles = [
  w('raw-inbox.json', rawSearch(inboxSlice, 999)),
  w('raw-nolabel.json', rawSearch(nolabelSlice, 999)),
  w('raw-promos.json', rawMetadataOnly(rawUnion.filter((t) => t.category === P), 42)),
  w('raw-updates.json', rawMetadataOnly(rawUnion.filter((t) => t.category === U), 42)),
  w('raw-labels.json', labelDoc(AFTER_LABELS)),
  w('raw-inbox-metadata.json', rawMetadataOnly(nolabelSlice, 999)),
];

const files = [
  ...rawFiles,
  w('threads.json', threads),
  w('labels.json', labelDoc(AFTER_LABELS)),
  w('rules.json', AFTER_RULES),
  w('filed.json', filedBefore),
  w('filed-after.json', filedAfter),
  w('filed-labels.json', labelDoc(AFTER_LABELS)),
  w('rules-recruiting.json', RECRUITING_RULES),
  w('mailbox-before.json', beforeThreads),
  w('mailbox-before-labels.json', labelDoc(BEFORE_LABELS)),
  w('mailbox-before-rules.json', BEFORE_RULES),
  w('mailbox-after.json', withNames(threads, AFTER_LABELS)),
  w('mailbox-after-labels.json', labelDoc(AFTER_LABELS)),
  w('mailbox-after-rules.json', AFTER_RULES),
];

console.log(`wrote ${files.length} fixtures · ${threads.length} threads · ${AFTER_LABELS.length} user labels`);

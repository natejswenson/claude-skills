/**
 * Unit tests, deliberately in their own file — `skillfactory freeze` rewrites
 * baseline.test.mjs, so a guard written there is deleted on the next refresh.
 *
 * Several of these pin defects the first real run against a live inbox found.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateRule, validateRuleSet, validateDestination, toGmailQuery, matches,
  normaliseLabel, destinationsOf, reconcileDestinations, archives, RuleProblem,
  labelPath, isAncestorLabel, subsumes, shadowedRules,
  isNearDuplicateLabel, MIN_NEAR_DUPLICATE_LENGTH,
} from '../lib/rules.mjs';
import {
  propose, candidateToRule, candidateToSortRule, plan, authorise, buildReceipt,
  undoPlan, matchDestination, NotAuthorised,
  isProtected, hasProtectedSubject,
  subdivide, clusterToSubRule, vendorHostOf,
  audit, mergeLabels, mergeReceiptEntries,
} from '../lib/plan.mjs';

const rule = (over = {}) => ({
  id: 'bulk-sender', action: 'trash',
  match: { from: 'noreply@shop.example' },
  note: 'retail bulk mail', ...over,
});

const thread = (over = {}) => ({
  id: 't1', from: 'noreply@shop.example', subject: 'Sale', date: '2026-08-01T00:00:00Z',
  labelIds: ['INBOX', 'CATEGORY_PROMOTIONS'], category: 'promotions', hasUnsubscribe: true, ...over,
});

// ── validation is where the safety is ───────────────────────────────────────

test('a rule that constrains nothing is refused', () => {
  assert.throws(() => validateRule(rule({ match: {} })), /whole mailbox/);
});

test('trashing by age alone is refused — it is every old message you have', () => {
  assert.throws(() => validateRule(rule({ match: { olderThanDays: 30 } })), /age alone/);
  // paired with a sender it is fine
  assert.ok(validateRule(rule({ match: { from: 'noreply@shop.example', olderThanDays: 30 } })));
});

test('an unknown match field is refused, because a typo never fires', () => {
  assert.throws(() => validateRule(rule({ match: { sender: 'x@y.z' } })), /unknown match field/);
});

test('a one-character match is refused as an accident', () => {
  assert.throws(() => validateRule(rule({ match: { from: 'a' } })), /at least 2 characters/);
});

test('a rule with no note is refused', () => {
  assert.throws(() => validateRule(rule({ note: '' })), /note/);
});

test('a duplicate id is refused so attribution stays unambiguous', () => {
  assert.throws(() => validateRuleSet({ rules: [rule(), rule()] }), /duplicate id/);
});

test('a label rule must name its label', () => {
  assert.throws(() => validateRule(rule({ action: 'label' })), /must name the label/);
});

test('the compiled query is visible and scoped to the inbox', () => {
  const q = toGmailQuery(rule({ match: { from: 'a@b.co', category: 'promotions', olderThanDays: 7 } }));
  assert.match(q, /from:a@b\.co/);
  assert.match(q, /category:promotions/);
  assert.match(q, /older_than:7d/);
  assert.match(q, /in:inbox/);
});

// ── the guards the first real run added ─────────────────────────────────────

test('recruiting senders are protected — the first run proposed trashing a live job pipeline', () => {
  for (const d of ['recruiting.uhg.com', 'careers.example.com', 'jobs.acme.io',
    'myworkday.com', 'greenhouse.io', 'candidates.workablemail.com']) {
    assert.equal(isProtected(d), true, `${d} should be withheld`);
  }
});

test('financial, medical, governmental and educational senders are protected', () => {
  for (const d of ['mail.fidelity.com', 'notify.wellsfargo.com', 'sanfordhealth.org',
    'irs.gov', 'hawley.k12.mn.us', 'someuniversity.edu']) {
    assert.equal(isProtected(d), true, `${d} should be withheld`);
  }
  assert.equal(isProtected('e.rocketreach.co'), false);
  assert.equal(isProtected(null), false);
});

test('one login code anywhere in a cluster withholds the whole sender', () => {
  // A sender that mixes marketing with credentials is the one that costs you.
  assert.equal(hasProtectedSubject([
    { subject: 'Weekly deals' },
    { subject: 'Multifactor authentication access code' },
  ]), true);
  assert.equal(hasProtectedSubject([{ subject: 'Confirm your email address' }]), true);
  assert.equal(hasProtectedSubject([{ subject: 'Your statement is ready' }]), true);
  assert.equal(hasProtectedSubject([{ subject: 'Weekly deals' }]), false);
});

test('propose withholds rather than suggests, and never proposes a person', () => {
  const threads = [
    ...Array.from({ length: 4 }, (_, i) => thread({ id: `b${i}` })),
    ...Array.from({ length: 3 }, (_, i) => thread({ id: `c${i}`, from: 'careers@recruiting.acme.com' })),
    ...Array.from({ length: 3 }, (_, i) => thread({ id: `p${i}`, from: 'a.person@example.com', hasUnsubscribe: false })),
  ];
  const { candidates, withheld } = propose(threads);
  assert.deepEqual(candidates.map((c) => c.from), ['noreply@shop.example']);
  const reasons = Object.fromEntries(withheld.map((w) => [w.from, w.why]));
  assert.match(reasons['careers@recruiting.acme.com'], /recruiting/);
  assert.match(reasons['a.person@example.com'], /may be a person/);
});

test('a proposed candidate is a valid rule', () => {
  const { candidates } = propose(Array.from({ length: 4 }, (_, i) => thread({ id: `b${i}` })));
  assert.ok(validateRule(candidateToRule(candidates[0])));
});

// ── planning ────────────────────────────────────────────────────────────────

test('keep beats trash, whatever else matched', () => {
  const doc = { rules: [rule(), { id: 'keep-it', action: 'keep', match: { subjectContains: 'Sale' }, note: 'wanted' }] };
  const p = plan([thread()], doc);
  assert.equal(p.taken.length, 0);
  assert.equal(p.spared.length, 1);
  assert.equal(p.spared[0].ruleId, 'keep-it');
});

test('the first matching rule owns a thread, and overlaps are reported', () => {
  const doc = { rules: [rule(), rule({ id: 'other', match: { subjectContains: 'Sale' } })] };
  const p = plan([thread()], doc);
  assert.equal(p.taken.length, 1);
  assert.equal(p.taken[0].ruleId, 'bulk-sender');
  assert.deepEqual(p.overlaps[0].ruleIds, ['bulk-sender', 'other']);
});

test('matching honours category, age and the bulk proxy', () => {
  const now = new Date('2026-08-10T00:00:00Z');
  assert.equal(matches(rule({ match: { category: 'promotions' } }), thread(), now), true);
  assert.equal(matches(rule({ match: { category: 'social' } }), thread(), now), false);
  assert.equal(matches(rule({ match: { from: 'x', olderThanDays: 5 } }), thread({ from: 'x@y.z' }), now), true);
  assert.equal(matches(rule({ match: { from: 'x', olderThanDays: 30 } }), thread({ from: 'x@y.z' }), now), false);
  assert.equal(matches(rule({ match: { hasUnsubscribe: true } }), thread({ hasUnsubscribe: false }), now), false);
});

// ── the one rule, as code ───────────────────────────────────────────────────

const planDoc = {
  taken: [
    { ruleId: 'bulk-sender', action: 'trash', threadId: 't1', from: 'a@b.co', subject: 'S1' },
    { ruleId: 'bulk-sender', action: 'trash', threadId: 't2', from: 'a@b.co', subject: 'S2' },
    { ruleId: 'tagger', action: 'label', threadId: 't3', from: 'c@d.co', subject: 'S3' },
  ],
};

test('authorise passes exactly the plan, and defaults to all of it', () => {
  assert.equal(authorise(planDoc, ['t1']).length, 1);
  assert.deepEqual(authorise(planDoc).map((e) => e.threadId), ['t1', 't2']);
});

test('a thread the plan never named is refused', () => {
  assert.throws(() => authorise(planDoc, ['t1', 'nope']), NotAuthorised);
  assert.throws(() => authorise(planDoc, ['nope']), /not authorised to be trashed/);
});

test('a label rule does not authorise a trash', () => {
  // t3 is in the plan, but under a label action — trashing it would be an
  // action no rule asked for.
  assert.throws(() => authorise(planDoc, ['t3']), NotAuthorised);
  // And the message says so, rather than claiming the thread is absent. "Not
  // in the plan" would be a lie that sends the reader looking for the wrong bug.
  assert.throws(() => authorise(planDoc, ['t3']), /under a different action/);
});

test('a trash rule does not authorise a sort — the mirror, and the dangerous half', () => {
  // The other direction is what protects the mailbox: a plan that authorises
  // trashing t1 must not be usable to file t1 somewhere, and vice versa. One
  // shared authorisation set would make every plan a permission slip for both.
  assert.throws(() => authorise(planDoc, ['t1'], 'label'), NotAuthorised);
  assert.throws(() => authorise(planDoc, ['t1'], 'label'), /not authorised to be moved/);
  assert.deepEqual(authorise(planDoc, null, 'label').map((e) => e.threadId), ['t3']);
});

test('an empty plan authorises nothing', () => {
  assert.deepEqual(authorise({ taken: [] }), []);
  assert.throws(() => authorise({ taken: [] }, ['t1']), NotAuthorised);
});

test('the receipt records the rule behind every thread', () => {
  const r = buildReceipt(authorise(planDoc), { at: '2026-08-04T00:00:00Z' });
  assert.equal(r.count, 2);
  assert.deepEqual(r.entries.map((e) => e.ruleId), ['bulk-sender', 'bulk-sender']);
  assert.ok(r.entries.every((e) => e.threadId && e.subject !== undefined));
});

test('the guard reads the whole address, not just the domain', () => {
  // A live run proposed trashing a school district hiding behind a vendor
  // domain: hawleyschools@onlinejmc.com carries every marker in the LOCAL part
  // and none in the domain.
  assert.equal(isProtected('hawleyschools@onlinejmc.com'), true);
  assert.equal(isProtected('careers@somevendor.io'), true);
  assert.equal(isProtected('billing-noreply@somevendor.io'), false);
  assert.equal(isProtected('marketing@e.rocketreach.co'), false);
  assert.equal(isProtected(null), false);
});

test('a school behind a vendor domain is withheld, not proposed', () => {
  const t = (i) => ({
    id: `s${i}`, from: 'hawleyschools@onlinejmc.com', subject: 'Bus registration',
    date: '2026-08-01T00:00:00Z', labelIds: ['INBOX'], category: 'updates', hasUnsubscribe: true,
  });
  const { candidates, withheld } = propose([t(1), t(2), t(3), t(4)], { minCount: 2 });
  assert.equal(candidates.length, 0);
  assert.match(withheld[0].why, /educational/);
});

// ── an empty result must explain itself ─────────────────────────────────────

test('propose says WHY it proposed nothing, in each of the three cases', () => {
  const t = (over) => ({ id: `x${Math.random()}`, subject: 'Sale', date: '2026-08-01T00:00:00Z',
    labelIds: ['INBOX'], category: 'promotions', hasUnsubscribe: true, ...over });

  // below the threshold — names the closest cluster so the user can widen
  const below = propose([t({ from: 'a@shop.example' }), t({ from: 'a@shop.example' })], { minCount: 5 });
  assert.equal(below.candidates.length, 0);
  assert.equal(below.reason.kind, 'below-threshold');
  assert.match(below.reason.text, /--min-count 2/);
  assert.equal(below.below[0].count, 2);

  // everything guarded — the safe answer, said as such
  const guarded = propose([t({ from: 'careers@acme.com' }), t({ from: 'careers@acme.com' })], { minCount: 1 });
  assert.equal(guarded.reason.kind, 'all-withheld');
  assert.match(guarded.reason.text, /safe answer, not a broken one/);

  // nothing bulk at all
  const empty = propose([], { minCount: 1 });
  assert.equal(empty.reason.kind, 'nothing-bulk');
});

test('a successful propose carries no reason', () => {
  const t = (i) => ({ id: `b${i}`, from: 'noreply@shop.example', subject: 'Sale',
    date: '2026-08-01T00:00:00Z', labelIds: ['INBOX'], category: 'promotions', hasUnsubscribe: true });
  const r = propose([t(1), t(2), t(3)], { minCount: 2 });
  assert.equal(r.candidates.length, 1);
  assert.equal(r.reason, null);
});

test('the "closest sender" list never dangles a person as a near-candidate', () => {
  // A person with 2 threads must be withheld as a person, not offered as
  // something a lower threshold would catch.
  const person = (i) => ({ id: `p${i}`, from: 'a.realtor@agency.example', subject: 'Re: paperwork',
    date: '2026-08-01T00:00:00Z', labelIds: ['INBOX'], category: null, hasUnsubscribe: false });
  const bulk = (i) => ({ id: `b${i}`, from: 'noreply@shop.example', subject: 'Sale',
    date: '2026-08-01T00:00:00Z', labelIds: ['INBOX'], category: 'promotions', hasUnsubscribe: true });

  const r = propose([person(1), person(2), bulk(1), bulk(2)], { minCount: 5 });
  assert.deepEqual(r.below.map((b) => b.from), ['noreply@shop.example']);
  assert.ok(r.withheld.some((w) => w.from === 'a.realtor@agency.example' && /may be a person/.test(w.why)));
});

// ── sorting: destinations ───────────────────────────────────────────────────

test('a label rule can never name one of Gmail\'s own labels', () => {
  // The reason this list exists: without it, {"action":"label","label":"TRASH"}
  // destroys mail through the action that exists precisely so nothing is
  // destroyed, bypassing every trash guard in the file.
  for (const bad of ['TRASH', 'Trash', 'spam', 'INBOX', 'SENT', 'STARRED', 'CATEGORY_PROMOTIONS']) {
    assert.throws(
      () => validateRule(rule({ action: 'label', label: bad })),
      RuleProblem,
      `"${bad}" was accepted as a destination`,
    );
  }
  assert.throws(() => validateDestination('TRASH'), /would destroy it/);
  assert.throws(() => validateDestination('SENT'), /Gmail owns it/);
});

test('a malformed destination is refused before it can be applied', () => {
  assert.throws(() => validateRule(rule({ action: 'label' })), /must name the label/);
  assert.throws(() => validateRule(rule({ action: 'label', label: '   ' })), /must name the label/);
  assert.throws(() => validateRule(rule({ action: 'label', label: '/Leading' })), /empty nesting level/);
  assert.throws(() => validateRule(rule({ action: 'label', label: 'Trailing/' })), /empty nesting level/);
  assert.throws(() => validateRule(rule({ action: 'label', label: 'A//B' })), /empty nesting level/);
  assert.throws(() => validateRule(rule({ action: 'label', label: 'x'.repeat(226) })), /Gmail's limit/);
  // and the good case still passes, or the assertions above prove nothing
  assert.equal(validateRule(rule({ action: 'label', label: 'Finance/Chase' })).label, 'Finance/Chase');
});

test('only a label rule carries a destination or a keepInInbox', () => {
  assert.throws(() => validateRule(rule({ action: 'trash', label: 'Shopping' })), /does not sort/);
  assert.throws(() => validateRule(rule({ action: 'trash', keepInInbox: true })), /nothing else archives/);
  assert.throws(() => validateRule(rule({ action: 'label', label: 'X', keepInInbox: 'yes' })), /true or false/);
});

test('an unknown rule key is refused — "keepInbox" would archive silently', () => {
  // The typo that matters: keepInbox for keepInInbox reads as "leave it in the
  // inbox" and does the opposite, with nothing anywhere saying so.
  assert.throws(() => validateRule(rule({ action: 'label', label: 'X', keepInbox: true })), /unknown rule key/);
});

test('a label rule archives by default and opts out explicitly', () => {
  assert.equal(archives({ action: 'label', label: 'X' }), true);
  assert.equal(archives({ action: 'label', label: 'X', keepInInbox: true }), false);
  assert.equal(archives({ action: 'label', label: 'X', keepInInbox: false }), true);
  assert.equal(archives({ action: 'trash' }), false);
  assert.equal(archives({ action: 'keep' }), false);
});

test('one folder, however it is spelled', () => {
  assert.equal(normaliseLabel('Receipts'), normaliseLabel('receipts'));
  assert.equal(normaliseLabel(' Finance / Chase '), 'finance/chase');
  assert.equal(normaliseLabel('Bank  Statements'), 'bank statements');
  // but nesting is real structure, not noise
  assert.notEqual(normaliseLabel('Finance/Chase'), normaliseLabel('Chase'));

  const doc = { rules: [
    { id: 'a', action: 'label', label: 'Receipts', match: { from: 'a@x.com' }, note: 'one' },
    { id: 'b', action: 'label', label: 'receipts', match: { from: 'b@x.com' }, note: 'two' },
  ] };
  const [d] = destinationsOf(doc);
  assert.equal(destinationsOf(doc).length, 1, 'two spellings became two folders');
  assert.deepEqual(d.ruleIds, ['a', 'b']);
  assert.deepEqual(d.variants, ['receipts'], 'the disagreement must be reported, not silently resolved');
});

test('reconcile names exactly the folders that must be created first', () => {
  const doc = { rules: [
    { id: 'a', action: 'label', label: 'Shopping', match: { from: 'a@x.com' }, note: 'one' },
    { id: 'b', action: 'label', label: 'Finance/Chase', match: { from: 'b@x.com' }, note: 'two' },
    { id: 'c', action: 'trash', match: { from: 'c@x.com' }, note: 'not a destination' },
  ] };
  // list_labels shape, and a bare-string list, must both work.
  //
  // `Finance` is in the list without any rule naming it: filing into
  // `Finance/Chase` applies `Finance` too, so it must exist before anything
  // moves. Reconciling only the leaf would pass, and then the first apply
  // would create the parent implicitly — which is precisely what this command
  // exists to stop.
  for (const have of [[{ name: 'shopping', type: 'user' }], ['shopping']]) {
    const r = reconcileDestinations(doc, have);
    assert.deepEqual(r.map((d) => d.name), ['Shopping', 'Finance', 'Finance/Chase']);
    assert.deepEqual(r.map((d) => d.exists), [true, false, false]);
    assert.deepEqual(r.map((d) => d.implied), [false, true, false],
      'a folder a rule names and one its nesting implies must be distinguishable');
  }
  assert.deepEqual(reconcileDestinations(doc, []).filter((d) => d.exists), []);
});

// ── sorting: what propose does with the withheld half ───────────────────────

const bulkFrom = (from, subject, n) => Array.from({ length: n }, (_, i) => ({
  id: `${from}-${i}`, from, subject, date: '2026-08-01T00:00:00Z',
  labelIds: ['INBOX', 'CATEGORY_UPDATES'], category: 'updates', hasUnsubscribe: true,
}));

test('a sender withheld from trashing is offered for sorting', () => {
  // This is the whole point of the feature: a bank is a terrible trash
  // candidate and the best sort candidate in the mailbox.
  const r = propose(bulkFrom('news@chase.com', 'Your monthly summary', 4), { minCount: 3 });
  assert.equal(r.candidates.length, 0, 'a bank must never be a trash candidate');
  assert.equal(r.sortable.length, 1);
  assert.equal(r.sortable[0].from, 'news@chase.com');
  assert.equal(r.sortable[0].keepInInbox, false, 'a plain bank cluster is filed and archived');
});

test('a cluster that ever delivered a code is filed but never archived', () => {
  // You can file your receipts and still find, in your inbox, the login code
  // you are sitting there waiting for.
  const r = propose([
    ...bulkFrom('news@chase.com', 'Your monthly summary', 3),
    ...bulkFrom('news@chase.com', 'Your security code', 1),
  ], { minCount: 3 });
  assert.equal(r.sortable.length, 1);
  assert.equal(r.sortable[0].keepInInbox, true);
  assert.equal(candidateToSortRule(r.sortable[0], 'Finance').keepInInbox, true);
});

test('a person is never sorted, however many threads they send', () => {
  // The single most damaging thing this skill could do is archive a human's
  // mail out of the inbox. "No bulk marker" is the only withholding reason
  // that also withholds sorting.
  const person = Array.from({ length: 9 }, (_, i) => ({
    id: `p${i}`, from: 'a.realtor@agency.example', subject: 'Re: paperwork',
    date: '2026-08-01T00:00:00Z', labelIds: ['INBOX'], category: null, hasUnsubscribe: false,
  }));
  const r = propose(person, { minCount: 2 });
  assert.equal(r.sortable.length, 0);
  assert.equal(r.sortReason.kind, 'only-people');
});

test('an empty sort table says which of three things produced it', () => {
  // Two-sided with the test above: an empty table that cannot explain itself
  // reads as a broken skill, which is how a real result gets ignored.
  const belowT = propose(bulkFrom('news@chase.com', 'Summary', 2), { minCount: 9 });
  assert.equal(belowT.sortable.length, 0);
  assert.equal(belowT.sortReason.kind, 'below-threshold');

  const nothing = propose(bulkFrom('noreply@shop.example', 'Sale', 4), { minCount: 2 });
  assert.ok(nothing.candidates.length > 0);
  assert.equal(nothing.sortReason.kind, 'nothing-to-file');

  assert.equal(propose([], { minCount: 1 }).sortReason.kind, 'nothing-to-file');
});

test('a destination is matched to an existing label, never invented', () => {
  const labels = ['Finance/Chase', 'Shopping', 'School'];
  assert.equal(matchDestination('news@chase.com', labels), 'Finance/Chase');
  assert.equal(matchDestination('alerts@shopping.example.com', labels), 'Shopping');
  // no fuzzy matching: a coin-flip folder is worse than no folder, because the
  // user stops trusting where anything went
  assert.equal(matchDestination('news@chasebankonline.com', labels), null);
  assert.equal(matchDestination('hello@acmecorp.com', labels), null);
  // and noise words match nothing, or every sender lands in "Mail"
  assert.equal(matchDestination('noreply@notifications.acme.com', ['Notifications', 'Mail']), null);
});

test('an unhoused cluster is reported unhoused, never given a guessed name', () => {
  // Naming a folder is a judgment about how the user thinks. A script that
  // guesses files a school district into a folder named after its mail vendor.
  const r = propose(bulkFrom('hawleyschools@onlinejmc.com', 'Bus registration', 4), { minCount: 3, labels: [] });
  assert.equal(r.sortable.length, 1);
  assert.equal(r.sortable[0].destination, null);
  assert.equal(r.sortable[0].unhoused, true);
  assert.equal(r.unhoused, 1);
  assert.throws(() => candidateToSortRule(r.sortable[0]), /no destination/);
  // with a name supplied, it becomes a real, valid rule
  const built = candidateToSortRule(r.sortable[0], 'School');
  assert.equal(validateRule(built).label, 'School');
  assert.equal(built.match.hasUnsubscribe, undefined, 'filing is not conditional on bulk the way trashing is');
});

// ── sorting: the plan, the receipt, and the undo ────────────────────────────

test('a sort rule stops taking a thread already filed there', () => {
  // Without this a keepInInbox rule reports the same twelve threads every run
  // forever, and "this rule suddenly took ten times its usual volume" — the
  // signal the skill tells you to stop on — stops meaning anything.
  const r = { id: 'x', action: 'label', label: 'Shopping', match: { from: 'noreply@shop.example' }, note: 'shop' };
  assert.equal(matches(r, thread()), true);
  assert.equal(matches(r, thread({ labels: ['Shopping'] })), false);
  assert.equal(matches(r, thread({ labels: ['shopping'] })), false, 'case must not create a second folder');
  assert.equal(matches(r, thread({ labels: ['Other'] })), true);
  // and the compiled query says so too
  assert.match(toGmailQuery(r), /-label:Shopping/);
});

test('the plan carries the destination and whether the thread leaves the inbox', () => {
  const doc = { rules: [
    { id: 'file-it', action: 'label', label: 'Shopping', match: { from: 'noreply@shop.example' }, note: 'shop' },
  ] };
  const p = plan([thread()], doc);
  assert.deepEqual(p.destinations, ['Shopping']);
  assert.equal(p.taken[0].label, 'Shopping');
  assert.equal(p.taken[0].archive, true);

  const stay = { rules: [{ ...doc.rules[0], keepInInbox: true }] };
  assert.equal(plan([thread()], stay).taken[0].archive, false);
});

test('the receipt records what was done, not merely to what', () => {
  const p = { taken: [
    { ruleId: 'file-it', action: 'label', label: 'Shopping', archive: true, threadId: 't9', from: 'a@b.c', subject: 'S' },
  ] };
  const [e] = buildReceipt(authorise(p, null, 'label'), { at: '2026-08-05T00:00:00Z' }).entries;
  assert.equal(e.action, 'label');
  assert.equal(e.label, 'Shopping');
  assert.equal(e.archived, true);
});

test('undo reverses each action with the call that actually reverses it', () => {
  const receipt = { at: 'now', entries: [
    { threadId: 't1', ruleId: 'junk', action: 'trash', label: null, archived: false },
    { threadId: 't2', ruleId: 'file', action: 'label', label: 'Shopping', archived: true },
    { threadId: 't3', ruleId: 'tag', action: 'label', label: 'Receipts', archived: false },
  ] };
  const u = undoPlan(receipt);
  assert.deepEqual(u.untrash.map((e) => e.threadId), ['t1']);
  assert.deepEqual(u.unlabel.map((g) => g.label), ['Shopping', 'Receipts']);
  // only the archived one gets INBOX back — re-inboxing t3 would move mail the
  // run never moved
  assert.deepEqual(u.reinbox.map((e) => e.threadId), ['t2']);
});

test('a 0.1.0 receipt still undoes — an old receipt must not become unusable', () => {
  // 0.1.0 wrote no `action` because trashing was the only thing it could do.
  const old = { at: 'then', entries: [
    { threadId: 't1', ruleId: 'junk', from: 'a@b.c', subject: 'S' },
    { threadId: 't2', ruleId: 'junk', from: 'a@b.c', subject: 'S' },
  ] };
  const u = undoPlan(old);
  assert.deepEqual(u.untrash.map((e) => e.threadId), ['t1', 't2']);
  assert.deepEqual(u.unlabel, []);
  assert.deepEqual(u.reinbox, []);
});

// ── sub-labels: splitting a folder that grew into several things ────────────

test('a nested destination applies its whole path', () => {
  assert.deepEqual(labelPath('Recruiting'), ['Recruiting']);
  assert.deepEqual(labelPath('Recruiting/One Call'), ['Recruiting', 'Recruiting/One Call']);
  assert.deepEqual(labelPath('A/B/C'), ['A', 'A/B', 'A/B/C']);
  assert.deepEqual(labelPath(''), []);

  assert.equal(isAncestorLabel('Recruiting', 'Recruiting/UHG'), true);
  assert.equal(isAncestorLabel('recruiting', 'Recruiting/UHG'), true, 'spelling is not structure');
  assert.equal(isAncestorLabel('Recruiting', 'Recruiting'), false, 'a folder is not its own ancestor');
  assert.equal(isAncestorLabel('Recruiting/UHG', 'Recruiting'), false);
  // the near miss that a naive startsWith gets wrong
  assert.equal(isAncestorLabel('Rec', 'Recruiting/UHG'), false);
});

test('a plan files a thread into the parent as well as the sub-label', () => {
  // Gmail nesting is cosmetic: a thread carrying only `Recruiting/One Call`
  // does NOT show under `Recruiting`. Without the path, mail filed before a
  // folder was split carries the parent and mail filed after it does not.
  const doc = { rules: [
    { id: 'sort-oc', action: 'label', label: 'Recruiting/One Call', match: { from: '@onecallcm.com' }, note: 'One Call recruiting mail' },
  ] };
  const t = { id: 't1', from: 'a@onecallcm.com', subject: 'Interview', labelIds: ['INBOX'] };
  const p = plan([t], doc);
  assert.deepEqual(p.taken[0].labels, ['Recruiting', 'Recruiting/One Call']);
  assert.deepEqual(p.destinations, ['Recruiting', 'Recruiting/One Call']);
});

test('a retroactive pass adds only what the thread does not already carry', () => {
  // The undo contract. A thread the user filed into `Recruiting` by hand, then
  // sub-labelled by this skill, must come back to `Recruiting` — not to
  // nothing.
  const doc = { rules: [
    { id: 'sort-oc', action: 'label', label: 'Recruiting/One Call', match: { from: '@onecallcm.com' }, note: 'One Call recruiting mail' },
  ] };
  const filed = { id: 't1', from: 'a@onecallcm.com', subject: 'Interview', labels: ['Recruiting'] };
  const fresh = { id: 't2', from: 'b@onecallcm.com', subject: 'Interview', labels: ['INBOX'] };
  const p = plan([filed, fresh], doc);

  assert.deepEqual(p.taken[0].adds, ['Recruiting/One Call'], 'it would re-add a label the thread already had');
  assert.deepEqual(p.taken[1].adds, ['Recruiting', 'Recruiting/One Call']);

  const r = buildReceipt(p.taken, { at: 'now' });
  const u = undoPlan(r);
  // Undoing must never strip `Recruiting` from the thread that already had it.
  const rec = u.unlabel.find((g) => g.label === 'Recruiting');
  assert.deepEqual(rec.entries.map((e) => e.threadId), ['t2']);
  // and innermost first, so a parent is never removed while its child remains
  assert.deepEqual(u.unlabel.map((g) => g.label), ['Recruiting/One Call', 'Recruiting']);
});

test('an archiving rule cannot archive mail that already left the inbox', () => {
  // The one number the user reads on a retroactive pass is "would leave the
  // inbox", and on that run it is zero. Declaring it per rule instead of per
  // thread reported 13 moves that would never happen.
  const doc = { rules: [
    { id: 'sort-oc', action: 'label', label: 'Recruiting/One Call', match: { from: '@onecallcm.com' }, note: 'One Call recruiting mail' },
  ] };
  const inbox = { id: 't1', from: 'a@onecallcm.com', subject: 'S', labelIds: ['INBOX'] };
  const filed = { id: 't2', from: 'b@onecallcm.com', subject: 'S', labelIds: ['Label_10'], labels: ['Recruiting'] };
  const p = plan([inbox, filed], doc);
  assert.equal(p.taken.find((t) => t.threadId === 't1').archive, true);
  assert.equal(p.taken.find((t) => t.threadId === 't2').archive, false);

  // and a fetch that supplied no labels at all cannot claim otherwise
  const blind = plan([{ id: 't3', from: 'c@onecallcm.com', subject: 'S' }], doc);
  assert.equal(blind.taken[0].archive, true, 'absence of evidence became evidence of absence');
});

test('the scope is a parameter, not a hardcoded inbox', () => {
  const r = { id: 'x', action: 'label', label: 'Recruiting/UHG', match: { from: '@uhg.com' }, note: 'n' };
  assert.match(toGmailQuery(r), /\bin:inbox\b/, 'the default is still an inbox run');
  const retro = toGmailQuery(r, { scope: 'label:Recruiting' });
  assert.match(retro, /\blabel:Recruiting\b/);
  assert.doesNotMatch(retro, /\bin:inbox\b/, 'a retroactive pass that still says in:inbox finds nothing');
  // the idempotence guard survives either way
  assert.match(retro, /-label:Recruiting\/UHG\b/);
});

test('a rule that can never fire is detected, not left in the file', () => {
  const broad = { id: 'a', action: 'trash', match: { from: 'uhg.com' }, note: 'all UHG' };
  const narrow = { id: 'b', action: 'trash', match: { from: 'careers@recruiting.uhg.com', subjectContains: 'code' }, note: 'codes' };
  assert.equal(subsumes(broad, narrow), true, 'substring containment is how matches() works');
  assert.equal(subsumes(narrow, broad), false);
  // and containment is literal, not "same organisation" — `@uhg.com` is NOT a
  // substring of `careers@recruiting.uhg.com`, so claiming subsumption there
  // would kill a rule that really does fire.
  assert.equal(subsumes({ match: { from: '@uhg.com' } }, narrow), false);

  // every field must be implied, not merely present
  assert.equal(subsumes({ match: { from: '@x.com', hasUnsubscribe: true } }, { match: { from: 'a@x.com' } }), false);
  assert.equal(subsumes({ match: { from: '@x.com', hasUnsubscribe: true } }, { match: { from: 'a@x.com', hasUnsubscribe: true } }), true);
  assert.equal(subsumes({ match: { olderThanDays: 7 } }, { match: { olderThanDays: 3 } }), false, '3 days old is not 7 days old');
  assert.equal(subsumes({ match: { olderThanDays: 7 } }, { match: { olderThanDays: 30 } }), true);
  assert.equal(subsumes({ match: { category: 'promotions' } }, { match: { category: 'updates' } }), false);

  // the live rule set's real near-miss: a trash rule for EXPIRED codes must not
  // be read as shadowing the label rule that keeps fresh ones
  const expired = { id: 'trash-old', action: 'trash', match: { from: 'careers@recruiting.uhg.com', subjectContains: 'access code', olderThanDays: 7 }, note: 'n' };
  const fresh = { id: 'keep-new', action: 'label', label: 'Recruiting/UHG', keepInInbox: true, match: { from: 'careers@recruiting.uhg.com', subjectContains: 'access code' }, note: 'n' };
  assert.equal(subsumes(expired, fresh), false, 'the fresh-code rule was declared dead and would have been deleted');

  const { dead } = shadowedRules([broad, narrow]);
  assert.deepEqual(dead.map((d) => [d.shadowedBy, d.ruleId]), [['a', 'b']]);
});

test('a parent rule standing in front of its own sub-label rule is refused', () => {
  // Not a style complaint. This pair DRIFTS: fresh mail hits the parent rule
  // first and never reaches the sub-rule, while mail already carrying the
  // parent skips it (the already-filed short-circuit in `matches`) and does.
  // Same rule set, two outcomes, decided by when the mail arrived.
  const doc = { rules: [
    { id: 'sort-uhg', action: 'label', label: 'Recruiting', match: { from: 'careers@recruiting.uhg.com' }, note: 'UHG recruiting mail' },
    { id: 'sort-uhg-sub', action: 'label', label: 'Recruiting/UnitedHealth Group', match: { from: 'careers@recruiting.uhg.com' }, note: 'UHG recruiting mail' },
  ] };
  assert.throws(() => validateRuleSet(doc), RuleProblem);
  assert.throws(() => validateRuleSet(doc), /Recruiting\/UnitedHealth Group/);

  // Only THIS order drifts. Sub-label first is a working configuration — the
  // sub-rule applies the parent too — so it must NOT be refused, merely
  // reported as leaving the parent rule dead. Refusing both would make the
  // check look like a complaint about nesting rather than about drift.
  const swapped = { rules: [doc.rules[1], doc.rules[0]] };
  const rows = validateRuleSet(swapped);
  assert.equal(rows.find((r) => r.id === 'sort-uhg').shadowedBy, 'sort-uhg-sub',
    'the now-dead parent rule was not reported at all');

  // and the corrected set passes, or the check above is just rejecting nesting
  assert.ok(validateRuleSet({ rules: [
    { id: 'sort-uhg', action: 'label', label: 'Recruiting/UnitedHealth Group', match: { from: 'careers@recruiting.uhg.com' }, note: 'UHG recruiting mail' },
    { id: 'sort-oc', action: 'label', label: 'Recruiting/One Call', match: { from: '@onecallcm.com' }, note: 'One Call recruiting mail' },
  ] }).length === 2);
});

const filedThread = (from, subject, i) => ({
  id: `${from}-${i}`, from, subject, date: '2026-08-01T00:00:00Z', labelIds: ['Label_10'], labels: ['Recruiting'],
});

test('subdivide clusters a folder by sender domain and houses what it can', () => {
  const threads = [
    ...Array.from({ length: 7 }, (_, i) => filedThread('Skye_Laskin@onecallcm.com', 'Interview with One Call', i)),
    ...Array.from({ length: 4 }, (_, i) => filedThread('careers@recruiting.uhg.com', 'Opening at UnitedHealth Group', i)),
  ];
  const r = subdivide(threads, { parent: 'Recruiting', labels: ['Recruiting', 'Recruiting/One Call', 'Statements'] });

  assert.equal(r.clusters.length, 2);
  assert.equal(r.clusters[0].from, '@onecallcm.com');
  assert.equal(r.clusters[0].count, 7);
  assert.equal(r.clusters[0].destination, 'Recruiting/One Call', 'an existing sub-label is the home');
  // UHG has no sub-label yet, and naming one is not this function's job
  assert.equal(r.clusters[1].destination, null);
  assert.equal(r.unhoused, 1);

  // Only sub-labels of THIS parent are candidate homes. `Statements` shares no
  // token here, but a top-level match would be wrong even if it did.
  assert.deepEqual(r.knownChildren, ['Recruiting/One Call']);
});

test('subdivide never names a sub-label after the mail vendor', () => {
  // Ashby sends for whichever employer bought it. `Recruiting/Ashbyhq` files
  // every one of them into one folder — the same failure as filing a school
  // district under `Onlinejmc`, committed by the fix for it.
  assert.equal(vendorHostOf('no-reply@ashbyhq.com'), 'ashbyhq');
  assert.equal(vendorHostOf('noreply@candidates.workablemail.com'), 'workable');
  assert.equal(vendorHostOf('careers@recruiting.uhg.com'), null);

  const threads = [
    filedThread('no-reply@ashbyhq.com', 'Nate - Thanks for applying to Obvious!', 0),
    filedThread('no-reply@ashbyhq.com', 'Thanks for applying to Someone Else', 1),
  ];
  // even when a sub-label exists whose name WOULD match the vendor's domain
  const r = subdivide(threads, { parent: 'Recruiting', labels: ['Recruiting/Ashbyhq'] });
  assert.equal(r.clusters[0].vendorHost, 'ashbyhq');
  assert.equal(r.clusters[0].destination, null, 'it housed a vendor cluster under the vendor');
  assert.equal(r.vendorHosted, 1);
  // the subjects are carried, because that is where the organisation's name is
  assert.equal(r.clusters[0].subjects.length, 2);

  // and a rule for one cannot be built from the sender alone
  assert.throws(() => clusterToSubRule(r.clusters[0], 'Recruiting/Obvious'), /subjectContains/);
  const rule = clusterToSubRule(r.clusters[0], 'Recruiting/Obvious', 'Obvious');
  assert.equal(rule.match.subjectContains, 'Obvious');
  assert.ok(validateRule(rule));
});

test('subdivide says so when a folder is still one thing', () => {
  const threads = Array.from({ length: 4 }, (_, i) => filedThread('Fidelity.eDocuments@mail.fidelity.com', 'New statement', i));
  const r = subdivide(threads, { parent: 'Statements', labels: [] });
  assert.equal(r.clusters.length, 1);
  assert.ok(r.single, 'a one-entity folder must be reported as not worth splitting');

  // and an empty folder is a result with a reason, never a bare empty table
  const empty = subdivide([], { parent: 'Statements', labels: [] });
  assert.equal(empty.clusters.length, 0);
  assert.equal(empty.reason.kind, 'empty-folder');
  assert.ok(empty.reason.text.includes('Statements'));

  assert.throws(() => subdivide(threads, { parent: '' }), /--parent/);
});

// ── hygiene: is the label system still coherent? ────────────────────────────

test('one folder spelled two ways is detected, including a transposition', () => {
  // The pair this mailbox actually carried for months, with mail split across
  // both and nothing in Gmail saying so. Edit distance alone scores it 2 and
  // misses it; sorted letters catch a transposition exactly.
  assert.equal(isNearDuplicateLabel('Receipts', 'Reciepts'), true);
  assert.equal(isNearDuplicateLabel('Reciepts', 'Receipts'), true, 'the check must be symmetric');
  // a dropped character, which reordering never sees
  assert.equal(isNearDuplicateLabel('Statements', 'Statments'), true);
  // and case/spacing is `normaliseLabel`'s job, not a NEAR duplicate
  assert.equal(isNearDuplicateLabel('Receipts', 'receipts'), false, 'those are the SAME label');
});

test('the near-duplicate check refuses to cry wolf', () => {
  // A hygiene check that reports false pairs stops being read, and then the
  // real pair goes unnoticed too.
  assert.equal(isNearDuplicateLabel('NPM', 'PNM'), false, 'three characters is below the floor');
  assert.equal(isNearDuplicateLabel('Medical', 'Banking'), false);
  assert.equal(isNearDuplicateLabel('Recruiting', 'Receipts'), false);
  // Deliberately different folders that share a leaf are NOT one folder
  assert.equal(isNearDuplicateLabel('Finance/Receipts', 'Work/Receipts'), false,
    'two intentional folders were reported as one misspelling');
  // but a typo in the leaf is still caught under different parents
  assert.equal(isNearDuplicateLabel('Finance/Receipts', 'Work/Reciepts'), true);
  // the floor is real, not incidental
  assert.ok(MIN_NEAR_DUPLICATE_LENGTH >= 4);
});

const lbl = (name, threadsTotal) => ({ labelId: `L_${name}`, name, threadsTotal });

test('audit separates a folder holding orphaned mail from empty scaffolding', () => {
  // Opposite remedies: write a rule for the first, delete the second. Reporting
  // both as "unmanaged" tells the user to do the wrong thing to one of them.
  const doc = { rules: [
    { id: 'sort-bank', action: 'label', label: 'Banking', match: { from: '@bank.example' }, note: 'bank alerts' },
  ] };
  const a = audit([lbl('Banking', 2), lbl('Selling_Home', 4), lbl('DevOps_Book', 0), lbl('INBOX', 1)], doc);

  assert.equal(a.labels.length, 3, 'a system label was counted as one of the user\'s folders');
  assert.deepEqual(a.unmanaged.map((l) => l.name), ['Selling_Home', 'DevOps_Book']);
  assert.equal(a.unmanaged.find((l) => l.name === 'Selling_Home').empty, false);
  assert.equal(a.unmanaged.find((l) => l.name === 'DevOps_Book').empty, true);
  assert.equal(a.coverage, 33);
  assert.equal(a.clean, false);
});

test('audit says "count unknown" rather than guessing that a folder holds mail', () => {
  // A label list without threadsTotal cannot say which remedy applies, and
  // guessing "holds mail" from a missing field tells the user to write rules
  // for folders that are empty.
  const a = audit([{ name: 'Mystery' }], { rules: [] });
  assert.equal(a.labels[0].empty, null);
  assert.notEqual(a.labels[0].empty, false);
});

test('audit counts a correctly-filed thread as claimed, not as unclaimed', () => {
  // The bug the first live run exposed: `plan` answers "is there work to do",
  // and says no for a thread already sitting in the folder its rule files
  // into. Reusing that made the audit report 47 of 48 threads as unclaimed —
  // a clean mailbox rendered as a broken one.
  const doc = { rules: [
    { id: 'sort-bank', action: 'label', label: 'Banking', match: { from: '@bank.example' }, note: 'bank alerts' },
  ] };
  const filed = { id: 't1', from: 'alerts@bank.example', subject: 'Balance', labels: ['Banking'] };
  const orphan = { id: 't2', from: 'someone@nowhere.example', subject: 'Hello', labels: [] };

  const a = audit([lbl('Banking', 1)], doc, [filed, orphan]);
  assert.equal(a.unclaimed.threads, 1, 'a thread already filed by its own rule was called unclaimed');
  assert.deepEqual(a.unclaimed.clusters.map((c) => c.from), ['someone@nowhere.example']);

  // and `plan` must still answer its own question the old way, or every run
  // re-files everything it filed last time
  assert.equal(plan([filed], doc).taken.length, 0);
});

test('audit offers existing parents to nest a new sender under', () => {
  // Without this the honest answer to "where does this go" is always a new
  // top-level folder, and the label system sprawls instead of growing.
  const doc = { rules: [{ id: 'r', action: 'label', label: 'Recruiting/Acme', match: { from: '@acme.example' }, note: 'acme jobs' }] };
  const a = audit([lbl('Recruiting', 5), lbl('Recruiting/Acme', 5)], doc,
    [{ id: 't', from: 'jobs@newco.example', subject: 'Application received', labels: [] }]);
  assert.deepEqual(a.unclaimed.parents, ['Recruiting'], 'a sub-label was offered as a nesting parent');
  assert.equal(a.unclaimed.clusters[0].unhoused, true);
});

test('audit is clean only when nothing is outstanding', () => {
  const doc = { rules: [{ id: 'r', action: 'label', label: 'Banking', match: { from: '@bank.example' }, note: 'bank alerts' }] };
  const clean = audit([lbl('Banking', 1)], doc, [{ id: 't', from: 'a@bank.example', subject: 'S', labels: ['Banking'] }]);
  assert.equal(clean.clean, true);
  assert.equal(clean.coverage, 100);
  // any one of the three findings is enough to make it not clean
  assert.equal(audit([lbl('Banking', 1), lbl('Stray', 3)], doc).clean, false);
  assert.equal(audit([lbl('Banking', 1), lbl('Bankign', 0)], doc).clean, false);
  assert.equal(audit([lbl('Banking', 1)], doc, [{ id: 'x', from: 'q@nowhere.example', subject: 'S', labels: [] }]).clean, false);
});

// ── merging one folder into another ─────────────────────────────────────────

test('a merge labels before it unlabels', () => {
  // Ordering is not cosmetic. Reversed, every thread spends the gap between two
  // API calls in neither folder — and a run that dies in that gap leaves it
  // there permanently.
  const threads = [
    { id: 't1', from: 'a@x.com', subject: 'One', labels: ['Reciepts'] },
    { id: 't2', from: 'b@x.com', subject: 'Two', labels: ['Reciepts', 'Receipts'] },
    { id: 't3', from: 'c@x.com', subject: 'Three', labels: ['Banking'] },
  ];
  const m = mergeLabels(threads, { from: 'Reciepts', to: 'Receipts' });
  assert.equal(m.total, 2, 'a thread not carrying the source was swept in');
  assert.deepEqual(m.label.map((e) => e.threadId), ['t1'], 'only the thread lacking the target needs it');
  assert.deepEqual(m.unlabel.map((e) => e.threadId), ['t1', 't2'], 'every carrier must lose the source');
  assert.equal(m.alreadyThere, 1);
});

test('a merge that moves no mail is still recorded, so it can be undone', () => {
  // The real case: the typo folder's only thread already carried the correct
  // one, so the whole operation was "remove the label, delete the folder".
  // Recording nothing would make it unreversible.
  const threads = [{ id: 't1', from: 'a@x.com', subject: 'One', labels: ['Reciepts', 'Receipts'] }];
  const m = mergeLabels(threads, { from: 'Reciepts', to: 'Receipts' });
  assert.equal(m.label.length, 0);
  assert.equal(m.unlabel.length, 1);

  const u = undoPlan({ at: 'now', entries: mergeReceiptEntries(m) });
  assert.deepEqual(u.relabel.map((g) => g.label), ['Reciepts'], 'undo cannot put the folded folder back');
  assert.deepEqual(u.relabel[0].entries.map((e) => e.threadId), ['t1']);
  // and it must NOT strip `Receipts`, which this merge never added
  assert.deepEqual(u.unlabel, []);
});

test('undoing a merge that DID move mail takes the target back off', () => {
  const threads = [{ id: 't1', from: 'a@x.com', subject: 'One', labels: ['Reciepts'] }];
  const m = mergeLabels(threads, { from: 'Reciepts', to: 'Receipts' });
  const u = undoPlan({ at: 'now', entries: mergeReceiptEntries(m) });
  assert.deepEqual(u.unlabel.map((g) => g.label), ['Receipts'], 'the label the merge added was left on');
  assert.deepEqual(u.relabel.map((g) => g.label), ['Reciepts']);
});

test('a merge refuses the cases that would lose mail', () => {
  assert.throws(() => mergeLabels([], { from: 'A' }), /--from and --to/);
  assert.throws(() => mergeLabels([], { from: 'Receipts', to: 'receipts' }), /same label/);
  // folding a parent into its own child leaves the child holding mail the
  // parent no longer names
  assert.throws(() => mergeLabels([], { from: 'Recruiting', to: 'Recruiting/Acme' }), /parent of/);
});

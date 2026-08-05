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
} from '../lib/rules.mjs';
import {
  propose, candidateToRule, candidateToSortRule, plan, authorise, buildReceipt,
  undoPlan, matchDestination, NotAuthorised,
  isProtected, hasProtectedSubject,
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
  for (const d of ['recruiting.initech.example', 'careers.example.com', 'jobs.acme.io',
    'myworkday.com', 'greenhouse.io', 'candidates.workablemail.com']) {
    assert.equal(isProtected(d), true, `${d} should be withheld`);
  }
});

test('financial, medical, governmental and educational senders are protected', () => {
  for (const d of ['statements.northbank.example', 'notify.southbank.example', 'valleyhealth.example',
    'irs.gov', 'hawley.k12.mn.us', 'someuniversity.edu']) {
    assert.equal(isProtected(d), true, `${d} should be withheld`);
  }
  assert.equal(isProtected('leadgen.example'), false);
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
  // domain: centralschools@parentvendor.example carries every marker in the LOCAL part
  // and none in the domain.
  assert.equal(isProtected('centralschools@parentvendor.example'), true);
  assert.equal(isProtected('careers@somevendor.io'), true);
  assert.equal(isProtected('billing-noreply@somevendor.io'), false);
  assert.equal(isProtected('outreach@leadgen.example'), false);
  assert.equal(isProtected(null), false);
});

test('a school behind a vendor domain is withheld, not proposed', () => {
  const t = (i) => ({
    id: `s${i}`, from: 'centralschools@parentvendor.example', subject: 'Bus registration',
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
  // list_labels shape, and a bare-string list, must both work
  for (const have of [[{ name: 'shopping', type: 'user' }], ['shopping']]) {
    const r = reconcileDestinations(doc, have);
    assert.deepEqual(r.map((d) => d.name), ['Shopping', 'Finance/Chase']);
    assert.deepEqual(r.map((d) => d.exists), [true, false]);
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
  const r = propose(bulkFrom('centralschools@parentvendor.example', 'Bus registration', 4), { minCount: 3, labels: [] });
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

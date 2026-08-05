/**
 * Unit tests, deliberately in their own file — `skillfactory freeze` rewrites
 * baseline.test.mjs, so a guard written there is deleted on the next refresh.
 *
 * Several of these pin defects the first real run against a live inbox found.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { validateRule, validateRuleSet, toGmailQuery, matches, RuleProblem } from '../lib/rules.mjs';
import {
  propose, candidateToRule, plan, authorise, buildReceipt, NotAuthorised,
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
  assert.throws(() => authorise(planDoc, ['nope']), /not named by the plan/);
});

test('a label rule does not authorise a trash', () => {
  // t3 is in the plan, but under a label action — trashing it would be an
  // action no rule asked for.
  assert.throws(() => authorise(planDoc, ['t3']), NotAuthorised);
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

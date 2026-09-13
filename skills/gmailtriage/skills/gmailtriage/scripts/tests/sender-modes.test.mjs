import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { matches, validateRule, validateRuleSet, subsumes, lintRuleSet, toGmailQuery } from '../lib/rules.mjs';
import { propose, candidateToRule, candidateToSortRule, subdivide, clusterToSubRule, plan } from '../lib/plan.mjs';
import { normalizeSearchThreads, mergeThreadSources, applyCategories, validateIngest } from '../lib/ingest.mjs';

const rule = (match, action = 'label', extra = {}) => ({
  id: 'sender-rule', action, ...(action === 'label' ? { label: 'Shopping' } : {}),
  match, note: 'invented sender selection', ...extra,
});
const thread = (from, extra = {}) => ({
  id: 'thread-one', from, subject: 'Summer offers', date: '2026-08-01',
  labelIds: ['INBOX'], category: 'promotions', hasUnsubscribe: true, ...extra,
});
const exact = rule({ fromAddress: ' Offers@Shop.Example ' });
const domain = rule({ fromDomain: ' Shop.Example ' });
const invalid = [
  'attacker@evil.example, offers@shop.example', 'offers@shop.example, attacker@evil.example',
  'Name <offers@shop.example> trailing', 'Name <offers@shop.example', 'offers@shop.example>',
  '"Name <offers@shop.example>', 'Name" <offers@shop.example>', 'Name (comment) <offers@shop.example>',
  'Name, Other <offers@shop.example>', 'offers@shop.example (comment)', 'Name <offers@shop.example> <other@shop.example>',
  'offers@@shop.example', '.offers@shop.example', 'offers..more@shop.example', 'offers.@shop.example',
  'offers@shop..example', 'offers@-shop.example', 'offers@shop-.example', 'offers@shop_example',
  'offers @shop.example', 'offers@shop.example\n', 'Name\t<offers@shop.example>',
  '"offers"@shop.example', 'offers@[127.0.0.1]', 'préfix@shop.example', 'offers@Kshop.example',
  'offers@shop.example\u2028', 'Name\u0085<offers@shop.example>', '', 42, {},
];

test('exact mailbox and domain select parsed sender boundaries for every action', () => {
  const cases = [
    ['offers@shop.example', true, true], ['OFFERS@SHOP.EXAMPLE', true, true],
    ['Different Name <Offers@Shop.Example>', true, true], ['"Doe, Shop" <offers@shop.example>', true, true],
    ['<offers@shop.example>', true, true], ['xoffers@shop.example', false, true],
    ['offersx@shop.example', false, true], ['offers@shop.example.evil.example', false, false],
    ['offers@sub.shop.example', false, false], ['offers@othershop.example', false, false],
    ['"offers@shop.example" <attacker@evil.example>', false, false],
    ['"@shop.example" <attacker@evil.example>', false, false],
  ];
  for (const action of ['trash', 'label', 'keep']) {
    for (const [from, addressMatch, domainMatch] of cases) {
      assert.equal(matches({ ...exact, action }, thread(from)), addressMatch, action + ': ' + from);
      assert.equal(matches({ ...domain, action }, thread(from)), domainMatch, action + ': ' + from);
    }
  }
});

test('exact configuration validates bare values without mutating saved rules', () => {
  for (const r of [exact, domain, rule({ fromAddress: "offers+tag@shop.example" })]) {
    const before = JSON.stringify(r);
    assert.doesNotThrow(() => validateRule(r));
    assert.equal(JSON.stringify(r), before);
  }
  for (const match of [
    ...[null, '', 4, 'Name <offers@shop.example>', ...invalid].map((fromAddress) => ({ fromAddress })),
    ...[null, '', 4, '@shop.example', '*.shop.example', 'shop..example', '-shop.example', 'shop.example\n'].map((fromDomain) => ({ fromDomain })),
  ]) assert.throws(() => validateRule(rule(match)), /fromAddress|fromDomain/);
  for (const match of [
    { from: '@shop.example', fromAddress: 'offers@shop.example' },
    { fromAddress: 'offers@shop.example', fromDomain: 'shop.example' },
    { from: '@shop.example', fromDomain: 'shop.example' },
  ]) assert.throws(() => validateRule(rule(match)), /only one|mutually exclusive|combine/i);
});

test('malformed sender input cannot match or become a proposal', () => {
  for (const from of invalid) {
    const t = thread(from);
    assert.equal(matches(exact, t), false, JSON.stringify(from));
    assert.equal(matches(domain, t), false, JSON.stringify(from));
    const p = propose([t], { minCount: 1 });
    assert.equal([...p.candidates, ...p.sortable, ...p.withheld, ...p.below].length, 0, JSON.stringify(from));
    assert.equal(subdivide([t], { parent: 'Shopping' }).clusters.length, 0);
  }
});

test('ingest retains invalid and conflicting sender evidence in either source order', () => {
  const raw = (from, extra = {}) => ({ threads: [{ id: 'thread-one', ...extra, messages: [
    { sender: from, subject: 'Summer offers', labelIds: ['INBOX'] },
    { sender: 'reply@elsewhere.example', subject: 'Reply', labelIds: [] },
  ] }] });
  const good = normalizeSearchThreads(raw('Offers <offers@shop.example>'));
  for (const [other, ambiguous] of [
    ['OFFERS@SHOP.EXAMPLE', false], ['Other Name <offers@shop.example>', false], [null, false],
    ['attacker@evil.example', true], ['bad, offers@shop.example', true], ['', true],
  ]) {
    const second = normalizeSearchThreads(raw(other));
    for (const sources of [[good, second], [second, good]]) {
      const [snapshot] = applyCategories(mergeThreadSources(...sources), ['thread-one']);
      assert.equal(snapshot.senderAmbiguous, ambiguous ? true : undefined, JSON.stringify({ other, sources }));
      assert.equal(matches(exact, snapshot), !ambiguous);
      const [again] = applyCategories(mergeThreadSources(JSON.parse(JSON.stringify([snapshot])), good), ['thread-one']);
      assert.equal(matches(exact, again), !ambiguous, 'round-trip must retain uncertainty');
      assert.equal(plan([again], { rules: [exact] }).taken.length, ambiguous ? 0 : 1);
      assert.equal(propose([again], { minCount: 1 }).candidates.length, ambiguous ? 0 : 1);
      const legacy = rule({ from: String(snapshot.from).toLowerCase() });
      assert.equal(matches(legacy, snapshot), true, 'legacy raw sender selection remains unchanged');
    }
  }
  for (const senderAmbiguous of [true, false, null, 'private-marker', {}, 0]) {
    const [normalized] = normalizeSearchThreads(raw('offers@shop.example', { senderAmbiguous }));
    assert.equal(normalized.senderAmbiguous, true);
    const [snapshot] = applyCategories([thread('offers@shop.example', { senderAmbiguous })]);
    assert.equal(snapshot.senderAmbiguous, true);
    assert.equal(matches(exact, snapshot), false);
    assert.ok(!JSON.stringify(snapshot).includes('private-marker'));
  }
});

test('generated address and domain rules validate, enforce local actions, keeps and overlaps', () => {
  const real = thread('offers@shop.example');
  const lookalike = thread('offers@shop.example.evil.example', { id: 'lookalike' });
  const c = propose([real], { minCount: 1 }).candidates[0];
  const trash = candidateToRule(c);
  const sort = candidateToSortRule({ ...c, id: 'sort-offers', destination: 'Shopping' });
  assert.deepEqual(trash.match, { fromAddress: 'offers@shop.example', hasUnsubscribe: true });
  assert.deepEqual(sort.match, { fromAddress: 'offers@shop.example' });
  assert.doesNotThrow(() => validateRuleSet({ rules: [trash, sort] }));
  const p = plan([real, lookalike], { rules: [trash, sort] });
  assert.deepEqual(p.taken.map((t) => t.threadId), ['thread-one']);
  assert.deepEqual(p.overlaps.map((t) => t.threadId), ['thread-one']);
  const keep = rule({ fromAddress: 'offers@shop.example' }, 'keep', { id: 'keep-offers' });
  const kept = plan([real, lookalike], { rules: [trash, keep] });
  assert.deepEqual(kept.taken, []);
  assert.deepEqual(kept.spared.map((t) => t.threadId), ['thread-one']);
  const cluster = subdivide([real], { parent: 'Shopping', labels: ['Shopping/Shop'] }).clusters[0];
  const sub = clusterToSubRule(cluster);
  assert.deepEqual(sub.match, { fromDomain: 'shop.example' });
  assert.doesNotThrow(() => validateRule(sub));
  assert.equal(matches(sub, lookalike), false);
  const vendor = subdivide([thread('offers@ashbyhq.example')], { parent: 'Work' }).clusters[0];
  assert.throws(() => clusterToSubRule(vendor, 'Work/Shop'), /subjectContains/);
  const constrained = clusterToSubRule(vendor, 'Work/Shop', 'Shop');
  assert.deepEqual(constrained.match, { fromDomain: 'ashbyhq.example', subjectContains: 'Shop' });
  assert.doesNotThrow(() => validateRule(constrained));
});

test('static sender implication is conservative, including whitespace-bearing legacy needles', () => {
  const a = rule({ fromAddress: 'offers@shop.example' });
  const d = rule({ fromDomain: 'shop.example' });
  assert.equal(subsumes(a, exact), true);
  assert.equal(subsumes(d, a), true);
  assert.equal(subsumes(a, d), false);
  assert.equal(subsumes(d, domain), true);
  for (const m of [{ fromDomain: 'sub.shop.example' }, { fromDomain: 'other.example' }, { fromAddress: 'offers@other.example' }]) {
    assert.equal(subsumes(d, rule(m)), false);
  }
  assert.equal(subsumes(a, rule({ fromAddress: 'other@shop.example' })), false);
  const legacy = rule({ from: '@shop.example' });
  assert.equal(subsumes(legacy, a), true);
  assert.equal(subsumes(legacy, d), true);
  assert.equal(subsumes(d, legacy), false);
  assert.equal(subsumes(rule({ from: ' @shop.example' }), a), false);
  assert.equal(subsumes(rule({ from: ' @shop.example' }), d), false);
  assert.equal(subsumes(rule({ from: ' @shop.example' }), legacy), false);
  assert.equal(subsumes(rule({ fromDomain: 'shop.example', subjectContains: 'code' }), a), false);
  assert.equal(subsumes(d, rule({ fromAddress: 'offers@shop.example', subjectContains: 'code' })), true);
  const child = { ...a, id: 'child-rule', label: 'Shopping/Shop' };
  assert.throws(() => validateRuleSet({ rules: [d, child] }), /shadow|sub-label|never/i);
  assert.doesNotThrow(() => validateRuleSet({ rules: [rule({ from: ' @shop.example' }), child] }));
  assert.doesNotThrow(() => validateRuleSet({ rules: [rule({ fromDomain: 'other.example' }), child] }));
});

test('lint explains all legacy substrings and exact or mixed trash/sort overlap', () => {
  for (const from of ['shop.example', '@shop.example', 'offers@shop.example']) {
    const warnings = lintRuleSet([rule({ from })]);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0].text, /substring/);
    assert.match(warnings[0].text, /fromAddress/);
    assert.match(warnings[0].text, /fromDomain/);
    assert.doesNotMatch(warnings[0].text, /Anchor it with/);
  }
  assert.deepEqual(lintRuleSet([exact]), []);
  const overlap = (a, b) => lintRuleSet([rule(a, 'trash'), rule(b, 'label', { id: 'sort-rule' })])
    .filter((w) => w.kind === 'trash-shadows-sort');
  for (const pair of [
    [{ fromAddress: 'offers@shop.example' }, { fromDomain: 'shop.example' }],
    [{ fromDomain: 'shop.example' }, { fromAddress: 'offers@shop.example' }],
    [{ from: '@shop.example' }, { fromAddress: 'offers@shop.example' }],
    [{ fromAddress: 'offers@shop.example' }, { from: '@shop.example' }],
    [{ from: 'offers@shop.example' }, { fromDomain: 'shop.example' }],
    [{ fromDomain: 'shop.example' }, { from: 'offers@shop.example' }],
    [{ from: ' Shop' }, { from: 'Shop ' }],
  ]) assert.equal(overlap(...pair).length, 1);
  assert.equal(overlap({ fromDomain: 'shop.example' }, { fromDomain: 'other.example' }).length, 0);
  assert.equal(overlap({ fromAddress: 'offers@shop.example' }, { fromAddress: 'other@shop.example' }).length, 0);
});

test('query sender terms are broad safe candidates and local matching decides', () => {
  assert.equal(toGmailQuery(exact), 'from:shop.example in:inbox -label:Shopping');
  assert.equal(toGmailQuery(domain, { scope: 'label:Filed' }), 'from:shop.example label:Filed -label:Shopping');
  assert.equal(toGmailQuery(rule({ fromAddress: "o'ffer+tag@shop.example", subjectContains: 'sale' })),
    'from:shop.example subject:sale in:inbox -label:Shopping');
});

test('offline CLI ingest, propose, rules and plan keep exact selection through persisted files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sender-modes-'));
  const cli = fileURLToPath(new URL('../gmailtriage.js', import.meta.url));
  const write = (name, data) => { const p = join(dir, name); writeFileSync(p, JSON.stringify(data)); return p; };
  const read = (name) => JSON.parse(readFileSync(join(dir, name), 'utf8'));
  const run = (...args) => {
    const r = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: process.env });
    assert.equal(r.status, 0, r.stderr + r.stdout);
  };
  try {
    const senders = ['Offers <offers@shop.example>', 'OFFERS@SHOP.EXAMPLE', 'offers@shop.example',
      'bad, offers@shop.example', '"offers@shop.example" <attacker@evil.example>'];
    const raw = write('raw.json', { threads: senders.map((sender, i) => ({
      id: 't' + i, messages: [{ sender, subject: 'Summer offers', date: '2026-08-01', labelIds: ['INBOX'] }],
    })) });
    const labels = write('labels-raw.json', { labels: [] });
    const rules = write('rules.json', { rules: [] });
    run('ingest', '--inbox', raw, '--promos', raw, '--labels', labels,
      '--out-threads', join(dir, 'threads.json'), '--out-labels', join(dir, 'labels.json'));
    run('propose', '--threads', join(dir, 'threads.json'), '--rules', rules, '--min-count', '3', '--out', join(dir, 'candidates.json'));
    const candidates = read('candidates.json');
    assert.equal(candidates.candidates.length, 1);
    assert.equal(candidates.candidates[0].match.fromAddress, 'offers@shop.example');
    run('rules', '--file', rules, '--add', join(dir, 'candidates.json'));
    run('plan', '--threads', join(dir, 'threads.json'), '--rules', rules, '--out', join(dir, 'plan.json'));
    assert.deepEqual(read('plan.json').taken.map((t) => t.threadId), ['t0', 't1', 't2']);
    const legacy = write('legacy.json', { rules: [rule({ from: 'offers@shop.example' }, 'trash')] });
    run('rules', '--file', legacy);
    run('plan', '--threads', join(dir, 'threads.json'), '--rules', legacy, '--out', join(dir, 'legacy-plan.json'));
    assert.equal(read('legacy-plan.json').taken.length, 5, 'saved substring rules retain display-name and malformed matches');
    // Rich category responses must preserve sender uncertainty for selected
    // threads, while metadata-only responses and out-of-scope IDs stay harmless.
    for (const category of ['promos', 'updates']) {
      const evidence = write('category.json', { threads: [
        { id: 't0', messages: [{ sender: 'attacker@evil.example' }] },
        { id: 't1', messages: [{ sender: 'bad, offers@shop.example' }] },
        { id: 't2', senderAmbiguous: true, messages: [] },
        { id: 'outside', messages: [{ sender: 'offers@shop.example' }] },
      ] });
      run('ingest', '--inbox', raw, '--' + category, evidence, '--labels', labels,
        '--out-threads', join(dir, 'threads.json'), '--out-labels', join(dir, 'labels.json'));
      const snapshots = read('threads.json');
      assert.equal(snapshots.length, 5, 'category fetch must not expand scope');
      assert.ok(snapshots.slice(0, 3).every((t) => t.senderAmbiguous === true));
      run('plan', '--threads', join(dir, 'threads.json'), '--rules', rules, '--out', join(dir, 'plan.json'));
      assert.deepEqual(read('plan.json').taken, [], category + ' uncertainty must block exact trash');

      const metadata = write('category.json', { threads: [{ id: 't0' }, { id: 'outside' }] });
      run('ingest', '--inbox', raw, '--' + category, metadata, '--labels', labels,
        '--out-threads', join(dir, 'threads.json'), '--out-labels', join(dir, 'labels.json'));
      run('plan', '--threads', join(dir, 'threads.json'), '--rules', rules, '--out', join(dir, 'plan.json'));
      assert.deepEqual(read('plan.json').taken.map((t) => t.threadId), ['t0']);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


test('category sender evidence cannot fill a missing selected sender', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sender-category-missing-'));
  const cli = fileURLToPath(new URL('../gmailtriage.js', import.meta.url));
  const write = (name, data) => { const p = join(dir, name); writeFileSync(p, JSON.stringify(data)); return p; };
  const raw = (sender) => ({ threads: [{ id: 'thread-one', messages: [
    { ...(sender === null ? {} : { sender }), subject: 'Summer offers', labelIds: ['INBOX'] },
  ] }] });
  try {
    const inbox = write('inbox.json', raw(null));
    const labels = write('labels.json', { labels: [] });
    const out = join(dir, 'threads.json');
    for (const category of ['promos', 'updates']) {
      for (const senders of [['offers@shop.example'], ['offers@shop.example', 'attacker@evil.example']]) {
        const evidence = write('category.json', { threads: senders.flatMap((s) => raw(s).threads) });
        const args = ['ingest', '--inbox', inbox, '--' + category, evidence, '--labels', labels,
          '--out-threads', out, '--out-labels', join(dir, 'labels-out.json')];
        const refused = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: process.env });
        assert.equal(refused.status, 1, 'category sender must not bypass missing-sender validation');
        assert.match(refused.stdout, /no subject or sender/);
        const forced = spawnSync(process.execPath, [cli, ...args, '--force'], { encoding: 'utf8', env: process.env });
        assert.equal(forced.status, 0, forced.stderr + forced.stdout);
        const snapshots = JSON.parse(readFileSync(out, 'utf8'));
        assert.equal(snapshots[0].from, null, 'preserve the selected snapshot sender');
        assert.equal(snapshots[0].senderAmbiguous, senders.length > 1 ? true : undefined);
        assert.deepEqual(validateIngest(snapshots), [{ id: 'thread-one', missing: ['from'] }]);
        for (const r of [exact, domain, rule({ from: '@shop.example' }, 'trash')]) {
          assert.equal(matches(r, snapshots[0]), false);
          assert.deepEqual(plan(snapshots, { rules: [r] }).taken, []);
        }
        assert.equal(propose(snapshots, { minCount: 1 }).candidates.length, 0);
      }
      // A no-label fetch remains an authorized source for the selected sender.
      const nolabel = write('nolabel.json', raw('offers@shop.example'));
      const evidence = write('category.json', raw('OFFERS@SHOP.EXAMPLE'));
      const good = spawnSync(process.execPath, [cli, 'ingest', '--inbox', inbox, '--nolabel', nolabel,
        '--' + category, evidence, '--labels', labels, '--out-threads', out,
        '--out-labels', join(dir, 'labels-out.json')], { encoding: 'utf8', env: process.env });
      assert.equal(good.status, 0, good.stderr + good.stdout);
      const snapshots = JSON.parse(readFileSync(out, 'utf8'));
      assert.equal(snapshots[0].from, 'offers@shop.example');
      assert.equal(matches(exact, snapshots[0]), true);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

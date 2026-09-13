import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const skill = fileURLToPath(new URL('../..', import.meta.url));
const cli = (...args) => spawnSync(process.execPath, [join(skill, 'scripts/gmailtriage.js'), ...args], { encoding: 'utf8' });
const thread = (id, labelIds = ['INBOX'], category) => ({ id, category, snippet: 'invented-private-sentinel', messages: [{ sender: 'Sender <sender@example.test>', subject: 'Invented notice', date: '2026-08-01', labelIds }] });
const page = (threads = [], nextPageToken) => ({ threads, nextPageToken, resultCountEstimate: 999999 });
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'gt-pagination-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const put = (name, value) => { writeFileSync(join(dir, name), JSON.stringify(value)); return name; };
  put('labels.raw.json', { labels: [{ id: 'Label_1', name: 'Filed', type: 'user' }] });
  const read = (name) => JSON.parse(readFileSync(join(dir, name), 'utf8'));
  const args = ['--labels', join(dir, 'labels.raw.json'), '--out-threads', join(dir, 'threads.json'), '--out-labels', join(dir, 'labels.json'), '--out-coverage', join(dir, 'coverage.json')];
  const ingest = (sources, extra = []) => {
    put('manifest.json', { schema: 1, sources });
    return cli('ingest', '--manifest', join(dir, 'manifest.json'), ...args, ...extra);
  };
  const source = (pages, caps = {}) => ({ query: 'in:inbox', maxPages: 5, maxThreads: 100, pages, ...caps });
  const record = (name, raw, pageToken = null) => ({ path: put(name, raw), pageToken });
  return { dir, put, read, args, ingest, source, record };
}
const ok = (r) => assert.equal(r.status, 0, r.stderr + r.stdout);

test('multiple verbatim pages dedupe with union, later category membership and conservative plan actions', (t) => {
  const f = fixture(t);
  const records = [f.record('i1.json', page([...Array.from({ length: 50 }, (_, i) => thread(`t${i}`)), thread('t0', ['EXTRA'])], 'next')),
    f.record('i2.json', page([thread('t0', ['LATER']), ...Array.from({ length: 10 }, (_, i) => thread(`t${i + 50}`))]), 'next')];
  const sources = {
    inbox: f.source(records),
    nolabel: f.source([f.record('n.json', page([thread('t0', ['OTHER'], 'updates')]))]),
    promos: f.source([f.record('p1.json', page([{ id: 'outside' }], 'pnext')), f.record('p2.json', page([{ id: 't0' }, { id: 't59' }]), 'pnext')], { query: 'category:promotions -in:trash' }),
  };
  const result = f.ingest(sources); ok(result);
  const threads = f.read('threads.json'), coverage = f.read('coverage.json');
  assert.equal(threads.length, 60); assert.equal(new Set(threads.map(t => t.id)).size, 60);
  assert.deepEqual(new Set(threads[0].labelIds), new Set(['INBOX', 'EXTRA', 'LATER', 'OTHER']));
  assert.equal(threads[0].categoryEvidence.status, 'conflict');
  assert.equal(threads.find(t => t.id === 't59').category, 'promotions');
  assert.deepEqual([coverage.sources.inbox.pages, coverage.sources.inbox.uniqueThreads, coverage.sources.inbox.state], [2, 60, 'complete']);
  assert.deepEqual([coverage.sources.promos.pages, coverage.sources.promos.uniqueThreads], [2, 3]);
  assert.equal(coverage.sources.updates.state, 'unknown');
  assert.match(result.stderr, /inbox\s*\|\s*2\s*\|\s*60\s*\|\s*complete/);
  assert.doesNotMatch(JSON.stringify({ threads, coverage }), /snippet|invented-private-sentinel|999999|nextPageToken|i1.json/);
  const rules = { version: 1, rules: [{ id: 'bulk', action: 'label', label: 'Filed', match: { category: 'promotions', hasUnsubscribe: true }, note: 'Invented approved rule' }] };
  f.put('rules.json', rules);
  const plan = () => { ok(cli('plan', '--threads', join(f.dir, 'threads.json'), '--labels', join(f.dir, 'labels.json'), '--rules', join(f.dir, 'rules.json'), '--out', join(f.dir, 'plan.json'))); return f.read('plan.json').taken; };
  const actions = plan(); assert.deepEqual(actions.map(a => a.threadId), ['t59']);
  // Reverse independent source declarations and the duplicate order, retaining a valid chain.
  f.put('i1.json', page([...Array.from({ length: 50 }, (_, i) => thread(`t${i}`)), thread('t0', ['EXTRA'])].reverse(), 'next'));
  ok(f.ingest(Object.fromEntries(Object.entries(sources).reverse())));
  assert.deepEqual(plan(), actions);
});

test('coverage distinguishes exhaustion, caps and interruptions while retaining partial data', (t) => {
  const f = fixture(t);
  const first = f.record('first.json', page([thread('one')], 'a'));
  const terminal = f.record('terminal.json', page(), 'a');
  const cases = [
    [[first, terminal], {}, 'complete', 2, 1],
    [[first], {}, 'interrupted', 1, 1],
    [[first], { maxPages: 1 }, 'capped', 1, 1],
    [[first], { maxThreads: 1 }, 'capped', 1, 1],
    [[f.record('end.json', page([thread('one')]))], { maxPages: 1, maxThreads: 1 }, 'complete', 1, 1],
    [[first, { path: 'absent.json', pageToken: 'a' }, f.record('last.json', page([thread('two')]), 'b')], {}, 'interrupted', 2, 2],
    [[first, { failed: true, pageToken: 'a' }], { maxPages: 2 }, 'interrupted', 1, 1],
    [[first, { ...terminal, pageToken: 'wrong' }], {}, 'interrupted', 2, 1],
    [[first, f.record('repeat.json', page([thread('two')], 'a'), 'a')], { maxPages: 2 }, 'interrupted', 2, 2],
    [[first, { ...terminal, pageToken: null }], {}, 'interrupted', 2, 1],
    [[terminal], {}, 'interrupted', 1, 0],
    [[f.record('empty.json', {}), terminal], {}, 'interrupted', 2, 0],
    [[f.record('malformed.json', { error: 'invented-private-sentinel' })], {}, 'interrupted', 0, 0],
    [[f.record('bad-threads.json', { threads: null })], {}, 'interrupted', 0, 0],
    [[], {}, 'interrupted', 0, 0],
  ];
  for (const [pages, caps, state, count, unique] of cases) {
    ok(f.ingest({ inbox: f.source(pages, caps) }));
    const c = f.read('coverage.json').sources.inbox;
    assert.deepEqual([c.state, c.pages, c.uniqueThreads], [state, count, unique], JSON.stringify(pages));
    assert.ok(c.reason.length < 80);
    assert.equal(f.read('threads.json').length, unique);
  }
});

test('manifest validation refuses invalid or over-cap input before snapshots', (t) => {
  const f = fixture(t);
  const a = f.record('one.json', page([thread('one'), thread('two')]));
  for (const sources of [
    { inbox: f.source([a], { maxPages: 0 }) }, { inbox: f.source([a], { maxThreads: 1 }) },
    { inbox: f.source([a, a], { maxPages: 1 }) }, { mystery: f.source([a]) },
    { inbox: f.source([{ path: 'one.json' }]) }, { inbox: f.source([a], { query: '' }) },
    { inbox: f.source([{ failed: true, path: 'one.json', pageToken: null }]) },
  ]) {
    assert.notEqual(f.ingest(sources).status, 0);
    assert.equal(existsSync(join(f.dir, 'threads.json')), false);
  }
  assert.notEqual(f.ingest({ inbox: f.source([a]) }, ['--inbox', join(f.dir, 'one.json')]).status, 0);
});

test('legacy coverage stays unknown and labels-only preserves snapshots and refuses incompatible flags', (t) => {
  const f = fixture(t); f.put('one.json', page([thread('one'), thread('one')]));
  ok(cli('ingest', '--inbox', join(f.dir, 'one.json'), ...f.args));
  assert.ok(existsSync(join(f.dir, 'coverage.json')), 'legacy ingest must write requested coverage');
  assert.deepEqual([f.read('coverage.json').sources.inbox.state, f.read('coverage.json').sources.inbox.uniqueThreads], ['unknown', 1]);
  const before = readFileSync(join(f.dir, 'threads.json'), 'utf8');
  const labelArgs = ['--labels-only', '--labels', join(f.dir, 'labels.raw.json'), '--out-labels', join(f.dir, 'labels.json')];
  ok(cli('ingest', ...labelArgs));
  assert.equal(readFileSync(join(f.dir, 'threads.json'), 'utf8'), before);
  for (const flag of ['--manifest', '--out-coverage', '--out-threads', '--inbox']) {
    assert.notEqual(cli('ingest', ...labelArgs, flag, join(f.dir, 'one.json')).status, 0);
  }
});

test('shared host instructions require bounded verbatim fetching and final coverage', () => {
  const doc = readFileSync(join(skill, 'SKILL.md'), 'utf8');
  for (const pattern of [/Claude and Codex/, /maxPages=1/, /maxThreads=50/, /pageSize=min\(50/, /numbered.*verbatim/i, /before.*create_label/, /--manifest/, /--out-coverage/, /coverage\.json/]) assert.match(doc, pattern);
  const ref = readFileSync(join(skill, 'references/gmail.md'), 'utf8');
  for (const state of ['complete', 'capped', 'interrupted', 'unknown']) assert.ok(ref.includes(state));
  assert.match(ref, /failed.*attempt/i); assert.match(ref, /repeated.*token/i);
});

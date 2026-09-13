import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { plan } from '../lib/plan.mjs';

const trash = { id: 'trash-offers', action: 'trash', match: { from: 'offers@shop.example' }, note: 'User offers rule' };
const file = { ...trash, id: 'file-offers', action: 'label', label: 'Shopping/Offers' };
const keep = { id: 'keep', action: 'keep', match: { subjectContains: 'Keep' }, note: 'Keep requested mail' };
const row = (id, labelIds, extra = {}) => ({ id, from: 'offers@shop.example', subject: 'Offers', labelIds, ...extra });
const index = new Map([['Label_1', 'Shopping'], ['Label_2', 'Shopping/Offers'], ['Label_3', 'Shopping/Other']]);
const mixed = () => [row('inbox', ['INBOX']), row('names', undefined, { labels: ['Inbox'] }),
  row('archived', []), row('sent', ['SENT']), row('trash', ['TRASH']), row('spam', ['SPAM']),
  row('inbox-trash', ['INBOX', 'TRASH']), row('inbox-spam', ['INBOX', 'SPAM']),
  row('out-keep', [], { subject: 'Keep' }), row('in-keep', ['INBOX'], { subject: 'Keep' })];
const folderRows = () => [row('member', ['Label_1']), row('inbox-member', ['INBOX', 'Label_1']),
  row('filed', ['Label_1', 'Label_2']), row('descendant', ['Label_3']), row('outsider', []),
  row('kept', ['Label_1'], { subject: 'Keep' }), row('mixed', ['Label_1'], { labels: ['UNREAD'] })];

function checkInbox(p) {
  assert.deepEqual(p.taken.map((t) => t.threadId), ['inbox', 'names']);
  assert.equal(p.scanned, 10);
  assert.equal(p.inScope, 3);
  assert.equal(p.excluded.length, 7);
  assert.equal(p.scanned, p.inScope + p.excluded.length);
  assert.deepEqual(p.spared.map((t) => t.threadId), ['in-keep']);
  assert.ok(p.overlaps.every((t) => ['inbox', 'names', 'in-keep'].includes(t.threadId)));
  assert.equal(p.excluded.filter((t) => t.reason === 'trash').length, 2);
  assert.equal(p.excluded.filter((t) => t.reason === 'spam').length, 2);
  assert.equal(p.excluded.filter((t) => t.reason === 'not-in-inbox').length, 3);
  assert.deepEqual(p.destinations, []);
}
function checkFolder(p) {
  assert.deepEqual(p.taken.map((t) => t.threadId), ['member', 'inbox-member', 'mixed']);
  assert.ok(p.taken.every((t) => t.action === 'label' && t.archive === false));
  assert.ok(p.taken.every((t) => !t.removed?.length && !t.unlabel));
  assert.ok(p.taken.every((t) => JSON.stringify(t.adds) === JSON.stringify(['Shopping/Offers'])));
  assert.deepEqual(p.destinations, ['Shopping', 'Shopping/Offers']);
  assert.deepEqual(p.spared.map((t) => t.threadId), ['kept']);
  assert.deepEqual(p.excluded.map((t) => t.threadId), ['descendant', 'outsider']);
  assert.deepEqual(p.excludedRules, [{ ruleId: 'trash-offers', action: 'trash', reason: 'additive-only' }]);
  assert.ok(p.queries.every((q) => q.action !== 'trash'));
}
test('default scope excludes archived, sent, trash and spam before matching and counting', () => {
  checkInbox(plan(mixed(), { rules: [keep, trash, file] }));
});
test('folder scope excludes destructive precedence and adds only missing labels', () => {
  checkFolder(plan(folderRows(), { rules: [keep, trash, file] }, { scope: 'label:Shopping', labelIndex: index }));
  const p = plan([row('literal', undefined, { labels: ['Work Mail/Shopping'] })], { rules: [file] }, { scope: 'label:"Work Mail/Shopping"' });
  assert.equal(p.taken.length, 1);
  assert.equal(p.taken[0].archive, false);
});
test('unsupported or unevaluable scopes refuse actionably, including empty snapshots', () => {
  for (const scope of ['', 'anywhere', 'in:sent', 'label:', 'label:""', 'label:Shopping in:inbox', 'label:"Shopping', 'label:Shopping OR label:Other']) {
    assert.throws(() => plan([], { rules: [trash] }, { scope }), /scope.*in:inbox.*label:/i, scope);
  }
  for (const t of [{ id: 'missing' }, row('bad', 'INBOX'), row('null', null), row('bad-name', [], { labels: [42] })]) {
    assert.throws(() => plan([t], { rules: [trash] }), /thread.*(fetch|labels)/i);
  }
  assert.equal(plan([row('empty', [])], { rules: [trash] }).taken.length, 0);
  for (const t of [row('opaque', ['Label_99']), row('mixed', ['Label_99'], { labels: ['Shopping'] })]) {
    assert.throws(() => plan([t], { rules: [file] }, { scope: 'label:Shopping', labelIndex: index }), /thread.*--labels/i);
  }
  assert.throws(() => plan([], { rules: [file] }, { scope: 'label:Shopping', labelIndex: new Map([['Label_1', 'Shopping'], ['Label_2', ' shopping ']]) }), /ambiguous.*--labels/i);
});

const cli = fileURLToPath(new URL('../gmailtriage.js', import.meta.url));
function fixture(t, threads, rules) {
  const dir = mkdtempSync(join(tmpdir(), 'gt-scope-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = (name) => join(dir, name + '.json');
  for (const [name, value] of Object.entries({ threads, rules: { rules }, labels: [...index].map(([id, name]) => ({ id, name })) })) writeFileSync(path(name), JSON.stringify(value));
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: process.env });
  const planning = (...args) => run('plan', '--threads', path('threads'), '--rules', path('rules'), '--labels', path('labels'), '--out', path('plan'), ...args);
  return { path, run, planning, read: (name) => JSON.parse(readFileSync(path(name), 'utf8')) };
}
test('CLI default scope enforces the same mixed-snapshot boundary', (t) => {
  const f = fixture(t, mixed(), [keep, trash, file]);
  const r = f.planning();
  assert.equal(r.status, 0, r.stderr);
  checkInbox(f.read('plan'));
  assert.match(r.stdout, /In scope.*Excluded/);
  assert.match(r.stdout, /not-in-inbox/);
});
test('CLI folder apply and updated snapshot converge while preserving parent and INBOX', (t) => {
  const f = fixture(t, folderRows(), [keep, trash, file]);
  const first = f.planning('--scope', 'label:Shopping');
  assert.equal(first.status, 0, first.stderr);
  checkFolder(f.read('plan'));
  assert.match(first.stdout, /additive-only/);
  const applied = f.run('apply', '--plan', f.path('plan'), '--receipt', f.path('receipt'), '--update-threads', f.path('threads'));
  assert.equal(applied.status, 0, applied.stderr);
  assert.match(applied.stdout, /additive.*INBOX/i);
  assert.doesNotMatch(applied.stdout, /TRASH exactly|REMOVE the INBOX|had already left the inbox/);
  assert.ok(f.read('receipt').entries.every((e) => e.action === 'label' && e.archived === false && !e.removed?.length));
  const updated = f.read('threads');
  assert.ok(updated.find((t) => t.id === 'inbox-member').labelIds.includes('INBOX'));
  assert.ok(updated.filter((t) => ['member', 'inbox-member', 'mixed'].includes(t.id)).every((t) => t.labelIds.includes('Label_1')));
  const second = f.planning('--scope', 'label:Shopping');
  assert.equal(second.status, 0, second.stderr);
  assert.equal(f.read('plan').taken.length, 0);
});
test('CLI refusals never write a plan', (t) => {
  const f = fixture(t, [row('bad', ['Label_99'], { labels: ['Shopping'] })], [file]);
  for (const scope of ['label:Shopping', '', 'anywhere', 'label:Shopping in:inbox']) {
    const r = f.planning('--scope', scope);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /--labels|scope/i);
    assert.equal(existsSync(f.path('plan')), false);
  }
  writeFileSync(f.path('threads'), JSON.stringify([{ id: 'missing', from: 'offers@shop.example' }]));
  const r = f.planning();
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /thread.*(fetch|labels)/i);
  assert.equal(existsSync(f.path('plan')), false);
});

for (const [name, threads, labelMap, scope, taken] of [
  ['mapped Label_ folder name', [row('member', ['Label_1'])],
    [['Label_1', 'Label_Archive']], 'label:Label_Archive', ['member']],
  ['resolved name colliding with an ID', [row('outsider', undefined, { labels: ['Label_1'] })],
    [['Label_1', 'Shopping'], ['Label_2', 'Label_1']], 'label:Shopping', []],
  ['resolved Label_ folder without a map', [row('member', undefined, { labels: ['Label_Archive'] })],
    [], 'label:Label_Archive', ['member']],
]) {
  test('planner preserves ' + name, () => {
    const p = plan(threads, { rules: [file] }, { scope, labelIndex: new Map(labelMap) });
    assert.deepEqual(p.taken.map((t) => t.threadId), taken);
    assert.equal(p.excluded.length, threads.length - taken.length);
    assert.ok(p.taken.every((t) => t.action === 'label' && t.archive === false));
  });
  test('CLI preserves ' + name, (t) => {
    const f = fixture(t, threads, [file]);
    writeFileSync(f.path('labels'), JSON.stringify(labelMap.map(([id, name]) => ({ id, name }))));
    const r = f.planning('--scope', scope);
    assert.equal(r.status, 0, r.stderr);
    const p = f.read('plan');
    assert.deepEqual(p.taken.map((t) => t.threadId), taken);
    assert.equal(p.excluded.length, threads.length - taken.length);
    assert.ok(p.taken.every((t) => t.action === 'label' && t.archive === false));
  });
}

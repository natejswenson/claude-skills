import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../gmailtriage.js', import.meta.url));
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'gt-triage-cli-'));
  const path = name => join(dir, name + '.json');
  const write = (name, value) => writeFileSync(path(name), JSON.stringify(value));
  const read = name => JSON.parse(readFileSync(path(name), 'utf8'));
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  const ok = (...args) => { const r = run(...args); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  const timestamp = new Date(Date.now() - 3000).toISOString();
  write('raw', { threads: [{ id: 't1', totalMessages: 1, messages: [{ id: 'm1', sender: 'orders@shop.example', subject: 'Your order receipt', date: timestamp, labelIds: ['INBOX'], snippet: 'secret-that-must-not-be-copied' }] }] });
  write('threads', [{ id: 't1', from: 'orders@shop.example', subject: 'Your order receipt', date: timestamp, labelIds: ['INBOX'] }]);
  write('labels', { labels: [{ id: 'Label_receipts', name: 'Receipts' }] });
  write('rules', { version: 1, rules: [] });
  write('candidate', { version: 1, mode: 'auto-file', approvedAt: null, policies: [{ id: 'receipts', purpose: 'receipt', label: 'Receipts', archive: true, note: 'File routine receipts' }] });
  const inputs = () => ['--threads', path('threads'), '--labels', path('labels'), '--rules', path('rules'), '--preferences', path('preferences'), '--context', path('context'), '--decisions', path('decisions')];
  const prepare = () => {
    ok('preferences', '--file', path('preferences'), '--save', path('candidate'), '--approve');
    ok('context', '--raw', path('raw'), '--source', 'thread', '--out', path('context'));
    const c = read('context');
    write('decisions', { version: 1, decisions: [{ threadId: 't1', contextHash: c.threads[0].hash, messages: [{ messageId: 'm1', purpose: 'receipt', attention: 'routine' }] }] });
    ok('triage', ...inputs(), '--out', path('plan'));
  };
  const refresh = () => {
    write('raw-fresh', read('raw'));
    ok('context', '--raw', path('raw-fresh'), '--source', 'thread', '--out', path('fresh'));
  };
  return { dir, path, write, read, run, ok, inputs, prepare, refresh };
}

test('preferences require approval, back up previous settings, and setup shows the next step', () => {
  const f = fixture();
  assert.notEqual(f.run('preferences', '--file', f.path('preferences'), '--save', f.path('candidate')).status, 0);
  assert.equal(existsSync(f.path('preferences')), false);
  f.ok('preferences', '--file', f.path('preferences'), '--save', f.path('candidate'), '--approve');
  const original = readFileSync(f.path('preferences'), 'utf8');
  assert.ok(f.read('preferences').approvedAt);
  f.write('candidate', { ...f.read('candidate'), mode: 'preview' });
  f.ok('preferences', '--file', f.path('preferences'), '--save', f.path('candidate'), '--approve');
  const backups = readdirSync(f.dir).filter(name => name.startsWith('preferences.json.') && name.endsWith('.bak'));
  assert.equal(backups.length, 1);
  assert.equal(readFileSync(join(f.dir, backups[0]), 'utf8'), original);
  assert.match(f.ok('setup', '--file', f.path('rules'), '--preferences', f.path('preferences')), /preview|triage/);
});

test('context strips snippets and policy decisions enter existing pending receipts only after refresh', () => {
  const f = fixture(); f.prepare();
  assert.doesNotMatch(readFileSync(f.path('context'), 'utf8'), /secret-that-must-not-be-copied|snippet/);
  const refused = f.run('apply', '--plan', f.path('plan'), ...f.inputs(), '--receipt', f.path('receipt'));
  assert.notEqual(refused.status, 0); assert.equal(existsSync(f.path('receipt')), false);
  f.ok('context', '--raw', f.path('raw'), '--source', 'thread', '--out', f.path('fresh'));
  assert.notEqual(f.run('apply', '--plan', f.path('plan'), ...f.inputs(), '--fresh-context', f.path('fresh'), '--receipt', f.path('receipt')).status, 0, 're-normalizing an unchanged raw response cannot fake refresh');
  f.refresh();
  const plan = f.read('plan'); delete plan.semantic; f.write('missing-marker', plan);
  assert.notEqual(f.run('apply', '--plan', f.path('missing-marker'), '--receipt', f.path('receipt')).status, 0);
  assert.equal(existsSync(f.path('receipt')), false);
  f.ok('apply', '--plan', f.path('plan'), ...f.inputs(), '--fresh-context', f.path('fresh'), '--receipt', f.path('receipt'));
  const receipt = f.read('receipt');
  assert.ok(receipt.operations.some(o => o.action === 'add' && o.label === 'Receipts'));
  assert.ok(receipt.operations.some(o => o.action === 'remove' && o.label === 'INBOX'));
  assert.ok(receipt.operations.every(o => o.status === 'pending'));
  assert.equal(receipt.authorization.policies[0].id, 'receipts');
  assert.equal(receipt.authorization.decisions[0].messages[0].purpose, 'receipt');
  assert.match(f.ok('digest', '--receipt', f.path('receipt')), /0.*confirmed|confirmed.*0/i);
});

test('a new conversation reply invalidates apply before a receipt exists', () => {
  const f = fixture(); f.prepare();
  const raw = f.read('raw');
  raw.threads[0].totalMessages = 2;
  raw.threads[0].messages.push({ id: 'm2', sender: 'support@shop.example', subject: 'Please confirm your shipping address', date: new Date().toISOString(), labelIds: ['INBOX'] });
  f.write('raw', raw);
  f.refresh();
  const result = f.run('apply', '--plan', f.path('plan'), ...f.inputs(), '--fresh-context', f.path('fresh'), '--receipt', f.path('receipt'));
  assert.notEqual(result.status, 0); assert.equal(existsSync(f.path('receipt')), false);
});

test('preview and corrections do not activate preference actions', () => {
  const f = fixture(); f.prepare();
  f.write('candidate', { ...f.read('candidate'), mode: 'preview' });
  f.ok('preferences', '--file', f.path('preferences'), '--save', f.path('candidate'), '--approve');
  f.ok('triage', ...f.inputs(), '--out', f.path('plan'));
  assert.equal(f.read('plan').taken.length, 0);
  assert.match(f.ok('review', '--plan', f.path('plan')), /preview/i);
  f.ok('correct', '--id', 'shop-receipts', '--from-address', 'orders@shop.example', '--purpose', 'receipt', '--label', 'Receipts', '--archive', 'false', '--note', 'Keep these receipts visible', '--out', f.path('correction'));
  const candidate = f.read('correction');
  assert.equal(candidate.approvedAt, null);
  assert.equal(candidate.policies[0].fromAddress, 'orders@shop.example');
  assert.equal(candidate.policies[0].archive, false);
  assert.equal(f.read('preferences').mode, 'preview');
  assert.notEqual(f.run('correct', '--id', 'too-broad', '--purpose', 'receipt', '--label', 'Receipts', '--archive', 'false', '--note', 'Unscoped', '--out', f.path('bad')).status, 0);
});

test('digest distinguishes confirmed effects from authorization and preserves undo instructions', () => {
  const f = fixture(); f.prepare();
  f.refresh();
  f.ok('apply', '--plan', f.path('plan'), ...f.inputs(), '--fresh-context', f.path('fresh'), '--receipt', f.path('receipt'));
  const r = f.read('receipt'); const add = r.operations.find(o => o.action === 'add');
  const tuple = { id: add.id, threadId: add.threadId, action: add.action, label: add.label };
  f.write('outcomes', { runId: r.runId, outcomes: [tuple] });
  f.ok('record', '--receipt', f.path('receipt'), '--outcomes', f.path('outcomes'), '--begin');
  f.write('outcomes', { runId: r.runId, outcomes: [{ ...tuple, status: 'confirmed', evidence: 'success' }] });
  f.ok('record', '--receipt', f.path('receipt'), '--outcomes', f.path('outcomes'));
  const digest = f.ok('digest', '--receipt', f.path('receipt'), '--plan', f.path('plan'));
  assert.match(digest, /filed.*1|1.*filed/i);
  assert.match(digest, /pending.*1|1.*pending/i);
  assert.match(digest, /undo.*--receipt/);
  assert.doesNotMatch(digest, /secret-that-must-not-be-copied/);
  assert.doesNotMatch(digest, /nothing has moved/i);
});

test('named trash approval is evidence-bound and enters the existing receipt lifecycle', () => {
  const f = fixture();
  const raw = f.read('raw'); raw.threads[0].messages[0].subject = 'Seasonal offers'; f.write('raw', raw);
  f.write('threads', [{ ...f.read('threads')[0], subject: 'Seasonal offers' }]);
  f.write('candidate', { ...f.read('candidate'), policies: [] });
  f.ok('preferences', '--file', f.path('preferences'), '--save', f.path('candidate'), '--approve');
  f.ok('context', '--raw', f.path('raw'), '--source', 'thread', '--out', f.path('context'));
  f.write('decisions', { version: 1, decisions: [{ threadId: 't1', contextHash: f.read('context').threads[0].hash, messages: [{ messageId: 'm1', purpose: 'promotion', attention: 'routine' }] }] });
  f.ok('triage', ...f.inputs(), '--out', f.path('plan'));
  assert.equal(f.read('plan').taken.length, 0);
  assert.notEqual(f.run('review', '--plan', f.path('plan'), '--context', f.path('context'), '--approve-trash', 'foreign', '--out', f.path('bad-approval')).status, 0);
  f.ok('review', '--plan', f.path('plan'), '--context', f.path('context'), '--approve-trash', 't1', '--out', f.path('approvals'));
  f.ok('triage', ...f.inputs(), '--approvals', f.path('approvals'), '--out', f.path('plan'));
  assert.equal(f.read('plan').taken[0].action, 'trash');
  f.refresh();
  assert.notEqual(f.run('apply', '--plan', f.path('plan'), ...f.inputs(), '--fresh-context', f.path('fresh'), '--receipt', f.path('receipt')).status, 0);
  assert.equal(existsSync(f.path('receipt')), false);
  f.ok('apply', '--plan', f.path('plan'), ...f.inputs(), '--approvals', f.path('approvals'), '--fresh-context', f.path('fresh'), '--receipt', f.path('receipt'));
  assert.deepEqual(f.read('receipt').operations.map(o => [o.action, o.status]), [['trash', 'pending']]);
  assert.equal(f.read('receipt').authorization.approvals[0].threadId, 't1');
});

test('digest does not count a parent-only addition as completed destination filing', () => {
  const f = fixture();
  const candidate = f.read('candidate'); candidate.policies[0].label = 'Finance/Receipts'; f.write('candidate', candidate);
  f.write('labels', { labels: [{ id: 'Label_finance', name: 'Finance' }, { id: 'Label_receipts', name: 'Finance/Receipts' }] });
  f.prepare(); f.refresh();
  f.ok('apply', '--plan', f.path('plan'), ...f.inputs(), '--fresh-context', f.path('fresh'), '--receipt', f.path('receipt'));
  const receipt = f.read('receipt'); const parent = receipt.operations.find(o => o.action === 'add' && o.label === 'Finance');
  const tuple = { id: parent.id, threadId: parent.threadId, action: parent.action, label: parent.label };
  f.write('outcomes', { runId: receipt.runId, outcomes: [tuple] });
  f.ok('record', '--receipt', f.path('receipt'), '--outcomes', f.path('outcomes'), '--begin');
  f.write('outcomes', { runId: receipt.runId, outcomes: [{ ...tuple, status: 'confirmed', evidence: 'success' }] });
  f.ok('record', '--receipt', f.path('receipt'), '--outcomes', f.path('outcomes'));
  const digest = f.ok('digest', '--receipt', f.path('receipt'));
  assert.match(digest, /Confirmed: 0 filed/);
  assert.match(digest, /1 confirmed operations/);
  assert.match(digest, /2 pending/);
});

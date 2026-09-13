import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, renameSync, mkdirSync, rmdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
const cli = resolve('scripts/gmailtriage.js');
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const write = (p, data) => writeFileSync(p, JSON.stringify(data));
function fixture(kind = 'apply') {
  const dir = mkdtempSync(join(tmpdir(), 'gt-outcomes-')), path = (n) => join(dir, n + '.json');
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  const ok = (...args) => { const r = run(...args); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  write(path('threads'), [{ id: 'one', from: 'mail@shop.example', subject: 'Offer', labelIds: ['INBOX', 'Label_old', 'Label_parent'], labels: ['INBOX', 'Old', 'Filed'] },
    { id: 'other', from: 'other@shop.example', subject: 'Unrelated', labelIds: ['INBOX'] }]);
  write(path('labels'), { labels: [{ id: 'Label_old', name: 'Old' }, { id: 'Label_parent', name: 'Filed' }] });
  const original = readFileSync(path('threads'), 'utf8');
  if (kind === 'merge') ok('merge', '--threads', path('threads'), '--labels', path('labels'), '--from', 'Old', '--to', 'Filed/Child', '--receipt', path('receipt'), '--update-threads', path('threads'));
  else {
    write(path('rules'), { version: 1, rules: [{ id: 'sort', action: kind === 'trash' ? 'trash' : 'label', ...(kind === 'trash' ? {} : { label: 'Filed/Child' }), match: { from: 'mail@shop.example' }, note: 'Synthetic authorization' }] });
    ok('plan', '--threads', path('threads'), '--labels', path('labels'), '--rules', path('rules'), '--out', path('plan'));
    ok('apply', '--plan', path('plan'), '--receipt', path('receipt'), '--update-threads', path('threads'));
  }
  const receipt = () => read(path('receipt')), ops = () => receipt().operations;
  const record = (operations, mode, status = 'confirmed', evidence = 'success', overrides = {}) => {
    write(path('outcomes'), { runId: receipt().runId, outcomes: operations.map(({ id, threadId, action, label, attempt }) => ({ id, threadId, action, label, ...(attempt === undefined ? {} : { attempt }), ...(mode === '--begin' || mode === '--retry' ? {} : { status, evidence }) })), ...overrides });
    return run('record', '--receipt', path('receipt'), '--outcomes', path('outcomes'), ...(mode ? [mode] : []));
  };
  const pass = (...args) => { const r = record(...args); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  return { path, run, ok, original, receipt, ops, record, pass };
}
for (const kind of ['apply', 'merge', 'trash']) {
  test(kind + ': authorization leaves snapshot unchanged and undo empty', () => {
    const f = fixture(kind);
    assert.equal(readFileSync(f.path('threads'), 'utf8'), f.original);
    assert.ok(f.ops().length > 0 && f.ops().every((o) => o.status === 'pending'));
    assert.match(f.ok('undo', '--receipt', f.path('receipt')), /confirmed=0/);
    assert.doesNotMatch(f.ok('undo', '--receipt', f.path('receipt')), /exactly these thread ids/);
    assert.equal(statSync(f.path('receipt')).mode & 0o777, 0o600);
    if (kind !== 'merge') assert.notEqual(f.run('apply', '--plan', f.path('plan'), '--receipt', f.path('receipt')).status, 0);
  });
  test(kind + ': success, duplicate confirmation and restart replay', () => {
    const f = fixture(kind);
    for (const action of ['trash', 'add', 'remove']) {
      const ops = f.ops().filter((o) => o.action === action);
      if (!ops.length) continue;
      f.pass(ops, '--begin'); f.pass(ops);
      const bytes = readFileSync(f.path('receipt'), 'utf8'); f.pass([...ops, ...ops]);
      assert.equal(readFileSync(f.path('receipt'), 'utf8'), bytes);
    }
    const after = readFileSync(f.path('threads'), 'utf8');
    f.ok('record', '--receipt', f.path('receipt'), '--recover');
    assert.equal(readFileSync(f.path('threads'), 'utf8'), after);
    assert.deepEqual(read(f.path('threads')).find((t) => t.id === 'other'), JSON.parse(f.original)[1]);
    assert.match(f.ok('undo', '--receipt', f.path('receipt')), /incomplete=0/);
    if (kind !== 'merge') {
      f.ok('plan', '--threads', f.path('threads'), '--labels', f.path('labels'), '--rules', f.path('rules'), '--out', f.path('replan'));
      assert.equal(read(f.path('replan')).taken.length, 0);
    } else assert.ok(!read(f.path('threads'))[0].labelIds.includes('Label_old'));
  });
}
for (const kind of ['apply', 'merge']) {
  test(kind + ': addition survives failed removal; undo only confirmed effects', () => {
    const f = fixture(kind), add = f.ops().filter((o) => o.action === 'add'), remove = f.ops().filter((o) => o.action === 'remove');
    assert.notEqual(f.record(remove, '--begin').status, 0);
    f.pass(add, '--begin'); f.pass(add); f.pass(remove, '--begin'); f.pass(remove, null, 'failed', 'no-effect');
    const t = read(f.path('threads'))[0];
    assert.ok(t.labelIds.includes('INBOX') && t.labelIds.includes('Label_parent') && t.labelIds.includes('Filed/Child'));
    if (kind === 'merge') assert.ok(t.labelIds.includes('Label_old'));
    const undo = f.ok('undo', '--receipt', f.path('receipt'));
    assert.match(undo, /remove the "Filed\/Child"/);
    assert.doesNotMatch(undo, /ADD the INBOX|ADD it back|remove the "Filed" label/);
  });
  test(kind + ': interruption, timeout, reconciliation and explicit retry', () => {
    const f = fixture(kind), add = f.ops().filter((o) => o.action === 'add');
    f.pass(add, '--begin');
    assert.match(f.ok('record', '--receipt', f.path('receipt'), '--status'), /unknown=1/);
    assert.notEqual(f.record(add, '--begin').status, 0);
    f.pass(add, null, 'unknown', 'timeout');
    assert.notEqual(f.record(add).status, 0);
    assert.doesNotMatch(f.ok('record', '--receipt', f.path('receipt'), '--recover'), /Dispatchable|Begun operation/);
    assert.notEqual(f.record(add, '--retry').status, 0);
    f.pass(add, '--reconcile', 'failed', 'read-absent');
    f.pass(add, '--retry');
    const retried = f.ops().filter((o) => o.action === 'add');
    f.pass(retried, '--begin'); f.pass(retried, '--reconcile', 'confirmed', 'read-present');
    assert.match(f.ok('record', '--receipt', f.path('receipt'), '--status'), /confirmed=1/);
  });
  test(kind + ': invalid batches and contradictory duplicates in both orders write nothing', () => {
    const f = fixture(kind), add = f.ops().filter((o) => o.action === 'add'); f.pass(add, '--begin');
    const paths = [f.path('receipt'), f.path('threads')], bytes = paths.map((p) => readFileSync(p, 'utf8'));
    const { id, threadId, action, label } = add[0], good = { id, threadId, action, label, status: 'confirmed', evidence: 'success' };
    for (const bad of [{ ...good, threadId: 'unauthorized' }, { ...good, action: 'trash' }, { ...good, label: 'Wrong' },
      { ...good, id: 'wrong' }, { ...good, status: 'failed', evidence: 'no-effect' }]) {
      for (const outcomes of [[good, bad], [bad, good]]) {
        assert.notEqual(f.record([], null, undefined, undefined, { outcomes }).status, 0);
        assert.deepEqual(paths.map((p) => readFileSync(p, 'utf8')), bytes);
      }
    }
    assert.notEqual(f.record(add, null, undefined, undefined, { runId: 'wrong' }).status, 0);
    f.pass([], null);
    assert.deepEqual(paths.map((p) => readFileSync(p, 'utf8')), bytes);
  });
}
test('receipt commit survives missing snapshot and locked recovery fails closed', () => {
  const f = fixture(), add = f.ops().filter((o) => o.action === 'add'); f.pass(add, '--begin');
  renameSync(f.path('threads'), f.path('saved'));
  assert.match(f.record(add).stderr, /receipt preserved; snapshot replay incomplete/);
  assert.equal(f.ops()[0].status, 'confirmed');
  renameSync(f.path('saved'), f.path('threads'));
  mkdirSync(f.path('receipt') + '.lock');
  assert.match(f.run('record', '--receipt', f.path('receipt'), '--recover').stderr, /locked/);
  rmdirSync(f.path('receipt') + '.lock');
  f.ok('record', '--receipt', f.path('receipt'), '--recover');
  assert.ok(read(f.path('threads'))[0].labelIds.includes('Filed/Child'));
});
test('legacy receipts stay explicit and unsupported versions fail', () => {
  const f = fixture();
  for (const name of ['receipt', 'retro-receipt', 'merge-receipt']) assert.match(f.ok('undo', '--receipt', resolve('evals/baseline', name + '.json')), /legacy: execution evidence unavailable/);
  const r = f.receipt(); r.version = 999; write(f.path('receipt'), r);
  assert.notEqual(f.run('undo', '--receipt', f.path('receipt')).status, 0);
});
test('source already present merge authorizes only removal', () => {
  const f = fixture('merge');
  // Source has only a removal when the target is already carried.
  f.ok('merge', '--threads', f.path('threads'), '--labels', f.path('labels'), '--from', 'Old', '--to', 'Filed', '--receipt', f.path('already'));
  assert.deepEqual(read(f.path('already')).operations.map((o) => o.action), ['remove']);

});

test('public ingest duplicates in either order retain category guards through record and undo', () => {
  for (const reverse of [false, true]) {
    const f = fixture();
    const raw = (category) => ({ threads: ['one', 'conflict'].map((id) => ({ id,
      category: id === 'one' ? 'promotions' : category, messages: [{
        sender: 'mail@shop.example', subject: 'Offers', date: '2026-08-01', labelIds: ['INBOX'], snippet: 'do-not-copy-000000'
      }] })) });
    write(f.path('raw1'), raw('promotions')); write(f.path('raw2'), raw('social'));
    write(f.path('rawlabels'), { labels: [{ id: 'INBOX', name: 'INBOX', type: 'system' }] });
    f.ok('ingest', '--inbox', f.path(reverse ? 'raw2' : 'raw1'), '--nolabel', f.path(reverse ? 'raw1' : 'raw2'),
      '--labels', f.path('rawlabels'), '--out-threads', f.path('ingested'), '--out-labels', f.path('ingested-labels'));
    assert.doesNotMatch(readFileSync(f.path('ingested'), 'utf8'), /do-not-copy|snippet/);
    write(f.path('bulk-rules'), { version: 1, rules: [{ id: 'bulk', action: 'label', label: 'Filed/Child',
      match: { from: 'mail@shop.example', category: 'promotions' }, note: 'Synthetic category boundary' }] });
    f.ok('plan', '--threads', f.path('ingested'), '--labels', f.path('ingested-labels'), '--rules', f.path('bulk-rules'), '--out', f.path('bulk-plan'));
    assert.deepEqual(read(f.path('bulk-plan')).taken.map((t) => t.threadId), ['one']);
    f.ok('apply', '--plan', f.path('bulk-plan'), '--receipt', f.path('bulk-receipt'), '--update-threads', f.path('ingested'));
    const r = read(f.path('bulk-receipt'));
    const additions = r.operations.filter((o) => o.action === 'add').map(({ id, threadId, action, label }) => ({ id, threadId, action, label }));
    assert.equal(additions.length, 2);
    const record = (outcomes, mode) => {
      write(f.path('bulk-outcomes'), { runId: r.runId, outcomes });
      return f.ok('record', '--receipt', f.path('bulk-receipt'), '--outcomes', f.path('bulk-outcomes'), ...(mode ? [mode] : []));
    };
    record(additions, '--begin');
    record(additions.map((o, i) => ({ ...o, status: i ? 'failed' : 'confirmed', evidence: i ? 'no-effect' : 'success' })));
    const snapshot = read(f.path('ingested'));
    assert.ok(snapshot[0].labelIds.includes('Filed') && !snapshot[0].labelIds.includes('Filed/Child') && snapshot[0].labelIds.includes('INBOX'));
    assert.equal(snapshot[1].category, null);
    assert.match(f.ok('undo', '--receipt', f.path('bulk-receipt')), /remove the "Filed" label/);
    assert.doesNotMatch(f.ok('undo', '--receipt', f.path('bulk-receipt')), /remove the "Filed\/Child"|ADD the INBOX/);
    f.ok('plan', '--threads', f.path('ingested'), '--labels', f.path('ingested-labels'), '--rules', f.path('bulk-rules'), '--out', f.path('bulk-replan'));
    assert.deepEqual(read(f.path('bulk-replan')).taken.map((t) => t.threadId), ['one']);
  }
});
test('both hosts share the begin, record, reconciliation and truthful-count protocol', () => {
  const skill = readFileSync('SKILL.md', 'utf8'), reference = readFileSync('references/gmail.md', 'utf8');
  assert.match(skill, /Claude Code and Codex follow the same outcome protocol/);
  for (const text of [skill, reference]) for (const token of ['--begin', '--reconcile', '--retry', 'confirmed', 'unknown']) assert.ok(text.includes(token));
  assert.match(skill, /authorization alone cannot report success/);
});

test('opaque merge snapshots and mixed removal outcomes preserve exact memberships', () => {
  const f = fixture('merge');
  const source = JSON.parse(f.original)[0]; delete source.labels;
  write(f.path('opaque'), [source, { ...source, id: 'two' }]);
  f.ok('merge', '--threads', f.path('opaque'), '--labels', f.path('labels'), '--from', 'Old', '--to', 'Filed',
    '--receipt', f.path('opaque-receipt'), '--update-threads', f.path('opaque'));
  const r = read(f.path('opaque-receipt'));
  const outcomes = r.operations.map(({ id, threadId, action, label }) => ({ id, threadId, action, label }));
  assert.equal(outcomes.length, 2);
  write(f.path('opaque-outcomes'), { runId: r.runId, outcomes });
  f.ok('record', '--receipt', f.path('opaque-receipt'), '--outcomes', f.path('opaque-outcomes'), '--begin');
  write(f.path('opaque-outcomes'), { runId: r.runId, outcomes: outcomes.map((o, i) => ({ ...o, status: i ? 'failed' : 'confirmed', evidence: i ? 'no-effect' : 'success' })) });
  f.ok('record', '--receipt', f.path('opaque-receipt'), '--outcomes', f.path('opaque-outcomes'));
  const [one, two] = read(f.path('opaque'));
  assert.deepEqual(one.labelIds, ['INBOX', 'Label_parent']);
  assert.deepEqual(two.labelIds, source.labelIds);
  const undo = f.ok('undo', '--receipt', f.path('opaque-receipt'));
  assert.match(undo, /ADD it back to exactly these thread ids:\none/);
  assert.doesNotMatch(undo, /\ntwo\n/);
});

function recordReceipt(f, receiptPath, operations, mode) {
  write(f.path('second-outcomes'), { runId: read(receiptPath).runId,
    outcomes: operations.map(({ id, threadId, action, label }) => ({ id, threadId, action, label,
      ...(mode === '--begin' ? {} : { status: 'confirmed', evidence: 'success' }) })) });
  return f.ok('record', '--receipt', receiptPath, '--outcomes', f.path('second-outcomes'), ...(mode ? [mode] : []));
}
function finishMerge(f, from, to) {
  f.ok('merge', '--threads', f.path('threads'), '--labels', f.path('labels'), '--from', from, '--to', to,
    '--receipt', f.path('second'), '--update-threads', f.path('threads'));
  for (const action of ['add', 'remove']) {
    const ops = read(f.path('second')).operations.filter((o) => o.action === action);
    recordReceipt(f, f.path('second'), ops, '--begin'); recordReceipt(f, f.path('second'), ops);
  }
}
test('older duplicate confirmation and recovery cannot replay over a later merge', () => {
  const f = fixture(), add = f.ops().filter((o) => o.action === 'add');
  f.pass(add, '--begin'); f.pass(add);
  finishMerge(f, 'Filed/Child', 'New');
  const snapshot = readFileSync(f.path('threads'), 'utf8');
  assert.ok(!read(f.path('threads'))[0].labelIds.includes('Filed/Child'));
  f.pass(add); f.ok('record', '--receipt', f.path('receipt'), '--recover');
  assert.equal(readFileSync(f.path('threads'), 'utf8'), snapshot);
});
test('distinct receipts share a snapshot lock and recover both confirmed effects', () => {
  const f = fixture(), add = f.ops().filter((o) => o.action === 'add');
  f.pass(add, '--begin');
  mkdirSync(f.path('threads') + '.lock');
  try {
    assert.match(f.record(add).stderr, /locked/);
    f.ok('merge', '--threads', f.path('threads'), '--labels', f.path('labels'), '--from', 'Old', '--to', 'Filed',
      '--receipt', f.path('second'), '--update-threads', f.path('threads'));
    assert.throws(() => recordReceipt(f, f.path('second'), read(f.path('second')).operations, '--begin'), /locked/);
    assert.throws(() => recordReceipt(f, f.path('second'), read(f.path('second')).operations), /locked/);
    assert.equal(readFileSync(f.path('threads'), 'utf8'), f.original);
    assert.equal(f.ops()[0].status, 'confirmed');
    assert.equal(read(f.path('second')).operations[0].status, 'confirmed');
  } finally { rmdirSync(f.path('threads') + '.lock'); }
  f.ok('record', '--receipt', f.path('receipt'), '--recover');
  f.ok('record', '--receipt', f.path('second'), '--recover');
  const t = read(f.path('threads'))[0];
  assert.ok(t.labelIds.includes('Filed/Child') && !t.labelIds.includes('Label_old'));
});
test('pending snapshot image recovers before another receipt replays', () => {
  const f = fixture(), add = f.ops().filter((o) => o.action === 'add');
  f.pass(add, '--begin'); f.pass(add);
  const ledgerPath = f.path('threads') + '.receipt-state.json', ledger = read(ledgerPath);
  ledger.pending = read(f.path('threads')); write(ledgerPath, ledger);
  writeFileSync(f.path('threads'), f.original);
  finishMerge(f, 'Old', 'Filed');
  const t = read(f.path('threads'))[0];
  assert.ok(t.labelIds.includes('Filed/Child') && !t.labelIds.includes('Label_old'));
  assert.equal(read(ledgerPath).pending, undefined);
});
for (const firstOutcome of ['timeout', 'no-effect']) {
  test('retry rejects stale ' + firstOutcome + ' and reconciliation envelopes', () => {
    const f = fixture(), original = f.ops().filter((o) => o.action === 'add');
    f.pass(original, '--begin');
    f.pass(original, null, firstOutcome === 'timeout' ? 'unknown' : 'failed', firstOutcome);
    f.pass(original, '--reconcile', 'failed', 'read-absent'); f.pass(original, '--retry');
    const current = f.ops().filter((o) => o.action === 'add');
    assert.equal(current[0].attempt, 1);
    assert.notEqual(f.record(original, '--begin').status, 0);
    f.pass(current, '--begin');
    const before = readFileSync(f.path('receipt'), 'utf8');
    assert.match(f.record(original, '--reconcile', 'failed', 'read-absent').stderr, /stale operation attempt/);
    assert.match(f.record(original, null, firstOutcome === 'timeout' ? 'unknown' : 'failed', firstOutcome).stderr, /stale operation attempt/);
    assert.equal(readFileSync(f.path('receipt'), 'utf8'), before);
    f.pass(current); f.pass(current);
    assert.equal(f.ops()[0].status, 'confirmed');
  });
}
for (const target of ['Filed', 'New']) {
  test('merge INBOX undo restores membership with target ' + target, () => {
    const f = fixture(); finishMerge(f, 'INBOX', target);
    const undo = f.ok('undo', '--receipt', f.path('second'));
    assert.match(undo, /INBOX/); assert.match(undo, /ADD it back to exactly these thread ids:/);
    assert.ok(!read(f.path('threads'))[0].labelIds.includes('INBOX'));
  });
}

for (const kind of ['apply', 'merge']) {
  test(kind + ': restored older snapshot cannot reuse an applied-operation ledger', () => {
    const f = fixture(kind), add = f.ops().filter((o) => o.action === 'add');
    f.pass(add, '--begin'); f.pass(add);
    const removal = f.ops().filter((o) => o.action === 'remove');
    f.pass(removal, '--begin');
    renameSync(f.path('threads'), f.path('saved'));
    assert.match(f.record(removal).stderr, /receipt preserved; snapshot replay incomplete/);
    writeFileSync(f.path('threads'), f.original);
    const ledgerPath = f.path('threads') + '.receipt-state.json';
    const ledger = readFileSync(ledgerPath, 'utf8');
    const recovery = f.run('record', '--receipt', f.path('receipt'), '--recover');
    assert.notEqual(recovery.status, 0);
    assert.match(recovery.stderr, /snapshot does not match its application ledger; reconcile/);
    assert.doesNotMatch(recovery.stdout, /incomplete=0/);
    assert.equal(readFileSync(f.path('threads'), 'utf8'), f.original);
    assert.equal(readFileSync(ledgerPath, 'utf8'), ledger);
    renameSync(f.path('saved'), f.path('threads'));
    f.ok('record', '--receipt', f.path('receipt'), '--recover');
    const t = read(f.path('threads'))[0];
    assert.ok(t.labelIds.includes('Filed/Child'));
    assert.ok(!t.labelIds.includes(kind === 'apply' ? 'INBOX' : 'Label_old'));
  });
}
for (const label of ['constructor', 'toString', '__proto__']) {
  test('confirmed removal recognizes literal label ' + label, () => {
    const f = fixture();
    write(f.path('literal'), [{ id: 't', labelIds: [label, 'Label_new', 'New'] }]);
    write(f.path('literal-labels'), { labels: [{ id: 'Label_new', name: 'New' }] });
    f.ok('merge', '--threads', f.path('literal'), '--labels', f.path('literal-labels'),
      '--from', label, '--to', 'New', '--receipt', f.path('literal-receipt'), '--update-threads', f.path('literal'));
    const receiptPath = f.path('literal-receipt'), operations = read(receiptPath).operations;
    assert.deepEqual(operations.map(({ action, label }) => ({ action, label })), [{ action: 'remove', label }]);
    recordReceipt(f, receiptPath, operations, '--begin'); recordReceipt(f, receiptPath, operations);
    const result = read(f.path('literal'));
    assert.deepEqual(result[0].labelIds, ['Label_new', 'New']);
    recordReceipt(f, receiptPath, operations);
    f.ok('record', '--receipt', receiptPath, '--recover');
    assert.deepEqual(read(f.path('literal')), result);
  });
}

for (const kind of ['apply', 'merge']) {
  test(kind + ': refreshed snapshot refuses preparation before creating an unusable receipt', () => {
    const f = fixture(kind);
    for (const action of ['add', 'remove']) {
      const ops = f.ops().filter((o) => o.action === action);
      f.pass(ops, '--begin'); f.pass(ops);
    }
    const oldReceipt = readFileSync(f.path('receipt'), 'utf8');
    const ledgerPath = f.path('threads') + '.receipt-state.json';
    const oldLedger = readFileSync(ledgerPath, 'utf8');
    write(f.path('raw'), { threads: JSON.parse(f.original).map((t) => ({ id: t.id, messages: [{ sender: t.from, subject: t.subject, labelIds: t.labelIds }] })) });
    const ingest = (target) => f.ok('ingest', '--inbox', f.path('raw'), '--labels', f.path('labels'), '--out-threads', target, '--out-labels', f.path('fresh-labels'));
    ingest(f.path('threads'));
    const fresh = readFileSync(f.path('threads'), 'utf8');
    const prepare = (snapshot, receipt) => {
      if (kind === 'merge') return f.run('merge', '--threads', snapshot, '--labels', f.path('labels'), '--from', 'Old', '--to', 'Filed/Child', '--receipt', receipt, '--update-threads', snapshot);
      f.ok('plan', '--threads', snapshot, '--labels', f.path('labels'), '--rules', f.path('rules'), '--out', f.path('fresh-plan'));
      return f.run('apply', '--plan', f.path('fresh-plan'), '--receipt', receipt, '--update-threads', snapshot);
    };
    const rejected = prepare(f.path('threads'), f.path('unusable'));
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /no run prepared.*ingest --out-threads <new-unused-path>/);
    assert.throws(() => readFileSync(f.path('unusable')), /ENOENT/);
    assert.equal(readFileSync(f.path('threads'), 'utf8'), fresh);
    assert.equal(readFileSync(ledgerPath, 'utf8'), oldLedger);
    assert.equal(readFileSync(f.path('receipt'), 'utf8'), oldReceipt);
    ingest(f.path('fresh'));
    const prepared = prepare(f.path('fresh'), f.path('new-receipt'));
    assert.equal(prepared.status, 0, prepared.stderr);
    const next = read(f.path('new-receipt'));
    const outcomes = next.operations.filter((o) => o.action === 'add').map(({ id, threadId, action, label }) => ({ id, threadId, action, label }));
    write(f.path('new-outcomes'), { runId: next.runId, outcomes });
    f.ok('record', '--receipt', f.path('new-receipt'), '--outcomes', f.path('new-outcomes'), '--begin');
    write(f.path('new-outcomes'), { runId: next.runId, outcomes: outcomes.map((o) => ({ ...o, status: 'confirmed', evidence: 'success' })) });
    f.ok('record', '--receipt', f.path('new-receipt'), '--outcomes', f.path('new-outcomes'));
    assert.ok(read(f.path('fresh'))[0].labelIds.includes('Filed/Child'));
  });
}

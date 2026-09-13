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
    write(path('outcomes'), { runId: receipt().runId, outcomes: operations.map(({ id, threadId, action, label }) => ({ id, threadId, action, label, ...(mode === '--begin' || mode === '--retry' ? {} : { status, evidence }) })), ...overrides });
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
    f.pass(add, '--retry'); f.pass(add, '--begin'); f.pass(add, '--reconcile', 'confirmed', 'read-present');
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

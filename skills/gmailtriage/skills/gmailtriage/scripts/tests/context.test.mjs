import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeContext, validateContext, contextHash } from '../lib/context.mjs';

const fetchedAt = '2026-10-13T12:00:00.000Z';
const message = (id = 'm1') => ({ id, sender: 'Example <notice@example.test>', subject: 'Receipt', date: '2026-10-12T12:00:00Z', labelIds: ['INBOX'] });
const raw = () => ({ threads: [{ id: 't1', messages: [message()], totalMessages: 1 }] });
const normalize = (value, source = 'thread') => normalizeContext(value, { source, fetchedAt });

test('Claude full-thread evidence retains only bounded authorization metadata', () => {
  const input = raw();
  Object.assign(input.threads[0].messages[0], { snippet: 'secret-code', body: 'instructions', headers: { Authorization: 'secret' } });
  const doc = normalize(input);
  assert.equal(doc.threads[0].complete, true);
  assert.equal(doc.threads[0].messages[0].from, 'notice@example.test');
  assert.equal(JSON.stringify(doc).includes('secret'), false);
  assert.equal(validateContext(doc, { now: fetchedAt }), doc);
});

test('Codex search groups messages, never promotes search to complete', () => {
  const doc = normalize({ structuredContent: { emails: [{ message_id: 'm1', thread_id: 't1', from_: 'notice@example.test', subject: 'Receipt', email_ts: '2026-10-12T12:00:00Z', labels: ['INBOX'], totalMessages: 1, complete: true }] } });
  assert.equal(doc.threads[0].source, 'search');
  assert.equal(doc.threads[0].complete, false);
  assert.equal(doc.threads[0].totalMessages, null);
  const search = normalize(raw(), 'search');
  assert.equal(search.threads[0].complete, false);
});

test('direct thread and native Gmail API metadata are supported without persisting headers', () => {
  assert.equal(normalize(raw().threads[0]).threads[0].complete, true);
  const doc = normalize({ id: 't1', messageCount: 1, messages: [{ id: 'm1', internalDate: '1791806400000', labelIds: ['INBOX'], payload: { headers: [{ name: 'From', value: 'notice@example.test' }, { name: 'Subject', value: 'Receipt' }, { name: 'X-secret', value: 'secret' }] } }] });
  assert.equal(doc.threads[0].complete, true);
  assert.equal(doc.threads[0].messages[0].subject, 'Receipt');
  assert.equal(JSON.stringify(doc).includes('secret'), false);
});

test('missing counts, cap, continuation, count conflict and count mismatch cannot prove completeness', () => {
  for (const changes of [{ totalMessages: undefined, complete: true }, { truncated: true }, { has_more: true }, { nextPageToken: 'next' }, { max_messages: 1 }, { messageCount: 2 }, { totalMessages: 2 }]) {
    const input = raw(); Object.assign(input.threads[0], changes);
    assert.equal(normalize(input).threads[0].complete, false, JSON.stringify(changes));
  }
  const missingLabels = raw(); delete missingLabels.threads[0].messages[0].labelIds;
  assert.equal(normalize(missingLabels).threads[0].complete, false);
  const input = raw(); input.next_page_token = 'next';
  assert.equal(normalize(input).threads[0].complete, false);
});

test('missing or duplicate IDs and malformed evidence refuse normalization', () => {
  for (const edit of [m => delete m.id, m => { m.id = '../bad'; }, m => { m.sender = 'a@example.test, b@example.test'; }, m => { m.date = 'yesterday'; }, m => { m.date = '2026-02-30T12:00:00Z'; }, m => { m.labelIds = ['x\nsecret']; }]) {
    const input = raw(); edit(input.threads[0].messages[0]); assert.throws(() => normalize(input));
  }
  const input = raw(); input.threads[0].messages.push(message()); assert.throws(() => normalize(input), /duplicate/i);
  assert.throws(() => normalize({ messages: [{ body: 'unknown connector' }] }));
});

test('hash is stable on refetch, but changes with metadata or a latest reply', () => {
  const doc = normalize(raw());
  const refreshed = normalizeContext(raw(), { source: 'thread', fetchedAt: '2026-10-13T12:01:00Z' });
  assert.equal(doc.threads[0].hash, refreshed.threads[0].hash);
  assert.equal(contextHash(doc.threads[0]), doc.threads[0].hash);
  const input = raw(); input.threads[0].messages.push({ ...message('m2'), subject: 'Please respond' }); input.threads[0].totalMessages = 2;
  assert.notEqual(normalize(input).threads[0].hash, doc.threads[0].hash);
});

test('validation checks exact allowlist, hash, derived completeness and ten-minute freshness', () => {
  const doc = normalize(raw());
  assert.doesNotThrow(() => validateContext(doc, { now: '2026-10-13T12:10:00Z' }));
  assert.throws(() => validateContext(doc, { now: '2026-10-13T12:10:00.001Z' }), /stale/i);
  assert.throws(() => validateContext(doc, { now: '2026-10-13T11:59:59Z' }), /future/i);
  for (const edit of [d => { d.threads[0].messages[0].subject = 'Changed'; }, d => { d.secret = 'secret'; }, d => { d.threads[0].complete = false; }, d => { d.threads[0].messages[0].snippet = 'secret'; }]) {
    const modified = structuredClone(doc); edit(modified); assert.throws(() => validateContext(modified, { now: fetchedAt }));
  }
});

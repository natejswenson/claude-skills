/** Allowlisted authorization metadata from known native Gmail response shapes. */
import { createHash } from 'node:crypto';
import { resolveSender } from './sender.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = reason => { throw new Error(`context: ${reason}`); };
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(value);
const controls = /[\x00-\x1f\x7f-\x9f\u2028\u2029]/;
const keys = (value, allowed) => object(value) && Object.keys(value).length === allowed.length && Object.keys(value).every(key => allowed.includes(key));
const array = (value, max, what) => { if (!Array.isArray(value) || value.length > max) fail(`invalid or unbounded ${what}`); return value; };
const timestamp = value => {
  if (typeof value !== 'string' || value.length > 100 || controls.test(value) || !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value) || !Number.isFinite(Date.parse(value))) fail('invalid date');
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const calendar = new Date(0); calendar.setUTCFullYear(year, month - 1, day);
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) fail('invalid calendar date');
  return new Date(value).toISOString();
};
const labels = value => {
  const result = array(value, 100, 'labels');
  if (result.some(label => !id(label)) || new Set(result).size !== result.length) fail('invalid labels');
  return [...result].sort();
};
const subject = value => { if (typeof value !== 'string' || value.length > 1000 || controls.test(value)) fail('invalid subject'); return value; };
const sender = (...values) => { const resolved = resolveSender(...values); if (!resolved.address) fail('missing or ambiguous sender'); return resolved.address; };
const nativeCount = (...sources) => {
  const counts = sources.flatMap(source => ['totalMessages', 'messagesTotal', 'messageCount'].filter(key => source?.[key] !== undefined).map(key => source[key]));
  if (!counts.length || counts.some(count => !Number.isSafeInteger(count) || count < 1 || count > 1000) || new Set(counts).size !== 1) return null;
  return counts[0];
};
// The connector may return only recent messages. A declared cap is conservative:
// an unexplained cap cannot be treated as evidence that the thread is exhausted.
const partial = value => ['truncated', 'isTruncated', 'hasMore', 'has_more', 'nextPageToken', 'next_page_token', 'continuation', 'max_messages', 'maxMessages', 'limit'].some(key => value?.[key] !== undefined && value[key] !== null && value[key] !== false);
const complete = thread => thread.source === 'thread' && Number.isSafeInteger(thread.totalMessages) && thread.totalMessages > 0 && thread.totalMessages === thread.messages.length;

/** Hash every authorization field, never wall-clock fetch time or the hash itself. */
export function contextHash(thread) {
  const metadata = { id: thread.id, messages: thread.messages.map(message => ({ id: message.id, from: message.from, subject: message.subject, date: message.date, labelIds: message.labelIds })), source: thread.source, totalMessages: thread.totalMessages, complete: thread.complete };
  return createHash('sha256').update(JSON.stringify(metadata)).digest('hex');
}

function nativeMessage(message) {
  if (!object(message) || !id(message.id)) fail('missing or malformed message id');
  let from, text, date;
  if (Object.hasOwn(message, 'internalDate') && object(message.payload) && Array.isArray(message.payload.headers)) {
    const headers = array(message.payload.headers, 200, 'headers');
    const header = name => headers.filter(h => object(h) && typeof h.name === 'string' && h.name.toLowerCase() === name).map(h => h.value);
    const fromHeaders = header('from'), subjects = header('subject');
    if (!fromHeaders.length || subjects.length !== 1) fail('missing or conflicting native headers');
    from = sender(...fromHeaders.map(value => ({ from: value })), { from: message.from }, { from: message.sender }, message.senderAmbiguous === undefined ? {} : { senderAmbiguous: message.senderAmbiguous });
    text = subject(subjects[0]);
    if (!(typeof message.internalDate === 'string' && /^\d{1,16}$/.test(message.internalDate)) && !Number.isSafeInteger(message.internalDate)) fail('invalid native date');
    const millis = Number(message.internalDate);
    if (!Number.isSafeInteger(millis) || millis < 0 || !Number.isFinite(new Date(millis).getTime())) fail('invalid native date');
    date = new Date(millis).toISOString();
  } else {
    from = sender({ from: message.sender }, { from: message.from }, message.senderAmbiguous === undefined ? {} : { senderAmbiguous: message.senderAmbiguous });
    text = subject(message.subject);
    date = timestamp(message.date);
  }
  return { id: message.id, from, subject: text, date, labelIds: labels(message.labelIds ?? []) };
}

/** Unknown connector MIME shapes deliberately refuse rather than guessing. */
export function normalizeContext(raw, { source, fetchedAt = new Date().toISOString() } = {}) {
  if (!['thread', 'search'].includes(source)) fail('source must be thread or search');
  if (!object(raw)) fail('unsupported host response');
  const envelope = object(raw.structuredContent) ? raw.structuredContent : raw;
  let nativeThreads;
  if (Array.isArray(envelope.emails)) {
    const grouped = new Map();
    for (const email of array(envelope.emails, 10000, 'emails')) {
      if (!object(email) || !id(email.thread_id) || !id(email.id ?? email.message_id) || (email.id !== undefined && email.message_id !== undefined && email.id !== email.message_id)) fail('missing or conflicting Codex ids');
      const entry = grouped.get(email.thread_id) ?? { id: email.thread_id, messages: [] };
      entry.messages.push({ id: email.id ?? email.message_id, sender: email.from_, from: email.from, subject: email.subject, date: email.email_ts, labelIds: email.labels ?? [], ...(email.senderAmbiguous === undefined ? {} : { senderAmbiguous: email.senderAmbiguous }) });
      grouped.set(email.thread_id, entry);
    }
    nativeThreads = [...grouped.values()];
    source = 'search';
  } else if (Array.isArray(envelope.threads)) nativeThreads = envelope.threads;
  else if (id(envelope.id) && Array.isArray(envelope.messages)) nativeThreads = [envelope];
  else fail('unsupported host response');
  const seenThreads = new Set(), seenMessages = new Set();
  let messageTotal = 0;
  const threads = array(nativeThreads, 1000, 'threads').map(thread => {
    if (!object(thread) || !id(thread.id) || seenThreads.has(thread.id)) fail('missing or duplicate thread id');
    seenThreads.add(thread.id);
    const messages = array(thread.messages, 1000, 'messages').map(nativeMessage);
    messageTotal += messages.length;
    if (messageTotal > 10000) fail('unbounded messages');
    for (const message of messages) {
      if (seenMessages.has(message.id)) fail('duplicate message id');
      seenMessages.add(message.id);
    }
    const totalMessages = partial(raw) || partial(envelope) || partial(thread) || thread.messages.some(message => !Array.isArray(message.labelIds)) ? null : nativeCount(thread);
    const normalized = { id: thread.id, messages, source, totalMessages, complete: false };
    normalized.complete = complete(normalized);
    normalized.hash = contextHash(normalized);
    return normalized;
  });
  return { version: 1, fetchedAt: timestamp(fetchedAt), threads };
}

/** Validate persisted evidence, including derived flags and bounded freshness. */
export function validateContext(doc, { now = Date.now() } = {}) {
  if (!keys(doc, ['version', 'fetchedAt', 'threads']) || doc.version !== 1 || timestamp(doc.fetchedAt) !== doc.fetchedAt) fail('invalid context schema');
  const current = typeof now === 'number' ? now : Date.parse(now);
  if (!Number.isFinite(current)) fail('invalid current time');
  const age = current - Date.parse(doc.fetchedAt);
  if (age < 0) fail('future fetch time');
  if (age > 10 * 60 * 1000) fail('stale context; fetch again');
  const seenThreads = new Set(), seenMessages = new Set();
  let messageTotal = 0;
  for (const thread of array(doc.threads, 1000, 'threads')) {
    if (!keys(thread, ['id', 'messages', 'source', 'totalMessages', 'complete', 'hash']) || !id(thread.id) || seenThreads.has(thread.id) || !['thread', 'search'].includes(thread.source) || !(thread.totalMessages === null || Number.isSafeInteger(thread.totalMessages) && thread.totalMessages > 0 && thread.totalMessages <= 1000) || typeof thread.complete !== 'boolean') fail('invalid thread schema');
    seenThreads.add(thread.id);
    for (const message of array(thread.messages, 1000, 'messages')) {
      if (!keys(message, ['id', 'from', 'subject', 'date', 'labelIds']) || !id(message.id) || seenMessages.has(message.id)) fail('invalid or duplicate message');
      seenMessages.add(message.id);
      if (sender(message) !== message.from || timestamp(message.date) !== message.date) fail('noncanonical metadata');
      subject(message.subject);
      if (JSON.stringify(labels(message.labelIds)) !== JSON.stringify(message.labelIds)) fail('noncanonical labels');
    }
    messageTotal += thread.messages.length;
    if (messageTotal > 10000) fail('unbounded messages');
    if (thread.complete !== complete(thread)) fail('invalid completeness');
    if (typeof thread.hash !== 'string' || !/^[a-f0-9]{64}$/.test(thread.hash) || thread.hash !== contextHash(thread)) fail('metadata hash mismatch');
  }
  return doc;
}

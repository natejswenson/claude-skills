/** Durable authorization and host-reported effects. No Gmail credentials or calls. */
import { normaliseLabel } from './rules.mjs';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, mkdirSync, rmdirSync } from 'node:fs';

export function pendingReceipt(entries, { at, snapshot = null, labelIndex = {} } = {}) {
  const operations = [];
  for (const e of entries) {
    const adds = [];
    const add = (action, label, requires = []) => {
      const id = createHash('sha256').update(JSON.stringify([e.threadId, action, label])).digest('hex').slice(0, 24);
      if (operations.some((o) => o.id === id)) throw new Error('duplicate authorized operation');
      operations.push({ id, threadId: e.threadId, action, label, requires, status: 'pending', evidence: null });
      return id;
    };
    if (e.action === 'trash') add('trash', null);
    for (const label of e.added ?? []) adds.push(add('add', label));
    for (const label of [...(e.removed ?? []), ...(e.archived ? ['INBOX'] : [])]) add('remove', label, [...adds]);
  }
  return { version: 2, runId: randomUUID(), revision: 0, at, count: entries.length, entries, operations, snapshot, labelIndex };
}

export function checkReceipt(r) {
  if (r.version === undefined) return false;
  if (r.version !== 2 || !Array.isArray(r.operations)) throw new Error('unsupported receipt version');
  return true;
}
export const counts = (r) => {
  checkReceipt(r);
  const c = { confirmed: 0, pending: 0, failed: 0, unknown: 0 };
  for (const o of r.operations) c[o.status]++;
  return { ...c, affectedThreads: new Set(r.operations.filter((o) => o.status === 'confirmed').map((o) => o.threadId)).size,
    incomplete: c.pending + c.failed + c.unknown };
};
export const summary = (r) => {
  const c = counts(r);
  return `confirmed=${c.confirmed} affectedThreads=${c.affectedThreads} pending=${c.pending} failed=${c.failed} unknown=${c.unknown} incomplete=${c.incomplete}`;
};
const ready = (r, o) => o.requires.every((id) => r.operations.find((x) => x.id === id)?.status === 'confirmed');
export const dispatchable = (r) => r.operations.filter((o) => o.status === 'pending' && ready(r, o));

/** Validate a whole batch against the persisted revision before changing anything. */
export function transition(receipt, envelope, mode = 'outcome') {
  if (!checkReceipt(receipt)) throw new Error('legacy: execution evidence unavailable; cannot record outcomes');
  if (envelope.runId !== receipt.runId || !Array.isArray(envelope.outcomes)) throw new Error('outcomes require matching runId and outcomes array');
  const next = structuredClone(receipt);
  const seen = new Map();
  for (const x of envelope.outcomes) {
    if (!x || Object.keys(x).some((k) => !['id', 'threadId', 'action', 'label', 'status', 'evidence', 'attempt'].includes(k))) throw new Error('unsupported outcome fields');
    const o = receipt.operations.find((v) => v.id === x.id);
    if (!o || ['threadId', 'action', 'label'].some((k) => x[k] !== o[k])) throw new Error('unauthorized operation tuple');
    if ((x.attempt ?? 0) !== (o.attempt ?? 0)) throw new Error('stale operation attempt; read the current receipt');
    const signature = JSON.stringify([x.status ?? null, x.evidence ?? null]);
    if (seen.has(x.id) && seen.get(x.id) !== signature) throw new Error('contradictory duplicate outcomes');
    seen.set(x.id, signature);
  }
  for (const [id] of seen) {
    const x = envelope.outcomes.find((v) => v.id === id);
    const o = next.operations.find((v) => v.id === id);
    const previous = receipt.operations.find((v) => v.id === id);
    let status, evidence;
    if (mode === 'begin') {
      if (o.status !== 'pending' || !ready(receipt, o)) throw new Error('begin requires pending operation and confirmed prerequisites');
      status = 'unknown'; evidence = 'attempt-started';
    } else if (mode === 'retry') {
      if (o.status !== 'failed' || o.evidence !== 'read-absent') throw new Error('retry requires fresh no-effect reconciliation');
      status = 'pending'; evidence = null;
      o.attempt = (o.attempt ?? 0) + 1;
    } else {
      status = x.status; evidence = x.evidence;
      const permitted = mode === 'reconcile'
        ? { confirmed: ['read-present'], failed: ['read-absent'] }
        : { confirmed: ['success'], failed: ['no-effect'], unknown: ['timeout', 'ambiguous'] };
      if (!permitted[status]?.includes(evidence)) throw new Error('unsupported status/evidence');
      if (o.status === status && o.evidence === evidence) continue;
      if (o.status === 'confirmed' || (mode === 'reconcile' ? !['unknown', 'failed'].includes(o.status) : o.status !== 'unknown' || o.evidence !== 'attempt-started')) {
        throw new Error('outcome requires begun operation; uncertainty requires reconciliation');
      }
      if (status === 'confirmed' && !ready(receipt, previous)) throw new Error('confirmation requires confirmed prerequisites');
    }
    o.status = status; o.evidence = evidence;
  }
  if (JSON.stringify(next.operations) !== JSON.stringify(receipt.operations)) next.revision++;
  return next;
}

/** Only confirmed memberships justify replay; apply each effect idempotently. */
export function replay(r, snapshot) {
  const confirmed = r.operations.filter((o) => o.status === 'confirmed');
  return snapshot.filter((t) => !confirmed.some((o) => o.threadId === t.id && o.action === 'trash')).map((t) => {
    const ops = confirmed.filter((o) => o.threadId === t.id && o.action !== 'trash');
    if (!ops.length) return t;
    const change = (labels, ids) => {
      let result = [...(labels ?? [])];
      for (const o of ops) {
        const name = (v) => ids ? (r.labelIndex[v] ?? v) : v;
        if (o.action === 'add' && !result.some((v) => normaliseLabel(name(v)) === normaliseLabel(o.label))) result.push(o.label);
        if (o.action === 'remove') result = result.filter((v) => normaliseLabel(name(v)) !== normaliseLabel(o.label));
      }
      return [...new Set(result)];
    };
    return { ...t, labelIds: change(t.labelIds, true), ...(Array.isArray(t.labels) && t.labels.length ? { labels: change(t.labels, false) } : {}) };
  });
}

export function confirmedEntries(r) {
  if (!checkReceipt(r)) return r.entries ?? [];
  return r.entries.flatMap((e) => {
    const ops = r.operations.filter((o) => o.threadId === e.threadId && o.status === 'confirmed');
    if (!ops.length) return [];
    return [{ ...e, added: ops.filter((o) => o.action === 'add').map((o) => o.label),
      removed: ops.filter((o) => o.action === 'remove' && (e.action === 'unlabel' || o.label !== 'INBOX')).map((o) => o.label),
      archived: ops.some((o) => o.action === 'remove' && o.label === 'INBOX') }];
  });
}

/** A stale lock is deliberately not stolen: reconcile writer ownership first. */
export function withReceiptLock(path, callback) {
  const lock = path + '.lock';
  try { mkdirSync(lock, { mode: 0o700 }); }
  catch { throw new Error('receipt locked; reconcile writer ownership before recovery'); }
  try { return callback(JSON.parse(readFileSync(path, 'utf8'))); }
  finally { rmdirSync(lock); }
}

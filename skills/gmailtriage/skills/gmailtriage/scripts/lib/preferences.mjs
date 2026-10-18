/** Preference authority is explicit; native-agent classification is evidence, never authority. */
import { createHash } from 'node:crypto';
import { plan, hasProtectedSubject, isProtected, isSentOnly } from './plan.mjs';
import { matches, validateRuleSet, validateDestination, normaliseLabel, labelPath } from './rules.mjs';
import { parseAddress, resolveSender } from './sender.mjs';
import { validateContext, contextHash } from './context.mjs';

export const PURPOSES = ['promotion', 'receipt', 'delivery', 'newsletter', 'notification', 'personal', 'security', 'recruiting', 'finance', 'medical', 'education', 'unknown'];
const ATTENTION = ['routine', 'action-needed', 'unknown'];
const SENSITIVE = new Set(['personal', 'security', 'recruiting', 'finance', 'medical', 'education', 'receipt']);
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const controls = /[\x00-\x1f\x7f-\x9f\u2028\u2029]/;
const text = (v, max = 500) => typeof v === 'string' && v.trim().length > 0 && v.length <= max && !controls.test(v);
const id = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(v);
const hash = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const fail = reason => { throw new Error(`preferences: ${reason}`); };
const keys = (v, allowed, required = allowed) => object(v) && Object.keys(v).every(k => allowed.includes(k)) && required.every(k => Object.hasOwn(v, k));
const array = (v, max, what) => { if (!Array.isArray(v) || v.length > max) fail(`invalid or unbounded ${what}`); return v; };
const time = value => {
  const n = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(n)) fail('invalid current time');
  return n;
};
const iso = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
// Sorted object keys permit harmless file reformatting, but array order remains bound.
const canonical = value => Array.isArray(value) ? value.map(canonical) : object(value)
  ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
const fingerprint = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

function validatePolicy(policy) {
  if (!keys(policy, ['id', 'purpose', 'label', 'archive', 'fromAddress', 'note'], ['id', 'purpose', 'label', 'archive', 'note'])
    || typeof policy.id !== 'string' || !/^[a-z0-9][a-z0-9-]{1,39}$/.test(policy.id)
    || !PURPOSES.includes(policy.purpose) || policy.purpose === 'unknown'
    || typeof policy.archive !== 'boolean' || !text(policy.note, 500) || policy.note.trim().length < 4
    || !text(policy.label, 225) || policy.label !== policy.label.trim()) fail('invalid policy schema, purpose, label or note');
  validateDestination(policy.label, 'preference');
  // Every parent is applied too: a destructive system parent is equally forbidden.
  for (const part of policy.label.split('/')) validateDestination(part, 'preference label segment');
  if (Object.hasOwn(policy, 'fromAddress') && (!parseAddress(policy.fromAddress) || policy.fromAddress.includes('*') || parseAddress(policy.fromAddress).address !== policy.fromAddress)) fail('fromAddress must be an exact canonical sender mailbox');
}

/** Return the original validated document; approvedAt null is an inert candidate. */
export function validatePreferences(doc) {
  if (!keys(doc, ['version', 'mode', 'approvedAt', 'policies']) || doc.version !== 1
    || !['preview', 'auto-file'].includes(doc.mode) || !(doc.approvedAt === null || iso(doc.approvedAt))) fail('invalid preference schema or approval');
  const seen = new Set();
  for (const policy of array(doc.policies, 100, 'policies')) {
    validatePolicy(policy);
    if (seen.has(policy.id)) fail('duplicate policy id');
    seen.add(policy.id);
  }
  return doc;
}

function labelMetadata(doc) {
  const list = Array.isArray(doc) ? doc : doc?.labels;
  const index = new Map(), names = new Map();
  for (const l of array(list, 10000, 'labels')) {
    if (!object(l) || !id(l.id) || !text(l.name, 225) || index.has(l.id) || names.has(normaliseLabel(l.name))) fail('invalid or duplicate label metadata');
    index.set(l.id, l.name);
    names.set(normaliseLabel(l.name), l.name);
  }
  return { index, names };
}

function decisionMetadata(doc) {
  if (!keys(doc, ['version', 'decisions']) || doc.version !== 1) fail('invalid decisions schema');
  const result = new Map();
  for (const d of array(doc.decisions, 1000, 'decisions')) {
    if (!keys(d, ['threadId', 'contextHash', 'messages']) || !id(d.threadId) || !hash(d.contextHash) || result.has(d.threadId)) fail('invalid or duplicate thread decision');
    for (const m of array(d.messages, 1000, 'decision messages')) {
      if (!keys(m, ['messageId', 'purpose', 'attention']) || !id(m.messageId) || !PURPOSES.includes(m.purpose) || !ATTENTION.includes(m.attention)) fail('invalid message decision');
    }
    result.set(d.threadId, d);
  }
  return result;
}

function approvalMetadata(doc) {
  if (!keys(doc, ['version', 'approvals']) || doc.version !== 1) fail('invalid approvals schema');
  const result = new Map();
  for (const a of array(doc.approvals, 1000, 'approvals')) {
    if (!keys(a, ['threadId', 'contextHash', 'action']) || !id(a.threadId) || !hash(a.contextHash) || a.action !== 'trash' || result.has(a.threadId)) fail('invalid or duplicate exact trash approval');
    result.set(a.threadId, a);
  }
  return result;
}

const emptyApprovals = () => ({ version: 1, approvals: [] });
const bindings = inputs => Object.fromEntries(['preferences', 'decisions', 'context', 'rules', 'labels', 'threads', 'approvals'].map(k => [k, fingerprint(k === 'approvals' ? inputs.approvals ?? emptyApprovals() : inputs[k])]));
const actionableSubject = /\b(action required|action needed|reply needed|response required|reply requested|response requested|please (?:respond|reply|confirm|approve|sign|complete|submit)|past due|overdue|payment failed|security alert|suspicious (?:activity|login)|appointment|interview|deadline)\b/i;
const securitySubject = /\b(multifactor|two[- ]factor|2fa|mfa|password|sign[- ]?in)\b|\b(access|security|verification|confirmation|one[- ]time) code\b|\bverify your\b|\bconfirm your email\b/i;
const financialSubject = /\b(receipt|invoice|statement)\b/i;
const messageInbox = (message, index) => message.labelIds.some(l => (index.get(l) ?? l).toUpperCase() === 'INBOX');

/** Merge conservatively validated semantic actions into the unchanged explicit-rule plan. */
export function triagePlan(inputs) {
  const { threads, rules, labels, preferences, context, decisions, approvals = emptyApprovals(), now = new Date() } = inputs;
  const current = time(now);
  validatePreferences(preferences);
  if (preferences.approvedAt !== null && Date.parse(preferences.approvedAt) > current) fail('future preference approval');
  validateContext(context, { now: current });
  validateRuleSet(rules);
  const { index, names } = labelMetadata(labels);
  const decisionIndex = decisionMetadata(decisions), approvalIndex = approvalMetadata(approvals);
  const seen = new Set();
  for (const t of array(threads, 1000, 'threads')) {
    if (!object(t) || !id(t.id) || seen.has(t.id)) fail('invalid or duplicate snapshot thread');
    seen.add(t.id);
  }
  const contexts = new Map(context.threads.map(t => [t.id, t]));
  const p = plan(threads, rules, { now: new Date(current), labelIndex: index });
  p.semantic = { version: 1, bindings: bindings(inputs), plannedAt: new Date(current).toISOString() };
  p.review = [];
  p.proposed = [];
  const excluded = new Set(p.excluded.map(t => t.threadId));
  for (const t of threads) {
    if (excluded.has(t.id) || isSentOnly(t)) continue;
    const c = contexts.get(t.id);
    // An explicit opinion about any observed message blocks model reinterpretation.
    const explicitSources = [t, ...(c?.messages ?? []).map(m => ({ ...t, ...m }))];
    if (rules.rules.some(r => explicitSources.some(s => matches(r, s, new Date(current), { ignoreFiled: true })))) continue;
    const review = (reason, purpose, policyId) => p.review.push({ threadId: t.id, reason, ...(purpose ? { purpose } : {}), ...(policyId ? { policyId } : {}) });
    if (!c || c.messages.length === 0) { review('missing-context'); continue; }
    const sender = resolveSender(t);
    const ordered = [...c.messages].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    if (!sender.address || sender.address !== ordered[0].from) { review('uncertain-sender'); continue; }
    if (c.messages.some(m => Date.parse(m.date) > Date.parse(context.fetchedAt)
      || m.labelIds.some(l => ['TRASH', 'SPAM', 'DRAFT', 'DRAFTS'].includes((index.get(l) ?? l).toUpperCase())))) { review('conflicting-context'); continue; }
    const d = decisionIndex.get(t.id);
    if (!d) { review('missing-decision'); continue; }
    if (d.contextHash !== c.hash || d.contextHash !== contextHash(c)) { review('stale-decision'); continue; }
    const messageIds = new Set(d.messages.map(m => m.messageId));
    if (d.messages.length !== c.messages.length || messageIds.size !== d.messages.length || c.messages.some(m => !messageIds.has(m.id))) { review('incomplete-decision'); continue; }
    const purposes = new Set(d.messages.map(m => m.purpose));
    if (purposes.has('unknown')) { review('unknown-purpose'); continue; }
    if (purposes.size !== 1) { review('mixed-purpose'); continue; }
    const purpose = d.messages[0].purpose;
    const matchingPolicies = preferences.policies.filter(pol => pol.purpose === purpose && (!pol.fromAddress || c.messages.every(m => m.from === pol.fromAddress)));
    // A reviewed sender-specific correction outranks a broad purpose policy.
    const exactPolicies = matchingPolicies.filter(pol => pol.fromAddress);
    const applicable = exactPolicies.length ? exactPolicies : matchingPolicies;
    if (applicable.length > 1) { review('conflicting-policies', purpose); continue; }
    const approval = approvalIndex.get(t.id);
    let actualPath = null, have = null;
    if (applicable.length === 1) {
      const path = labelPath(applicable[0].label);
      if (path.every(name => names.has(normaliseLabel(name)))) {
        actualPath = path.map(name => names.get(normaliseLabel(name)));
        const messageLabels = c.messages.map(m => new Set(m.labelIds.map(l => normaliseLabel(index.get(l) ?? l))));
        const memberships = actualPath.map(name => messageLabels.map(h => h.has(normaliseLabel(name))));
        // Whole-thread operations cannot fill only missing messages, and whole-thread
        // undo would remove an older message's original label. Leave that split alone.
        if (memberships.some(values => values.some(Boolean) && !values.every(Boolean))) { review('mixed-label-membership', purpose, applicable[0].id); continue; }
        const snapshotLabels = new Set([...(t.labels ?? []), ...(t.labelIds ?? []).map(l => index.get(l) ?? l)].map(normaliseLabel));
        if (actualPath.some((name, i) => snapshotLabels.has(normaliseLabel(name)) !== memberships[i].some(Boolean))) { review('context-label-disagreement', purpose, applicable[0].id); continue; }
        have = new Set(actualPath.filter((_, i) => memberships[i].every(Boolean)).map(normaliseLabel));
      }
    }
    const inboxCount = c.messages.filter(m => messageInbox(m, index)).length;
    let unsafe = d.messages.some(m => m.attention === 'unknown') ? 'unknown-attention'
      : d.messages.some(m => m.attention === 'action-needed') ? 'needs-attention'
      : ['personal', 'security'].includes(purpose) || c.messages.some(m => securitySubject.test(m.subject) || actionableSubject.test(m.subject)) ? 'protected-message'
      : !['receipt', 'finance'].includes(purpose) && c.messages.some(m => financialSubject.test(m.subject)) ? 'conflicting-purpose'
      : new Set(c.messages.map(m => m.from)).size !== 1 ? 'mixed-senders'
      : !c.complete ? 'incomplete-context'
      : inboxCount === 0 ? 'conflicting-context'
      : inboxCount !== c.messages.length ? 'mixed-inbox-membership' : null;
    if (approval && approval.contextHash !== c.hash) unsafe ??= 'stale-approval';
    const trashUnsafe = unsafe ?? (SENSITIVE.has(purpose) || hasProtectedSubject(c.messages) || c.messages.some(m => isProtected(m.from)) ? 'protected-trash' : null);
    if (approval && !trashUnsafe) {
      const row = { authority: 'thread-approval', ruleId: 'approval-trash', action: 'trash', threadId: t.id, from: t.from, subject: t.subject, label: null, labels: [], adds: [], archive: false, wouldArchive: false };
      if (preferences.mode === 'preview' || preferences.approvedAt === null) { p.proposed.push(row); review(preferences.approvedAt === null ? 'unapproved-preferences' : 'preview', purpose); }
      else p.taken.push(row);
      continue;
    }
    if (applicable.length !== 1) { review(unsafe ?? (approval && trashUnsafe) ?? (applicable.length ? 'conflicting-policies' : 'no-policy'), purpose); continue; }
    const policy = applicable[0];
    if (!actualPath) { review('missing-label', purpose, policy.id); continue; }
    const adds = actualPath.filter(name => !have.has(normaliseLabel(name)));
    const archive = policy.archive && !unsafe;
    const row = { authority: 'preference', ruleId: `preference-${policy.id}`, action: 'label', threadId: t.id, from: t.from, subject: t.subject,
      label: actualPath.at(-1), labels: actualPath, adds, archive, wouldArchive: policy.archive };
    if (!c.complete || preferences.approvedAt === null || preferences.mode === 'preview') {
      if (adds.length || archive) p.proposed.push(row);
      if (c.complete) review(preferences.approvedAt === null ? 'unapproved-preferences' : 'preview', purpose, policy.id);
    } else if (adds.length || archive) p.taken.push(row);
    if (unsafe) review(unsafe, purpose, policy.id);
    else if (approval && trashUnsafe) review(trashUnsafe, purpose, policy.id);
  }
  p.destinations = [...new Set(p.taken.filter(t => t.action === 'label').flatMap(t => t.labels ?? [t.label]))];
  return p;
}

/** Apply-time revalidation binds all inputs and every output to separately refreshed evidence. */
export function validateSemanticPlan(planDoc, inputs, { freshContext, now = new Date() } = {}) {
  if (!keys(planDoc?.semantic, ['version', 'bindings', 'plannedAt']) || planDoc.semantic.version !== 1 || !iso(planDoc.semantic.plannedAt)) fail('missing or invalid semantic plan marker');
  const current = time(now);
  if (Date.parse(planDoc.semantic.plannedAt) > current || current - Date.parse(planDoc.semantic.plannedAt) > 10 * 60 * 1000) fail('stale semantic plan; re-plan');
  if (fingerprint(planDoc.semantic.bindings) !== fingerprint(bindings(inputs))) fail('bound inputs changed; re-plan');
  const expected = triagePlan({ ...inputs, now: new Date(current) });
  // plannedAt is wall-clock metadata; every other output must be exactly recomputed.
  expected.semantic.plannedAt = planDoc.semantic.plannedAt;
  if (fingerprint(expected) !== fingerprint(planDoc)) fail('semantic plan output changed or does not match current inputs');
  validateContext(freshContext, { now: current });
  if (Date.parse(freshContext.fetchedAt) <= Date.parse(inputs.context.fetchedAt)) fail('apply requires a newer separately fetched context');
  const oldEvidence = inputs.context.threads.map(t => [t.id, t.hash]).sort((a, b) => a[0].localeCompare(b[0]));
  const freshEvidence = freshContext.threads.map(t => [t.id, t.hash]).sort((a, b) => a[0].localeCompare(b[0]));
  if (fingerprint(oldEvidence) !== fingerprint(freshEvidence)) fail('conversation evidence changed; reclassify and re-plan');
  return expected;
}

/** A correction is always an exact sender-and-purpose candidate, never active policy. */
export function correctionCandidate({ id: policyId, fromAddress, purpose, label, archive, note }) {
  if (!parseAddress(fromAddress)) fail('correction requires an exact fromAddress sender');
  const policy = { id: policyId, fromAddress: parseAddress(fromAddress).address, purpose, label, archive, note };
  validatePolicy(policy);
  return policy;
}

/** Group bounded exception reasons without copying private message text. */
export function reviewGroups(planDoc) {
  const groups = new Map();
  for (const row of array(planDoc?.review, 3000, 'review rows')) {
    if (!keys(row, ['threadId', 'reason', 'purpose', 'policyId'], ['threadId', 'reason']) || !id(row.threadId) || !text(row.reason, 80)
      || row.purpose !== undefined && !PURPOSES.includes(row.purpose) || row.policyId !== undefined && !id(row.policyId)) fail('invalid review row');
    const k = JSON.stringify([row.reason, row.purpose, row.policyId]);
    if (!groups.has(k)) groups.set(k, { reason: row.reason, ...(row.purpose ? { purpose: row.purpose } : {}), ...(row.policyId ? { policyId: row.policyId } : {}), count: 0, threadIds: [] });
    const g = groups.get(k); g.count++; g.threadIds.push(row.threadId);
  }
  return [...groups.values()];
}

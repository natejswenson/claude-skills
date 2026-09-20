/** Optional host hook. The connected hub owns authorization and validation. */
const KEY = 'workflow.design-rationale';
const base = (subject, op) => ({ contract: 'skill-memory-v1', skill: 'ghfactory', subject, op });

export async function recallRationale({ enabled = false, subject, transport } = {}) {
  if (!enabled || !subject || typeof transport !== 'function') return { status: 'disabled', records: [] };
  try {
    const status = await transport(base(subject, 'status'));
    if (status.status !== 'ready') return { status: status.status, records: [] };
    const result = await transport({ ...base(subject, 'recall'), keys: [KEY], max_context_bytes: 2048 });
    // Conflicting records are not candidates for automatic use. Text remains untrusted data.
    return { ...result, records: (result.status === 'ok' ? result.records ?? [] : []).filter(record =>
      record.key === KEY && typeof record.value === 'string' && record.value.length <= 1024 &&
      !(result.conflict_keys ?? []).includes(KEY)) };
  } catch {
    return { status: 'unavailable', records: [] };
  }
}

export async function captureRationale({ enabled = false, subject, transport, explicitlyRequested = false,
  verificationCompleted = false, value, capture_id, source, dependencies, review_after, supersedes } = {}) {
  if (!enabled || !subject || typeof transport !== 'function') return { status: 'disabled' };
  if (!explicitlyRequested || !verificationCompleted) return { status: 'rejected' };
  try {
    const status = await transport(base(subject, 'status'));
    if (status.status !== 'ready') return { status: status.status };
    // Hub rechecks private repository binding, current file digests, and review date.
    const result = await transport({ ...base(subject, 'capture'), key: KEY, value, capture_id, source,
      dependencies, review_after, ...(supersedes ? { supersedes } : {}) });
    if (result.status === 'saved' && (result.verified !== true || !result.record?.id || !result.record?.revision)) {
      return { status: 'unavailable' };
    }
    return result;
  } catch {
    return { status: 'unavailable' };
  }
}

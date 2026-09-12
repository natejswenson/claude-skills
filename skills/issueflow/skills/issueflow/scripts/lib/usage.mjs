/** Host-specific usage readers. No prompt text and no inferred dollar amounts. */
const measured = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const value = (n) => measured(n) ? n : null;
const plus = (...ns) => ns.every(measured) ? ns.reduce((a, b) => a + b, 0) : null;
const fields = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'];

export function readUsage(records, { host, attemptId = null } = {}) {
  if (!['claude', 'codex'].includes(host)) throw new Error('usage host must be claude or codex');
  const samples = new Map();
  let cumulative = null;
  let malformedRecords = 0;
  let recordsSeen = 0;
  for (const record of records) {
    let r;
    try { r = typeof record === 'string' ? JSON.parse(record) : record; } catch { malformedRecords += 1; continue; }
    if (!r) continue;
    if (host === 'claude' && r.type === 'assistant') {
      const u = r.message?.usage;
      const key = r.message?.id ?? `unidentified-${recordsSeen++}`;
      samples.set(key, { inputTokens: plus(value(u?.input_tokens), value(u?.cache_read_input_tokens), value(u?.cache_creation_input_tokens)),
        outputTokens: value(u?.output_tokens), cacheReadTokens: value(u?.cache_read_input_tokens), cacheWriteTokens: value(u?.cache_creation_input_tokens) });
    }
    if (host === 'codex') {
      const payload = r.payload ?? r;
      if (payload.type === 'token_count') {
        const u = payload.info?.total_token_usage;
        if (!u) continue;
        // Rollout events repeat cumulative totals. Never sum those snapshots.
        cumulative = { inputTokens: value(u.input_tokens), outputTokens: value(u.output_tokens), cacheReadTokens: value(u.cached_input_tokens), cacheWriteTokens: null };
      } else if (r.type === 'turn.completed') {
        const u = r.usage;
        samples.set(r.turn_id ?? r.id ?? `unidentified-${recordsSeen++}`, { inputTokens: value(u?.input_tokens), outputTokens: value(u?.output_tokens), cacheReadTokens: value(u?.cached_input_tokens), cacheWriteTokens: null });
      }
    }
  }
  const selected = cumulative ? [cumulative] : [...samples.values()];
  const result = { host, attemptId, samples: selected.length, source: cumulative ? 'cumulative-rollout' : 'messages', malformedRecords, costUsd: null, totals: {}, knownSubtotals: {}, missingSamples: {} };
  for (const field of fields) {
    const known = selected.map((s) => s[field]).filter(measured);
    const subtotal = known.reduce((a, b) => a + b, 0);
    result.knownSubtotals[field] = subtotal;
    result.missingSamples[field] = selected.length - known.length;
    result.totals[field] = selected.length && known.length === selected.length && !malformedRecords ? subtotal : null;
  }
  return result;
}

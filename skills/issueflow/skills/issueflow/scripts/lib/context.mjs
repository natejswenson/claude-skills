/** Shared, hash-bound context packets used by Codex review workers. */
import { createHash } from 'node:crypto';

export const CONTEXT_SCHEMA = 1;
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function compactContext(value, budget = 4096) {
  const source = typeof value === 'string' ? value : JSON.stringify(value);
  if (Buffer.byteLength(source) <= budget) return { value, summarized: false, sourceHash: hash(value) };
  const text = source.replace(/\s+/g, ' ').trim();
  let end = Math.max(0, budget - 1);
  while (end > 0 && Buffer.byteLength(text.slice(0, end + 1)) > budget - 1) end -= 1;
  return { value: `${text.slice(0, end)}…`, summarized: true, sourceHash: hash(value) };
}

export function buildContextPacket({ issue, base, head, files = [], guidance = [], plan = null, evidence = null, diffStats = {}, priorFindings = [] } = {}) {
  const packet = { schema: CONTEXT_SCHEMA, issue: issue ?? {}, base: base ?? null, head: head ?? null, files, guidance, plan, evidence, diffStats, priorFindings };
  return { ...packet, packetHash: hash(packet) };
}

export function verifyContextPacket(packet, expectedHash = packet?.packetHash) {
  if (!packet || packet.schema !== CONTEXT_SCHEMA || typeof packet.packetHash !== 'string') return false;
  const { packetHash, ...body } = packet;
  return packetHash === expectedHash && packetHash === hash(body);
}

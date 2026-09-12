/** Shared, hash-bound context packets used by Codex review workers. */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { safeRelative } from './contracts.mjs';
import { resolveGuidance } from './guidance.mjs';

export const CONTEXT_SCHEMA = 1;
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function compactContext(value, budget = 4096) {
  if (!Number.isSafeInteger(budget) || budget < 4) throw new Error('context budget must be at least four bytes');
  const source = typeof value === 'string' ? value : JSON.stringify(value);
  if (Buffer.byteLength(source) <= budget) return { value, summarized: false, sourceHash: hash(value) };
  const text = source.replace(/\s+/g, ' ').trim();
  let end = Math.max(0, budget - 3);
  while (end > 0 && Buffer.byteLength(text.slice(0, end)) > budget - 3) end -= 1;
  return { value: `${text.slice(0, end)}…`, summarized: true, sourceHash: hash(value), omittedBytes: Math.max(0, Buffer.byteLength(source) - Buffer.byteLength(text.slice(0, end))), omission: 'Truncated summary: read the referenced primary source before deciding.' };
}

export function buildContextPacket({ issue, base, head, files = [], guidance = [], plan = null, evidence = null, diffStats = {}, priorFindings = [], contract = null, sources = null } = {}) {
  const packet = { schema: CONTEXT_SCHEMA, issue: issue ?? {}, base: base ?? null, head: head ?? null, files, guidance, plan, evidence, diffStats, priorFindings };
  if (contract) packet.contract = contract; // Acceptance criteria are never truncated.
  if (sources) packet.sources = sources;
  return { ...packet, packetHash: hash(packet) };
}

/** Cache keys describe primary inputs, not a reusable branch name or file mtime. */
export function cachedContext(dir, identity, build) {
  const key = hash({ schema: 1, identity });
  mkdirSync(dir, { recursive: true }); const path = join(dir, `${key}.json`);
  if (existsSync(path)) {
    try {
      const item = JSON.parse(readFileSync(path, 'utf8'));
      if (item.key === key && verifyContextPacket(item.packet)) return { packet: item.packet, key, hit: true };
    } catch { /* A damaged cache is not evidence; rebuild from original inputs. */ }
    renameSync(path, `${path}.invalid-${Date.now()}`);
  }
  const packet = build();
  if (!verifyContextPacket(packet)) throw new Error('context builder returned an invalid packet');
  writeFileSync(path, JSON.stringify({ key, packet }), { flag: 'wx' });
  return { key, packet, hit: false };
}

const source = (tree, path) => {
  if (!safeRelative(path)) throw new Error('context source escapes checkout');
  const full = join(tree, path);
  if (!existsSync(full)) return { path, hash: null, bytes: 0, text: '' };
  const stat = lstatSync(full);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`unsupported context source: ${path}`);
  const bytes = readFileSync(full);
  return { path, hash: hash(bytes.toString('base64')), bytes: bytes.length, text: bytes.toString('utf8') };
};

export function prepareReviewContext(cache, tree, input, { excerptBytes = 16384 } = {}) {
  if (!Number.isSafeInteger(excerptBytes) || excerptBytes < 4 || excerptBytes > 1048576) throw new Error('excerpt budget must be 4–1048576 bytes');
  const paths = [...new Set(input.files.map((f) => typeof f === 'string' ? f : f.path ?? f.file).filter(Boolean))].sort();
  const guidance = resolveGuidance(tree, paths);
  const inputs = [...new Set([...paths, ...guidance.map((g) => g.path)])].sort().map((p) => source(tree, p));
  const plan = input.plan && existsSync(input.plan) ? { path: input.plan, hash: hash(readFileSync(input.plan).toString('base64')) } : input.plan;
  const identity = { ...input, plan, sources: inputs.map(({ text, ...rest }) => rest), excerptBytes };
  return cachedContext(cache, identity, () => {
    let left = excerptBytes;
    const sources = inputs.map(({ text, ...entry }) => {
      const redact = /(?:^|\/)(?:\.env|credentials?|secrets?)(?:\.|\/|$)/i.test(entry.path) || text.includes('\0');
      if (redact || left < 4) return { ...entry, omission: redact ? 'Sensitive/binary source: inspect within existing authority; not copied into context.' : 'Excerpt budget exhausted; read primary source.' };
      const excerpt = compactContext(text, Math.max(4, Math.min(2048, left)));
      left -= Buffer.byteLength(typeof excerpt.value === 'string' ? excerpt.value : JSON.stringify(excerpt.value));
      return { ...entry, excerpt };
    });
    return buildContextPacket({ ...input, plan, sources, guidance: guidance.map(({ text, ...entry }) => ({ ...entry, instruction: 'Read this complete guidance file; excerpts never replace its instructions.' })) });
  });
}

export function verifyContextSources(packet, tree) {
  try {
    if (packet.sources?.some((s) => source(tree, s.path).hash !== s.hash)) return false;
    if (packet.plan?.hash && hash(readFileSync(packet.plan.path).toString('base64')) !== packet.plan.hash) return false;
    return true;
  } catch { return false; }
}

export function verifyContextPacket(packet, expectedHash = packet?.packetHash) {
  if (!packet || packet.schema !== CONTEXT_SCHEMA || typeof packet.packetHash !== 'string') return false;
  const { packetHash, ...body } = packet;
  return packetHash === expectedHash && packetHash === hash(body);
}

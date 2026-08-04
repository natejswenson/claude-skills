/**
 * Redaction, applied at ingest — never as a later pass.
 *
 * The corpus on disk is read by every later run and by every model pass, so a
 * secret that reaches it is a secret that leaks repeatedly. Redacting here means
 * the raw value exists only in memory, for the length of one parse.
 */
import { homedir } from 'node:os';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Order matters only in that `assigned-secret` runs before the narrow token
 * shapes, so `FOO_TOKEN=ghp_...` is caught by name even when the value shape is
 * one we do not recognise.
 */
export const RULES = [
  { cls: 'assigned-secret', re: /\b([A-Za-z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|APIKEY|API_KEY|CREDENTIAL|PRIVATE_KEY)[A-Za-z0-9_]*)(\s*[=:]\s*)(?:"|')?([^\s"',;]{6,})/g, to: (_m, k, sep) => `${k}${sep}[redacted:assigned-secret]` },
  { cls: 'anthropic-key', re: /\bsk-ant-[A-Za-z0-9_-]{12,}/g },
  { cls: 'openai-key', re: /\bsk-[A-Za-z0-9]{20,}\b/g },
  { cls: 'github-token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,})\b/g },
  { cls: 'aws-key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { cls: 'slack-token', re: /\bxox[baprse]-[A-Za-z0-9-]{10,}/g },
  { cls: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}/g },
  { cls: 'bearer', re: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}={0,2}/gi },
  { cls: 'pem-block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { cls: 'email', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { cls: 'home-path', re: null, to: '~' }, // built per-call: the home dir is host-specific
];

/**
 * A counter shared across a whole index run, so `index` can report how much it
 * removed rather than asserting that it removed anything.
 */
export const newCounts = () => Object.create(null);

export function redact(text, counts = newCounts(), home = homedir()) {
  if (typeof text !== 'string' || text.length === 0) return text;
  let out = text;
  for (const rule of RULES) {
    const re = rule.cls === 'home-path' ? new RegExp(esc(home), 'g') : rule.re;
    if (!re) continue;
    let hits = 0;
    out = out.replace(re, (...args) => {
      hits += 1;
      return typeof rule.to === 'function' ? rule.to(...args) : (rule.to ?? `[redacted:${rule.cls}]`);
    });
    if (hits) counts[rule.cls] = (counts[rule.cls] ?? 0) + hits;
  }
  return out;
}

/** Redact every string inside a structure, in place-safe fashion. */
export function redactDeep(value, counts = newCounts(), home = homedir()) {
  if (typeof value === 'string') return redact(value, counts, home);
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, counts, home));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactDeep(v, counts, home);
    return out;
  }
  return value;
}

export const countsTable = (counts) =>
  Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)).map(([cls, n]) => [cls, n]);

export const totalRedactions = (counts) => Object.values(counts).reduce((a, b) => a + b, 0);

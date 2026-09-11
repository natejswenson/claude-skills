/** Best-effort, privacy-conscious run telemetry for Codex and Claude runs. */
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { activePath } from './execution.mjs';

export const TELEMETRY_SCHEMA = 1;

const digest = (value) => createHash('sha256').update(String(value)).digest('hex');
const safeRole = (value) => ['investigate', 'implement', 'redTeam', 'finder', 'verifier', 'fixer', 'fixerEscalated'].includes(value) ? value : 'unknown';
const safeEffort = (value) => ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(value) ? value : 'unknown';
const safePath = (value) => {
  const text = String(value ?? '');
  if (!text || text.includes('\0') || /(^|[/\\])(?:\.env|credentials?|secrets?|token|password|private)/i.test(text)) return null;
  return text.replace(/\\/g, '/').replace(/\/Users\/[^/]+/g, '/Users/<user>').replace(/\/home\/[^/]+/g, '/home/<user>');
};

export const telemetryPath = (dir, run) => activePath(dir, 'telemetry', 'events.jsonl');

export function telemetryEvent(run, event, fields = {}, now = new Date().toISOString()) {
  const out = {
    schema: TELEMETRY_SCHEMA,
    at: now,
    event: String(event),
    host: run?.runtime === 'codex' ? 'codex' : 'claude',
  };
  for (const [key, value] of Object.entries(fields)) {
    if (key === 'prompt' || key === 'artifact' || key === 'path') {
      const path = safePath(value);
      if (path) out[`${key}PathHash`] = digest(path);
      continue;
    }
    if (key === 'role') out.role = safeRole(value);
    else if (key === 'reasoning' || key === 'reasoningEffort') out.reasoningEffort = safeEffort(value);
    else if (key === 'agentTimeMs' || key === 'wallTimeMs' || key === 'promptBytes' || key === 'artifactBytes' || key === 'retry' || key === 'queueOccupancy') out[key] = Number.isFinite(Number(value)) ? Number(value) : null;
    else if (key === 'tokens') out.tokens = Number.isFinite(Number(value)) ? Number(value) : null;
    else if (key === 'files') out.files = Array.isArray(value) ? value.map(safePath).filter(Boolean).map(digest) : [];
    else if (key === 'success' || key === 'confirmed') out[key] = Boolean(value);
    else if (key === 'reason') out.reason = String(value).slice(0, 240);
    else if (key === 'unknown') out.unknown = Boolean(value);
  }
  return out;
}

/** Never throw into the state machine: telemetry is an observation sidecar. */
export function recordTelemetry(dir, run, event, fields = {}, now) {
  try {
    const path = telemetryPath(dir, run);
    mkdirSync(join(path, '..'), { recursive: true });
    const line = `${JSON.stringify(telemetryEvent(run, event, fields, now))}\n`;
    const fd = openSync(path, 'a');
    try { appendFileSync(fd, line); } finally { closeSync(fd); }
    return true;
  } catch { return false; }
}

export function readTelemetry(dir, run) {
  try {
    const path = telemetryPath(dir, run);
    if (!existsSync(path)) return [];
    return readFileSync(path, 'utf8').split('\n').filter(Boolean).flatMap((line) => {
      try { const item = JSON.parse(line); return item?.schema === TELEMETRY_SCHEMA ? [item] : []; } catch { return []; }
    });
  } catch { return []; }
}

export function summarizeTelemetry(events) {
  const workers = events.filter((e) => e.event === 'worker');
  const durations = workers.map((e) => e.wallTimeMs).filter(Number.isFinite);
  const total = durations.reduce((sum, n) => sum + n, 0);
  const successful = workers.filter((e) => e.success === true).length;
  const result = {
    schema: TELEMETRY_SCHEMA,
    events: events.length,
    workers: workers.length,
    successfulWorkers: successful,
    failedWorkers: workers.filter((e) => e.success === false).length,
    retries: events.filter((e) => e.event === 'retry').length,
    gateRefusals: events.filter((e) => e.event === 'gate-refusal').length,
    findingsProposed: events.filter((e) => e.event === 'finding' && e.confirmed !== true).length,
    findingsConfirmed: events.filter((e) => e.event === 'finding' && e.confirmed === true).length,
    wallTimeMs: total,
    agentTimeMs: workers.reduce((sum, e) => sum + (Number.isFinite(e.agentTimeMs) ? e.agentTimeMs : 0), 0),
    unknownAgentTime: workers.some((e) => !Number.isFinite(e.agentTimeMs)),
  };
  return result;
}

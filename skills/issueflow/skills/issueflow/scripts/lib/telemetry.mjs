/** Best-effort, privacy-conscious run telemetry for Codex and Claude runs. */
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { activePath } from './execution.mjs';

export const TELEMETRY_SCHEMA = 1;

const digest = (value) => createHash('sha256').update(String(value)).digest('hex');
// Do not coerce null, false, empty strings or malformed usage into measured zero.
const measured = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
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
    if(['category','start','end'].includes(key)) { if(key==='category'&&['human','ci','worker','controller'].includes(value)||key!=='category'&&Number.isFinite(Date.parse(value)))out[key]=value; continue; }
    if (key === 'prompt' || key === 'artifact' || key === 'path') {
      const path = safePath(value);
      if (path) out[`${key}PathHash`] = digest(path);
      continue;
    }
    if (key === 'role') out.role = safeRole(value);
    else if (key === 'reasoning' || key === 'reasoningEffort') out.reasoningEffort = safeEffort(value);
    else if (key === 'agentTimeMs' || key === 'wallTimeMs' || key === 'promptBytes' || key === 'artifactBytes' || key === 'retry' || key === 'queueOccupancy') out[key] = measured(value) ? value : null;
    else if (key === 'tokens') out.tokens = measured(value) ? value : null;
    else if (key === 'files') out.files = Array.isArray(value) ? value.map(safePath).filter(Boolean).map(digest) : [];
    else if (key === 'success' || key === 'confirmed') out[key] = Boolean(value);
    else if (key === 'reason') out.reason = String(value).slice(0, 240);
    else if (key === 'unknown') out.unknown = Boolean(value);
    else if (key === 'attemptId' && typeof value === 'string') out.attemptId = digest(value);
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

export function summarizeTelemetry(events, run = null) {
  const seen = new Set();
  events = events.filter((e) => {
    if (!e.attemptId) return true;
    const key = `${e.event}:${e.attemptId}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  const workers = events.filter((e) => e.event === 'worker');
  const durations = workers.map((e) => e.wallTimeMs).filter(measured);
  const total = durations.reduce((sum, n) => sum + n, 0);
  // Earlier records may carry a coerced zero together with an explicit unknown
  // marker. Preserve that marker when reading historical telemetry too.
  const agentDurations = workers.filter((e) => e.unknown !== true).map((e) => e.agentTimeMs).filter(measured);
  const agentTotal = agentDurations.reduce((sum, n) => sum + n, 0);
  const successful = workers.filter((e) => e.success === true).length;
  const attempts = [...new Map([...(run?.harness?.attemptHistory ?? []), ...Object.values(run?.harness?.attempts ?? {})].map((a) => [a.id, a])).values()];
  const native = attempts.filter((a) => a.native?.terminalAt).map((a) => a.native);
  const tokenFields = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'];
  const usage = Object.fromEntries(tokenFields.map((field) => {
    const known = native.map((n) => n.usage?.totals?.[field]).filter(measured);
    const subtotal = known.reduce((a, b) => a + b, 0);
    return [field, { total: native.length && native.length === attempts.length && known.length === native.length ? subtotal : null, knownSubtotal: subtotal, missingAttempts: attempts.length - known.length }];
  }));
  // PR review state is authoritative: the old finding sidecar was emitted only
  // by plan review. Counting it omitted PR findings entirely. Count pooled
  // candidates per lane/round, and first-confirmed findings once per lane;
  // subsequent fixed/still-open transitions must not add confirmations.
  const findingCountsSource = Array.isArray(run?.lanes) ? 'pr-review-state' : 'legacy-finding-events';
  let findingsProposed = 0, findingsConfirmed = 0;
  if (findingCountsSource === 'pr-review-state') {
    for (const lane of run.lanes) {
      const rounds = (lane.review?.rounds ?? []).filter((r) => !r.cancelled);
      for (const round of rounds) {
        findingsProposed += new Set([...(round.candidates ?? []), ...(round.unverifiedNits ?? [])]
          .map((c) => c.id).filter((id) => typeof id === 'string' && id.length > 0)).size;
      }
      const registered = new Set(rounds.filter((r) => r.registered).map((r) => r.round));
      findingsConfirmed += new Set((lane.review?.findings ?? [])
        .filter((f) => f.verdict === 'CONFIRMED' && registered.has(f.firstRound))
        .map((f) => f.id).filter((id) => typeof id === 'string' && id.length > 0)).size;
    }
  } else {
    findingsProposed = events.filter((e) => e.event === 'finding' && e.confirmed !== true).length;
    findingsConfirmed = events.filter((e) => e.event === 'finding' && e.confirmed === true).length;
  }
  const result = {
    schema: TELEMETRY_SCHEMA,
    events: events.length,
    nativeObservedWorkers: native.length,
    missingNativeObservations: attempts.length - native.length,
    usage,
    costUsd: null,
    elapsed: elapsedBreakdown([...events.filter(e=>e.event==='interval').map(e=>({category:e.category,start:e.start,end:e.end})),...native.map(n=>({category:'worker',start:n.startedAt,end:n.terminalAt}))], {start:run?.createdAt,end:run?.finished?.at}),
    milestones: Object.fromEntries(['implementation-start','reviewed-pr','endpoint'].map(name=>[name,events.find(e=>e.event===name)?.at??null])),
    workers: workers.length,
    successfulWorkers: successful,
    failedWorkers: workers.filter((e) => e.success === false).length,
    retries: events.filter((e) => e.event === 'retry').length,
    gateRefusals: events.filter((e) => e.event === 'gate-refusal').length,
    findingCountsSource,
    findingsProposed,
    findingsConfirmed,
    // Worker intervals may overlap. They do not establish end-to-end elapsed time.
    wallTimeMs: run?.finished && Number.isFinite(Date.parse(run.finished.at)) && Number.isFinite(Date.parse(run.createdAt))
      ? Math.max(0, Date.parse(run.finished.at) - Date.parse(run.createdAt)) : null,
    workerWallTimeMs: workers.length > 0 && durations.length === workers.length ? total : null,
    knownWorkerWallTimeMs: total,
    missingWorkerTimeSamples: workers.length - durations.length,
    agentTimeMs: workers.length > 0 && agentDurations.length === workers.length ? agentTotal : null,
    knownAgentTimeMs: agentTotal,
    missingAgentTimeSamples: workers.length - agentDurations.length,
    unknownAgentTime: workers.length === 0 || agentDurations.length !== workers.length,
  };
  return result;
}

/** Union overlapping intervals; report unobserved time instead of assigning it to the controller. */
export function elapsedBreakdown(intervals, {start, end} = {}) {
  const lo=Date.parse(start),hi=Date.parse(end),categories=['human','ci','worker','controller'];
  if(!Number.isFinite(lo)||!Number.isFinite(hi)||hi<lo)return {wallTimeMs:null,unknownTimeMs:null};
  const valid=intervals.filter(i=>categories.includes(i.category)&&Number.isFinite(Date.parse(i.start))&&Number.isFinite(Date.parse(i.end))&&Date.parse(i.end)>=Date.parse(i.start));
  const points=[...new Set([lo,hi,...valid.flatMap(i=>[Math.max(lo,Math.min(hi,Date.parse(i.start))),Math.max(lo,Math.min(hi,Date.parse(i.end)))])])].sort((a,b)=>a-b);
  const exclusive=Object.fromEntries(categories.map(c=>[c,0]));let unknown=0;
  for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i];const category=categories.find(c=>valid.some(v=>v.category===c&&Date.parse(v.start)<=a&&Date.parse(v.end)>=b));if(category)exclusive[category]+=b-a;else unknown+=b-a;}
  return {wallTimeMs:hi-lo,exclusiveMs:exclusive,unknownTimeMs:unknown,overlapPriority:categories,invalidIntervals:intervals.length-valid.length};
}

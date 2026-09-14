/** Observations only: never load/adopt a run or ask the controller what to do. */
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { activeRoot } from './execution.mjs';

const JSON_LIMIT = 1024 * 1024;
const TEXT_LIMIT = 16384;
export const FRESHNESS_MS = 60000;
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const hash = (v) => createHash('sha256').update(v).digest('hex');
export const cleanText = (v) => typeof v === 'string'
  ? stripVTControlCharacters(v).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, '').slice(0, TEXT_LIMIT) : null;
const stamp = (v) => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;
const latest = (values) => values.map(stamp).filter(Boolean).sort().at(-1) ?? null;
const age = (at, now) => !at || Date.parse(at) > now ? 'unavailable' : now - Date.parse(at) > FRESHNESS_MS ? 'stale' : 'fresh';
const inside = (root, path) => path === root || path.startsWith(root + sep);

// Only canonicalize aliases above the owned root (e.g. macOS /var → /private/var).
// Keep every component below that root lexical so readOwned still rejects symlinks.
function ownedPath(root, name) {
  const path = resolve(root, name);
  if (inside(root, path)) return path;
  for (let ancestor = dirname(path); ancestor !== dirname(ancestor); ancestor = dirname(ancestor)) {
    try {
      if (!lstatSync(ancestor).isSymbolicLink() && realpathSync(ancestor) === root) {
        return resolve(root, relative(ancestor, path));
      }
    } catch { /* Missing output ancestors do not establish ownership. */ }
  }
  return path;
}

/** Reject every symlink component and check identity again after a bounded read. */
function readOwned(root, name, limit = TEXT_LIMIT, tail = false) {
  let fd;
  try {
    if (typeof name !== 'string' || name.split(/[\\/]/).includes('..')) throw new Error('unsafe path');
    const path = ownedPath(root, name);
    if (!inside(root, path)) throw new Error('path outside owned artifacts');
    for (let part = path; inside(root, part); part = dirname(part)) {
      if (lstatSync(part).isSymbolicLink() || realpathSync(part) !== part) throw new Error('symlink path');
      if (part === root) break;
    }
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = fstatSync(fd);
    if (!before.isFile()) throw new Error('not a regular file');
    if (!tail && before.size > limit) throw new Error('file exceeds observation limit');
    const bytes = Buffer.alloc(Math.min(before.size, limit));
    const count = readSync(fd, bytes, 0, bytes.length, tail ? Math.max(0, before.size - limit) : 0);
    const after = fstatSync(fd), current = lstatSync(path);
    if (count !== bytes.length || before.size !== after.size || before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs || current.ino !== after.ino || current.dev !== after.dev ||
        realpathSync(path) !== path) throw new Error('file changed during observation');
    return { status: 'available', bytes, observedAt: after.mtime.toISOString(), truncated: before.size > limit };
  } catch (error) { return { status: 'unavailable', reason: cleanText(error.code ?? error.message) }; }
  finally { if (fd !== undefined) closeSync(fd); }
}
function jsonOwned(root, path) {
  const file = readOwned(root, path, JSON_LIMIT);
  if (!file.bytes) throw new Error(file.reason);
  return JSON.parse(file.bytes.toString('utf8'));
}
function textOwned(root, path, now) {
  const file = readOwned(root, path, TEXT_LIMIT, true);
  const { bytes, ...metadata } = file;
  return { ...metadata, path: cleanText(path), text: bytes ? cleanText(bytes.toString('utf8')) : null,
    freshness: age(file.observedAt, now) };
}
const unavailable = (reason) => ({ status: 'unavailable', reason, text: null, freshness: 'unavailable' });

function stagesOf(run) {
  const stages = [];
  const add = (entries, lane) => {
    for (const stage of Array.isArray(entries) ? entries : []) if (object(stage)) {
      const id = cleanText(stage.id), key = lane ? `${lane}/${id}` : id;
      stages.push({ key, id, lane, state: cleanText(stage.state) ?? 'unknown',
        artifact: typeof stage.artifact === 'string' ? join(lane ?? 'shared', stage.artifact) : null,
        lastObservedAt: latest(Object.values(object(stage.at) ? stage.at : {})) });
    }
  };
  add(run.stages, null);
  for (const lane of run.lanes ?? []) if (object(lane)) add(lane.stages, cleanText(lane.slug));
  return stages;
}

function agentsOf(run, runKey, root, stages, now) {
  const current = object(run.harness?.attempts) ? run.harness.attempts : {};
  const history = Array.isArray(run.harness?.attemptHistory) ? run.harness.attemptHistory : [];
  const groups = new Map();
  for (const [binding, attempt] of [...Object.entries(current), ...history.map((a) => [null, a])]) {
    const id = typeof attempt?.id === 'string' ? attempt.id : null;
    const identity = id ?? `invalid:${hash(JSON.stringify(attempt))}`;
    if (!groups.has(identity)) groups.set(identity, []);
    groups.get(identity).push({ attempt, binding });
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([identity, entries]) => {
    const records = entries.map((e) => e.attempt).filter(object);
    const distinct = (fn) => [...new Set(records.map(fn).filter((v) => v !== null && v !== undefined))];
    const generations = distinct((a) => a.generation), ids = distinct((a) => a.native?.workerId);
    const states = distinct((a) => a.native?.status);
    const terminals = states.filter((s) => s !== 'started');
    const bindings = entries.filter((e) => e.binding !== null).map((e) => e.binding).sort();
    const a = records[0] ?? {};
    const outputs = Array.isArray(a.outputs) ? a.outputs : [];
    const conflict = records.length !== entries.length || typeof a.id !== 'string' ||
      generations.length !== 1 || typeof generations[0] !== 'string' || ids.length > 1 || terminals.length > 1 ||
      states.some((s) => !['started', 'completed', 'failed', 'cancelled'].includes(s)) ||
      distinct((r) => JSON.stringify(r.outputs)).length > 1 ||
      ['brief', 'briefHash', 'manifest', 'manifestHash', 'completion'].some((field) => distinct((r) => r[field]).length > 1) ||
      !outputs.length || outputs.some((p) => typeof p !== 'string') ||
      (root && bindings.some((b) => !outputs.some((p) => ownedPath(root, p) === ownedPath(root, b))));
    const generation = generations.length === 1 ? cleanText(generations[0]) : null;
    const key = hash(JSON.stringify([runKey, generations.slice().sort(), identity]));
    const at = latest(records.flatMap((r) => [r.native?.startedAt, r.native?.terminalAt]));
    const matching = root ? stages.filter((s) => s.artifact && outputs.some((p) =>
      typeof p === 'string' && ownedPath(root, p) === ownedPath(root, s.artifact))) : [];
    const agent = { key, attemptId: cleanText(a.id), generation, current: bindings.length > 0,
      membership: bindings.length ? 'current' : 'historical', role: conflict ? 'unavailable' : matching.map((s) => s.key).join(', ') || cleanText(a.brief) || 'unknown',
      workerId: conflict ? null : cleanText(ids[0]), state: conflict ? 'conflict' : terminals[0] ?? states[0] ?? 'unknown',
      lastObservedAt: at, freshness: age(at, now), outputs: conflict ? [] : outputs.map(cleanText),
      details: [], reason: conflict ? 'Conflicting or malformed attempt observations; identity and output unavailable.' : null };
    if (conflict || !root) {
      agent.details.push(unavailable(conflict ? agent.reason : 'Execution artifacts unavailable'));
      return agent;
    }
    // Prefer immutable, attempt-correlated archive bytes even when live paths were reused.
    let envelope;
    try {
      const expected = join(root, 'attempts', a.id, 'completed.json');
      if (typeof a.completion !== 'string' || ownedPath(root, a.completion) !== expected) throw new Error('completion path mismatch');
      envelope = jsonOwned(root, expected);
      if (envelope.id !== a.id || envelope.generation !== a.generation || envelope.manifestHash !== a.manifestHash ||
          envelope.status !== 'completed' || !Array.isArray(envelope.outputs) || envelope.outputs.length !== outputs.length ||
          !envelope.outputs.every((o, i) => o.path === outputs[i] && /^[a-f0-9]{64}$/.test(o.hash))) envelope = null;
    } catch { envelope = null; }
    outputs.slice(0, 16).forEach((path, i) => {
      if (envelope) {
        const archived = join(root, 'attempts', a.id, 'outputs', `${i}-${envelope.outputs[i].hash}`);
        const file = readOwned(root, archived, JSON_LIMIT);
        if (file.bytes && hash(file.bytes) === envelope.outputs[i].hash) {
          agent.details.push({ status: 'available', path: cleanText(path), source: 'attempt archive',
            text: cleanText(file.bytes.toString('utf8')), observedAt: file.observedAt,
            freshness: age(file.observedAt, now), truncated: file.bytes.length > TEXT_LIMIT });
        } else agent.details.push(unavailable('Attempt archive unavailable or hash mismatch'));
      } else if (agent.current && current[relative(root, ownedPath(root, path))]?.id === a.id &&
                 current[relative(root, ownedPath(root, path))]?.generation === a.generation) {
        agent.details.push({ ...textOwned(root, path, now), source: 'current attempt output' });
      } else agent.details.push(unavailable('Historical output unavailable; live path may belong to a replacement'));
    });
    if (outputs.length > 16) agent.details.push(unavailable('Additional outputs omitted: observation limit 16'));
    return agent;
  });
}

function observeRun(dir, now) {
  let canonical = resolve(dir);
  try {
    if (lstatSync(canonical).isSymbolicLink()) throw new Error('symlink run directory');
    canonical = realpathSync(canonical);
    const file = readOwned(canonical, 'run.json', JSON_LIMIT);
    if (!file.bytes) throw new Error(file.reason);
    const run = JSON.parse(file.bytes.toString('utf8'));
    if (!object(run) || ![3, 4, 5].includes(run.schema) ||
        run.schema === 4 && run.harness?.version !== 1 || run.schema === 5 && run.harness?.version !== 2 ||
        !object(run.repo) || !object(run.issue) || !Array.isArray(run.stages) || !Array.isArray(run.lanes)) {
      throw new Error('Malformed or unsupported run schema');
    }
    const key = hash(JSON.stringify([canonical, run.createdAt ?? null]));
    const stages = stagesOf(run), problems = [];
    let root;
    try { root = realpathSync(activeRoot(canonical, run)); }
    catch { problems.push('Execution artifacts unavailable: missing storage or invalid execution ownership'); }
    const agents = agentsOf(run, key, root, stages, now);
    const currentStages = stages.filter((s) => !['approved', 'skipped'].includes(s.state));
    const presentation = run.presentation?.snapshot ?? run.presentation;
    const state = cleanText(presentation?.state) ?? (run.finished ? 'finished' : currentStages[0]?.state ?? 'unknown');
    const stageActivity = currentStages.map((s) => ({ stage: s.key, source: 'stage activity (not worker-specific)',
      ...(root && s.key ? textOwned(root, join('progress', `${s.key.replace('/', '-')}.log`), now) : unavailable('Stage activity unavailable')) }));
    const lastObservedAt = latest([file.observedAt, run.presentation?.emittedAt,
      ...stages.map((s) => s.lastObservedAt), ...agents.map((a) => a.lastObservedAt),
      ...stageActivity.map((s) => s.observedAt)]);
    return { key, directory: cleanText(canonical), status: 'available', schema: run.schema,
      repository: [cleanText(run.repo.owner), cleanText(run.repo.name)].filter(Boolean).join('/') || 'unknown',
      issue: Number.isSafeInteger(run.issue.number) ? run.issue.number : null, title: cleanText(run.issue.title),
      createdAt: stamp(run.createdAt), host: ['claude', 'codex'].includes(run.runtime) ? run.runtime : 'unknown',
      ownerFingerprint: /^[a-f0-9]{64}$/.test(run.initialization?.owner?.digest ?? '') ? run.initialization.owner.digest : null,
      state, currentStage: currentStages.map((s) => s.key).join(', ') || 'unavailable',
      nextAction: cleanText(presentation?.nextAction ?? run.presentation?.lastProgress),
      lastObservedAt, freshness: age(lastObservedAt, now), stages, stageActivity, agents, problems,
      agentsNote: agents.length ? null : 'Native agent observations unavailable; no recorded attempts' };
  } catch (error) {
    return { key: hash(JSON.stringify([canonical, null])), directory: cleanText(canonical), status: 'unavailable',
      state: 'unknown', agents: [], problems: [cleanText(error.message)], lastObservedAt: null, freshness: 'unavailable' };
  }
}

export function monitorSnapshot({ runRoot, runDir, now = Date.now() } = {}) {
  if (runRoot && runDir) throw new Error('monitor: choose --run-root or --run-dir, not both');
  if ([runRoot, runDir].some((p) => p !== undefined && (typeof p !== 'string' || !p))) throw new Error('monitor: directory flags require a path');
  const root = resolve(runDir ?? runRoot ?? join(homedir(), '.claude', 'issueflow'));
  const problems = [], dirs = [];
  if (runDir) dirs.push(root);
  else {
    try {
      for (const repo of readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (!repo.isDirectory() || repo.isSymbolicLink()) continue;
        try {
          for (const issue of readdirSync(join(root, repo.name), { withFileTypes: true })) {
            if (issue.isDirectory() && !issue.isSymbolicLink() && issue.name.startsWith('issue-')) dirs.push(join(root, repo.name, issue.name));
          }
        } catch (error) { problems.push(`${cleanText(repo.name)}: ${cleanText(error.code ?? error.message)}`); }
      }
    } catch (error) { problems.push(`Run root unavailable: ${cleanText(error.code ?? error.message)}`); }
  }
  return { schema: 1, observedAt: new Date(now).toISOString(), root: cleanText(root), freshnessMs: FRESHNESS_MS,
    observationNote: 'Fresh means observed within 60 seconds, not proof of a live worker. Controller fingerprints are not native session IDs.',
    runs: dirs.sort().map((dir) => observeRun(dir, now)), problems };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordTelemetry, readTelemetry, summarizeTelemetry, telemetryEvent, telemetryPath } from '../lib/telemetry.mjs';

const run = { runtime: 'codex' };

test('duplicate acknowledgements and stops cannot invent worker completions or double-count time', () => {
  const worker = telemetryEvent(run, 'worker', { attemptId: 'a', wallTimeMs: 100, agentTimeMs: 60, success: true });
  const stop = telemetryEvent(run, 'worker-stop', { attemptId: 'a', wallTimeMs: 200 });
  const summary = summarizeTelemetry([worker, worker, stop, stop], { createdAt: '2026-09-11T00:00:00Z', finished: { at: '2026-09-11T00:00:01Z' } });
  assert.equal(summary.workers, 1);
  assert.equal(summary.workerWallTimeMs, 100);
  assert.equal(summary.agentTimeMs, 60);
  assert.equal(summary.wallTimeMs, 1000);
});

test('explicit null and invalid durations cannot become measured zero', () => {
  for (const value of [null, undefined, '', '100', false, -1, NaN, Infinity]) {
    const event = telemetryEvent(run, 'worker', { agentTimeMs: value, wallTimeMs: value });
    assert.equal(event.agentTimeMs, null);
    assert.equal(event.wallTimeMs, null);
    const summary = summarizeTelemetry([event]);
    assert.equal(summary.agentTimeMs, null);
    assert.equal(summary.unknownAgentTime, true);
    assert.equal(summary.missingAgentTimeSamples, 1);
  }
  assert.equal(telemetryEvent(run, 'worker', { agentTimeMs: 0 }).agentTimeMs, 0);
});

test('concurrent worker duration and run elapsed duration are distinct measurements', () => {
  const events = [
    telemetryEvent(run, 'worker', { agentTimeMs: 100, wallTimeMs: 100 }),
    telemetryEvent(run, 'worker', { agentTimeMs: null, wallTimeMs: 100 }),
  ];
  const summary = summarizeTelemetry(events);
  assert.equal(summary.workerWallTimeMs, 200);
  assert.equal(summary.wallTimeMs, null);
  assert.equal(summary.agentTimeMs, null);
  assert.equal(summary.knownAgentTimeMs, 100);
  assert.equal(summary.missingAgentTimeSamples, 1);
  assert.equal(summary.unknownAgentTime, true);
});

test('zero workers is no timing evidence', () => {
  const summary = summarizeTelemetry([]);
  assert.equal(summary.wallTimeMs, null);
  assert.equal(summary.agentTimeMs, null);
  assert.equal(summary.workerWallTimeMs, null);
  assert.equal(summary.unknownAgentTime, true);
});

test('historical unknown markers outrank a previously coerced zero', () => {
  const summary = summarizeTelemetry([{ event: 'worker', agentTimeMs: 0, wallTimeMs: 10, unknown: true }]);
  assert.equal(summary.agentTimeMs, null);
  assert.equal(summary.missingAgentTimeSamples, 1);
  assert.equal(summary.unknownAgentTime, true);
});

test('telemetry is deterministic and keeps unavailable metrics explicit', () => {
  const event = telemetryEvent(run, 'worker', {
    role: 'finder', reasoning: 'medium', prompt: '/Users/nate/secrets/token.txt',
    agentTimeMs: undefined, wallTimeMs: 20, success: true,
  }, '2026-01-01T00:00:00.000Z');
  assert.deepEqual(event, {
    schema: 1, at: '2026-01-01T00:00:00.000Z', event: 'worker', host: 'codex',
    role: 'finder', reasoningEffort: 'medium', agentTimeMs: null, wallTimeMs: 20,
    success: true,
  });
});

test('telemetry excludes raw paths and tolerates malformed lines', () => {
  const dir = mkdtempSync(join(tmpdir(), 'issueflow-telemetry-'));
  assert.equal(recordTelemetry(dir, run, 'worker', { role: 'verifier', success: false, artifact: '/tmp/output.json', artifactBytes: 4 }), true);
  const path = telemetryPath(dir, run);
  writeFileSync(path, `${readFileSync(path, 'utf8')}not-json\n`);
  const events = readTelemetry(dir, run);
  assert.equal(events.length, 1);
  assert.equal(events[0].artifact, undefined);
  assert.equal(events[0].artifactPathHash.length, 64);
  assert.deepEqual(summarizeTelemetry(events), {
    schema: 1, events: 1, workers: 1, successfulWorkers: 0, failedWorkers: 1,
    nativeObservedWorkers: 0, missingNativeObservations: 0, costUsd: null,
    usage: Object.fromEntries(['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'].map((field) => [field, { total: null, knownSubtotal: 0, missingAttempts: 0 }])),
    retries: 0, gateRefusals: 0, findingsProposed: 0, findingsConfirmed: 0,
    wallTimeMs: null, workerWallTimeMs: null, knownWorkerWallTimeMs: 0, missingWorkerTimeSamples: 1,
    agentTimeMs: null, knownAgentTimeMs: 0, missingAgentTimeSamples: 1, unknownAgentTime: true,
  });
  assert.equal(existsSync(join(dir, 'telemetry', 'events.jsonl')), true);
});

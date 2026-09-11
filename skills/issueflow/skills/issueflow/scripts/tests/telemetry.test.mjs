import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordTelemetry, readTelemetry, summarizeTelemetry, telemetryEvent, telemetryPath } from '../lib/telemetry.mjs';

const run = { runtime: 'codex' };

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
    retries: 0, gateRefusals: 0, findingsProposed: 0, findingsConfirmed: 0,
    wallTimeMs: 0, agentTimeMs: 0, unknownAgentTime: true,
  });
  assert.equal(existsSync(join(dir, 'telemetry', 'events.jsonl')), true);
});

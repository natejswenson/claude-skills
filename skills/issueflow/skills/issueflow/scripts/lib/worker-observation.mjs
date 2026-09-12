/** The parent records native host observations; workers cannot self-certify them. */
import { readFileSync } from 'node:fs';
import { hash } from './contracts.mjs';
import { RunError, saveRun } from './run.mjs';
import { readUsage } from './usage.mjs';
import { runtimeOf } from './runtime.mjs';

export function observeWorker(dir, run, { attemptId, workerId, status, usageFile = null }) {
  if (typeof workerId !== 'string' || !workerId.trim() || !['started', 'completed', 'failed', 'cancelled'].includes(status)) throw new RunError('worker-observe requires a native worker-id and started/completed/failed/cancelled status');
  const matches = Object.values(run.harness?.attempts ?? {}).filter((a) => a.id === attemptId && a.state === 'dispatched');
  if (!matches.length) throw new RunError('worker observation does not identify a current dispatched attempt');
  if (Object.values(run.harness.attempts).some((a) => a.id !== attemptId && a.native?.workerId === workerId && a.native.status === 'started')) throw new RunError('native worker is already active on another attempt');
  const prior = matches[0].native;
  if (prior && (prior.workerId !== workerId || prior.status !== 'started' && prior.status !== status)) throw new RunError('native identity or terminal status changed; preserve the earlier observation');
  let usage = prior?.usage ?? null; let usageHash = prior?.usageHash ?? null;
  if (usageFile) {
    if (status === 'started') throw new RunError('record usage only from a terminal worker, after its source has stopped changing');
    const bytes = readFileSync(usageFile);
    if (usageHash && usageHash !== hash(bytes)) throw new RunError('usage source changed after recording');
    usageHash = hash(bytes);
    usage = readUsage(bytes.toString('utf8').split('\n').filter(Boolean), { host: runtimeOf(run), attemptId });
  }
  const native = { workerId, status, startedAt: prior?.startedAt ?? (status === 'started' ? new Date().toISOString() : null),
    terminalAt: status === 'started' ? null : prior?.terminalAt ?? new Date().toISOString(), usageHash, usage };
  for (const attempt of matches) attempt.native = native;
  saveRun(dir, run); return native;
}

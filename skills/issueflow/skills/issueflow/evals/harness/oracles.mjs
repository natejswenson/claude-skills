/** Outcome checks live outside the candidate snapshot and never trust its prose. */
export function judge(probe, actual) {
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) throw new Error('missing observation');
  switch (probe) {
    case 'invented-evidence':
    case 'zero-tests':
    case 'exit-conflict':
    case 'green-only': return { pass: actual.ok === false, detail: actual.reason ?? 'evidence was accepted' };
    case 'real-evidence': return { pass: actual.ok === true && actual.executions?.length === 2 && actual.executions[0].status !== 0 && actual.executions[1].status === 0, detail: 'same test executed against broken and fixed behavior' };
    case 'copy-risk': return { pass: actual.kind !== 'fast-docs' && ['standard', 'deep'].includes(actual.kind), detail: `selected ${actual.kind}` };
    case 'unknown-time': return { pass: actual.unknownAgentTime === true && actual.agentTimeMs === null, detail: 'unavailable agent duration must remain unknown, including the aggregate' };
    case 'concurrent-time': return { pass: actual.workerWallTimeMs === 200 && actual.wallTimeMs === null, detail: 'worker duration is 200ms; run elapsed time is unavailable' };
    default: throw new Error(`no oracle for ${probe}`);
  }
}

/** Compare actual resulting files and command status, never a worker success claim. */
export function repositoryOutcome({ expected, observed, exitCode }) {
  if (!expected || Object.keys(expected).length === 0) throw new Error('empty repository oracle');
  return exitCode === 0 && Object.keys(expected).length === Object.keys(observed ?? {}).length
    && Object.entries(expected).every(([path, value]) => observed?.[path] === value);
}

export function reportVerdict(results) {
  if (!Array.isArray(results) || !results.length) throw new Error('no evaluated cases');
  if (results.some((r) => r.status === 'fail')) return 'fail';
  if (results.some((r) => r.status !== 'pass')) return 'inconclusive';
  return 'pass';
}

export const verdictExit = (verdict) => ({ pass: 0, fail: 1, inconclusive: 2 }[verdict] ?? 2);

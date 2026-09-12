import { RunError } from './run.mjs';

/** Unknown/absent CI is not green. The reviewed contract can document no CI. */
export function assertCiReady({ checks, expectedHead, observedHead, policy }) {
  if (!expectedHead || observedHead !== expectedHead) throw new RunError('cannot ready: PR head differs from the reviewed and verified head');
  if (!Array.isArray(checks)) throw new RunError('cannot ready: CI evidence is unavailable');
  if (!checks.length) {
    if (policy?.mode === 'none' && typeof policy.reason === 'string' && policy.reason.trim()) return;
    throw new RunError('cannot ready: no CI checks observed; require passing checks or an explicitly reviewed no-CI policy');
  }
  const bad = checks.filter((c) => c.bucket !== 'pass');
  if (bad.length) throw new RunError(`cannot ready: CI is not passing: ${bad.map((c) => c.name).join(', ')}`);
  for (const name of policy?.requiredChecks ?? []) if (!checks.some((c) => c.name === name)) throw new RunError(`cannot ready: missing required check ${name}`);
}

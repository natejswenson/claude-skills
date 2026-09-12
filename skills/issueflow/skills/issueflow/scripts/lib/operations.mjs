/** Persist intent before remote mutation, confirm by read-back, preserve uncertainty. */
import { hash } from './contracts.mjs';
import { HandBack, saveRun } from './run.mjs';

export function operation(dir, run, { kind, target, intent, read, write, retrySafe = false }) {
  const key = hash({ kind, target, intent });
  run.operations ??= {};
  let record = run.operations[key];
  const existed = Boolean(record);
  if (!record) {
    record = run.operations[key] = { key, kind, target, intent, state: 'pending', attempts: 0, createdAt: new Date().toISOString() };
    saveRun(dir, run);
  }
  const confirm = (observed) => {
    record.state = 'confirmed'; record.observed = observed; record.confirmedAt = new Date().toISOString();
    saveRun(dir, run); return observed;
  };
  // read returns null only for observed absence; infrastructure errors throw.
  const prior = read(key);
  if (prior) return confirm(prior);
  if (existed && record.attempts > 0 && !retrySafe) throw new HandBack(`remote operation ${kind} has an uncertain outcome; reconcile ${key} before retrying the mutation`);
  if (record.attempts >= 3) throw new HandBack(`remote operation ${kind} exhausted three bounded attempts`);
  record.state = 'uncertain'; record.attempts += 1; saveRun(dir, run);
  let failure;
  try { write(key); } catch (e) { failure = e; }
  let observed;
  try { observed = read(key); } catch (e) { failure ??= e; }
  if (observed) return confirm(observed);
  record.lastError = String(failure?.message ?? 'effect not observed after mutation').slice(0, 500); saveRun(dir, run);
  throw new HandBack(`remote operation ${kind} is unconfirmed (${key}): ${record.lastError}; no completion claimed`);
}

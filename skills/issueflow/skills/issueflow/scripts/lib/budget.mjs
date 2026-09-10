/** Wall-clock allowance is independent of complexity and review-round limits. */
import { RunError, runState } from './run.mjs';

export const DISPATCHES = new Set(['brief', 'review-brief', 'review-verify', 'review-fix-brief', 'dispatch-wave']);

/** Schema-3 runs need no migration: their first window starts at createdAt. */
export function budgetStatus(run, now = new Date().toISOString()) {
  const renewal = run.budgetRenewals?.at(-1);
  const allowanceSeconds = renewal?.budgetSeconds ?? run.complexity?.budgetSeconds;
  const start = Date.parse(renewal?.at ?? run.createdAt);
  if (!allowanceSeconds || !Number.isFinite(start)) return null;
  const deadline = start + allowanceSeconds * 1000;
  const current = Date.parse(now);
  return {
    elapsedSeconds: Math.max(0, (current - Date.parse(run.createdAt)) / 1000),
    allowanceSeconds,
    remainingSeconds: Math.max(0, (deadline - current) / 1000),
    expired: current >= deadline,
    deadline: new Date(deadline).toISOString(),
  };
}

/** Validate everything before touching the run. Resume grants a fresh window. */
export function renewBudget(run, value, now = new Date().toISOString()) {
  if (typeof value !== 'string' || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) <= 0) {
    throw new RunError('--budget-seconds must be a positive safe integer');
  }
  const budgetSeconds = Number(value);
  const start = Date.parse(now);
  const deadline = start + budgetSeconds * 1000;
  if (!Number.isSafeInteger(deadline) || !Number.isFinite(new Date(deadline).getTime())) {
    throw new RunError('--budget-seconds must produce a representable deadline');
  }
  if (runState(run) === 'done') throw new RunError('a completed run cannot be resumed');
  if (!budgetStatus(run, now)?.expired) throw new RunError('the budget is already active — no time was added');
  run.budgetRenewals ??= [];
  run.budgetRenewals.push({ at: now, budgetSeconds });
  return budgetStatus(run, now);
}

export function budgetStop(budget) {
  return {
    kind: 'stop', reason: 'budget', budget,
    detail: 'The time allowance expired. Delivered results retain their gates; new worker dispatches require explicit resume.',
    command: 'resume --budget-seconds 1800',
  };
}

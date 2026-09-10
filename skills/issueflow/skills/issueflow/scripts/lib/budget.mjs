/** Wall-clock allowance is independent of complexity and review-round limits. */
import { RunError, runState } from './run.mjs';

export const DISPATCHES = new Set(['brief', 'review-brief', 'review-verify', 'review-fix-brief']);

/** Schema-3 runs need no migration: their first window starts at createdAt. */
export function budgetStatus(run, now = new Date().toISOString()) {
  const renewal = run.budgetRenewals?.at(-1);
  const allowanceSeconds = renewal?.budgetSeconds ?? run.complexity?.budgetSeconds;
  const start = Date.parse(renewal?.at ?? run.createdAt);
  if (!allowanceSeconds || !Number.isFinite(start)) return null;
  const deadline = start + allowanceSeconds * 1000;
  const current = Date.parse(now);
  const usedSeconds = (run.complexity?.budgetSeconds ?? 0) + (run.budgetRenewals ?? []).reduce((sum, r) => sum + (Number(r.budgetSeconds) || 0), 0);
  const totalBudgetSeconds = Number.isFinite(run.totalBudgetSeconds) ? run.totalBudgetSeconds : null;
  return {
    elapsedSeconds: Math.max(0, (current - Date.parse(run.createdAt)) / 1000),
    allowanceSeconds,
    remainingSeconds: Math.max(0, (deadline - current) / 1000),
    expired: current >= deadline,
    deadline: new Date(deadline).toISOString(),
    usedSeconds,
    totalBudgetSeconds,
    totalRemainingSeconds: totalBudgetSeconds == null ? null : Math.max(0, totalBudgetSeconds - usedSeconds),
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
  const current = budgetStatus(run, now);
  if (!current?.expired) throw new RunError('the budget is already active — no time was added');
  if (current.totalRemainingSeconds != null && current.totalRemainingSeconds <= 0) {
    throw new RunError('the hard cumulative budget cap is spent — no more time can be added');
  }
  if (current.totalRemainingSeconds != null && budgetSeconds > current.totalRemainingSeconds) {
    throw new RunError(`--budget-seconds exceeds the ${current.totalRemainingSeconds}s remaining cumulative cap`);
  }
  run.budgetRenewals ??= [];
  run.budgetRenewals.push({ at: now, budgetSeconds });
  return budgetStatus(run, now);
}

export function budgetStop(budget) {
  return {
    kind: 'stop', reason: 'budget', budget,
    detail: budget.totalBudgetSeconds != null && budget.totalRemainingSeconds <= 0
      ? 'The hard cumulative time cap is spent. Delivered results retain their gates; no further worker dispatch is permitted.'
      : 'The time allowance expired. Delivered results retain their gates; new worker dispatches require explicit resume.',
    command: 'resume --budget-seconds 1800',
  };
}

/** Renew one window for an explicitly autonomous run, without exceeding its
 * persisted hard cap. Returns null when the cap is exhausted. */
export function autoRenewBudget(run, now = new Date().toISOString()) {
  const status = budgetStatus(run, now);
  if (!status?.expired || !run.autonomous) return null;
  if (status.totalRemainingSeconds != null && status.totalRemainingSeconds <= 0) return null;
  const allowance = status.totalRemainingSeconds == null
    ? status.allowanceSeconds
    : Math.min(status.allowanceSeconds, status.totalRemainingSeconds);
  run.budgetRenewals ??= [];
  run.budgetRenewals.push({ at: now, budgetSeconds: allowance, automatic: true });
  return budgetStatus(run, now);
}

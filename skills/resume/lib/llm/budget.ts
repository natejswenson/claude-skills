/**
 * Daily LLM spend cap — Tier 1 process-memory counter (#9 / A5).
 *
 * Tracks aggregate WORST-CASE cost across all LLM calls in the current
 * container since UTC midnight. Pre-call gate in `anthropic.ts` calls
 * `reserve(worstCase)` — if the new total would exceed `DAILY_CAP_USD`,
 * the call is refused BEFORE the API hits.
 *
 * Why worst-case (vs. actual): the gate fires BEFORE the API round-trip.
 * Actual cost is only known post-response. Using worst-case makes the
 * cap genuinely protective — an adversary cannot use optimistic cache
 * pricing to slip over the line.
 *
 * Limitation (documented, acceptable for Tier 1): serverless scale-out
 * spreads spend across containers. Effective cap = DAILY_CAP_USD ×
 * active_container_count. When one container is warm for a single user,
 * this is a true per-day cap; under real load with horizontal scaling
 * the cap is softer. Tier 2 (Vercel KV / Upstash atomic INCR) closes
 * this gap — tracked as a follow-up in #9.
 *
 * Rollover: the counter is keyed by `YYYY-MM-DD` in UTC; a call on a
 * different day starts the sum fresh. No scheduled reset — the bucket
 * flip is opportunistic.
 */

import { logInfo, logWarn } from "../log.ts";

const DEFAULT_DAILY_CAP_USD = 10;

function getDailyCap(): number {
  const raw = process.env.LLM_DAILY_CAP_USD;
  if (!raw) return DEFAULT_DAILY_CAP_USD;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_DAILY_CAP_USD;
  return parsed;
}

function utcDayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function secondsUntilUtcMidnight(now: Date = new Date()): number {
  const end = new Date(now);
  end.setUTCHours(24, 0, 0, 0);
  return Math.ceil((end.getTime() - now.getTime()) / 1000);
}

interface BudgetState {
  day: string;
  totalUsd: number;
}

let state: BudgetState = { day: utcDayKey(), totalUsd: 0 };

function rolloverIfNeeded(): void {
  const today = utcDayKey();
  if (state.day !== today) {
    state = { day: today, totalUsd: 0 };
  }
}

export interface ReserveResult {
  ok: boolean;
  /** USD total AFTER this reservation (whether accepted or not). */
  totalUsd: number;
  /** Only set when ok=false — seconds until the counter resets. */
  retryAfterSeconds?: number;
  /** Only set when ok=false — the cap that was exceeded. */
  capUsd?: number;
}

/**
 * Reserve spend against the daily counter. Call BEFORE the API round-trip
 * with the worst-case estimate. Returns ok=false when over cap; caller
 * should refuse the LLM call. Ok=true paths commit the reservation to
 * the counter immediately — there is no settle step in Tier 1.
 */
export function reserve(worstCaseUsd: number): ReserveResult {
  rolloverIfNeeded();
  const cap = getDailyCap();
  const projected = state.totalUsd + worstCaseUsd;
  if (projected > cap) {
    const retryAfterSeconds = secondsUntilUtcMidnight();
    logWarn("llm_daily_budget_exceeded", {
      day: state.day,
      attempted_usd: Number(worstCaseUsd.toFixed(4)),
      running_total_usd: Number(state.totalUsd.toFixed(4)),
      cap_usd: cap,
      retry_after_seconds: retryAfterSeconds,
    });
    return { ok: false, totalUsd: state.totalUsd, retryAfterSeconds, capUsd: cap };
  }
  state.totalUsd = projected;
  // Log every reservation above 50% of cap so the operator sees pressure
  // BEFORE the breach. Below 50% is normal traffic — skip to avoid spam.
  if (projected > cap / 2) {
    logInfo("llm_daily_budget_pressure", {
      day: state.day,
      running_total_usd: Number(projected.toFixed(4)),
      cap_usd: cap,
      percent_used: Math.round((projected / cap) * 100),
    });
  }
  return { ok: true, totalUsd: projected };
}

/**
 * Test-only: force the counter to a specific state. Not exported in the
 * barrel; reached via direct import in scripts/ tests.
 */
export function _setStateForTest(day: string, totalUsd: number): void {
  state = { day, totalUsd };
}

export function _getStateForTest(): BudgetState {
  return { ...state };
}

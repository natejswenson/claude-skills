/**
 * BudgetGate — pre-call + cumulative budget enforcement for the optimizer loop.
 *
 * Hard cap + safety factor on pre-call estimate. Atomic persistence via
 * write-temp-then-rename to the state dir.
 */

import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";

// Pricing — mirrors lib/llm/anthropic.ts and scripts/redteam-multi.mjs
export const PRICING = {
  "claude-sonnet-4-20250514":   { input: 3,    output: 15,  cacheRead: 0.30, cacheWrite: 3.75 },
  "claude-sonnet-4-6":          { input: 3,    output: 15,  cacheRead: 0.30, cacheWrite: 3.75 },
  "claude-opus-4-7":            { input: 15,   output: 75,  cacheRead: 1.50, cacheWrite: 18.75 },
  "claude-haiku-4-5-20251001":  { input: 0.80, output: 4,   cacheRead: 0.08, cacheWrite: 1 },
};

export class BudgetExceededError extends Error {
  constructor(estimated, cumulative, cap) {
    super(`Budget would be exceeded: estimated +$${estimated.toFixed(4)}, cumulative $${cumulative.toFixed(4)}, cap $${cap.toFixed(2)}`);
    this.name = "BudgetExceededError";
    this.estimated = estimated;
    this.cumulative = cumulative;
    this.cap = cap;
  }
}

export class BudgetGate {
  /**
   * @param {{ capUsd: number, stateFile?: string, safetyFactor?: number }} opts
   */
  constructor({ capUsd, stateFile = null, safetyFactor = 1.3 }) {
    this.capUsd = capUsd;
    this.safetyFactor = safetyFactor;
    this.stateFile = stateFile;
    this.cumulativeUsd = 0;
    this.log = [];  // per-call { ts, model, estimated, actual, cumulative, kind }

    if (stateFile && existsSync(stateFile)) {
      const data = JSON.parse(readFileSync(stateFile, "utf-8"));
      this.cumulativeUsd = data.cumulative_usd ?? 0;
      this.log = data.log ?? [];
    }
  }

  /**
   * Throws BudgetExceededError if `estimatedUsd × safetyFactor` would push
   * cumulative past `capUsd`.
   */
  assertBudget(estimatedUsd) {
    const projected = this.cumulativeUsd + estimatedUsd * this.safetyFactor;
    if (projected > this.capUsd) {
      throw new BudgetExceededError(estimatedUsd, this.cumulativeUsd, this.capUsd);
    }
  }

  /**
   * Record an actual call cost (from Anthropic `usage` → `estimateCostFromUsage`).
   */
  record(actualUsd, meta = {}) {
    this.cumulativeUsd += actualUsd;
    this.log.push({
      ts: Date.now(),
      actual: actualUsd,
      cumulative: this.cumulativeUsd,
      ...meta,
    });
    this._persist();
  }

  remaining() {
    return Math.max(0, this.capUsd - this.cumulativeUsd);
  }

  /**
   * Tier of current spend. Drives the orchestrator's behavior.
   * @returns {'normal' | 'half' | 'late' | 'final' | 'halt'}
   */
  tier() {
    const pct = this.cumulativeUsd / this.capUsd;
    if (pct >= 0.97) return "halt";
    if (pct >= 0.90) return "final";
    if (pct >= 0.75) return "late";
    if (pct >= 0.50) return "half";
    return "normal";
  }

  _persist() {
    if (!this.stateFile) return;
    const tmp = this.stateFile + ".tmp";
    writeFileSync(
      tmp,
      JSON.stringify(
        {
          cumulative_usd: this.cumulativeUsd,
          cap_usd: this.capUsd,
          log: this.log.slice(-500), // cap log size
          last_update: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    renameSync(tmp, this.stateFile);
  }
}

/**
 * Given Anthropic `usage` response, compute actual cost for a given model.
 */
export function estimateCostFromUsage(usage, model) {
  const rates = PRICING[model];
  if (!rates) throw new Error(`No pricing for model ${model}`);
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const regularInput = Math.max(0, (usage.input_tokens ?? 0) - cacheRead - cacheWrite);
  return (
    (regularInput / 1_000_000) * rates.input +
    ((usage.output_tokens ?? 0) / 1_000_000) * rates.output +
    (cacheRead / 1_000_000) * rates.cacheRead +
    (cacheWrite / 1_000_000) * rates.cacheWrite
  );
}

/**
 * Rough pre-call estimate. `sysTokens` is cache-read on non-first calls.
 * `userTokens` is fresh input. `outputTokensEst` is expected output.
 */
export function estimateCallCost({ model, sysTokens, userTokens, outputTokensEst, firstCall = false }) {
  const rates = PRICING[model];
  if (!rates) throw new Error(`No pricing for model ${model}`);
  const sysCost = firstCall
    ? (sysTokens / 1_000_000) * rates.cacheWrite
    : (sysTokens / 1_000_000) * rates.cacheRead;
  return (
    sysCost +
    (userTokens / 1_000_000) * rates.input +
    (outputTokensEst / 1_000_000) * rates.output
  );
}

// Approximate tokenizer: 4 chars ≈ 1 token. Conservative upper bound for English.
export function approxTokens(text) {
  return Math.ceil((text?.length ?? 0) / 4);
}

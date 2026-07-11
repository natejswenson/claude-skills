// Cost control for live eval runs. Ported from ghostwriter's evals/budget.py:
// deliberately over-estimates, guards BEFORE any call that would exceed the
// cap, and forces mock mode when there is no API key so CI can never spend.

export const DEFAULT_MAX_SPEND = 0.50; // USD

// Conservative blended $/1K-token prices by model-family substring. These are
// intentionally pessimistic (treated as if every token cost the output rate).
const PRICE_PER_1K = [
  [/haiku/i, 0.005],
  [/sonnet/i, 0.018],
  [/opus/i, 0.09],
];
const DEFAULT_PRICE_PER_1K = 0.02;

export function pricePer1k(model) {
  for (const [re, price] of PRICE_PER_1K) {
    if (re.test(model || '')) return price;
  }
  return DEFAULT_PRICE_PER_1K;
}

// Over-estimate the cost of one `claude -p` judge call: a context baseline for
// the re-sent system prompt, ~4 chars/token for the prompt itself, plus the
// output budget.
export function estimateUsd(text, model, { outputTokens = 800, contextTokens = 6000 } = {}) {
  const promptTokens = Math.ceil((text || '').length / 4);
  const totalTokens = contextTokens + promptTokens + outputTokens;
  return (totalTokens / 1000) * pricePer1k(model);
}

export class BudgetExceeded extends Error {}

export class Budget {
  constructor(maxSpend = DEFAULT_MAX_SPEND) {
    this.maxSpend = maxSpend;
    this.spent = 0;
  }

  // Call BEFORE spending: throws if the estimate would push cumulative spend
  // over the cap. The cap is a hard ceiling, not advisory.
  guard(estimate) {
    if (this.spent + estimate > this.maxSpend) {
      throw new BudgetExceeded(
        `Refusing call: ~$${estimate.toFixed(3)} would push spend to `
        + `$${(this.spent + estimate).toFixed(3)} > cap $${this.maxSpend.toFixed(2)}`,
      );
    }
  }

  record(actual) {
    this.spent += actual;
  }
}

// Mock is forced when there is no ANTHROPIC_API_KEY — CI has no key, so a
// forgotten --mock flag can never turn into a live spend there.
export function mockEnabled(flag) {
  return Boolean(flag) || !process.env.ANTHROPIC_API_KEY;
}

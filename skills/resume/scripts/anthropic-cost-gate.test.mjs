#!/usr/bin/env node
/**
 * Unit tests for lib/llm/anthropic.ts — pre-flight cost gate (#6 / A4).
 *
 * Covers:
 *   - estimateInputTokens returns a reasonable byte-to-token ratio.
 *   - estimateWorstCaseCost matches hand-computed values for our two
 *     supported models.
 *   - AnthropicAdapter.completeStructured THROWS cost_cap_exceeded
 *     BEFORE issuing a fetch when worst-case exceeds MAX_COST_USD.
 *
 * No network — installs a global fetch stub that throws if called. If
 * the gate ever regresses to post-call the tests will fail loudly.
 *
 * Run: node scripts/anthropic-cost-gate.test.mjs
 */

import assert from "node:assert/strict";

process.env.ANTHROPIC_API_KEY = "sk-ant-dummy-test-key";

// Install the fetch stub BEFORE importing anthropic.ts so the adapter
// binds to this stub, not real fetch. The stub records calls and throws
// if it's ever invoked (over-cap tests must never reach here).
let fetchCalls = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (...args) => {
  fetchCalls.push(args);
  throw new Error("STUB: fetch() should not have been called");
};

const {
  AnthropicAdapter,
  estimateInputTokens,
  estimateWorstCaseCost,
} = await import("../lib/llm/anthropic.ts");

let pass = 0,
  fail = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    pass++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`     ${err.message}`);
    fail++;
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    pass++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`     ${err.message}`);
    fail++;
  }
}

// ============================================================
console.log("\n[estimateInputTokens]");
// ============================================================

test("empty strings → 0 tokens", () => {
  assert.equal(estimateInputTokens("", ""), 0);
});

test("105 chars → ~30 tokens (CHARS_PER_TOKEN=3.5)", () => {
  // 105 / 3.5 = 30
  const t = estimateInputTokens("a".repeat(52), "b".repeat(53));
  assert.equal(t, 30);
});

test("counts system + user additively", () => {
  // system=70 chars, user=140 chars → (70+140)/3.5 = 60
  const t = estimateInputTokens("a".repeat(70), "b".repeat(140));
  assert.equal(t, 60);
});

test("rounds UP (conservative — prefer false-reject over false-allow)", () => {
  // 10 chars / 3.5 = 2.857 → ceil = 3
  const t = estimateInputTokens("", "a".repeat(10));
  assert.equal(t, 3);
});

// ============================================================
console.log("\n[estimateWorstCaseCost]");
// ============================================================

test("Sonnet — 10k input + 4k output ≈ $0.0975", () => {
  // Sonnet cacheWrite: $3.75/M; output: $15/M
  // (10000 / 1e6) × 3.75 + (4000 / 1e6) × 15 = 0.0375 + 0.060 = 0.0975
  const c = estimateWorstCaseCost("claude-sonnet-4-20250514", 10_000, 4000);
  assert(
    Math.abs(c - 0.0975) < 1e-6,
    `expected 0.0975, got ${c}`,
  );
});

test("Haiku — 10k input + 4k output ≈ $0.026", () => {
  // Haiku cacheWrite: $1/M; output: $4/M
  // (10000 / 1e6) × 1 + (4000 / 1e6) × 4 = 0.01 + 0.016 = 0.026
  const c = estimateWorstCaseCost("claude-haiku-4-5-20251001", 10_000, 4000);
  assert(
    Math.abs(c - 0.026) < 1e-6,
    `expected 0.026, got ${c}`,
  );
});

test("unknown model → Infinity (fails closed)", () => {
  const c = estimateWorstCaseCost("unknown-model-id", 10_000, 4000);
  assert.equal(c, Infinity);
});

test("Sonnet — $0.15 cap triggers at ~37k input tokens", () => {
  // With 4000 output: (x/1e6)*3.75 + 0.060 = 0.15
  // x = (0.15 - 0.060) / 3.75e-6 = 24000
  // So 24000 input tokens is the break-even for Sonnet. Verify.
  const atBreak = estimateWorstCaseCost("claude-sonnet-4-20250514", 24_000, 4000);
  const justOver = estimateWorstCaseCost("claude-sonnet-4-20250514", 24_001, 4000);
  assert(atBreak <= 0.15, `at-break should be <=0.15, got ${atBreak}`);
  assert(justOver > 0.15, `just-over should be >0.15, got ${justOver}`);
});

// ============================================================
console.log("\n[pre-flight gate blocks expensive calls]");
// ============================================================

await asyncTest(
  "throws cost_cap_exceeded for an oversized prompt — no fetch fires",
  async () => {
    fetchCalls = [];
    const adapter = new AnthropicAdapter();
    // 500k chars = ~143k tokens. At $3.75/M cacheWrite + $15/M output for
    // Sonnet with 4k output, that's (143000/1e6)*3.75 + 0.06 = ~$0.596.
    // Well over $0.15 cap.
    const hugeSystem = "a".repeat(250_000);
    const hugeUser = "b".repeat(250_000);
    try {
      await adapter.completeStructured({
        system: hugeSystem,
        user: hugeUser,
        schema: {},
        model: "sonnet",
      });
      assert.fail("should have thrown");
    } catch (err) {
      assert(
        err.message.startsWith("cost_cap_exceeded"),
        `expected cost_cap_exceeded, got: ${err.message}`,
      );
    }
    assert.equal(
      fetchCalls.length,
      0,
      "fetch must NOT have been called for an over-cap request",
    );
  },
);

await asyncTest(
  "allows under-cap prompt — fetch called (stub throws to stop test short)",
  async () => {
    fetchCalls = [];
    const adapter = new AnthropicAdapter();
    // 1000 chars system + 1000 user ≈ 572 tokens. Well under cap for any
    // model. Fetch should fire (and our stub will throw STUB: message).
    try {
      await adapter.completeStructured({
        system: "a".repeat(1000),
        user: "b".repeat(1000),
        schema: {},
        model: "sonnet",
      });
      assert.fail("stub fetch should have thrown");
    } catch (err) {
      assert(
        err.message.includes("STUB: fetch()"),
        `expected stub throw, got: ${err.message}`,
      );
    }
    assert.equal(fetchCalls.length, 1, "fetch should have fired once");
  },
);

await asyncTest(
  "unknown model → cost_cap_exceeded (fails closed, not open)",
  async () => {
    fetchCalls = [];
    const adapter = new AnthropicAdapter();
    try {
      await adapter.completeStructured({
        system: "a".repeat(100),
        user: "b".repeat(100),
        schema: {},
        model: "nonexistent-model",
      });
      assert.fail("should have thrown");
    } catch (err) {
      assert(
        err.message.startsWith("cost_cap_exceeded"),
        `expected cost_cap_exceeded for unknown model, got: ${err.message}`,
      );
    }
    assert.equal(fetchCalls.length, 0);
  },
);

// ============================================================
console.log(`\nresult: ${pass} passed, ${fail} failed`);
// Restore real fetch so the test harness itself can run other tests.
globalThis.fetch = originalFetch;
if (fail > 0) process.exit(1);

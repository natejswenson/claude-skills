#!/usr/bin/env node
/**
 * Unit tests for lib/llm/budget.ts — daily LLM spend cap (#9 / A5).
 *
 * Covers:
 *   - reserve accumulates inside the same UTC day.
 *   - reserve rejects when projected total exceeds LLM_DAILY_CAP_USD.
 *   - Rejected reservations do NOT mutate the counter (safe to retry
 *     with a smaller worst-case).
 *   - Counter rolls over when the UTC day key changes.
 *   - LLM_DAILY_CAP_USD env var overrides the default.
 *   - retryAfterSeconds points to the NEXT UTC midnight.
 *
 * Run: node scripts/llm-budget.test.mjs
 */

import assert from "node:assert/strict";

process.env.LLM_DAILY_CAP_USD = "5";

const { reserve, _setStateForTest, _getStateForTest } = await import(
  "../lib/llm/budget.ts"
);

let pass = 0,
  fail = 0;
function test(name, fn) {
  try {
    // Fresh state every test — default to today with zero spend.
    const today = new Date().toISOString().slice(0, 10);
    _setStateForTest(today, 0);
    fn();
    console.log(`  ✓ ${name}`);
    pass++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`     ${err.message}`);
    fail++;
  }
}

// ============================================================
console.log("\n[reserve — happy path]");
// ============================================================

test("first reserve — accepts and sets total", () => {
  const r = reserve(1.5);
  assert.equal(r.ok, true);
  assert.equal(r.totalUsd, 1.5);
  assert.equal(_getStateForTest().totalUsd, 1.5);
});

test("two reserves accumulate", () => {
  reserve(1.0);
  const r2 = reserve(2.0);
  assert.equal(r2.ok, true);
  assert.equal(r2.totalUsd, 3.0);
});

test("exactly at cap is accepted (< is the breach, not ≤)", () => {
  const r = reserve(5.0);
  assert.equal(r.ok, true, "cap=5, reserve=5 should succeed");
  assert.equal(r.totalUsd, 5.0);
});

// ============================================================
console.log("\n[reserve — over cap]");
// ============================================================

test("over-cap reserve rejects and does NOT mutate counter", () => {
  reserve(4.0); // counter now 4.0
  const r = reserve(2.0); // would be 6.0 > 5.0 cap
  assert.equal(r.ok, false);
  assert.equal(r.capUsd, 5);
  // Counter still 4.0 — rejected reservation did not commit.
  assert.equal(_getStateForTest().totalUsd, 4.0);
});

test("after reject, a smaller reserve can succeed", () => {
  reserve(4.5);
  const bigReject = reserve(1.0); // 5.5 > 5 — reject
  assert.equal(bigReject.ok, false);
  const smallOk = reserve(0.4); // 4.9 ≤ 5 — ok
  assert.equal(smallOk.ok, true);
  assert.equal(smallOk.totalUsd, 4.9);
});

test("retryAfterSeconds is in [1, 86400] (seconds until UTC midnight)", () => {
  reserve(5.0);
  const r = reserve(0.1);
  assert.equal(r.ok, false);
  assert(
    typeof r.retryAfterSeconds === "number" &&
      r.retryAfterSeconds >= 1 &&
      r.retryAfterSeconds <= 86_400,
    `expected [1..86400], got ${r.retryAfterSeconds}`,
  );
});

// ============================================================
console.log("\n[rollover]");
// ============================================================

test("rollover — a reserve on a new UTC day resets the counter", () => {
  // Manually prime yesterday with max spend.
  _setStateForTest("2024-01-01", 4.9);
  // A reserve today should rollover, seeing totalUsd=0 inside.
  const r = reserve(3.0);
  assert.equal(r.ok, true);
  assert.equal(r.totalUsd, 3.0, "rollover should have reset prior-day total");
  const state = _getStateForTest();
  assert.notEqual(state.day, "2024-01-01", "day key should have advanced");
});

// ============================================================
console.log("\n[env override]");
// ============================================================

test("LLM_DAILY_CAP_USD is read at call time, not at import", () => {
  // Switch cap mid-test; reserve should use the new value.
  process.env.LLM_DAILY_CAP_USD = "2";
  const r = reserve(2.5);
  assert.equal(r.ok, false, "should reject under the new $2 cap");
  assert.equal(r.capUsd, 2);
  process.env.LLM_DAILY_CAP_USD = "5"; // restore for other tests
});

test("garbage LLM_DAILY_CAP_USD falls back to default $10", () => {
  process.env.LLM_DAILY_CAP_USD = "not-a-number";
  const r = reserve(9.0);
  assert.equal(r.ok, true, "default cap of $10 should accept $9");
  process.env.LLM_DAILY_CAP_USD = "5";
});

test("negative LLM_DAILY_CAP_USD also falls back to default", () => {
  process.env.LLM_DAILY_CAP_USD = "-1";
  const r = reserve(9.0);
  assert.equal(r.ok, true);
  process.env.LLM_DAILY_CAP_USD = "5";
});

// ============================================================
console.log(`\nresult: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

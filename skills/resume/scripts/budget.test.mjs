#!/usr/bin/env node
/**
 * Tests for BudgetGate (scripts/scorer/budget.mjs), extracted from the
 * retiring scripts/scorer.test.mjs — BudgetGate has no dependency on the
 * retired pipeline (it gates dollars, not pipelines) and is reused as-is by
 * the new eval harness's capped LLM-judge pass.
 *
 * No API calls. Run: node scripts/budget.test.mjs
 */
import assert from "node:assert/strict";
import { BudgetGate, BudgetExceededError, estimateCallCost } from "./scorer/budget.mjs";

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

console.log("\n[budget gate]");

test("assertBudget passes when projected < cap", () => {
  const g = new BudgetGate({ capUsd: 1.0 });
  g.assertBudget(0.5); // 0.5 × 1.3 = 0.65 < 1.0 ✓
});

test("assertBudget throws when projected > cap", () => {
  const g = new BudgetGate({ capUsd: 1.0 });
  g.cumulativeUsd = 0.5;
  assert.throws(
    () => g.assertBudget(0.5), // 0.5 + 0.65 = 1.15 > 1.0
    BudgetExceededError,
  );
});

test("tier reflects cumulative spend", () => {
  const g = new BudgetGate({ capUsd: 7.0 });
  assert.equal(g.tier(), "normal");
  g.cumulativeUsd = 3.6;
  assert.equal(g.tier(), "half");
  g.cumulativeUsd = 5.5;
  assert.equal(g.tier(), "late");
  g.cumulativeUsd = 6.35;
  assert.equal(g.tier(), "final");
  g.cumulativeUsd = 6.8;
  assert.equal(g.tier(), "halt");
});

test("estimateCallCost is non-zero for real models", () => {
  const c = estimateCallCost({
    model: "claude-haiku-4-5-20251001",
    sysTokens: 3000,
    userTokens: 2000,
    outputTokensEst: 3000,
    firstCall: false,
  });
  assert(c > 0 && c < 0.05, `expected 0 < c < 0.05, got ${c}`);
});

console.log(`\nresult: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

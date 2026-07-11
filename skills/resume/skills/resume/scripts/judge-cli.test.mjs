#!/usr/bin/env node
/**
 * Tests for the $0 subscription-CLI judges (scripts/scorer/judge-cli.mjs),
 * extracted from the retiring scripts/benchmark.test.mjs — judge-cli.mjs has
 * no dependency on the retired pipeline and survives as the eval harness's
 * optional, always-$0, non-authoritative corroborating signal (separate from
 * the capped paid-API judge pass).
 *
 * $0, no network (forces a spawn failure to verify fail-open behavior).
 * Run: node scripts/judge-cli.test.mjs
 */
import assert from "node:assert/strict";
import { judgeTailoringFitCli, judgeGroundingCli } from "./scorer/judge-cli.mjs";

let pass = 0,
  fail = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    pass++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`     ${err.stack || err.message}`);
    fail++;
  }
}

console.log("\n[CLI judges fail open]");

await test("G1 judge fails open to neutral 50 on child exit-1 (no claude)", async () => {
  process.env.BENCHMARK_CLAUDE_BIN = "false"; // exits 1 immediately
  const r = await judgeTailoringFitCli({ resume: { experience: [{ bullets: ["x"] }] }, jobText: "job" });
  delete process.env.BENCHMARK_CLAUDE_BIN;
  assert.equal(r.score, 50, `expected neutral 50, got ${r.score}`);
  assert.equal(r.breakdown.reason, "judge_failed");
});

await test("grounding judge fails open to empty list on bogus binary (spawn error)", async () => {
  process.env.BENCHMARK_CLAUDE_BIN = "definitely-not-a-real-binary-xyz";
  const r = await judgeGroundingCli({ resume: { summary: "s", experience: [] }, sourceText: "src" });
  delete process.env.BENCHMARK_CLAUDE_BIN;
  assert.equal(r.ok, true);
  assert.deepEqual(r.ungrounded, []);
  assert.equal(r.reason, "judge_failed");
});

console.log(`\nresult: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

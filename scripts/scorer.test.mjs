#!/usr/bin/env node
/**
 * Deterministic tests for lib scorer (L1 + L2) and budget gate.
 * No API calls. Run: node scripts/scorer.test.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { scoreLexicon, lexiconScore } from "./scorer/lexicon.mjs";
import { scoreStylometry } from "./scorer/stylometry.mjs";
import { BudgetGate, BudgetExceededError, estimateCallCost } from "./scorer/budget.mjs";
import { scoreEval, g3HardFloorCheck } from "./scorer/index.mjs";

/**
 * Extract a rule body by ID (e.g. "R4") from the system prompt.
 * Inlined from the retired `mutate.mjs` optimizer tooling.
 */
function extractRuleBody(prompt, ruleId) {
  const n = parseInt(ruleId.replace("R", ""), 10);
  const startRe = new RegExp(`(?:\\*\\*)?${ruleId}\\.`, "m");
  const start = prompt.search(startRe);
  if (start === -1) return null;
  let end = prompt.length;
  for (let i = n + 1; i <= 10; i++) {
    const nextRe = new RegExp(`(?:^|\\n)(?:\\*\\*)?R${i}\\.`, "m");
    const m = prompt.slice(start + 5).search(nextRe);
    if (m !== -1) {
      end = Math.min(end, start + 5 + m);
      break;
    }
  }
  const sectionRe = /\n#\s+[A-Z]/;
  const sectionIdx = prompt.slice(start + 5).search(sectionRe);
  if (sectionIdx !== -1) {
    end = Math.min(end, start + 5 + sectionIdx);
  }
  return prompt.slice(start, end).replace(/\s+$/, "");
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

let pass = 0, fail = 0;
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

// ============================================================
console.log("\n[lexicon]");
// ============================================================

test("AI-heavy bullet scores low (high density)", () => {
  const bullets = [
    "Leveraged cross-functional stakeholders to drive end-to-end transformative solutions.",
    "Orchestrated mission-critical initiatives utilizing cutting-edge technology.",
  ];
  const res = scoreLexicon(bullets);
  assert(res.weightedHits > 6, `expected weightedHits > 6, got ${res.weightedHits}`);
  assert(res.density > 10, `expected density > 10, got ${res.density}`);
  const score = lexiconScore(res);
  assert(score < 30, `expected score < 30, got ${score}`);
});

test("Human-written bullet scores high", () => {
  const bullets = [
    "Shipped v2 in six weeks, cutting onboarding time from 3 days to 40 minutes.",
    "Wrote the Redis cache that took the p99 from 820ms to 90ms.",
    "Hired 4 engineers and mentored 2 juniors through promotion.",
  ];
  const res = scoreLexicon(bullets);
  const score = lexiconScore(res);
  assert(score > 75, `expected score > 75, got ${score}, density=${res.density}`);
});

test("Deterministic: same input → same output", () => {
  const b = ["Built a tool. Orchestrated a thing."];
  const a = scoreLexicon(b);
  const c = scoreLexicon(b);
  assert.deepEqual(a, c);
});

// ============================================================
console.log("\n[stylometry]");
// ============================================================

test("Uniform-length bullets get LOW length-variance score", () => {
  const bullets = [
    "Built the widget in Node and shipped it.",    // 9 words
    "Wrote the handler in Python and deployed.",   // 7 words
    "Led the migration to Postgres and tested.",   // 8 words
  ];
  const res = scoreStylometry(bullets);
  assert(res.lengthVarianceScore < 40, `expected < 40, got ${res.lengthVarianceScore} (std=${res.lengthVarianceStd})`);
});

test("Varied-length bullets get HIGH length-variance score", () => {
  const bullets = [
    "Shipped v2.",
    "Wrote the Redis cache that took the p99 latency from 820ms to 90ms across all twelve production services.",
    "Hired four engineers and mentored two juniors through promotion after the 2023 freeze lifted.",
    "Cut CI time 40%.",
  ];
  const res = scoreStylometry(bullets);
  assert(res.lengthVarianceScore > 60, `expected > 60, got ${res.lengthVarianceScore}`);
});

test("Tricolon tells detected", () => {
  const bullets = [
    "Designed, built, and deployed three services.",
    "Planned, scoped, and shipped the feature.",
    "Wrote tests.",
  ];
  const res = scoreStylometry(bullets);
  assert(res.tricolonRate > 0.5, `expected tricolonRate > 0.5, got ${res.tricolonRate}`);
});

test("Concrete verbs score high concreteness", () => {
  const bullets = ["Built this.", "Shipped that.", "Wrote these."];
  const res = scoreStylometry(bullets);
  assert.equal(res.verbConcreteness, 1, `expected 1, got ${res.verbConcreteness}`);
});

test("Abstract verbs score low concreteness", () => {
  const bullets = ["Leveraged this.", "Orchestrated that.", "Facilitated these."];
  const res = scoreStylometry(bullets);
  assert.equal(res.verbConcreteness, 0, `expected 0, got ${res.verbConcreteness}`);
});

test("Round-number metrics flagged", () => {
  const bullets = [
    "Increased revenue by 50%.",
    "Reduced costs by 20%.",
    "Grew users by 100%.",
  ];
  const res = scoreStylometry(bullets);
  assert(res.roundMetricRatio > 0.8, `expected > 0.8, got ${res.roundMetricRatio}`);
  assert(res.roundMetricScore < 50, `expected score < 50, got ${res.roundMetricScore}`);
});

test("Specific numbers score well", () => {
  const bullets = [
    "Cut p99 latency from 820ms to 93ms.",
    "Saved $47K/yr by killing the unused replica.",
    "Closed 11 deals worth $2.3M.",
  ];
  const res = scoreStylometry(bullets);
  assert(res.roundMetricRatio < 0.3, `expected < 0.3, got ${res.roundMetricRatio}`);
});

// ============================================================
console.log("\n[budget gate]");
// ============================================================

test("assertBudget passes when projected < cap", () => {
  const g = new BudgetGate({ capUsd: 1.0 });
  g.assertBudget(0.5);   // 0.5 × 1.3 = 0.65 < 1.0 ✓
});

test("assertBudget throws when projected > cap", () => {
  const g = new BudgetGate({ capUsd: 1.0 });
  g.cumulativeUsd = 0.5;
  assert.throws(
    () => g.assertBudget(0.5),   // 0.5 + 0.65 = 1.15 > 1.0
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

// ============================================================
console.log("\n[rule extraction]");
// ============================================================

test("extractRuleBody returns R4 from lib/prompt.ts", () => {
  const promptSrc = readFileSync(resolve(ROOT, "lib/prompt.ts"), "utf-8");
  const m = promptSrc.match(/export const SYSTEM_PROMPT = `([\s\S]*?)`;/);
  const prompt = m[1];
  const body = extractRuleBody(prompt, "R4");
  assert(body !== null, "R4 not found");
  assert(body.includes("R4"), "R4 marker missing");
  assert(body.includes("Preserve all roles"), "R4 content missing");
  assert(!body.includes("R5"), "R5 leaked into R4 body");
});

test("extractRuleBody handles R10 (last rule)", () => {
  const promptSrc = readFileSync(resolve(ROOT, "lib/prompt.ts"), "utf-8");
  const m = promptSrc.match(/export const SYSTEM_PROMPT = `([\s\S]*?)`;/);
  const prompt = m[1];
  const body = extractRuleBody(prompt, "R10");
  assert(body !== null);
  assert(body.includes("Keyword integration"));
});

// ============================================================
console.log("\n[g3 hard floor]");
// ============================================================

test("g3HardFloorCheck flags a dropped sub-metric", () => {
  const inc = { g3_sub: { tricolon: 80, lexicon: 70, length_variance: 60, round_metric: 50, admitted_imperfection: 40 } };
  const cand = { g3_sub: { tricolon: 70, lexicon: 72, length_variance: 62, round_metric: 52, admitted_imperfection: 42 } }; // tricolon −10
  const r = g3HardFloorCheck(inc, cand, 5);
  assert(r.regressed);
  assert.deepEqual(r.regressedKeys, ["tricolon"]);
});

test("g3HardFloorCheck passes small regressions", () => {
  const inc = { g3_sub: { tricolon: 80 } };
  const cand = { g3_sub: { tricolon: 77 } }; // −3, below threshold 5
  assert(!g3HardFloorCheck(inc, cand, 5).regressed);
});

// ============================================================
console.log("\n[integration: scoreEval deterministic L1+L2]");
// ============================================================

test("scoreEval L1+L2 is deterministic", async () => {
  const resume = {
    experience: [
      { title: "Dev", company: "X", startDate: "2020", endDate: "Present", bullets: [
        "Built the widget.",
        "Shipped v2 with Redis.",
      ] },
    ],
  };
  const a = await scoreEval({ resume, jobText: "dev role" });
  const b = await scoreEval({ resume, jobText: "dev role" });
  assert.deepEqual(a.g2, b.g2);
  assert.deepEqual(a.g3, b.g3);
  assert.deepEqual(a.g3_sub, b.g3_sub);
});

// ============================================================
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

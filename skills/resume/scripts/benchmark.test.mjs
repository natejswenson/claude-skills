#!/usr/bin/env node
/**
 * Offline ($0, no claude spawn) tests for the resume-generator benchmark.
 *
 * Covers the design's testable invariants:
 *  - keyword coverage separates on-stack from off-stack, and is gameable
 *  - checkRules HARD vs REPORTED partition (both directions)
 *  - discrimination check (controls below / above treatment median)
 *  - CLI judges fail open (forced spawn failure → neutral result, no throw)
 *  - --mock is a plumbing check: exit 0, no claude spawn, full report renders
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { keywordCoverage } from "./eval/keyword-coverage.mjs";
import { partitionViolations, normalizeSource, median, discriminationCheck } from "./eval/benchmark-lib.mjs";
import { checkRules } from "./eval/rules.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const REGISTER = resolve(__dirname, "_tsx-register.mjs");

let pass = 0, fail = 0;
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

// ============================================================
console.log("\n[keyword-coverage]");
// ============================================================

const DEVOPS_JD =
  "Senior DevOps Engineer. Build and operate AWS infrastructure with Terraform, " +
  "Kubernetes, and CI/CD pipelines. Datadog observability, incident response, SRE.";

await test("on-stack résumé covers a DevOps JD far better than off-stack", () => {
  const devopsResume = {
    summary: "DevOps engineer building AWS infrastructure.",
    experience: [{ bullets: ["Built Terraform modules and Kubernetes pipelines.", "Ran Datadog observability and incident response."] }],
  };
  const frontendResume = {
    summary: "Frontend engineer building React interfaces.",
    experience: [{ bullets: ["Wrote TypeScript components and CSS animations.", "Designed accessible UI in Figma."] }],
  };
  const a = keywordCoverage(devopsResume, DEVOPS_JD);
  const b = keywordCoverage(frontendResume, DEVOPS_JD);
  assert(a.coverage > b.coverage, `expected devops(${a.coverage}) > frontend(${b.coverage})`);
  assert(a.matched.includes("terraform") && a.matched.includes("kubernetes"), "expected stack terms matched");
});

await test("coverage is gameable — keyword-stuffed résumé scores high", () => {
  const stuffed = { summary: DEVOPS_JD, experience: [{ bullets: [DEVOPS_JD] }] };
  const r = keywordCoverage(stuffed, DEVOPS_JD);
  assert(r.coverage > 0.9, `expected stuffed coverage > 0.9, got ${r.coverage}`);
});

await test("coverage is deterministic", () => {
  const resume = { summary: "AWS Terraform.", experience: [{ bullets: ["Kubernetes CI/CD."] }] };
  assert.deepEqual(keywordCoverage(resume, DEVOPS_JD), keywordCoverage(resume, DEVOPS_JD));
});

await test("empty JD → coverage 0, no crash", () => {
  assert.equal(keywordCoverage({ summary: "x", experience: [] }, "").coverage, 0);
});

// ============================================================
console.log("\n[checkRules HARD/REPORTED partition]");
// ============================================================

await test("HARD partition fires on banned phrase + no-op bullet", () => {
  const resume = {
    summary: "Built systems with a proven track record of delivery.", // R6_summary_phrase (HARD)
    experience: [{ company: "Acme", bullets: ["Did a thing."] }],
    optimizedBullets: [{ role: "Acme", original: "Same bullet.", rewritten: "Same bullet." }], // R9_optimized_noop (HARD)
  };
  const { hard, reported } = partitionViolations(checkRules(resume, { sourceText: "Acme. Built things." }).violations);
  const rules = hard.map((v) => v.rule).sort();
  assert(rules.includes("R6_summary_phrase"), `expected R6_summary_phrase HARD, got ${rules}`);
  assert(rules.includes("R9_optimized_noop"), `expected R9_optimized_noop HARD, got ${rules}`);
  assert.equal(reported.length, 0, `expected no REPORTED, got ${reported.map((v) => v.rule)}`);
});

await test("REPORTED-only violations do NOT enter the HARD partition", () => {
  const resume = {
    summary: "Engineer with 9 years of impact.", // R6_derived_years (REPORTED) — "9 years" not in source
    experience: [{ company: "Acme", bullets: ["Operated at scale across regions."] }], // scope_qualifier (REPORTED)
    optimizedBullets: [{ role: "Senior Engineer", original: "old wording", rewritten: "new wording" }], // R9_optimized_role_unknown (REPORTED)
  };
  const { hard, reported } = partitionViolations(checkRules(resume, { sourceText: "Acme. Engineer." }).violations);
  assert.equal(hard.length, 0, `expected 0 HARD, got ${hard.map((v) => v.rule)}`);
  const r = reported.map((v) => v.rule).sort();
  assert(r.includes("R9_optimized_role_unknown"), `expected role-unknown REPORTED, got ${r}`);
  assert(r.includes("scope_qualifier"), `expected scope_qualifier REPORTED, got ${r}`);
  assert(r.includes("R6_derived_years"), `expected derived_years REPORTED, got ${r}`);
});

await test("clean résumé → 0 HARD, 0 REPORTED (calibration shape)", () => {
  const resume = {
    summary: "DevOps engineer who ships reliable infrastructure.",
    experience: [{ company: "Acme", bullets: ["Built a Terraform module."] }],
    optimizedBullets: [{ role: "Acme", original: "made infra", rewritten: "Built a Terraform module." }],
  };
  const { hard, reported } = partitionViolations(checkRules(resume, { sourceText: "Acme. DevOps engineer who ships reliable infrastructure." }).violations);
  assert.equal(hard.length, 0);
  assert.equal(reported.length, 0);
});

// ============================================================
console.log("\n[normalizeSource]");
// ============================================================

await test("collapses whitespace and de-hyphenates line breaks", () => {
  assert.equal(normalizeSource("Kuber-\nnetes   at    GoodLeap"), "Kubernetes at GoodLeap");
});

// ============================================================
console.log("\n[discrimination check]");
// ============================================================

await test("controls below treatment median → PASS", () => {
  const rows = [
    { id: "t1", control: false, coverage: 0.5 },
    { id: "t2", control: false, coverage: 0.6 },
    { id: "t3", control: false, coverage: 0.4 },
    { id: "c1", control: true, coverage: 0.2 },
    { id: "c2", control: true, coverage: 0.25 },
  ];
  const d = discriminationCheck(rows);
  assert.equal(d.treatmentMedianCoverage, 0.5);
  assert.equal(d.pass, true);
  assert(d.controls.every((c) => c.below));
});

await test("a control AT/above the median → FAIL (catches non-discriminating metric)", () => {
  const rows = [
    { id: "t1", control: false, coverage: 0.5 },
    { id: "t2", control: false, coverage: 0.6 },
    { id: "c1", control: true, coverage: 0.55 }, // above median 0.55? median of [0.5,0.6]=0.55 → not below
  ];
  const d = discriminationCheck(rows);
  assert.equal(d.pass, false, "control at/above median must fail");
});

await test("no controls in selection → null (not evaluated)", () => {
  assert.equal(discriminationCheck([{ id: "t1", control: false, coverage: 0.5 }]), null);
});

// ============================================================
console.log("\n[CLI judges fail open]");
// ============================================================

const { judgeTailoringFitCli, judgeGroundingCli } = await import("./scorer/judge-cli.mjs");

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

// ============================================================
console.log("\n[--mock plumbing: exit 0, no claude spawn, full report]");
// ============================================================

await test("benchmark --mock runs $0, exits 0, prints the report", () => {
  const res = spawnSync(
    process.execPath,
    ["--import", REGISTER, "scripts/eval/benchmark.mjs", "--mock", "--jobs", "j1-senior-devops,j6-frontend"],
    { cwd: ROOT, encoding: "utf8", env: { ...process.env, MOCK_LLM: "1" } },
  );
  assert.equal(res.status, 0, `expected exit 0, got ${res.status}. stderr: ${res.stderr}`);
  assert(res.stdout.includes("PLUMBING CHECK"), "expected plumbing-check banner");
  assert(res.stdout.includes("Hard gate"), "expected summary line");
  assert(res.stdout.includes("j1-senior-devops"), "expected per-job row");
  // Mock must NOT emit a discrimination verdict (it's skipped).
  assert(!/Discrimination \((PASS|FAIL)\)/.test(res.stdout), "mock must skip discrimination verdict");
});

// ============================================================
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

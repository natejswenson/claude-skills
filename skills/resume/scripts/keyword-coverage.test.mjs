#!/usr/bin/env node
/**
 * Tests for keywordCoverage() (scripts/eval/keyword-coverage.mjs), extracted
 * from the retiring scripts/benchmark.test.mjs — this function has no
 * dependency on the retired pipeline and is reused as-is by the new eval
 * harness's JD-keyword-coverage metric (scored check + baseline delta).
 *
 * $0, no network. Run: node scripts/keyword-coverage.test.mjs
 */
import assert from "node:assert/strict";
import { keywordCoverage } from "./eval/keyword-coverage.mjs";

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

console.log("\n[keyword-coverage]");

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

console.log(`\nresult: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

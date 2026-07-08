#!/usr/bin/env node
/**
 * Tests for the targeted summary-only repair (lib/summary-fix.ts).
 * Offline / $0: the test runner sets MOCK_LLM=1, so fixSummaryOnly uses the
 * deterministic scrub path (no claude spawn). The `llm` arg is unused there.
 */
import assert from "node:assert/strict";
import { summaryScopedOnly, fixSummaryOnly } from "../lib/summary-fix.ts";
import { validateTailoring } from "../lib/validate.ts";

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

const DUMMY_LLM = { completeStructured: async () => { throw new Error("should not be called under MOCK"); } };

function baseResume(summary) {
  return {
    name: "Nate Swenson",
    contact: { links: [] },
    summary,
    experience: [
      { title: "Senior DevOps Engineer", company: "GoodLeap", startDate: "2022", endDate: "Present",
        bullets: ["Built AWS infrastructure with Terraform.", "Ran Datadog observability."] },
    ],
    skills: ["AWS", "Terraform", "Datadog"],
    education: [],
    droppedBullets: [],
    optimizedBullets: [],
  };
}
const SOURCE = "Senior DevOps Engineer at GoodLeap. Built AWS infrastructure with Terraform. Ran Datadog observability.";

console.log("\n[summaryScopedOnly]");

await test("true when every violation is summary-scoped", () => {
  assert.equal(summaryScopedOnly(['summary contains banned phrase "proven ability"']), true);
  assert.equal(summaryScopedOnly(["summary contains banned phrase \"x\"", "summary states duration \"6 years\" not literally in the source"]), true);
});

await test("false when any violation is not summary-scoped", () => {
  assert.equal(summaryScopedOnly(['output uses scope qualifier "at scale" not in the source']), false);
  assert.equal(summaryScopedOnly(['summary contains banned phrase "x"', 'number "5" in output not found in the source']), false);
});

await test("false for empty violation list", () => {
  assert.equal(summaryScopedOnly([]), false);
});

console.log("\n[fixSummaryOnly — MOCK scrub path]");

await test("clears a banned summary phrase and re-validates clean", async () => {
  const resume = baseResume("Senior DevOps Engineer with a proven track record building AWS infrastructure with Terraform.");
  const before = validateTailoring(resume, SOURCE);
  assert(!before.ok && summaryScopedOnly(before.violations), "fixture should have a summary-only violation");

  const fixed = await fixSummaryOnly(DUMMY_LLM, resume, SOURCE, before.violations);
  assert(fixed, "expected a fixed résumé, got null");
  assert(!/proven track record/i.test(fixed.summary), "banned phrase still present");
  assert.equal(validateTailoring(fixed, SOURCE).ok, true, "fixed résumé must validate clean");
});

await test("leaves all non-summary fields byte-identical", async () => {
  const resume = baseResume("Engineer with deep expertise in AWS and Terraform.");
  const before = validateTailoring(resume, SOURCE);
  const fixed = await fixSummaryOnly(DUMMY_LLM, resume, SOURCE, before.violations);
  assert(fixed, "expected a fix");
  assert.deepEqual(fixed.experience, resume.experience, "experience changed");
  assert.deepEqual(fixed.skills, resume.skills, "skills changed");
  assert.deepEqual(fixed.optimizedBullets, resume.optimizedBullets, "optimizedBullets changed");
  assert.notEqual(fixed.summary, resume.summary, "summary should change");
});

await test("returns null when a non-summary violation survives the scrub (safety net)", async () => {
  // Summary banned phrase + an invented number in a bullet — the scrub fixes the
  // summary but the bullet's number violation remains, so re-validate fails → null.
  const resume = baseResume("Engineer with a proven ability to ship.");
  resume.experience[0].bullets.push("Shipped 4242 services.");
  const fixed = await fixSummaryOnly(DUMMY_LLM, resume, SOURCE, ['summary contains banned phrase "proven ability"']);
  assert.equal(fixed, null, "expected null when a non-summary violation remains");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

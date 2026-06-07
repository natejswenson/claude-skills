#!/usr/bin/env node
/**
 * Unit tests for the deterministic rule-compliance checker (scripts/eval/rules.mjs).
 *
 * Run: node scripts/rules.test.mjs
 */
import assert from "node:assert/strict";
import { checkRules } from "./eval/rules.mjs";

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

// A clean, compliant baseline resume.
function clean() {
  return {
    name: "Jane Dev",
    contact: { links: [] },
    summary: "Backend engineer building payment systems with Go and PostgreSQL. Led migration to event-driven architecture at Acme.",
    experience: [
      { title: "Engineer", company: "Acme", startDate: "2020", endDate: "Present", bullets: ["Built a Go service handling 1k req/s"] },
    ],
    skills: ["Go", "PostgreSQL"],
    education: [],
    droppedBullets: [],
    optimizedBullets: [{ original: "Built a service", rewritten: "Built a Go service handling 1k req/s", role: "Acme" }],
  };
}

test("clean resume → no violations", () => {
  const r = checkRules(clean());
  assert.equal(r.ok, true, JSON.stringify(r.violations));
});

test("banned summary phrase flagged", () => {
  const resume = clean();
  resume.summary = "Seasoned engineer with proven track record and deep expertise in Go.";
  const r = checkRules(resume);
  assert.equal(r.ok, false);
  const rules = r.violations.map((v) => v.rule);
  assert.ok(rules.includes("R6_summary_phrase"));
  // catches multiple distinct phrases
  assert.ok(r.violations.length >= 3, `expected ≥3, got ${r.violations.length}`);
});

test("optimized no-op (original === rewritten) flagged", () => {
  const resume = clean();
  resume.optimizedBullets = [{ original: "Same text", rewritten: "Same text", role: "Acme" }];
  const r = checkRules(resume);
  assert.ok(r.violations.some((v) => v.rule === "R9_optimized_noop"));
});

test("optimized role not in experience flagged", () => {
  const resume = clean();
  resume.optimizedBullets = [{ original: "a", rewritten: "b", role: "Ghost Corp" }];
  const r = checkRules(resume);
  assert.ok(r.violations.some((v) => v.rule === "R9_optimized_role_unknown"));
});

test("scope qualifier added (no source) flagged", () => {
  const resume = clean();
  resume.experience[0].bullets = ["Built a Go service at scale handling traffic"];
  const r = checkRules(resume);
  assert.ok(r.violations.some((v) => v.rule === "scope_qualifier"));
});

test("scope qualifier present in source → allowed", () => {
  const resume = clean();
  resume.experience[0].bullets = ["Built a Go service at scale"];
  const r = checkRules(resume, { sourceText: "Built systems at scale across teams" });
  assert.ok(!r.violations.some((v) => v.rule === "scope_qualifier"), JSON.stringify(r.violations));
});

test("derived 'X years' in summary not in source flagged", () => {
  const resume = clean();
  resume.summary = "Engineer with 15 years building payment systems.";
  const r = checkRules(resume, { sourceText: "Engineer. Built payment systems." });
  assert.ok(r.violations.some((v) => v.rule === "R6_derived_years"));
});

test("'X years' literally present in source → allowed", () => {
  const resume = clean();
  resume.summary = "Engineer with 15 years building payment systems.";
  const r = checkRules(resume, { sourceText: "I have 15 years of experience building payment systems." });
  assert.ok(!r.violations.some((v) => v.rule === "R6_derived_years"));
});

test("handles missing/empty arrays gracefully", () => {
  const r = checkRules({ name: "X", summary: "", experience: [], skills: [], education: [] });
  assert.equal(r.ok, true);
});

console.log(`\nresult: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

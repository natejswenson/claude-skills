#!/usr/bin/env node
/**
 * Unit tests for the deterministic tailoring validator (lib/validate.ts).
 *
 * Run: node scripts/validate.test.mjs
 */
import assert from "node:assert/strict";
const { validateTailoring } = await import("../lib/validate.ts");

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

const base = {
  name: "Test",
  contact: { links: [] },
  summary: "Backend engineer building Python services with Django.",
  experience: [
    { title: "Engineer", company: "Acme", startDate: "2020", endDate: "Present", bullets: ["Built Python services"] },
  ],
  skills: ["Python", "Django"],
  education: [],
  droppedBullets: [],
  optimizedBullets: [],
};
const SOURCE = "Engineer at Acme. Built Python services. Skills: Python, Django.";

const has = (res, frag) => res.violations.some((v) => v.includes(frag));

test("clean output passes", () => {
  const r = validateTailoring(base, SOURCE);
  assert.equal(r.ok, true, `unexpected: ${r.violations.join(" | ")}`);
});

test("banned summary phrase is flagged", () => {
  const r = validateTailoring(
    { ...base, summary: "Seasoned engineer with deep expertise in Python." },
    SOURCE,
  );
  assert.equal(r.ok, false);
  assert(has(r, "deep expertise") || has(r, "seasoned"), r.violations.join(" | "));
});

test("scope qualifier not in source is flagged", () => {
  const r = validateTailoring(
    { ...base, experience: [{ ...base.experience[0], bullets: ["Built Python services at scale"] }] },
    SOURCE,
  );
  assert.equal(r.ok, false);
  assert(has(r, "at scale"), r.violations.join(" | "));
});

test("scope qualifier present in source is allowed", () => {
  const r = validateTailoring(
    { ...base, experience: [{ ...base.experience[0], bullets: ["Built Python services at scale"] }] },
    SOURCE + " operating at scale.",
  );
  assert(!has(r, "at scale"), r.violations.join(" | "));
});

test("derived years not in source is flagged", () => {
  const r = validateTailoring(
    { ...base, summary: "Engineer with 12 years building Python services." },
    SOURCE,
  );
  assert.equal(r.ok, false);
  assert(has(r, "12 years") || has(r, "duration"), r.violations.join(" | "));
});

test("invented number is flagged", () => {
  const r = validateTailoring(
    { ...base, experience: [{ ...base.experience[0], bullets: ["Improved performance by 47% across 19 teams"] }] },
    SOURCE,
  );
  assert.equal(r.ok, false);
  assert(has(r, "47") || has(r, "19"), r.violations.join(" | "));
});

test("number present in source is allowed", () => {
  const r = validateTailoring(
    { ...base, experience: [{ ...base.experience[0], bullets: ["Led 15 services"] }] },
    SOURCE + " across 15 services.",
  );
  assert(!has(r, '"15"'), r.violations.join(" | "));
});

console.log(`\nresult: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

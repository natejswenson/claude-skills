#!/usr/bin/env node
/**
 * Unit tests for the résumé HTML generator (scripts/build-html.mjs).
 *
 * Run: node scripts/build-html.test.mjs
 *
 * These assert the STRUCTURAL contract themes are written against — the one
 * documented in references/theme-contract.md. A change here that a theme is
 * not updated for silently produces an unstyled section, so the class names
 * and element types are pinned deliberately.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildResumeHtml,
  esc,
  initials,
  displayLink,
  isCurrent,
  splitSkill,
} from "./build-html.mjs";

let pass = 0,
  fail = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    pass++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`     ${err.stack ?? err.message}`);
    fail++;
  }
}

console.log("\n[helpers]");
test("esc neutralises markup", () => {
  assert.equal(esc('<script>&"'), "&lt;script&gt;&amp;&quot;");
  assert.equal(esc(null), "");
});
test("initials take first and last word", () => {
  assert.equal(initials("Nate Swenson"), "NS");
  assert.equal(initials("Alex de la Cruz"), "AC");
  assert.equal(initials("Cher"), "C");
  assert.equal(initials(""), "");
});
test("displayLink strips scheme, www and trailing slash", () => {
  assert.equal(displayLink("https://github.com/natejswenson"), "github.com/natejswenson");
  assert.equal(displayLink("http://www.example.com/"), "example.com");
});
test("isCurrent recognises ongoing roles", () => {
  assert.ok(isCurrent("Present"));
  assert.ok(isCurrent("current"));
  assert.ok(!isCurrent("Nov 2022"));
});
test("splitSkill splits on a short leading label only", () => {
  assert.deepEqual(splitSkill("CI/CD: Jenkins, Actions"), { label: "CI/CD", value: "Jenkins, Actions" });
  assert.deepEqual(splitSkill("AWS"), { label: null, value: "AWS" });
  // A sentence-shaped entry must not be mangled into a nonsense label.
  const long = "Built and operated a very long platform description: with a trailing clause";
  assert.equal(splitSkill(long).label, null);
});

const RESUME = {
  name: "Ada Lovelace",
  contact: {
    email: "ada@example.com",
    phone: "555-0100",
    location: "London",
    links: ["https://github.com/ada"],
  },
  summary: "Builds engines.",
  highlights: [{ label: "Years", value: "16 years", caption: "Computing" }],
  skills: ["CI/CD: Jenkins", "Terraform"],
  experience: [
    {
      title: "Principal Engineer",
      company: "Analytical Co",
      location: "London",
      startDate: "Jan 2020",
      endDate: "Present",
      bullets: ["Wrote the first algorithm."],
    },
  ],
  projects: [{ name: "note-g", meta: "github.com/ada/note-g", description: "An engine." }],
  education: [{ degree: "BSc Mathematics", school: "Cambridge", year: "1840" }],
  droppedBullets: [],
  optimizedBullets: [],
};

const html = buildResumeHtml(RESUME, ":root { --x: 1 }");

console.log("\n[document structure]");
test("theme CSS is inlined into a <style> block", () => {
  assert.ok(html.includes("<style>"));
  assert.ok(html.includes("--x: 1"));
  assert.ok(!/<link[^>]+stylesheet/i.test(html));
});
test("every section heading is a real <h2> in document order", () => {
  const headings = [...html.matchAll(/<h2>([^<]+)<\/h2>/g)].map((m) => m[1]);
  assert.deepEqual(headings, [
    "Summary",
    "At a Glance",
    "Skills",
    "Experience",
    "Open Source",
    "Education",
  ]);
});
test("job titles are <h3>, not styled divs", () => {
  assert.ok(html.includes('<h3 class="jtitle">Principal Engineer</h3>'));
});
test("each contact line is one unbroken text node", () => {
  // Splitting a right-aligned line with inline separators reorders the runs in
  // the PDF content stream; that shipped once and pushed the email to line six.
  const items = [...html.matchAll(/<li class="c-[a-z]+">(.*?)<\/li>/g)].map((m) => m[1]);
  assert.ok(items.length >= 4, `expected 4+ contact lines, got ${items.length}`);
  for (const item of items) {
    const stripped = item.replace(/<\/?a[^>]*>/g, "");
    assert.ok(!/[<>]/.test(stripped), `contact line is fragmented: ${item}`);
  }
});
test("a current role is marked so a theme can accent it", () => {
  assert.ok(html.includes('class="jdate now"'));
});
test("the stamp carries derived initials", () => {
  assert.ok(html.includes('<div class="stamp" aria-hidden="true">AL</div>'));
});
test("grouped skills get the grouped class", () => {
  assert.ok(html.includes('<ul class="skills grouped">'));
  assert.ok(html.includes('<span class="k">CI/CD</span>'));
});
test("bare keyword skills get the flat class", () => {
  const flat = buildResumeHtml({ ...RESUME, skills: ["AWS", "Terraform"] }, "");
  assert.ok(flat.includes('<ul class="skills flat">'));
  assert.ok(!flat.includes('<span class="k">'));
});

console.log("\n[optional sections]");
test("highlights and projects are omitted entirely when absent", () => {
  const bare = buildResumeHtml({ ...RESUME, highlights: undefined, projects: undefined }, "");
  assert.ok(!bare.includes("sec-highlights"), "empty highlights section rendered");
  assert.ok(!bare.includes("sec-projects"), "empty projects section rendered");
  // ...and the required sections survive.
  assert.ok(bare.includes("sec-experience"));
  assert.ok(bare.includes("sec-education"));
});
test("an empty array is treated the same as absent", () => {
  const bare = buildResumeHtml({ ...RESUME, highlights: [], projects: [] }, "");
  assert.ok(!bare.includes("sec-highlights"));
  assert.ok(!bare.includes("sec-projects"));
});
test("optional per-item fields are dropped cleanly", () => {
  const r = {
    ...RESUME,
    experience: [{ ...RESUME.experience[0], location: undefined }],
    education: [{ degree: "BSc", school: "Cambridge" }],
  };
  const out = buildResumeHtml(r, "");
  assert.ok(!out.includes('class="where"'), "empty location element rendered");
  assert.ok(out.includes("Cambridge"));
  assert.ok(!out.includes("undefined"), "an undefined leaked into the document");
});

console.log("\n[escaping]");
test("résumé content cannot inject markup", () => {
  const evil = buildResumeHtml(
    { ...RESUME, name: '<img src=x onerror="alert(1)">', summary: "a & b < c" },
    "",
  );
  assert.ok(!evil.includes("<img"), "unescaped markup reached the document");
  assert.ok(evil.includes("a &amp; b &lt; c"));
});

console.log("\n[real fixture]");
test("the baseline résumé renders every expected section", () => {
  const real = JSON.parse(readFileSync("evals/baseline/tailored-devops-resume.json", "utf8"));
  const out = buildResumeHtml(real, "");
  for (const marker of ["sec-summary", "sec-skills", "sec-experience", "sec-education"]) {
    assert.ok(out.includes(marker), `missing ${marker}`);
  }
  assert.ok(!out.includes("undefined"));
});

console.log(`\nresult: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

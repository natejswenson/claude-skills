#!/usr/bin/env node
/**
 * Unit tests for PDF rendering (lib/render.ts).
 *
 * Run: node scripts/render.test.mjs
 */
import assert from "node:assert/strict";
import { existsSync, statSync, rmSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const {
  renderTemplateFromResume,
  normalizeTemplate,
  TEMPLATE_NAMES,
  DEFAULT_TEMPLATE,
} = await import("../lib/render.ts");

let pass = 0,
  fail = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    pass++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`     ${err.stack ?? err.message}`);
    fail++;
  }
}

const TMP = join(tmpdir(), "resume-render-test");
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

const resume = JSON.parse(
  readFileSync("scripts/fixtures/mock-resume.json", "utf8"),
);

console.log("\n[normalizeTemplate]");
await test("default is modern", () => {
  assert.equal(normalizeTemplate(undefined), DEFAULT_TEMPLATE);
  assert.equal(DEFAULT_TEMPLATE, "modern");
});
await test("all 7 templates present", () => {
  assert.equal(TEMPLATE_NAMES.length, 7);
  for (const t of ["modern", "classic", "technical", "polished", "timeline", "editorial", "spotlight"]) {
    assert.ok(TEMPLATE_NAMES.includes(t), `missing ${t}`);
  }
});
await test("valid template passes through", () => {
  assert.equal(normalizeTemplate("editorial"), "editorial");
});
await test("unknown template throws", () => {
  assert.throws(() => normalizeTemplate("fancy"), /unknown_template/);
});

console.log("\n[renderTemplateFromResume]");
for (const template of TEMPLATE_NAMES) {
  await test(`renders a non-trivial PDF: ${template}`, async () => {
    const pdfPath = await renderTemplateFromResume(resume, template, TMP);
    assert.ok(existsSync(pdfPath), "pdf not written");
    assert.ok(statSync(pdfPath).size > 1000, "pdf suspiciously small");
    assert.ok(pdfPath.endsWith(`-${template}.pdf`));
  });
}

rmSync(TMP, { recursive: true, force: true });
console.log(`\nresult: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

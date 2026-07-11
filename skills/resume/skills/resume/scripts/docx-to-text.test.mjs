#!/usr/bin/env node
/**
 * Unit tests for the DOCX-extraction shim (scripts/docx-to-text.mjs).
 *
 * Run: node scripts/docx-to-text.test.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { extractDocxText } = await import("./docx-to-text.mjs");

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

await test("extracts expected substrings from a sample .docx", async () => {
  const buffer = readFileSync("scripts/fixtures/sample-resume.docx");
  const text = await extractDocxText(buffer);
  assert.ok(text.includes("Jordan Rivera"), "missing name");
  assert.ok(text.includes("Senior Backend Engineer"), "missing summary");
  assert.ok(text.includes("Acme Corp"), "missing experience");
  assert.ok(text.includes("Kubernetes"), "missing skills");
});

await test("rejects an unparseable buffer", async () => {
  await assert.rejects(() => extractDocxText(Buffer.from("not a docx file")));
});

console.log(`\nresult: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

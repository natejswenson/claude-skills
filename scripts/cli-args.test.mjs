#!/usr/bin/env node
/**
 * Unit tests for the CLI argument parser (lib/cli-args.ts).
 *
 * Run: node scripts/cli-args.test.mjs
 */
import assert from "node:assert/strict";
const { parseArgs } = await import("../lib/cli-args.ts");

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

test("two positionals captured in order", () => {
  const { positional } = parseArgs(["resume.pdf", "https://x.com/job"]);
  assert.deepEqual(positional, ["resume.pdf", "https://x.com/job"]);
});

test("defaults: pdfOnly/json/help false", () => {
  const { flags } = parseArgs([]);
  assert.equal(flags.pdfOnly, false);
  assert.equal(flags.json, false);
  assert.equal(flags.help, false);
});

test("--help and -h set help", () => {
  assert.equal(parseArgs(["--help"]).flags.help, true);
  assert.equal(parseArgs(["-h"]).flags.help, true);
});

test("--pdf-only and --json", () => {
  const { flags } = parseArgs(["--pdf-only", "--json"]);
  assert.equal(flags.pdfOnly, true);
  assert.equal(flags.json, true);
});

test("--template space form", () => {
  assert.equal(parseArgs(["--template", "classic"]).flags.template, "classic");
});

test("--template=eq form", () => {
  assert.equal(parseArgs(["--template=editorial"]).flags.template, "editorial");
});

test("--out and --model captured", () => {
  const { flags } = parseArgs(["--out", "/tmp/x", "--model", "haiku"]);
  assert.equal(flags.out, "/tmp/x");
  assert.equal(flags.model, "haiku");
});

test("flags interleaved with positionals", () => {
  const { flags, positional } = parseArgs([
    "r.pdf",
    "--template",
    "timeline",
    "job text here",
    "--pdf-only",
  ]);
  assert.deepEqual(positional, ["r.pdf", "job text here"]);
  assert.equal(flags.template, "timeline");
  assert.equal(flags.pdfOnly, true);
});

test("unknown flag throws", () => {
  assert.throws(() => parseArgs(["--bogus"]), /unknown flag: --bogus/);
});

test("a bare dash-prefixed value is treated as unknown flag, not positional", () => {
  assert.throws(() => parseArgs(["-x"]), /unknown flag/);
});

console.log(`\nresult: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

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

test("defaults: pdfOnly/json/help/pick/open false", () => {
  const { flags } = parseArgs([]);
  assert.equal(flags.pdfOnly, false);
  assert.equal(flags.json, false);
  assert.equal(flags.help, false);
  assert.equal(flags.pick, false);
  assert.equal(flags.open, false);
  assert.equal(flags.render, undefined);
});

test("--open sets open", () => {
  assert.equal(parseArgs(["--open"]).flags.open, true);
});

test("--render captures path (space and = forms)", () => {
  assert.equal(parseArgs(["--render", "/tmp/r.json"]).flags.render, "/tmp/r.json");
  assert.equal(parseArgs(["--render=/tmp/r.json"]).flags.render, "/tmp/r.json");
});

test("--pick sets pick", () => {
  assert.equal(parseArgs(["--pick"]).flags.pick, true);
});

test("--pick with a job positional and no resume", () => {
  const { flags, positional } = parseArgs(["--pick", "https://x.com/job"]);
  assert.equal(flags.pick, true);
  assert.deepEqual(positional, ["https://x.com/job"]);
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

#!/usr/bin/env node
/**
 * Test runner for the resume skill.
 *
 * The ported unit tests are self-contained scripts: each owns its own
 * assertion harness, prints a `result: N passed, M failed` line, and exits
 * non-zero on any failure. (This is the convention inherited from the
 * upstream onetap-app repo.) `node --test` is the wrong harness for them —
 * it expects `node:test` `test()` registrations.
 *
 * This runner discovers every `scripts/**\/*.test.mjs`, runs each in its own
 * child process with the TS loader registered, and aggregates pass/fail.
 *
 *   node scripts/run-tests.mjs            # run all
 *   node scripts/run-tests.mjs extract    # run files matching a substring
 */
import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(SCRIPTS_DIR);
const REGISTER = join(SCRIPTS_DIR, "_tsx-register.mjs");
const filter = process.argv[2];

function findTests(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...findTests(full));
    else if (entry.endsWith(".test.mjs")) out.push(full);
  }
  return out;
}

let tests = findTests(SCRIPTS_DIR).sort();
if (filter) tests = tests.filter((t) => t.includes(filter));

if (tests.length === 0) {
  console.error(filter ? `No test files match "${filter}".` : "No test files found.");
  process.exit(1);
}

const failed = [];
for (const test of tests) {
  const rel = relative(ROOT, test);
  process.stdout.write(`\n──── ${rel} ────\n`);
  const res = spawnSync(
    process.execPath,
    ["--import", REGISTER, test],
    {
      stdio: "inherit",
      cwd: ROOT,
      env: process.env,
    },
  );
  if (res.status !== 0) failed.push(rel);
}

console.log(`\n${"═".repeat(60)}`);
console.log(`Test files: ${tests.length} total, ${tests.length - failed.length} passed, ${failed.length} failed`);
if (failed.length) {
  console.log("Failed:");
  for (const f of failed) console.log(`  ✖ ${f}`);
  process.exit(1);
}
console.log("✓ all test files passed");

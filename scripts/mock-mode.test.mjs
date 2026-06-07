#!/usr/bin/env node
/**
 * Unit tests for lib/mock-mode.ts (issue #73).
 *
 * isMockBypassEnabled gates the CLIENT-side Turnstile skip. The
 * security-critical invariant: it MUST be false whenever NODE_ENV is
 * "production", regardless of the public flag. This mirrors the server
 * guard at app/api/generate/route.ts:167 so the two cannot diverge.
 *
 * Run: node scripts/mock-mode.test.mjs
 */

import assert from "node:assert/strict";

const { isMockBypassEnabled } = await import("../lib/mock-mode.ts");

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

test("flag=1 + development -> enabled", () => {
  assert.equal(isMockBypassEnabled("1", "development"), true);
});

test("flag=1 + test -> enabled", () => {
  assert.equal(isMockBypassEnabled("1", "test"), true);
});

test("flag=1 + undefined NODE_ENV -> enabled", () => {
  assert.equal(isMockBypassEnabled("1", undefined), true);
});

test("CRITICAL: flag=1 + production -> DISABLED", () => {
  assert.equal(isMockBypassEnabled("1", "production"), false);
});

test("flag unset -> disabled (even in dev)", () => {
  assert.equal(isMockBypassEnabled(undefined, "development"), false);
});

test("flag='0' -> disabled", () => {
  assert.equal(isMockBypassEnabled("0", "development"), false);
});

test("flag='true' (not exactly '1') -> disabled", () => {
  assert.equal(isMockBypassEnabled("true", "development"), false);
});

test("flag=1 + 'Production' (case-sensitive) still production-safe", () => {
  // NODE_ENV is exactly "production" on Vercel; only that exact string is
  // the prod signal. Anything else is non-prod by design — but the flag
  // must still be exactly "1" to enable, so a weird casing can't abuse it.
  assert.equal(isMockBypassEnabled("1", "Production"), true);
  assert.equal(isMockBypassEnabled(undefined, "Production"), false);
});

// ============================================================
console.log(`\nresult: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

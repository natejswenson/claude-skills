#!/usr/bin/env node
/**
 * Regression guard for resume PDF line spacing.
 *
 * react-pdf's built-in fonts already include generous leading, so a
 * `lineHeight` multiplier above ~1.15 stacks into visually ~2x spacing
 * (the PDF looked double-spaced; a 2-page resume bloated to 5). Every
 * template's `lineHeight` must stay tight. If a future edit pushes it
 * back up, this fails before it ships.
 *
 * Reads the template sources directly (no TS module graph) so it runs
 * under plain `node` exactly as CI invokes scripts/*.test.mjs.
 *
 * Run: node scripts/template-spacing.test.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MAX_LINE_HEIGHT = 1.15;
const NAMES = [
  "modern",
  "classic",
  "technical",
  "polished",
  "timeline",
  "editorial",
  "spotlight",
];

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

for (const n of NAMES) {
  test(`${n}: lineHeight is tight (<= ${MAX_LINE_HEIGHT})`, () => {
    const src = readFileSync(
      resolve(`lib/templates/${n}.ts`),
      "utf8",
    );
    const m = src.match(/lineHeight:\s*([0-9]+(?:\.[0-9]+)?)/);
    assert.ok(m, `${n}.ts: no lineHeight declaration found`);
    const lh = parseFloat(m[1]);
    assert.ok(
      lh <= MAX_LINE_HEIGHT,
      `${n}.ts lineHeight = ${lh}, exceeds ${MAX_LINE_HEIGHT} (renders ~2x loose)`,
    );
    assert.ok(lh >= 0.9, `${n}.ts lineHeight = ${lh}, implausibly tight`);
  });
}

// ============================================================
console.log(`\nresult: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

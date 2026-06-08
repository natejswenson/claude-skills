#!/usr/bin/env node
/**
 * Unit tests for the CLI table renderer (lib/ui/table.ts).
 *
 * Run: node scripts/table.test.mjs
 */
import assert from "node:assert/strict";
const { renderTable } = await import("../lib/ui/table.ts");

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

const lineW = (s) => [...s].length;
const lines = (t) => t.split("\n");

test("every line has identical visible width", () => {
  const t = renderTable(
    ["Output", "Path"],
    [
      ["PDF", "/tmp/some/long/path/nate-swenson-modern.pdf"],
      ["JSON", "/tmp/some/long/path/nate-swenson.json"],
    ],
    { indent: 2 },
  );
  const ws = lines(t).map(lineW);
  assert.equal(new Set(ws).size, 1, `widths varied: ${ws.join(",")}`);
});

test("border + header + body row count is correct", () => {
  const t = renderTable(["A", "B"], [["1", "2"], ["3", "4"]]);
  const ls = lines(t);
  // top, header, mid, 2 body rows, bottom = 6
  assert.equal(ls.length, 6);
  assert(ls[0].startsWith("┌"));
  assert(ls[2].startsWith("├"));
  assert(ls[ls.length - 1].startsWith("└"));
});

test("long cells wrap and still keep the table rectangular", () => {
  const long = "word ".repeat(40).trim();
  const t = renderTable(["Role", "Before", "After"], [["X", long, long]], {
    maxWidth: 80,
  });
  const ws = lines(t).map(lineW);
  assert.equal(new Set(ws).size, 1, `widths varied: ${ws.join(",")}`);
  assert(ws[0] <= 80, `table exceeded maxWidth: ${ws[0]}`);
});

test("right alignment pads on the left", () => {
  const t = renderTable(["Metric", "Count"], [["Bullets optimized", "2"]], {
    align: ["left", "right"],
  });
  // The count cell should be right-aligned: spaces precede the digit.
  const row = lines(t).find((l) => l.includes("Bullets optimized"));
  assert.match(row, /\s2 │$/);
});

test("indent shifts every line", () => {
  const t = renderTable(["A"], [["1"]], { indent: 4 });
  for (const l of lines(t)) assert(l.startsWith("    "), `missing indent: ${l}`);
});

console.log(`\nresult: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

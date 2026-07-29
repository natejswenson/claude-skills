#!/usr/bin/env node
/**
 * Unit tests for theme resolution and PDF rendering (scripts/render.mjs).
 *
 * Run: node scripts/render.test.mjs
 *
 * The theme-resolution tests point $HOME at a temp directory BEFORE importing
 * render.mjs, because HOME_THEMES_DIR is computed from os.homedir() at module
 * load. That is the seam — it keeps the tests off the real
 * ~/.claude/resume/themes, so a developer who has personalised a theme still
 * gets the shipped behaviour under test.
 */
import assert from "node:assert/strict";
import { existsSync, statSync, rmSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";

const TMP = join(tmpdir(), "resume-render-test");
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

// Captured before $HOME is redirected, and restored before the rendering
// tests: Playwright caches its browsers under the home directory too, so
// leaving the fake $HOME in place makes Chromium "not installed".
const REAL_HOME = homedir();

const FAKE_HOME = join(TMP, "home");
const FAKE_HOME_THEMES = join(FAKE_HOME, ".claude", "resume", "themes");
mkdirSync(FAKE_HOME_THEMES, { recursive: true });
process.env.HOME = FAKE_HOME;
process.env.USERPROFILE = FAKE_HOME;

const {
  resolveTheme,
  renderThemeFromResume,
  renderHtmlToPdf,
  shippedThemeNames,
  DEFAULT_THEME,
  HOME_THEMES_DIR,
} = await import("./render.mjs");

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

const resume = JSON.parse(readFileSync("scripts/fixtures/mock-resume.json", "utf8"));

console.log("\n[shipped themes]");
await test("both shipped themes are present", () => {
  const names = shippedThemeNames();
  assert.ok(names.includes("press"), "press theme missing");
  assert.ok(names.includes("ats-plain"), "ats-plain theme missing");
});
await test("the default theme is press", () => {
  assert.equal(DEFAULT_THEME, "press");
  assert.equal(resolveTheme(undefined).name, "press");
});

console.log("\n[resolveTheme]");
await test("a named shipped theme resolves to the shipped file", () => {
  const t = resolveTheme("ats-plain");
  assert.equal(t.name, "ats-plain");
  assert.equal(t.source, "shipped");
  assert.ok(t.path.endsWith(join("assets", "themes", "ats-plain.css")));
});

await test("a home theme wins over the shipped theme of the same name", () => {
  assert.equal(HOME_THEMES_DIR, FAKE_HOME_THEMES, "test is not isolated from the real home dir");
  const homePress = join(FAKE_HOME_THEMES, "press.css");
  writeFileSync(homePress, "/* the user's own press */\n");
  try {
    const t = resolveTheme("press");
    assert.equal(t.source, "home");
    assert.equal(t.path, homePress);
  } finally {
    rmSync(homePress, { force: true });
  }
  // ...and falls back to shipped once the personal copy is gone.
  assert.equal(resolveTheme("press").source, "shipped");
});

await test("an explicit .css path wins outright", () => {
  const custom = join(TMP, "my-brand.css");
  writeFileSync(custom, "/* custom */\n");
  const t = resolveTheme(custom);
  assert.equal(t.source, "custom");
  assert.equal(t.name, "my-brand");
});

await test("an unknown theme NAME throws rather than falling back", () => {
  // A silent fallback would render a different look than the one asked for,
  // and the PDF would look deliberate — there is no way to notice.
  assert.throws(() => resolveTheme("fancy"), /unknown_theme/);
});

await test("a missing explicit PATH throws", () => {
  assert.throws(() => resolveTheme(join(TMP, "nope.css")), /theme_not_found/);
});

process.env.HOME = REAL_HOME;
process.env.USERPROFILE = REAL_HOME;

console.log("\n[renderThemeFromResume]");
for (const theme of ["press", "ats-plain"]) {
  await test(`renders a non-trivial PDF: ${theme}`, async () => {
    const { pdfPath, htmlPath } = await renderThemeFromResume(resume, theme, TMP);
    assert.ok(existsSync(pdfPath), "pdf not written");
    assert.ok(statSync(pdfPath).size > 1000, "pdf suspiciously small");
    assert.ok(pdfPath.endsWith(`-${theme}.pdf`));
    // The HTML is kept on purpose: tweak-and-re-render is the theme-authoring
    // loop, and deleting the source on success breaks it.
    assert.ok(existsSync(htmlPath), "html source not kept next to the pdf");
    assert.ok(readFileSync(htmlPath, "utf8").includes("<article class=\"resume\">"));
  });
}

await test("the theme CSS is inlined, not linked", async () => {
  const { htmlPath } = await renderThemeFromResume(resume, "press", TMP);
  const html = readFileSync(htmlPath, "utf8");
  // A <link> would resolve relative to the browser's cwd and silently render
  // unstyled; setContent() has no base URL.
  assert.ok(!/<link[^>]+stylesheet/i.test(html), "theme was linked rather than inlined");
  assert.ok(html.includes("--sig"), "press tokens missing from the inlined CSS");
});

console.log("\n[renderHtmlToPdf]");
await test("a Chromium launch failure explains how to fix it", async () => {
  await assert.rejects(
    () =>
      renderHtmlToPdf("<p>hi</p>", join(TMP, "never.pdf"), {
        launch: () => {
          throw new Error("spawn ENOENT");
        },
      }),
    /npx playwright install chromium/,
  );
});

rmSync(TMP, { recursive: true, force: true });
console.log(`\nresult: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

#!/usr/bin/env node
/**
 * BASELINE — a rendered résumé must survive PDF text extraction.
 *
 * Run: node scripts/baseline-render.test.mjs
 *
 * Deterministic, offline, $0. Pinned against two real artifacts:
 *   evals/baseline/tailored-devops-resume.json  — a real past tailoring run
 *   evals/baseline/press-showcase-resume.json   — a real approved résumé,
 *       identity fields replaced, exercising the optional highlights and
 *       projects sections and grouped skills
 *
 * WHY THIS EXISTS. A résumé PDF that looks perfect can still be unreadable to
 * the software that reads it first. Every assertion below is a defect that was
 * measured on a real render during the 2.0 theme work, not a hypothetical:
 *
 *   - letter-spacing above ~0.10em makes pdf.js insert a space between every
 *     glyph, so "EXPERIENCE" extracts as "E X P E R I E N C E". Both shipped
 *     themes had this until it was measured. Poppler does NOT reproduce it,
 *     which is exactly why a one-extractor check missed it.
 *   - splitting a right-aligned contact line with inline <span> separators
 *     reorders the runs in the PDF content stream and pushed the email address
 *     to the sixth extracted line.
 *
 * TWO-SIDED. Good input must pass AND known-bad input must fail. The known-bad
 * is scripts/fixtures/themes/tracking-trap.css — press with the heading
 * tracking restored to 0.15em. Without it, `headingsSurvive` could be weakened
 * to a tautology and keep reporting green forever.
 *
 * NOTE ON LIGATURES: the shipped themes set `font-variant-ligatures: none`,
 * but that is insurance, not a fix for a measured bug — Chromium emits a
 * correct ToUnicode map and both pdf.js and poppler recover "workflows" even
 * with ligatures enabled. There is deliberately no assertion about it, because
 * a check whose known-bad input also passes is decorative.
 */
import assert from "node:assert/strict";
import { readFileSync, rmSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { getDocumentProxy, extractText } from "unpdf";
import { renderThemeFromResume, shippedThemeNames } from "./render.mjs";

const UPDATE_COMMAND =
  "node scripts/render.mjs --json evals/baseline/press-showcase-resume.json --theme press --out /tmp/resume-baseline --open";

/** Sections every résumé renders, and that a parser looks for by name. */
const REQUIRED_HEADINGS = ["SUMMARY", "SKILLS", "EXPERIENCE", "EDUCATION"];

/** Anti-vacuity floors — a blank or failed render must go red, not green. */
const MIN_EXTRACTED_CHARS = 1500;
const MIN_FIXTURES = 2;
const MIN_THEMES = 2;
const MAX_PAGES = 3;
/** The email is what an ATS auto-fills; it must be near the top, not buried. */
const CONTACT_WITHIN_CHARS = 400;

const FIXTURES = [
  { id: "tailored-devops", path: "evals/baseline/tailored-devops-resume.json" },
  { id: "press-showcase", path: "evals/baseline/press-showcase-resume.json" },
];

const TMP = join(tmpdir(), "resume-baseline-render");
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

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

async function extract(pdfPath) {
  const pdf = await getDocumentProxy(new Uint8Array(readFileSync(pdfPath)));
  const ex = await extractText(pdf, { mergePages: true });
  const text = Array.isArray(ex.text) ? ex.text.join("\n") : ex.text;
  return { text, pages: pdf.numPages };
}

/**
 * Does every required section heading appear as a contiguous run of
 * characters? This is the check the trap theme must break.
 */
function headingsSurvive(text) {
  const upper = text.toUpperCase();
  return REQUIRED_HEADINGS.filter((h) => !upper.includes(h));
}

const resumes = FIXTURES.map((f) => ({
  ...f,
  data: JSON.parse(readFileSync(f.path, "utf8")),
}));

console.log("\n[corpus floors]");
await test(`at least ${MIN_FIXTURES} baseline résumés and ${MIN_THEMES} shipped themes`, () => {
  // A glob or directory listing that quietly matches nothing must go red.
  // This is the most common way a baseline turns decorative.
  assert.ok(
    resumes.length >= MIN_FIXTURES,
    `only ${resumes.length} baseline résumés; expected >= ${MIN_FIXTURES}`,
  );
  const themes = shippedThemeNames();
  assert.ok(
    themes.length >= MIN_THEMES,
    `only ${themes.length} shipped themes (${themes.join(", ")}); expected >= ${MIN_THEMES}`,
  );
  assert.ok(themes.includes("press") && themes.includes("ats-plain"));
});

await test("the showcase fixture exercises the optional sections", () => {
  // If it stops doing so, the highlights/projects markup goes untested while
  // this file still reports green.
  const showcase = resumes.find((r) => r.id === "press-showcase").data;
  assert.ok(showcase.highlights?.length >= 3, "showcase lost its highlights");
  assert.ok(showcase.projects?.length >= 2, "showcase lost its projects");
  assert.ok(
    showcase.skills.some((s) => s.includes(":")),
    "showcase lost its grouped skills",
  );
});

console.log("\n[good input passes]");
for (const theme of ["press", "ats-plain"]) {
  for (const r of resumes) {
    await test(`${theme} / ${r.id}: extracts cleanly`, async () => {
      const { pdfPath } = await renderThemeFromResume(r.data, theme, TMP);
      const { text, pages } = await extract(pdfPath);

      assert.ok(
        text.length >= MIN_EXTRACTED_CHARS,
        `only ${text.length} chars extracted (floor ${MIN_EXTRACTED_CHARS}) — ` +
          `a near-empty PDF must fail, not pass. Re-render to inspect:\n    ${UPDATE_COMMAND}`,
      );

      const missing = headingsSurvive(text);
      assert.deepEqual(
        missing,
        [],
        `section heading(s) did not survive extraction: ${missing.join(", ")}. ` +
          `Usually letter-spacing > 0.10em on .sec > h2 — pdf.js then splits ` +
          `every glyph with a space. Re-render to inspect:\n    ${UPDATE_COMMAND}`,
      );

      const email = r.data.contact.email;
      const at = text.indexOf(email);
      assert.ok(at >= 0, `contact email ${email} did not extract at all`);
      assert.ok(
        at <= CONTACT_WITHIN_CHARS,
        `contact email extracted at char ${at}, past the ${CONTACT_WITHIN_CHARS} ` +
          `limit — contact lines are probably fragmented into separate runs`,
      );

      assert.ok(pages <= MAX_PAGES, `${pages} pages, over the ${MAX_PAGES}-page ceiling`);
    });
  }
}

await test("every bullet survives, in order (ats-plain)", async () => {
  // ats-plain exists to keep one linear text flow; if bullet order scrambles,
  // the theme has stopped doing its job.
  const r = resumes.find((x) => x.id === "press-showcase");
  const { pdfPath } = await renderThemeFromResume(r.data, "ats-plain", TMP);
  const { text } = await extract(pdfPath);
  const flat = text.replace(/\s+/g, " ");
  const bullets = r.data.experience.flatMap((e) => e.bullets);
  assert.ok(bullets.length >= 10, `only ${bullets.length} bullets in the fixture`);

  let last = -1;
  for (const b of bullets) {
    const probe = b.slice(0, 40).replace(/\s+/g, " ");
    const idx = flat.indexOf(probe);
    assert.ok(idx > last, `bullet out of order or missing: "${probe}"`);
    last = idx;
  }
});

console.log("\n[known-bad input fails]");
await test("the tracking trap breaks heading extraction", async () => {
  const trap = resolve("scripts/fixtures/themes/tracking-trap.css");
  const r = resumes.find((x) => x.id === "press-showcase");
  const { pdfPath } = await renderThemeFromResume(r.data, trap, TMP);
  const { text } = await extract(pdfPath);

  // The document still renders and still has plenty of text...
  assert.ok(
    text.length >= MIN_EXTRACTED_CHARS,
    "the trap fixture should still produce a full document, just an unparseable one",
  );
  // ...but the headings are gone, which is the whole point.
  const missing = headingsSurvive(text);
  assert.ok(
    missing.length > 0,
    "the tracking trap no longer breaks heading extraction — headingsSurvive() " +
      "has been weakened to something that cannot fail, or pdf.js changed its " +
      "spacing heuristic. Re-measure the threshold before trusting this file again.",
  );
  // And specifically in the way we expect: spaced-out glyphs.
  assert.ok(
    /E\s+X\s+P\s+E\s+R\s+I\s+E\s+N\s+C\s+E/.test(text.toUpperCase()),
    "expected the trap to split heading glyphs with spaces",
  );
});

rmSync(TMP, { recursive: true, force: true });
console.log(`\nresult: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

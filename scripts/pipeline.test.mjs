#!/usr/bin/env node
/**
 * Unit tests for the tailoring pipeline (lib/pipeline.ts).
 *
 * Offline + zero-cost: tailoring runs in MOCK_LLM mode (fixed mock-resume
 * fixture) so no LLM is invoked. Verifies parsing, job resolution, template
 * normalization, diff math, and the full runPipeline (PDF + JSON outputs).
 *
 * Run: MOCK_LLM=1 node scripts/pipeline.test.mjs
 */
import assert from "node:assert/strict";
import { existsSync, statSync, writeFileSync, rmSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.MOCK_LLM ??= "1";
process.env.ONETAP_SKIP_DNS_CHECK ??= "1";

const {
  mimeFromPath,
  normalizeTemplate,
  trimJobText,
  loadResumeText,
  resolveJobText,
  tailorResume,
  buildDiff,
  runPipeline,
  TEMPLATE_NAMES,
  DEFAULT_TEMPLATE,
} = await import("../lib/pipeline.ts");

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

const RESUME_FIXTURE = "scripts/fixtures/perf/resumes/01-swe-mid.txt";
const TMP = join(tmpdir(), "onetap-pipeline-test");
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

console.log("\n[mimeFromPath]");
await test("maps known extensions", () => {
  assert.equal(mimeFromPath("a.pdf"), "application/pdf");
  assert.equal(
    mimeFromPath("a.docx"),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  assert.equal(mimeFromPath("a.txt"), "text/plain");
  assert.equal(mimeFromPath("a.md"), "text/markdown");
  assert.equal(mimeFromPath("a.markdown"), "text/markdown");
});
await test("case-insensitive extension", () => {
  assert.equal(mimeFromPath("RESUME.PDF"), "application/pdf");
});
await test("unknown extension → null", () => {
  assert.equal(mimeFromPath("a.rtf"), null);
  assert.equal(mimeFromPath("noext"), null);
});

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

console.log("\n[trimJobText]");
await test("strips a benefits boilerplate section (bullet form)", () => {
  // The trimmer's lookahead ends a section at the next capitalized line-start,
  // so bullet/dash content (as real JDs use) gets removed; prose lines that
  // each start capitalized would not — that's the heuristic's known shape.
  const jd =
    "Key Responsibilities\nBuild systems.\n\nBenefits\n- free lunch\n- unlimited PTO\n- 401k match\n\nQualifications\nPython.";
  const out = trimJobText(jd);
  assert.ok(out.includes("Key Responsibilities"));
  assert.ok(out.includes("Qualifications"));
  assert.ok(!/free lunch/i.test(out), "benefits text should be trimmed");
});
await test("caps very long input", () => {
  const huge = "x".repeat(20000);
  assert.ok(trimJobText(huge).length <= 6000);
});

console.log("\n[loadResumeText]");
await test("parses a .txt resume", async () => {
  const text = await loadResumeText(RESUME_FIXTURE);
  assert.ok(text.length > 200, "resume text too short");
});
await test("missing file throws resume_not_found", async () => {
  await assert.rejects(loadResumeText("does-not-exist.txt"), /resume_not_found/);
});
await test("unsupported type throws", async () => {
  const p = join(TMP, "x.rtf");
  writeFileSync(p, "a".repeat(300), "utf-8");
  await assert.rejects(loadResumeText(p), /unsupported_resume_type/);
});

console.log("\n[resolveJobText]");
await test("literal text → source=text", async () => {
  const r = await resolveJobText("Senior engineer, Python");
  assert.equal(r.source, "text");
  assert.equal(r.text, "Senior engineer, Python");
});
await test("existing file path → source=file", async () => {
  const p = join(TMP, "jd.txt");
  writeFileSync(p, "Backend role, Go, k8s", "utf-8");
  const r = await resolveJobText(p);
  assert.equal(r.source, "file");
  assert.ok(r.text.includes("Backend role"));
});

console.log("\n[tailorResume — MOCK]");
await test("returns a valid ResumeJSON", async () => {
  const resume = await tailorResume("some resume text", "some job");
  assert.ok(resume.name && resume.name.length > 0);
  assert.ok(Array.isArray(resume.experience));
  assert.ok(Array.isArray(resume.optimizedBullets));
});

console.log("\n[buildDiff]");
await test("counts add up: live + dropped = total", async () => {
  const resume = await tailorResume("x", "y");
  const d = buildDiff(resume);
  const live = resume.experience.reduce((n, r) => n + r.bullets.length, 0);
  assert.equal(d.totalBullets, live + resume.droppedBullets.length);
  assert.equal(d.optimizedCount, resume.optimizedBullets.length);
  assert.equal(d.droppedCount, resume.droppedBullets.length);
  assert.equal(d.roles, resume.experience.length);
});

console.log("\n[runPipeline — MOCK, full]");
await test("writes PDF + JSON and returns diff", async () => {
  const out = join(TMP, "full");
  const res = await runPipeline({
    resumePath: RESUME_FIXTURE,
    jobInput: "Senior backend engineer, Python, distributed systems",
    outDir: out,
  });
  assert.ok(existsSync(res.pdfPath), "pdf not written");
  assert.ok(statSync(res.pdfPath).size > 1000, "pdf suspiciously small");
  assert.ok(res.jsonPath && existsSync(res.jsonPath), "json not written");
  const parsed = JSON.parse(readFileSync(res.jsonPath, "utf-8"));
  assert.equal(parsed.name, res.resume.name);
  assert.equal(res.template, "modern");
});
await test("--pdf-only skips the JSON sidecar", async () => {
  const out = join(TMP, "pdfonly");
  const res = await runPipeline({
    resumePath: RESUME_FIXTURE,
    jobInput: "Data engineer",
    outDir: out,
    pdfOnly: true,
  });
  assert.ok(existsSync(res.pdfPath), "pdf not written");
  assert.equal(res.jsonPath, null);
});
await test("template choice is honored in output path + result", async () => {
  const out = join(TMP, "tmpl");
  const res = await runPipeline({
    resumePath: RESUME_FIXTURE,
    jobInput: "Designer",
    outDir: out,
    template: "editorial",
  });
  assert.equal(res.template, "editorial");
  assert.ok(res.pdfPath.endsWith("-editorial.pdf"));
});

rmSync(TMP, { recursive: true, force: true });
console.log(`\nresult: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

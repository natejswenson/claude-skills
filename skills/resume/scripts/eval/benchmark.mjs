#!/usr/bin/env node
/**
 * Resume-generator benchmark — accuracy + speed on a real résumé × real jobs.
 *
 * Runs the REAL tailoring pipeline (tailorResume) over Nate's résumé PDF against
 * a set of cached real job postings, timing each phase and scoring each output.
 * See docs/plans/2026-06-20-resume-benchmark-design.md.
 *
 * Cost: $0. Tailoring runs through the subscription CLI adapter (LLM_MODE=cli);
 * the optional G1 + grounding judges spawn their own subscription `claude -p`
 * children. No billed API calls anywhere.
 *
 * Reproducibility is TWO-LEVEL (do not conflate):
 *   - function-deterministic: re-scoring a FIXED ResumeJSON is bit-identical.
 *   - end-to-end variable: a fresh run re-tailors via a non-temperature-pinned
 *     LLM, so scores/violations move run-to-run.
 *
 * Usage:
 *   npm run benchmark                       # real run, all jobs, no judges
 *   npm run benchmark -- --judge            # + $0 CLI G1 + grounding judges
 *   npm run benchmark -- --judge --judge-samples 3
 *   npm run benchmark -- --jobs j1-senior-devops,j6-frontend
 *   npm run benchmark -- --repeat 4         # tailoring-latency dist for one job
 *   npm run benchmark -- --render --json
 *   npm run benchmark -- --mock             # $0 plumbing check (no claude spawn)
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");

// ---- flags ----------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const val = (n, def) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};

const MOCK = flag("--mock");
const USE_JUDGE = flag("--judge");
const JUDGE_SAMPLES = Math.max(1, parseInt(val("--judge-samples", "1"), 10));
const REPEAT = parseInt(val("--repeat", "0"), 10);
const RENDER = flag("--render");
const JSON_OUT = flag("--json");
const G3_FLOOR = parseInt(val("--g3-floor", "40"), 10);
const COVERAGE_FLOOR = parseFloat(val("--coverage-floor", "0"));
const TEMPLATE = val("--template", "modern");
const DEFAULT_RESUME = resolve(ROOT, "scripts/fixtures/benchmark/resume.pdf");
const RESUME_PATH = resolve(val("--resume", DEFAULT_RESUME));
const OUT_DIR = resolve(val("--out", resolve(ROOT, "benchmark-out")));
const JOBS_FILTER = val("--jobs", null);

// Pin tailoring to the subscription CLI adapter BEFORE importing the pipeline,
// and set MOCK before any pipeline code reads it. (INV: LLM_MODE=cli first.)
if (MOCK) process.env.MOCK_LLM = "1";
process.env.LLM_MODE ??= "cli";

// Imports that touch the LLM factory must come AFTER the env pins above.
const { loadResumeText, tailorResume, trimJobText, renderResumePdf, normalizeTemplate } =
  await import("../../lib/pipeline.ts");
const { scoreEval } = await import("../scorer/index.mjs");
const { checkRules } = await import("./rules.mjs");
const { keywordCoverage } = await import("./keyword-coverage.mjs");
const { BENCHMARK_JOBS } = await import("../fixtures/benchmark/jobs.mjs");
const { partitionViolations, normalizeSource, median, mean, discriminationCheck } =
  await import("./benchmark-lib.mjs");

// Anchors for the parse-time sanity check — fixture-coupled, case-insensitive.
const FIXTURE_ANCHORS = ["swenson", "goodleap"];

// ---- helpers --------------------------------------------------------------
const now = () => performance.now();
const ms = (n) => `${(n / 1000).toFixed(1)}s`;
const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);

// ---- select jobs ----------------------------------------------------------
let jobs = BENCHMARK_JOBS;
if (JOBS_FILTER) {
  const ids = new Set(JOBS_FILTER.split(",").map((s) => s.trim()));
  jobs = BENCHMARK_JOBS.filter((j) => ids.has(j.id));
  if (jobs.length === 0) {
    console.error(`No jobs match "${JOBS_FILTER}". Available: ${BENCHMARK_JOBS.map((j) => j.id).join(", ")}`);
    process.exit(2);
  }
}

// ---- parse résumé ONCE ----------------------------------------------------
const tParseStart = now();
let rawResume;
try {
  rawResume = await loadResumeText(RESUME_PATH);
} catch (err) {
  console.error(`Failed to load résumé "${RESUME_PATH}": ${err.message}`);
  process.exit(2);
}
const resumeText = normalizeSource(rawResume);
const tParse = now() - tParseStart;

// Anchor sanity check (pre-flight; before any per-job work).
if (resumeText.length < 200) {
  console.error(`Extracted résumé text is suspiciously short (${resumeText.length} chars) — degraded extraction. Aborting.`);
  process.exit(2);
}
const isDefaultFixture = RESUME_PATH === DEFAULT_RESUME;
if (isDefaultFixture) {
  const lower = resumeText.toLowerCase();
  const missing = FIXTURE_ANCHORS.filter((a) => !lower.includes(a));
  if (missing.length) {
    console.error(`Fixture anchor check failed — missing ${missing.join(", ")} in extracted text. Degraded extraction? Aborting.`);
    process.exit(2);
  }
}

const template = normalizeTemplate(TEMPLATE);

// ===========================================================================
// --repeat mode: tailoring-latency distribution for ONE fixed job.
// ===========================================================================
if (REPEAT > 0) {
  const job = jobs[0];
  console.log(
    `\nLatency mode: re-running "${job.id}" ${REPEAT}× (first discarded as warmup) · ` +
      `tailoring=${MOCK ? "MOCK" : "live:cli ($0)"}\n`,
  );
  const samples = [];
  for (let i = 0; i < REPEAT; i++) {
    const t0 = now();
    await tailorResume(resumeText, job.text, {});
    const dt = now() - t0;
    const warm = i === 0 ? " (warmup, discarded)" : "";
    console.log(`  run ${i + 1}/${REPEAT}: ${ms(dt)}${warm}`);
    if (i > 0) samples.push(dt);
  }
  if (samples.length < 2) {
    console.log(`\n⚠  Only ${samples.length} measured point(s) — use --repeat 4+ for a non-degenerate median.`);
  }
  console.log(
    `\nTailoring latency (n=${samples.length}): ` +
      `min ${ms(Math.min(...samples))} · median ${ms(median(samples))} · max ${ms(Math.max(...samples))}`,
  );
  process.exit(0);
}

// ===========================================================================
// Normal suite
// ===========================================================================
console.log(
  `\nBenchmark: ${jobs.length} job(s) · résumé=${isDefaultFixture ? "fixture" : RESUME_PATH} (${resumeText.length} chars) · ` +
    `tailoring=${MOCK ? "MOCK ($0)" : "live:cli ($0)"} · judges=${USE_JUDGE ? (MOCK ? "skipped (mock)" : `on (samples=${JUDGE_SAMPLES})`) : "off"}` +
    `${MOCK ? " · PLUMBING CHECK (accuracy/discrimination NOT asserted)" : ""}\n`,
);

mkdirSync(OUT_DIR, { recursive: true });

const rows = [];
let anyHardFail = false;

for (const job of jobs) {
  const row = { id: job.id, fit: job.fit, control: !!job.control, title: job.title, company: job.company };
  try {
    const trimmedJD = trimJobText(job.text);

    const tTailor0 = now();
    const resume = await tailorResume(resumeText, job.text, {}); // RAW jobText; trims internally
    row.tTailor = now() - tTailor0;

    // Persist tailored ResumeJSON for the function-deterministic re-score path.
    writeFileSync(resolve(OUT_DIR, `${job.id}.json`), JSON.stringify(resume, null, 2));

    if (RENDER) {
      const tRender0 = now();
      await renderResumePdf(resume, template, resolve(OUT_DIR, `${job.id}-${template}.pdf`));
      row.tRender = now() - tRender0;
    }

    // ---- deterministic scoring (function-deterministic given this ResumeJSON)
    const tScore0 = now();
    const ruleRes = checkRules(resume, { sourceText: resumeText });
    const { hard: hardViol, reported: reportedViol } = partitionViolations(ruleRes.violations);
    const cov = keywordCoverage(resume, trimmedJD);
    const score = await scoreEval({ resume, jobText: job.text }); // L3 off → g1=50
    row.tScore = now() - tScore0;

    row.g2 = score.g2;
    row.g3 = score.g3;
    row.g4 = score.g4;
    row.fitness = score.fitness;
    row.coverage = cov.coverage;
    row.coverageMissed = cov.missed.slice(0, 12);
    row.hardViolations = hardViol;
    row.reportedViolations = reportedViol;

    // ---- optional CLI judges (soft, fail-open) ----
    // Skipped under --mock: the plumbing check must spawn NO claude child.
    if (USE_JUDGE && !MOCK) {
      const tJudge0 = now();
      const { judgeTailoringFitCli, judgeGroundingCli } = await import("../scorer/judge-cli.mjs");
      const g1 = await judgeTailoringFitCli({ resume, jobText: trimmedJD, samples: JUDGE_SAMPLES });
      const grounding = await judgeGroundingCli({ resume, sourceText: resumeText });
      row.tJudge = now() - tJudge0;
      row.g1 = g1.score;
      row.g1Failed = g1.breakdown?.reason === "judge_failed";
      row.ungrounded = grounding.ungrounded;
      row.groundingFailed = grounding.reason === "judge_failed";
    }

    row.tTotal = row.tTailor + (row.tRender ?? 0) + (row.tScore ?? 0) + (row.tJudge ?? 0);

    // ---- HARD gate (skipped in mock — plumbing only) ----
    if (MOCK) {
      row.gateOk = true;
      row.gateSkipped = true;
    } else {
      const g3Ok = row.g3 >= G3_FLOOR;
      const rulesOk = hardViol.length === 0;
      row.gateOk = g3Ok && rulesOk;
      row.gateReasons = [];
      if (!g3Ok) row.gateReasons.push(`G3 ${row.g3} < ${G3_FLOOR}`);
      if (!rulesOk) row.gateReasons.push(`${hardViol.length} HARD checkRules violation(s)`);
      if (!row.gateOk) anyHardFail = true;
    }
  } catch (err) {
    row.error = err.message ?? String(err);
    anyHardFail = true;
  }
  rows.push(row);
  if (!JSON_OUT) printRow(row);
}

// ---- discrimination check (skipped in mock) -------------------------------
// Mock returns a fixed résumé for every job, so separation is meaningless.
const discrimination = MOCK ? null : discriminationCheck(rows);

// ---- suite aggregates -----------------------------------------------------
const ok = rows.filter((r) => !r.error);
const suite = {
  jobs: rows.length,
  hardPass: rows.filter((r) => r.gateOk).length,
  tParse,
  tTailorMean: mean(ok.map((r) => r.tTailor ?? 0)),
  tTailorTotal: ok.reduce((s, r) => s + (r.tTailor ?? 0), 0),
  tSuiteTotal: tParse + ok.reduce((s, r) => s + (r.tTotal ?? 0), 0),
};

// ---- output ---------------------------------------------------------------
if (JSON_OUT) {
  console.log(
    JSON.stringify(
      {
        meta: { mock: MOCK, judges: USE_JUDGE, judgeSamples: JUDGE_SAMPLES, g3Floor: G3_FLOOR, coverageFloor: COVERAGE_FLOOR, resume: isDefaultFixture ? "fixture" : RESUME_PATH },
        jobs: rows.map((r) => ({
          id: r.id, fit: r.fit, control: r.control,
          // function-deterministic regression fields:
          g2: r.g2, g3: r.g3, g4: r.g4, fitness: r.fitness, coverage: r.coverage,
          hardViolations: (r.hardViolations ?? []).map((v) => v.rule),
          reportedViolations: (r.reportedViolations ?? []).map((v) => v.rule),
          gateOk: r.gateOk, gateReasons: r.gateReasons,
          // timing (noisy — compare with tolerance only):
          timing: { tTailor: r.tTailor, tRender: r.tRender, tJudge: r.tJudge, tTotal: r.tTotal },
          // non-deterministic judge signals (NOT regression triggers):
          judge: USE_JUDGE ? { g1: r.g1, g1Failed: r.g1Failed, ungroundedCount: (r.ungrounded ?? []).length, groundingFailed: r.groundingFailed } : undefined,
          error: r.error,
        })),
        discrimination,
        suite,
      },
      null,
      2,
    ),
  );
} else {
  printSummary(suite, discrimination);
}

// HARD gate drives exit code; mock always exits 0 (plumbing). Discrimination
// and all judge/coverage signals NEVER affect exit code.
process.exit(MOCK ? 0 : anyHardFail ? 1 : 0);

// ===========================================================================
function printRow(r) {
  if (r.error) {
    console.log(`  ✖ ${pad(r.id, 18)} ERROR: ${r.error}`);
    return;
  }
  const mark = r.gateOk ? "✓" : "✖";
  const tag = r.control ? "ctrl" : r.fit;
  const judge = r.g1 !== undefined ? ` g1 ${padL(r.g1, 3)}${r.g1Failed ? "!" : ""}` : "";
  const ungr = r.ungrounded !== undefined ? ` ungr ${padL(r.ungrounded.length, 2)}${r.groundingFailed ? "!" : ""}` : "";
  const reported = r.reportedViolations.length ? ` ·rep ${r.reportedViolations.length}` : "";
  const hard = r.hardViolations.length ? ` ·HARD ${r.hardViolations.length}` : "";
  console.log(
    `  ${mark} ${pad(r.id, 18)} ${pad(tag, 5)} ` +
      `tailor ${padL(ms(r.tTailor), 6)}  g3 ${padL(r.g3, 3)}  fit ${padL(r.fitness, 4)}  ` +
      `cov ${padL((r.coverage * 100).toFixed(0) + "%", 4)}${judge}${ungr}${hard}${reported}`,
  );
  if (r.gateReasons?.length) console.log(`       ↳ gate fail: ${r.gateReasons.join("; ")}`);
  for (const v of r.hardViolations) console.log(`       ↳ [HARD ${v.rule}] ${v.detail}`);
}

function printSummary(s, disc) {
  console.log(`\n${"─".repeat(72)}`);
  console.log(
    `Speed: parse ${ms(s.tParse)} · tailor mean ${ms(s.tTailorMean)} · ` +
      `tailor total ${ms(s.tTailorTotal)} · suite total ${ms(s.tSuiteTotal)}`,
  );
  console.log(`Hard gate: ${s.hardPass}/${s.jobs} passed${MOCK ? " (skipped — plumbing)" : ""}`);
  if (disc) {
    console.log(
      `\nDiscrimination (${disc.pass ? "PASS" : "FAIL"}) · primary signal=JD-coverage · ` +
        `treatment median ${(disc.treatmentMedianCoverage * 100).toFixed(0)}%`,
    );
    for (const c of disc.controls) {
      console.log(
        `  ${c.below ? "✓" : "✖"} control ${pad(c.id, 16)} cov ${(c.coverage * 100).toFixed(0)}% ` +
          `(${c.gap >= 0 ? "−" : "+"}${(Math.abs(c.gap) * 100).toFixed(0)}pt vs median)`,
      );
    }
    console.log(`  caveat: ${disc.caveat}`);
  } else if (!MOCK) {
    console.log(`\nDiscrimination: not evaluated (need ≥1 treatment and ≥1 control job in selection).`);
  }
  console.log(`\nTailored JSON + any PDFs written to ${OUT_DIR}`);
}

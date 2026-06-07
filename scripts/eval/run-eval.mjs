#!/usr/bin/env node
/**
 * Quality eval harness for the non-deterministic tailoring pass.
 *
 * Runs the REAL pipeline (tailorResume) over resume×job fixtures and scores
 * each output, then asserts hard floors. This is how we keep the LLM step
 * honest: the score is computed on the exact production code path.
 *
 * Cost model (important):
 *   - Tailoring runs through the CLI adapter (`claude -p`) on your Claude
 *     subscription → $0 marginal API cost. We force LLM_MODE=cli so that even
 *     when ANTHROPIC_API_KEY is set (for the judge) tailoring stays free.
 *   - Scoring L1 (lexicon) + L2 (stylometry) + rule compliance are pure,
 *     deterministic, offline → free.
 *   - L3 (LLM-as-judge for G1 tailoring fit + G4 writing) is the ONLY billed
 *     component. It is opt-in via --l3, requires ANTHROPIC_API_KEY, and is
 *     bounded by a hard BudgetGate cap (default $1.00) with an up-front quote.
 *
 * Usage:
 *   npm run eval                       # 3 cases, real tailoring (free), L1+L2+rules
 *   npm run eval -- --full             # all fixture pairs
 *   npm run eval -- --cases 5
 *   npm run eval -- --cohort swe-mid
 *   npm run eval -- --l3 --cap 1.00    # add billed LLM judge, hard $1 cap
 *   MOCK_LLM=1 npm run eval            # $0 wiring check (CI): scorer+rules on mock output
 *   npm run eval -- --json             # machine-readable report
 */
import { readFileSync } from "node:fs";
import { COHORTS } from "../fixtures/perf/index.mjs";
import { scoreEval } from "../scorer/index.mjs";
import { BudgetGate } from "../scorer/budget.mjs";
import { checkRules } from "./rules.mjs";

// ---- flags ----
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const val = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};

const MOCK = process.env.MOCK_LLM === "1" || flag("--mock");
const USE_L3 = flag("--l3");
const FULL = flag("--full");
const N_CASES = parseInt(val("--cases", "3"), 10);
const COHORT_FILTER = val("--cohort", null);
const CAP_USD = parseFloat(val("--cap", "1.00"));
const G3_FLOOR = parseInt(val("--g3-floor", "40"), 10);
const MODEL = val("--model", null);
const JSON_OUT = flag("--json");

// Pin tailoring to the subscription CLI adapter so it never bills, even when
// ANTHROPIC_API_KEY is present for the judge. (User can still override.)
if (!MOCK) process.env.LLM_MODE ??= "cli";

// tailorResume imports the LLM factory, so import it AFTER pinning LLM_MODE.
const { tailorResume } = await import("../../lib/pipeline.ts");

// ---- build the case list ----
let cohorts = COHORTS;
if (COHORT_FILTER) cohorts = cohorts.filter((c) => c.id === COHORT_FILTER);
if (cohorts.length === 0) {
  console.error(`No cohort matches "${COHORT_FILTER}". Available: ${COHORTS.map((c) => c.id).join(", ")}`);
  process.exit(2);
}

const cases = [];
for (const cohort of cohorts) {
  const jobs = FULL ? cohort.jobs : cohort.jobs.slice(0, 1);
  for (const job of jobs) cases.push({ cohort, job });
}
const selected = FULL || COHORT_FILTER ? cases : cases.slice(0, N_CASES);

// ---- L3 budget + cost quote ----
let apiKey = null;
let budgetGate = null;
if (USE_L3) {
  apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("--l3 requires ANTHROPIC_API_KEY (the judge calls the Anthropic API).");
    process.exit(2);
  }
  budgetGate = new BudgetGate({ capUsd: CAP_USD });
  console.log(
    `\n⚠  L3 judge ENABLED — billed Anthropic API calls.\n` +
      `   Cases: ${selected.length} · up to 2 judge calls each.\n` +
      `   Hard cap: $${CAP_USD.toFixed(2)} (BudgetGate aborts before exceeding).\n`,
  );
}

console.log(
  `Eval: ${selected.length} case(s) · tailoring=${MOCK ? "MOCK ($0)" : `live:${process.env.LLM_MODE} ($0 subscription)`} · ` +
    `scoring=L1+L2${USE_L3 ? "+L3(billed)" : ""}+rules · G3 floor=${G3_FLOOR}\n`,
);

// ---- run ----
const rows = [];
let anyFail = false;

for (const { cohort, job } of selected) {
  const label = `${cohort.id}/${job.id}`;
  const resumeText = readFileSync(cohort.resumePath, "utf8");
  let row = { label, ok: false };
  try {
    const resume = await tailorResume(resumeText, job.text, MODEL ? { model: MODEL } : {});
    const score = await scoreEval({
      resume,
      jobText: job.text,
      apiKey,
      budgetGate,
      useL3G1: USE_L3,
      useL3G4: USE_L3,
    });
    const rules = checkRules(resume, { sourceText: resumeText });
    const ok = score.g3 >= G3_FLOOR && rules.ok;
    row = {
      label,
      g1: score.g1,
      g2: score.g2,
      g3: score.g3,
      g4: score.g4,
      fitness: score.fitness,
      violations: rules.violations,
      ok,
    };
  } catch (err) {
    row.error = err.message ?? String(err);
  }
  if (!row.ok) anyFail = true;
  rows.push(row);
  printRow(row);
}

// ---- report ----
if (JSON_OUT) {
  console.log(JSON.stringify({ cases: rows, g3Floor: G3_FLOOR, useL3: USE_L3 }, null, 2));
} else {
  const scored = rows.filter((r) => r.fitness !== undefined);
  if (scored.length) {
    const avg = (k) => (scored.reduce((s, r) => s + r[k], 0) / scored.length).toFixed(1);
    console.log(`\n${"─".repeat(64)}`);
    console.log(
      `Avg  G1 ${avg("g1")}  G2 ${avg("g2")}  G3 ${avg("g3")}  G4 ${avg("g4")}  fitness ${avg("fitness")}`,
    );
  }
  const passed = rows.filter((r) => r.ok).length;
  console.log(`Cases: ${rows.length} · ${passed} passed · ${rows.length - passed} failed`);
  if (budgetGate) console.log(`L3 spend: $${(CAP_USD - budgetGate.remaining()).toFixed(4)} of $${CAP_USD.toFixed(2)} cap`);
}

process.exit(anyFail ? 1 : 0);

function printRow(r) {
  if (JSON_OUT) return;
  if (r.error) {
    console.log(`  ✖ ${r.label.padEnd(28)} ERROR: ${r.error}`);
    return;
  }
  const mark = r.ok ? "✓" : "✖";
  const v = r.violations.length ? ` · ${r.violations.length} rule viol` : "";
  console.log(
    `  ${mark} ${r.label.padEnd(28)} G1 ${pad(r.g1)} G2 ${pad(r.g2)} G3 ${pad(r.g3)} G4 ${pad(r.g4)} fit ${pad(r.fitness)}${v}`,
  );
  for (const viol of r.violations) console.log(`       ↳ [${viol.rule}] ${viol.detail}`);
}
function pad(n) {
  return String(n).padStart(3);
}

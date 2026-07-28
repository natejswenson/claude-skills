#!/usr/bin/env node
/**
 * Regenerate evals/baseline/coverage-matrix.json.
 *
 *   node evals/baseline/update-coverage-matrix.mjs
 *
 * Run this ONLY when a change to keywordCoverage() (or to the job/résumé
 * fixtures) is intentional. The matrix is what makes a silent scoring shift
 * visible, so refreshing it to make a failing test pass discards the signal —
 * read the diff first and confirm the new numbers are the ones you meant.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { keywordCoverage } from "../../scripts/eval/keyword-coverage.mjs";
import { JOBS } from "../../scripts/fixtures/perf/jobs.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = resolve(HERE, "..", "..");

// Mirrors scripts/evals/run.mjs, which passes job.text.slice(0, 6000).
const JD_TRIM_CHARS = 6000;
const RESUME_PATH = "evals/baseline/tailored-devops-resume.json";

const resume = JSON.parse(readFileSync(join(SKILL_ROOT, RESUME_PATH), "utf8"));

const jobs = {};
for (const job of JOBS) {
  jobs[job.id] = {
    archetype: job.archetype,
    coverage: Number(
      keywordCoverage(resume, job.text.slice(0, JD_TRIM_CHARS)).coverage.toFixed(4)
    ),
  };
}

const payload = {
  _comment:
    "Frozen keywordCoverage() scores for a real past-run tailored DevOps resume " +
    "(evals/baseline/tailored-devops-resume.json — the benchmark-out artifact with " +
    "identity fields replaced; benchmark-out/ is gitignored because it holds real " +
    "contact details, and coverage reads only summary + experience[].bullets) " +
    "against all 28 real job fixtures. " +
    "Regenerate with: node evals/baseline/update-coverage-matrix.mjs",
  resume: RESUME_PATH,
  matchingArchetype: "swe-mid",
  jdTrimChars: JD_TRIM_CHARS,
  jobs,
};

writeFileSync(
  join(HERE, "coverage-matrix.json"),
  JSON.stringify(payload, null, 2) + "\n"
);
console.log(`wrote ${Object.keys(jobs).length} entries to coverage-matrix.json`);

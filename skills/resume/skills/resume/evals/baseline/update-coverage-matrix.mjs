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
 *
 * TWO résumés are scored, on purpose. The DevOps fixture is the historical
 * discrimination case, but it has no `projects` and no `highlights`, so on its
 * own it exercises none of the sections keywordCoverage learned to read in
 * 2.0 — the new code paths would be frozen at zero coverage while the file
 * still looked comprehensive. The showcase résumé carries all of them.
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

const RESUMES = {
  // A real past-run tailored DevOps résumé: summary + bullets + flat skills.
  devops: "evals/baseline/tailored-devops-resume.json",
  // A real approved résumé with highlights, projects and grouped skills — the
  // only fixture that covers the sections added in 2.0.
  showcase: "evals/baseline/press-showcase-resume.json",
};

const scoreAll = (resume) => {
  const jobs = {};
  for (const job of JOBS) {
    jobs[job.id] = {
      archetype: job.archetype,
      coverage: Number(
        keywordCoverage(resume, job.text.slice(0, JD_TRIM_CHARS)).coverage.toFixed(4),
      ),
    };
  }
  return jobs;
};

const resumes = {};
for (const [key, path] of Object.entries(RESUMES)) {
  const resume = JSON.parse(readFileSync(join(SKILL_ROOT, path), "utf8"));
  resumes[key] = { path, jobs: scoreAll(resume) };
}

const payload = {
  _comment:
    "Frozen keywordCoverage() scores against all 28 real job fixtures, for two real " +
    "résumés with identity fields replaced (benchmark-out/ is gitignored because it " +
    "holds real contact details). 'devops' is the historical discrimination case; " +
    "'showcase' additionally carries highlights, projects and grouped skills, which " +
    "keywordCoverage reads as of 2.0 and which 'devops' does not contain at all. " +
    "Regenerate with: node evals/baseline/update-coverage-matrix.mjs",
  matchingArchetype: "swe-mid",
  jdTrimChars: JD_TRIM_CHARS,
  resumes,
};

writeFileSync(join(HERE, "coverage-matrix.json"), JSON.stringify(payload, null, 2) + "\n");
for (const [key, r] of Object.entries(resumes)) {
  console.log(`${key}: ${Object.keys(r.jobs).length} entries (${r.path})`);
}

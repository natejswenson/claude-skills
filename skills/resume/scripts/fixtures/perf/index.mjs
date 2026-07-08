/**
 * Cohort matrix index for the Haiku 4.5 perf optimization suite.
 *
 * Each cohort pairs ONE resume archetype with the job fixtures (3+
 * postings per archetype) it should be tested against. The matrix
 * runner iterates this structure to drive per-cohort scoring.
 *
 * Usage from the harness:
 *   import { COHORTS } from "../fixtures/perf/index.mjs";
 *   for (const cohort of COHORTS) {
 *     const resumeText = readFileSync(cohort.resumePath, "utf8");
 *     for (const job of cohort.jobs) { ... }
 *   }
 */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { JOBS } from "./jobs.mjs";

const HERE = resolve(fileURLToPath(import.meta.url), "..");

const ARCHETYPE_META = [
  { id: "swe-mid",       label: "Software Engineer (mid-level)",   resumeFile: "01-swe-mid.txt",            messy: false, cluster: "Technical" },
  { id: "sales-ae",      label: "Sales AE (B2B SaaS)",             resumeFile: "02-sales-ae.txt",           messy: false, cluster: "Sales" },
  { id: "rn-clinical",   label: "RN — ICU / Critical Care",        resumeFile: "03-rn-clinical.txt",        messy: false, cluster: "Healthcare" },
  { id: "retail-mgr",    label: "Retail Store Manager",            resumeFile: "04-retail-mgr.txt",         messy: false, cluster: "Retail" },
  { id: "restaurant-gm", label: "Restaurant General Manager",      resumeFile: "05-restaurant-gm-messy.txt", messy: true,  cluster: "Hospitality" },
  { id: "mktg-coord",    label: "Marketing Coordinator (early-career)", resumeFile: "06-mktg-coord-messy.txt", messy: true, cluster: "Marketing" },
  { id: "accountant",    label: "Senior Financial Analyst (CPA)",  resumeFile: "07-accountant.txt",         messy: false, cluster: "Finance" },
  { id: "hvac-tech",     label: "HVAC Service Technician",         resumeFile: "08-hvac-tech-messy.txt",    messy: true,  cluster: "Trades" },
  { id: "teacher-elem",  label: "Elementary Teacher (K-3)",        resumeFile: "09-teacher-elementary.txt", messy: false, cluster: "Education" },
];

export const COHORTS = ARCHETYPE_META.map((meta) => ({
  ...meta,
  resumePath: resolve(HERE, "resumes", meta.resumeFile),
  jobs: JOBS.filter((j) => j.archetype === meta.id),
}));

/** Total number of (cohort, job) pairs the harness will iterate. */
export const TOTAL_FIXTURE_PAIRS = COHORTS.reduce(
  (sum, c) => sum + c.jobs.length,
  0,
);

// Sanity: every cohort has at least 2 job fixtures
for (const c of COHORTS) {
  if (c.jobs.length < 2) {
    throw new Error(
      `cohort ${c.id} has only ${c.jobs.length} job fixtures (min 2)`,
    );
  }
}

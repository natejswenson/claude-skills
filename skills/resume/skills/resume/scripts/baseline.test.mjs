#!/usr/bin/env node
/**
 * Baseline eval: JD-keyword coverage pinned against the real fixture corpus.
 *
 * $0, no network, no LLM. Run: node scripts/baseline.test.mjs
 *
 * scripts/keyword-coverage.test.mjs already unit-tests keywordCoverage() on
 * small synthetic inputs (discrimination, gameability, determinism, empty JD).
 * What it cannot show is whether the function still discriminates on REAL data:
 * a hand-written two-bullet résumé against a hand-written JD will separate under
 * almost any scoring rule. The 28 real job postings in scripts/fixtures/perf/
 * and a real past-run tailored résumé are a much harder test, and they are what
 * the eval harness actually scores against.
 *
 * The résumé under test (evals/baseline/tailored-devops-resume.json) is a genuine
 * artifact from a local benchmark run — benchmark-out/j1-senior-devops.json with
 * its identity fields replaced. The redaction is required, not cosmetic:
 * benchmark-out/ is gitignored precisely because it holds real contact details,
 * so committing the original would both leak PII and be the only way CI could
 * see the file at all. keywordCoverage() reads no contact fields, so replacing
 * name/contact changes no score.
 *
 * TWO résumés are scored. The DevOps fixture is the historical discrimination
 * case, but it has no `projects` and no `highlights` — so on its own it
 * exercises none of the sections keywordCoverage learned to read in 2.0, and
 * those code paths would sit at zero coverage while this file still looked
 * thorough. `press-showcase-resume.json` is a real approved résumé that carries
 * highlights, projects and grouped skills, and must discriminate too.
 *
 * Both are DevOps/infrastructure résumés, so:
 *
 *   * against the three swe-mid postings it should score clearly highest;
 *   * against the other eight archetypes (nursing, HVAC, retail, teaching…)
 *     it should score clearly lower.
 *
 * That ordering is the whole reason the metric is in the harness. If it ever
 * inverts or collapses, JD-coverage has stopped measuring fit and every eval
 * score built on it is meaningless — while still looking like a number.
 *
 * NOTE on the fixture: benchmark-out/j6-frontend.json is byte-identical to
 * j1-senior-devops.json — a frontend job's output file containing a DevOps
 * résumé. That is a real defect in the historical benchmark run, not something
 * this baseline can fix, so only the DevOps file is used here and the pair is
 * deliberately NOT used as a two-résumé discrimination test.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { keywordCoverage } from "./eval/keyword-coverage.mjs";
import { JOBS } from "./fixtures/perf/jobs.mjs";
import { ResumeJSON } from "./validate.mjs";

const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MATRIX = JSON.parse(
  readFileSync(join(SKILL_ROOT, "evals", "baseline", "coverage-matrix.json"), "utf8")
);
const RESUMES = Object.entries(MATRIX.resumes).map(([key, entry]) => ({
  key,
  path: entry.path,
  frozen: entry.jobs,
  resume: JSON.parse(readFileSync(join(SKILL_ROOT, entry.path), "utf8")),
}));

// How far a score may drift before it counts as a change worth looking at.
// Deliberately loose: this exists to catch a stopword/tokenizer change that
// shifts the whole matrix, not to freeze the fourth decimal place.
const DRIFT_TOLERANCE = 0.03;

let pass = 0,
  fail = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    pass++;
  } catch (err) {
    console.log(`  ✗ ${name}\n    ${err.message}`);
    fail++;
  }
}

const scoreWith = (resume) => (job) =>
  keywordCoverage(resume, job.text.slice(0, MATRIX.jdTrimChars)).coverage;
const matching = JOBS.filter((j) => j.archetype === MATRIX.matchingArchetype);
const other = JOBS.filter((j) => j.archetype !== MATRIX.matchingArchetype);

console.log("\nbaseline: JD-keyword coverage vs the real fixture corpus\n");

await test("both résumés are loaded, and one exercises the 2.0 sections", () => {
  // Anti-vacuity: if the showcase fixture loses its highlights/projects, the
  // sections keywordCoverage reads go untested while this file stays green.
  assert.ok(RESUMES.length >= 2, `expected >= 2 baseline résumés, got ${RESUMES.length}`);
  const showcase = RESUMES.find((r) => r.key === "showcase");
  assert.ok(showcase, "the showcase résumé is missing from the matrix");
  assert.ok(showcase.resume.highlights?.length >= 3, "showcase lost its highlights");
  assert.ok(showcase.resume.projects?.length >= 2, "showcase lost its projects");
  assert.ok(
    showcase.resume.skills.some((s) => s.includes(":")),
    "showcase lost its grouped skills",
  );
});

await test("the job corpus is large enough to be meaningful", () => {
  // Anti-vacuity: every assertion below loops over these. If the fixtures ever
  // stop loading, the loops run zero times and this file passes checking nothing.
  assert.ok(JOBS.length >= 20, `expected >= 20 job fixtures, got ${JOBS.length}`);
  assert.ok(matching.length >= 3, `expected >= 3 matching-archetype jobs, got ${matching.length}`);
  assert.ok(other.length >= 15, `expected >= 15 off-archetype jobs, got ${other.length}`);
});

await test("coverage separates the matching archetype from every other one", () => {
  for (const { key, resume } of RESUMES) {
  const score = scoreWith(resume);
  const worstMatch = Math.min(...matching.map(score));
  const bestOther = Math.max(...other.map(score));
  assert.ok(
    worstMatch > bestOther,
    `[${key}] ` +
    `The worst matching-archetype score (${worstMatch.toFixed(4)}) is not above ` +
      `the best off-archetype score (${bestOther.toFixed(4)}). JD-coverage has ` +
      `stopped discriminating on real data — every eval score built on it is now ` +
      `meaningless while still looking like a number.`
  );
  }
});

await test("the matching archetype scores at least 1.5x the off-archetype mean", () => {
  const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  for (const { key, resume } of RESUMES) {
  const score = scoreWith(resume);
  const ratio = mean(matching.map(score)) / mean(other.map(score));
  assert.ok(
    ratio >= 1.5,
    `[${key}] matching/off-archetype mean ratio is ${ratio.toFixed(2)}, below 1.5. The ` +
      `signal is collapsing toward noise even if the strict ordering still holds.`
  );
  }
});

await test("no individual score has drifted from the frozen matrix", () => {
  const drifted = [];
  for (const { key, resume, frozen: frozenJobs } of RESUMES) {
  const score = scoreWith(resume);
  for (const job of JOBS) {
    const frozen = frozenJobs[job.id];
    if (!frozen) {
      drifted.push(`${key}/${job.id}: missing from the frozen matrix`);
      continue;
    }
    const now = score(job);
    if (Math.abs(now - frozen.coverage) > DRIFT_TOLERANCE) {
      drifted.push(
        `${key}/${job.id}: ${frozen.coverage.toFixed(4)} -> ${now.toFixed(4)}`
      );
    }
  }
  }
  assert.equal(
    drifted.length,
    0,
    `Coverage scores moved by more than ${DRIFT_TOLERANCE} on ${drifted.length} ` +
      `job(s):\n      ${drifted.join("\n      ")}\n    ` +
      `A shift across many jobs at once usually means the stopword list or the ` +
      `tokenizer changed. If intentional, regenerate with:\n    ` +
      `  node evals/baseline/update-coverage-matrix.mjs`
  );
});

await test("every job in the frozen matrix still exists in the fixtures", () => {
  // The check above skips nothing when a job is DELETED — it only iterates JOBS.
  // Without this, quietly dropping fixtures shrinks the corpus unnoticed.
  const ids = new Set(JOBS.map((j) => j.id));
  const gone = RESUMES.flatMap(({ key, frozen }) =>
    Object.keys(frozen).filter((id) => !ids.has(id)).map((id) => `${key}/${id}`),
  );
  assert.equal(
    gone.length,
    0,
    `Job fixture(s) in the frozen matrix no longer exist: ${gone.join(", ")}`
  );
});

await test("every real past-run résumé still satisfies the current schema", () => {
  // Schema drift that invalidates real historical output is a migration the
  // skill owes its users, not a detail — this surfaces it at CI time.
  for (const { path, resume } of RESUMES) {
    const result = ResumeJSON.safeParse(resume);
    assert.ok(
      result.success,
      `${path} no longer parses as ResumeJSON:\n      ` +
        JSON.stringify(result.error?.issues?.slice(0, 5), null, 2)
    );
  }
});

await test("coverage is still a pure function of its inputs", () => {
  const job = matching[0];
  const { resume } = RESUMES[0];
  const a = keywordCoverage(resume, job.text.slice(0, MATRIX.jdTrimChars));
  const b = keywordCoverage(resume, job.text.slice(0, MATRIX.jdTrimChars));
  assert.deepEqual(a, b, "two identical calls disagreed — scoring is not deterministic");
});

console.log(`\nresult: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

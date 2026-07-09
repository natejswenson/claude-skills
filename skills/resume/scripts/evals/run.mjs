#!/usr/bin/env node
/**
 * Tailoring-quality evaluation harness — the mechanism satisfying "it must
 * be evaluated". See docs/plans/2026-07-08-resume-eval-harness-design.md
 * for the full, quality-gated design (7 rounds of adversarial review).
 *
 * Runs each fixture through a bounded `claude -p` subprocess given the
 * tailoring rules + résumé/job text as PRE-SUPPLIED TEXT (no live WebFetch,
 * no filesystem/Bash access) — this verifies tailoring-rule compliance
 * given text already in hand; it does not exercise the WebFetch path, the
 * job-extraction-fallback path, the docx shim, or render-time error paths
 * (those are covered by the one required live interactive run, plus
 * scripts/docx-to-text.test.mjs and the other unit tests).
 *
 * PASS iff: the deterministic gate passes on 100% of the fixture set run,
 * AND the injection-regression check passes on all 5 adversarial fixtures.
 * Every other number (keyword-coverage, ATS-parseability, baseline delta,
 * LLM-judge score) is reported alongside the verdict but never changes it.
 *
 * Results are PRINTED for the user to read and sign off on — this harness
 * never declares the redesign "done" on its own; only a human does, after
 * reading this output.
 *
 * Usage:
 *   node scripts/evals/run.mjs                # default 9-pair subset
 *   node scripts/evals/run.mjs --full          # all 28 pairs
 *   node scripts/evals/run.mjs --skip-judge     # skip the capped LLM-judge pass
 *   node scripts/evals/run.mjs --judge-cap 5    # override the $2.00 default cap
 */
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
register(pathToFileURL(join(ROOT, "scripts", "_tsx-loader.mjs")).href);

const { z } = await import("zod");
const { ResumeJSON, validateTailoring, dropNoopOptimizedBullets } = await import("../validate.mjs");
const { renderTemplateFromResume } = await import("../render.mjs");
const { keywordCoverage } = await import("../eval/keyword-coverage.mjs");
const { BudgetGate, BudgetExceededError } = await import("../scorer/budget.mjs");
const { judgeTailoringQuality } = await import("./judge.mjs");
const { FIXTURES: INJECTION_FIXTURES, applySubstitutions, scanOutput } = await import(
  "../fixtures/injection-fixtures.mjs"
);
const { COHORTS } = await import("../fixtures/perf/index.mjs");
const { extractText, getDocumentProxy } = await import("unpdf");

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const FULL = argv.includes("--full");
const SKIP_JUDGE = argv.includes("--skip-judge");
const judgeCapIdx = argv.indexOf("--judge-cap");
let JUDGE_CAP_USD = 2.0;
if (judgeCapIdx !== -1) {
  const raw = argv[judgeCapIdx + 1];
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`--judge-cap requires a positive numeric value, got: ${raw}`);
  }
  JUDGE_CAP_USD = parsed;
}

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

function loadDefaultPairs() {
  const manifest = JSON.parse(
    readFileSync(join(__dirname, "default-fixtures.json"), "utf8"),
  );
  const pairs = [];
  for (const { cohortId, jobId } of manifest.pairs) {
    const cohort = COHORTS.find((c) => c.id === cohortId);
    const job = cohort.jobs.find((j) => j.id === jobId);
    pairs.push({ cohort, job });
  }
  return pairs;
}

function loadAllPairs() {
  const pairs = [];
  for (const cohort of COHORTS) {
    for (const job of cohort.jobs) pairs.push({ cohort, job });
  }
  return pairs;
}

// ---------------------------------------------------------------------------
// Driver: bounded `claude -p` subprocess, pre-supplied text only.
// Mirrors scripts/scorer/judge-cli.mjs's spawn/timeout/kill pattern.
// ---------------------------------------------------------------------------

const TAILORING_RULES = readFileSync(
  join(ROOT, "references", "tailoring-rules.md"),
  "utf8",
);
const DRIVER_TIMEOUT_MS = 90_000;
const SIGKILL_GRACE_MS = 5_000;
// The CLI's --json-schema tool-registration silently no-ops (model answers in
// plain text, structured_output never populates) if the schema carries a
// top-level $schema key — confirmed by direct reproduction. z.toJSONSchema()
// adds one by default, so it must be stripped before use.
const { $schema: _unused, ...RESUME_JSON_SCHEMA } = z.toJSONSchema(ResumeJSON);

function tailorViaSubprocess(resumeText, jobText) {
  return new Promise((res, rej) => {
    const system = `You are tailoring a résumé to a job description. Follow these rules exactly:\n\n${TAILORING_RULES}\n\nRespond with ONLY the tailored résumé as JSON matching the provided schema. Do not narrate, do not explain — emit the JSON object directly.`;
    const user = `SOURCE RÉSUMÉ:\n${resumeText}\n\nJOB POSTING:\n${jobText}`;
    const args = [
      "-p",
      "--tools", "",
      "--output-format", "json",
      "--system-prompt", system,
      "--json-schema", JSON.stringify(RESUME_JSON_SCHEMA),
    ];

    let child;
    try {
      child = spawn(process.env.EVAL_CLAUDE_BIN ?? "claude", args, {
        shell: false,
        cwd: process.env.TMPDIR ?? "/tmp",
        env: { ...process.env, MAX_THINKING_TOKENS: process.env.MAX_THINKING_TOKENS ?? "0" },
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err) {
      rej(new Error(`claude spawn failed: ${err.message}`));
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(arg);
    };

    const timer = setTimeout(() => {
      if (settled) return;
      try { child.kill("SIGTERM"); } catch {}
      setTimeout(() => {
        try { child.kill("SIGKILL"); } catch {}
      }, SIGKILL_GRACE_MS).unref();
      finish(rej, new Error(`driver timed out after ${DRIVER_TIMEOUT_MS}ms (child killed)`));
    }, DRIVER_TIMEOUT_MS);

    child.stdin.write(user);
    child.stdin.end();
    child.stdout.on("data", (c) => (stdout += c.toString()));
    child.stderr.on("data", (c) => (stderr += c.toString()));
    child.on("error", (err) => finish(rej, new Error(`claude spawn error: ${err.message}`)));
    child.on("close", (code) => {
      if (settled) return;
      if (code !== 0) {
        finish(
          rej,
          new Error(
            `claude exited ${code}. stderr: ${stderr.slice(-300) || "(empty)"}. stdout: ${stdout.slice(-300) || "(empty)"}`,
          ),
        );
        return;
      }
      let env;
      try {
        env = JSON.parse(stdout.trim());
      } catch {
        finish(rej, new Error(`unparseable envelope: ${stdout.slice(0, 200)}`));
        return;
      }
      if (!env.structured_output) {
        finish(rej, new Error(`no structured_output in envelope: ${JSON.stringify(env).slice(0, 200)}`));
        return;
      }
      finish(res, env.structured_output);
    });
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const pairs = FULL ? loadAllPairs() : loadDefaultPairs();
  console.log(
    `Running ${pairs.length} fixture pair(s) (${FULL ? "--full, all 28" : "default 9-pair subset"}). Each pair is a real subprocess call — no incremental API cost (subscription CLI), but this consumes rate-limit/quota and takes real wall-clock time.`,
  );

  const results = [];
  for (const { cohort, job } of pairs) {
    const resumeText = readFileSync(cohort.resumePath, "utf8");
    process.stdout.write(`  ${cohort.id} × ${job.id} ... `);
    try {
      const raw = await tailorViaSubprocess(resumeText, job.text);
      const parsed = ResumeJSON.safeParse(raw);
      if (!parsed.success) {
        results.push({
          cohort: cohort.id,
          job: job.id,
          gatePass: false,
          gateReason: `schema violations: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`,
        });
        console.log("✗ schema");
        continue;
      }
      const cleaned = dropNoopOptimizedBullets(parsed.data);
      const validation = validateTailoring(cleaned, resumeText);
      const coverage = keywordCoverage(cleaned, job.text.slice(0, 6000));
      results.push({
        cohort: cohort.id,
        job: job.id,
        resumeText,
        jobText: job.text,
        tailored: cleaned,
        gatePass: validation.ok,
        gateReason: validation.ok ? null : validation.violations.join("; "),
        coveragePct: Math.round(coverage.coverage * 100),
      });
      console.log(validation.ok ? "✓" : `✗ ${validation.violations[0]}`);
    } catch (err) {
      results.push({ cohort: cohort.id, job: job.id, gatePass: false, gateReason: err.message });
      console.log(`✗ driver error: ${err.message}`);
    }
  }

  // ---- Injection regression (gating) ----
  console.log("\nInjection regression (gating — reuses scripts/prompt-injection.test.mjs's oracle):");
  const injectionResults = [];
  const fixturesDir = join(ROOT, "docs", "security", "prompt-injection-fixtures");
  const benignResume = readFileSync(join(fixturesDir, "benign-resume.txt"), "utf8");
  for (const [name, spec] of Object.entries(INJECTION_FIXTURES)) {
    process.stdout.write(`  ${name} ... `);
    try {
      const raw = readFileSync(join(fixturesDir, `${name}.txt`), "utf8");
      const jobText = applySubstitutions(raw, spec.substitutions);
      const output = await tailorViaSubprocess(benignResume, jobText);
      const serialized = JSON.stringify(output);
      const hits = scanOutput(serialized, spec.forbiddenInOutput);
      // Regex checks (e.g. /\n\s*Human\s*:/i) need real newline bytes, which
      // JSON.stringify escapes to the two-char "\n" sequence — so they must
      // run against the UN-serialized text, not the JSON-escaped string.
      // Build a plain-text corpus from the fields most likely to carry a
      // smuggled turn-marker: the summary, every experience bullet/title/
      // company, skills, rewritten optimized-bullet text, and education
      // details, joined with literal newlines.
      const plainTextCorpus = [
        output?.summary ?? "",
        ...(output?.experience ?? []).flatMap((e) => e.bullets ?? []),
        ...(output?.experience ?? []).map((e) => e.title ?? ""),
        ...(output?.experience ?? []).map((e) => e.company ?? ""),
        ...(output?.skills ?? []),
        ...(output?.optimizedBullets ?? []).map((b) => b.rewritten ?? ""),
        ...(output?.education ?? []).map((e) => e.details ?? ""),
      ].join("\n");
      const regexHits = (spec.forbiddenInPromptRegex ?? []).filter((rx) => rx.test(plainTextCorpus));
      const pass = hits.length === 0 && regexHits.length === 0;
      injectionResults.push({ name, pass, hits });
      console.log(pass ? "✓" : `✗ forbidden found: ${JSON.stringify(hits)}`);
    } catch (err) {
      injectionResults.push({ name, pass: false, hits: [`driver error: ${err.message}`] });
      console.log(`✗ driver error: ${err.message}`);
    }
  }

  // ---- ATS-parseability (scored, not gating) ----
  console.log("\nATS-parseability (scored, informational):");
  const atsResults = [];
  const ATS_SAFE_TEMPLATES = ["modern", "classic", "technical", "editorial"];
  for (const r of results.filter((r) => r.gatePass)) {
    try {
      const pdfPath = await renderTemplateFromResume(r.tailored, "modern", process.env.TMPDIR ?? "/tmp");
      const buf = readFileSync(pdfPath);
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const extracted = await extractText(pdf, { mergePages: true });
      const text = Array.isArray(extracted.text) ? extracted.text.join("\n") : extracted.text;
      const allBullets = r.tailored.experience.flatMap((e) => e.bullets);
      let lastIndex = -1;
      let orderPreserved = true;
      for (const b of allBullets) {
        const idx = text.indexOf(b.slice(0, 30));
        if (idx === -1 || idx <= lastIndex) {
          orderPreserved = false;
          break;
        }
        lastIndex = idx;
      }
      atsResults.push({ cohort: r.cohort, orderPreserved });
    } catch (err) {
      atsResults.push({ cohort: r.cohort, orderPreserved: false, error: err.message });
    }
  }
  const atsPassRate = atsResults.length
    ? Math.round((atsResults.filter((a) => a.orderPreserved).length / atsResults.length) * 100)
    : null;
  console.log(`  ${atsPassRate ?? "N/A"}% of fixtures preserved bullet order in extracted text (threshold: 100%; templates used: modern, and ${ATS_SAFE_TEMPLATES.slice(1).join("/")} share the same single-column layout)`);

  // ---- Baseline delta (scored, not gating) ----
  console.log("\nBaseline delta (informational — is the rules doc measurably better than plain prompting?):");
  const BASELINE_CLUSTERS = ["swe-mid", "sales-ae", "rn-clinical"]; // Technical, Sales, Healthcare — most distinct clusters, not largest
  const baselineResults = [];
  for (const cohortId of BASELINE_CLUSTERS) {
    const withSkill = results.find((r) => r.cohort === cohortId && r.gatePass);
    if (!withSkill) continue;
    try {
      const baselineRaw = await tailorViaSubprocessNoRules(withSkill.resumeText, withSkill.jobText);
      const baselineCoverage = keywordCoverage(baselineRaw, withSkill.jobText.slice(0, 6000));
      const deltaPp = withSkill.coveragePct - Math.round(baselineCoverage.coverage * 100);
      baselineResults.push({ cohort: cohortId, deltaPp });
      console.log(`  ${cohortId}: ${deltaPp >= 0 ? "+" : ""}${deltaPp}pp vs. baseline`);
    } catch (err) {
      console.log(`  ${cohortId}: skipped (${err.message})`);
    }
  }
  const avgDelta = baselineResults.length
    ? Math.round(baselineResults.reduce((s, b) => s + b.deltaPp, 0) / baselineResults.length)
    : null;
  if (avgDelta !== null) {
    console.log(
      `  average: ${avgDelta >= 0 ? "+" : ""}${avgDelta}pp — ${avgDelta >= 15 ? "measurably outperforms baseline (≥15pp)" : "below the ≥15pp bar"}`,
    );
  }

  // ---- LLM-judge (optional, capped, defaults ON) ----
  let judgeResults = [];
  if (!SKIP_JUDGE) {
    console.log(`\nLLM-judge pass (capped at $${JUDGE_CAP_USD.toFixed(2)}, defaults ON for this first run):`);
    const budgetGate = new BudgetGate({ capUsd: JUDGE_CAP_USD });
    for (const r of results.filter((r) => r.gatePass).slice(0, 3)) {
      const verdict = await judgeTailoringQuality({
        sourceResume: r.resumeText,
        jobText: r.jobText,
        tailoredResume: r.tailored,
        budgetGate,
      });
      judgeResults.push({ cohort: r.cohort, ...verdict });
      if (verdict.incomplete) {
        console.log(`  ${r.cohort}: incomplete (${verdict.reason})`);
      } else {
        console.log(`  ${r.cohort}: tailoringFit=${verdict.tailoringFit} groundedness=${verdict.groundedness}`);
      }
    }
    console.log(`  spend: $${budgetGate.cumulativeUsd.toFixed(4)} / $${JUDGE_CAP_USD.toFixed(2)} cap`);
  } else {
    console.log("\nLLM-judge pass: skipped (--skip-judge)");
  }

  // ---- Aggregate verdict ----
  const gatePassRate = results.filter((r) => r.gatePass).length;
  const gateAllPass = results.length > 0 && gatePassRate === results.length;
  const injectionAllPass = injectionResults.every((r) => r.pass);
  const verdict = gateAllPass && injectionAllPass ? "PASS" : "FAIL";

  console.log(`\n${"═".repeat(70)}`);
  console.log(`HARNESS VERDICT: ${verdict}`);
  console.log(`  deterministic gate: ${gatePassRate}/${results.length} fixtures passed`);
  console.log(`  injection regression: ${injectionResults.filter((r) => r.pass).length}/${injectionResults.length} fixtures passed`);
  console.log(
    `  (scored, non-gating) keyword coverage avg: ${Math.round(results.filter((r) => r.coveragePct != null).reduce((s, r) => s + r.coveragePct, 0) / (results.filter((r) => r.coveragePct != null).length || 1))}% (informational — keywordCoverage() counts EVERY non-stopword JD token, including narrative/culture prose the résumé should NOT echo; a truthful, non-keyword-stuffed tailoring is expected to score well under 60% on this proxy — read matched/missed lists, not the raw %, before drawing conclusions)`,
  );
  console.log(`  (scored, non-gating) ATS-parseability: ${atsPassRate ?? "N/A"}% (threshold: 100%)`);
  console.log(
    `  (scored, non-gating) baseline delta: ${avgDelta !== null ? `${avgDelta >= 0 ? "+" : ""}${avgDelta}pp` : "N/A"} (informational — a negative delta on this noisy proxy is not necessarily bad: an unconstrained baseline is free to echo JD narrative filler the rules doc deliberately avoids; compare matched hard-skill lists, not just the aggregate, before concluding the rules doc underperforms)`,
  );
  console.log(`${"═".repeat(70)}`);
  console.log(
    "\nThis harness does not declare anything 'done' — read the results above and explicitly sign off before proceeding, per the eval-harness design's requirement.",
  );

  if (verdict !== "PASS") process.exit(1);
}

async function tailorViaSubprocessNoRules(resumeText, jobText) {
  return new Promise((res, rej) => {
    const system =
      "You are tailoring a résumé to a job description. Respond with ONLY the tailored résumé as JSON matching the provided schema.";
    const user = `SOURCE RÉSUMÉ:\n${resumeText}\n\nJOB POSTING:\n${jobText}`;
    const args = [
      "-p",
      "--tools", "",
      "--output-format", "json",
      "--system-prompt", system,
      "--json-schema", JSON.stringify(RESUME_JSON_SCHEMA),
    ];

    let child;
    try {
      child = spawn(process.env.EVAL_CLAUDE_BIN ?? "claude", args, {
        shell: false,
        cwd: process.env.TMPDIR ?? "/tmp",
        env: { ...process.env, MAX_THINKING_TOKENS: process.env.MAX_THINKING_TOKENS ?? "0" },
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err) {
      rej(new Error(`baseline claude spawn failed: ${err.message}`));
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(arg);
    };

    const timer = setTimeout(() => {
      if (settled) return;
      try { child.kill("SIGTERM"); } catch {}
      setTimeout(() => {
        try { child.kill("SIGKILL"); } catch {}
      }, SIGKILL_GRACE_MS).unref();
      finish(rej, new Error(`baseline driver timed out after ${DRIVER_TIMEOUT_MS}ms (child killed)`));
    }, DRIVER_TIMEOUT_MS);

    child.stdin.write(user);
    child.stdin.end();
    child.stdout.on("data", (c) => (stdout += c.toString()));
    child.stderr.on("data", (c) => (stderr += c.toString()));
    child.on("error", (err) => finish(rej, new Error(`baseline claude spawn error: ${err.message}`)));
    child.on("close", (code) => {
      if (settled) return;
      if (code !== 0) {
        finish(
          rej,
          new Error(
            `baseline claude exited ${code}. stderr: ${stderr.slice(-300) || "(empty)"}. stdout: ${stdout.slice(-300) || "(empty)"}`,
          ),
        );
        return;
      }
      let env;
      try {
        env = JSON.parse(stdout.trim());
      } catch {
        finish(rej, new Error(`unparseable baseline envelope: ${stdout.slice(0, 200)}`));
        return;
      }
      if (!env.structured_output) {
        finish(rej, new Error(`no structured_output in baseline envelope: ${JSON.stringify(env).slice(0, 200)}`));
        return;
      }
      finish(res, env.structured_output);
    });
  });
}

main().catch((err) => {
  console.error(`\n✖ ${err.message ?? err}`);
  process.exit(1);
});

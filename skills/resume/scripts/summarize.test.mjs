#!/usr/bin/env node
/**
 * Offline test for the display-side job summarizer.
 *
 * Reuses the 11 extract fixtures: runs extractJobFromUrl (with stubbed fetch
 * for each fixture's inputs) and feeds the result + url into summarizeJob.
 * Asserts role + company are non-empty and noise-free for every fixture that
 * returns ok:true. Locks the Coinbase fixture against an exact expected.
 *
 *   node scripts/summarize.test.mjs
 *   node scripts/summarize.test.mjs <fixtureName>
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "fixtures", "extract");

// Truly offline: skip the network DNS round-trip in assertPublicUrl.
process.env.RESUME_SKIP_DNS_CHECK ??= "1";

// ---- fetch stub (same pattern as extract.test.mjs) ----

let activeStubs = [];
globalThis.fetch = async (input) => {
  const urlStr =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input?.url ?? String(input);
  for (const stub of activeStubs) {
    if (urlStr === stub.match || urlStr.startsWith(stub.match)) {
      const bodyStr =
        stub.body !== undefined
          ? stub.body
          : stub.bodyFile !== undefined
            ? stub._bodyFileContent
            : stub.json !== undefined
              ? JSON.stringify(stub.json)
              : "";
      return new Response(bodyStr, {
        status: stub.status ?? 200,
        statusText: stub.statusText ?? "OK",
        headers: {
          "Content-Type":
            stub.json !== undefined
              ? "application/json"
              : "text/html; charset=utf-8",
        },
      });
    }
  }
  throw new Error(`summarize.test: no fetch stub for ${urlStr}`);
};

const { extractJobFromUrl } = await import("../lib/parsing/job.ts");
const { summarizeJob } = await import("../lib/ui/job-summary.ts");

// ---- fixture loader ----

async function loadFixtures(filter) {
  const entries = await fs.readdir(FIXTURES_DIR, { withFileTypes: true });
  const dirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((n) => !filter || n === filter)
    .sort();
  const out = [];
  for (const dir of dirs) {
    const p = path.join(FIXTURES_DIR, dir);
    const fx = JSON.parse(await fs.readFile(path.join(p, "fixture.json"), "utf8"));
    for (const stub of fx.stubs ?? []) {
      if (stub.bodyFile) {
        stub._bodyFileContent = await fs.readFile(path.join(p, stub.bodyFile), "utf8");
      }
    }
    out.push({ dir, ...fx });
  }
  return out;
}

// ---- assertions ----

const MARKDOWN_TOKENS = /[#\[\]]|\]\(|\*\*/;
const PRIVATE_USE = /[\u{E000}-\u{F8FF}]/u;

function checkClean(label, value) {
  const issues = [];
  if (!value || typeof value !== "string" || value.trim().length === 0) {
    issues.push(`${label} is empty`);
  } else {
    if (MARKDOWN_TOKENS.test(value)) issues.push(`${label} has markdown tokens: "${value}"`);
    if (PRIVATE_USE.test(value)) issues.push(`${label} has private-use glyph: "${value}"`);
    if (value.length > 200) issues.push(`${label} too long (${value.length} chars): "${value.slice(0, 80)}…"`);
  }
  return issues;
}

// Coinbase exact lock (derived from the observed Firecrawl response).
const COINBASE_EXPECTED = {
  role: "Senior Software Engineer, Backend",
  company: "Coinbase",
  location: "Remote — Singapore",
};

// ---- run ----

const filter = process.argv[2];
const fixtures = await loadFixtures(filter);

let passed = 0;
let failed = 0;

for (const fx of fixtures) {
  activeStubs = (fx.stubs ?? []).slice();
  const priorKey = process.env.FIRECRAWL_API_KEY;
  if (fx.firecrawlKey) process.env.FIRECRAWL_API_KEY = fx.firecrawlKey;
  else delete process.env.FIRECRAWL_API_KEY;

  let extractResult;
  try {
    extractResult = await extractJobFromUrl(fx.url);
  } catch (err) {
    failed++;
    console.log(`  FAIL ${fx.dir.padEnd(30)} extract threw: ${err.message}`);
    continue;
  } finally {
    if (priorKey === undefined) delete process.env.FIRECRAWL_API_KEY;
    else process.env.FIRECRAWL_API_KEY = priorKey;
  }

  // Fixtures that intentionally fail extraction (hostile, too_short) skip summarizer.
  if (!extractResult.ok) {
    passed++;
    console.log(`  skip ${fx.dir.padEnd(30)} (extract returned ${extractResult.error})`);
    continue;
  }

  const summary = summarizeJob({
    text: extractResult.text,
    title: extractResult.title,
    url: fx.url,
  });

  const issues = [
    ...checkClean("role", summary.role),
    ...checkClean("company", summary.company),
    ...(summary.location !== undefined ? checkClean("location", summary.location) : []),
  ];

  if (fx.dir === "coinbase-cloudflare") {
    if (summary.role !== COINBASE_EXPECTED.role) {
      issues.push(`coinbase role expected "${COINBASE_EXPECTED.role}", got "${summary.role}"`);
    }
    if (summary.company !== COINBASE_EXPECTED.company) {
      issues.push(`coinbase company expected "${COINBASE_EXPECTED.company}", got "${summary.company}"`);
    }
    if (summary.location !== COINBASE_EXPECTED.location) {
      issues.push(`coinbase location expected "${COINBASE_EXPECTED.location}", got "${summary.location}"`);
    }
  }

  if (fx.dir === "career-io-aggregator") {
    const expected = {
      role: "Sr DevOps Engineer",
      company: "Border States",
      location: "Fargo, ND",
    };
    if (summary.role !== expected.role) {
      issues.push(`career-io role expected "${expected.role}", got "${summary.role}"`);
    }
    if (summary.company !== expected.company) {
      issues.push(`career-io company expected "${expected.company}", got "${summary.company}"`);
    }
    if (summary.location !== expected.location) {
      issues.push(`career-io location expected "${expected.location}", got "${summary.location}"`);
    }
  }

  if (issues.length === 0) {
    passed++;
    const loc = summary.location ? ` · ${summary.location}` : "";
    console.log(
      `  PASS ${fx.dir.padEnd(30)} ${summary.role.padEnd(36)} [${summary.company}${loc}]`,
    );
  } else {
    failed++;
    console.log(`  FAIL ${fx.dir.padEnd(30)}`);
    for (const i of issues) console.log(`       ${i}`);
    console.log(`       summary: ${JSON.stringify(summary)}`);
  }
}

// ---- synthetic unit tests (no fixtures needed) ----

function unit(name, summary, expect) {
  const issues = [];
  for (const [k, v] of Object.entries(expect)) {
    if (summary[k] !== v) issues.push(`${k} expected "${v}", got "${summary[k]}"`);
  }
  if (issues.length === 0) {
    console.log(`  PASS ${("unit: " + name).padEnd(44)} [${summary.company}]`);
    return 0;
  }
  console.log(`  FAIL unit: ${name}`);
  for (const i of issues) console.log(`       ${i}`);
  console.log(`       summary: ${JSON.stringify(summary)}`);
  return 1;
}

let unitFails = 0;
unitFails += unit(
  "strips trailing '- Company' from title",
  summarizeJob({
    text: "Some description",
    title: "Senior Engineer - Coinbase",
    url: "https://www.coinbase.com/careers/positions/123",
  }),
  { role: "Senior Engineer", company: "Coinbase" },
);
unitFails += unit(
  "private-use glyph stripped from role",
  summarizeJob({
    text: "desc",
    title: "Staff Engineer \uE002 Platform",
    url: "https://stripe.com/jobs/1",
  }),
  { role: "Staff Engineer Platform", company: "Stripe" },
);
unitFails += unit(
  "Greenhouse URL → company from path",
  summarizeJob({
    text: "desc",
    title: "Senior Engineer",
    url: "https://boards.greenhouse.io/stripe/jobs/6409498",
  }),
  { role: "Senior Engineer", company: "Stripe" },
);
unitFails += unit(
  "Workday ATS params → company",
  summarizeJob({
    text: "desc",
    title: "Engineer",
    url: "https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/Remote/Engineer_R1",
  }),
  { role: "Engineer", company: "Nvidia" },
);

if (unitFails > 0) failed += unitFails;
else passed += 4;

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);

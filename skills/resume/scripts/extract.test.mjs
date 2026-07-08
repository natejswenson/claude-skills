#!/usr/bin/env node
/**
 * Offline gating test for the job-extraction pipeline.
 *
 * Loads every fixture under scripts/fixtures/extract/, stubs globalThis.fetch
 * to return the fixture's canned responses, invokes extractJobFromUrl(), and
 * asserts the expected shape.
 *
 * No network. No Firecrawl key usage. Exits non-zero on any failure.
 *
 *   node scripts/extract.test.mjs
 *   node scripts/extract.test.mjs <fixtureName>    # run one
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "fixtures", "extract");

// Truly offline: skip the network DNS round-trip in assertPublicUrl so
// fixtures whose hosts don't resolve (e.g. careers.example.com) still work
// with no network. Literal private-IP rejection still applies.
process.env.RESUME_SKIP_DNS_CHECK ??= "1";

// ---- fetch stub installed BEFORE job.ts imports ----
let activeStubs = [];
const callLog = [];

globalThis.fetch = async (input) => {
  const urlStr =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input?.url ?? String(input);
  callLog.push(urlStr);
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
  throw new Error(`extract.test: no fetch stub for ${urlStr}`);
};

// Import AFTER stubbing fetch so any top-level state picks up the stub.
const { extractJobFromUrl } = await import("../lib/parsing/job.ts");

// ---- fixture loader ----

async function loadFixtures(filter) {
  const entries = await fs.readdir(FIXTURES_DIR, { withFileTypes: true });
  const dirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => !filter || name === filter)
    .sort();

  const fixtures = [];
  for (const dir of dirs) {
    const dirPath = path.join(FIXTURES_DIR, dir);
    const raw = await fs.readFile(path.join(dirPath, "fixture.json"), "utf8");
    const fx = JSON.parse(raw);
    for (const stub of fx.stubs ?? []) {
      if (stub.bodyFile) {
        stub._bodyFileContent = await fs.readFile(
          path.join(dirPath, stub.bodyFile),
          "utf8",
        );
      }
    }
    fixtures.push({ dir, ...fx });
  }
  return fixtures;
}

// ---- assertions ----

function assertExpected(fx, result) {
  const e = fx.expected;
  const issues = [];

  if (e.ok === true) {
    if (!result.ok) {
      issues.push(`expected ok:true, got error "${result.error}" (${result.detail ?? ""})`);
      return issues;
    }
    if (e.minTextLength && result.text.length < e.minTextLength) {
      issues.push(`text length ${result.text.length} < min ${e.minTextLength}`);
    }
    if (e.titleContains) {
      if (!result.title || !result.title.includes(e.titleContains)) {
        issues.push(`title "${result.title ?? ""}" missing substring "${e.titleContains}"`);
      }
    }
    for (const sub of e.textIncludes ?? []) {
      if (!result.text.includes(sub)) {
        issues.push(`text missing expected substring "${sub}"`);
      }
    }
    for (const sub of e.textExcludes ?? []) {
      if (result.text.includes(sub)) {
        issues.push(`text contains forbidden substring "${sub}"`);
      }
    }
  } else {
    if (result.ok) {
      issues.push(`expected ok:false error "${e.error}", got ok:true`);
      return issues;
    }
    if (e.error && result.error !== e.error) {
      issues.push(`expected error "${e.error}", got "${result.error}"`);
    }
    if (e.detailContains && (!result.detail || !result.detail.includes(e.detailContains))) {
      issues.push(`detail "${result.detail ?? ""}" missing "${e.detailContains}"`);
    }
  }

  return issues;
}

// ---- runner ----

const filter = process.argv[2];
const fixtures = await loadFixtures(filter);

if (fixtures.length === 0) {
  console.error(
    filter
      ? `no fixture named "${filter}"`
      : `no fixtures under ${FIXTURES_DIR}`,
  );
  process.exit(2);
}

let passed = 0;
let failed = 0;
const failures = [];

for (const fx of fixtures) {
  activeStubs = (fx.stubs ?? []).slice();
  callLog.length = 0;

  // Respect per-fixture Firecrawl key toggle — default disabled.
  const priorKey = process.env.FIRECRAWL_API_KEY;
  if (fx.firecrawlKey) process.env.FIRECRAWL_API_KEY = fx.firecrawlKey;
  else delete process.env.FIRECRAWL_API_KEY;

  // Respect per-fixture RESUME_ALLOW_LINKEDIN toggle — default disabled.
  const priorLinkedInAllow = process.env.RESUME_ALLOW_LINKEDIN;
  if (fx.linkedInAllow) process.env.RESUME_ALLOW_LINKEDIN = "1";
  else delete process.env.RESUME_ALLOW_LINKEDIN;

  let result;
  let threw = null;
  try {
    result = await extractJobFromUrl(fx.url);
  } catch (err) {
    threw = err;
  }

  // Restore
  if (priorKey === undefined) delete process.env.FIRECRAWL_API_KEY;
  else process.env.FIRECRAWL_API_KEY = priorKey;
  if (priorLinkedInAllow === undefined) delete process.env.RESUME_ALLOW_LINKEDIN;
  else process.env.RESUME_ALLOW_LINKEDIN = priorLinkedInAllow;

  if (threw) {
    failed++;
    failures.push({ dir: fx.dir, issues: [`threw: ${threw.message}`] });
    console.log(`  FAIL ${fx.dir.padEnd(30)} threw ${threw.message}`);
    continue;
  }

  const issues = assertExpected(fx, result);
  if (issues.length === 0) {
    passed++;
    const preview = result.ok
      ? `${String(result.text.length).padStart(5)} chars`
      : result.error;
    console.log(`  PASS ${fx.dir.padEnd(30)} ${preview}`);
  } else {
    failed++;
    failures.push({ dir: fx.dir, issues, calls: callLog.slice() });
    console.log(`  FAIL ${fx.dir.padEnd(30)}`);
    for (const i of issues) console.log(`       ${i}`);
  }
}

console.log(`\n${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  console.log("--- failure detail ---");
  for (const f of failures) {
    console.log(`\n[${f.dir}]`);
    for (const i of f.issues) console.log(`  ${i}`);
    if (f.calls?.length) {
      console.log(`  fetch calls:`);
      for (const c of f.calls) console.log(`    ${c}`);
    }
  }
  process.exit(1);
}

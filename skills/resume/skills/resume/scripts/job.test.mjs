#!/usr/bin/env node
/**
 * Unit tests for job-posting extraction (scripts/job.mjs).
 *
 * Run: node scripts/job.test.mjs
 *
 * OFFLINE. Every test injects a fake `fetchImpl` backed by the recorded
 * payloads in scripts/fixtures/jobs/. CI has no network and must stay $0, so
 * a test that reaches out is a bug, not a flake — the fake throws on any URL
 * it was not primed with, which makes an accidental live call fail loudly.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  detectBoard,
  htmlToText,
  decodeEntities,
  normalizeWorkday,
  normalizeGreenhouse,
  normalizeLever,
  normalizeAshby,
  fetchJob,
} from "./job.mjs";

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

const fixture = (f) => JSON.parse(readFileSync(`scripts/fixtures/jobs/${f}`, "utf8"));
const WORKDAY = fixture("workday-alteryx.json");
const GREENHOUSE = fixture("greenhouse-stripe.json");
const LEVER = fixture("lever-sample.json");
const ASHBY = fixture("ashby-sample.json");

/** A fetch that only knows the URLs it was primed with. */
function fakeFetch(routes) {
  return async (url) => {
    if (!(url in routes)) {
      throw new Error(`test tried to reach the network: ${url}`);
    }
    const r = routes[url];
    if (r instanceof Error) throw r;
    return {
      ok: r.status ? r.status < 400 : true,
      status: r.status ?? 200,
      json: async () => r.json,
      text: async () => r.text ?? "",
    };
  };
}

const ALTERYX_URL =
  "https://alteryx.wd108.myworkdayjobs.com/AlteryxCareers/job/US---Remote/AI-Platform-Engineer_R12336?source=LinkedIn";

console.log("\n[detectBoard]");
await test("workday posting maps to its CXS endpoint", () => {
  const b = detectBoard(ALTERYX_URL);
  assert.equal(b.kind, "workday");
  // The endpoint the page itself calls — this is what unblocked the live run.
  assert.equal(
    b.endpoint,
    "https://alteryx.wd108.myworkdayjobs.com/wday/cxs/alteryx/AlteryxCareers/job/US---Remote/AI-Platform-Engineer_R12336",
  );
});
await test("a locale segment before the site id is handled", () => {
  const b = detectBoard("https://acme.wd1.myworkdayjobs.com/en-US/Careers/job/Remote/Engineer_R1");
  assert.equal(b.endpoint, "https://acme.wd1.myworkdayjobs.com/wday/cxs/acme/Careers/job/Remote/Engineer_R1");
});
await test("greenhouse, lever and ashby map to their APIs", () => {
  assert.equal(
    detectBoard("https://boards.greenhouse.io/stripe/jobs/7954688").endpoint,
    "https://boards-api.greenhouse.io/v1/boards/stripe/jobs/7954688",
  );
  assert.equal(
    detectBoard("https://jobs.lever.co/leverdemo/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee").endpoint,
    "https://api.lever.co/v0/postings/leverdemo/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  );
  const ashby = detectBoard("https://jobs.ashbyhq.com/ramp/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  assert.equal(ashby.kind, "ashby");
  assert.equal(ashby.jobId, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
});
await test("an unknown or malformed URL returns null", () => {
  assert.equal(detectBoard("https://example.com/careers/engineer"), null);
  assert.equal(detectBoard("not a url"), null);
});

console.log("\n[htmlToText]");
await test("list items and blocks become readable lines", () => {
  const out = htmlToText("<p>Intro</p><ul><li>One</li><li>Two</li></ul>");
  assert.match(out, /Intro/);
  assert.match(out, /- One/);
  assert.match(out, /- Two/);
});
await test("script and style bodies never leak into the text", () => {
  // Stripping tags without removing these first turns JS into prose.
  const out = htmlToText("<style>.a{color:red}</style><script>var x=1;</script><p>Real</p>");
  assert.equal(out.includes("color:red"), false);
  assert.equal(out.includes("var x"), false);
  assert.match(out, /Real/);
});
await test("entities are decoded, including numeric ones", () => {
  assert.equal(decodeEntities("R&amp;D &#8212; 5&#x25;"), "R&D — 5%");
  assert.equal(htmlToText("<p>a &nbsp;&amp;&nbsp; b</p>").replace(/\s+/g, " "), "a & b");
});

console.log("\n[normalisers — real recorded payloads]");
await test("workday: title, location, req id and description", () => {
  const j = normalizeWorkday(WORKDAY, ALTERYX_URL);
  assert.equal(j.title, "AI Platform Engineer");
  assert.equal(j.company, "alteryx");
  assert.equal(j.reqId, "R12336");
  assert.match(j.location, /Remote/);
  assert.ok(j.text.length > 1000, `description too short: ${j.text.length}`);
  assert.equal(/<[a-z]/i.test(j.text), false, "HTML survived into the text");
  // Content the live run actually needed.
  assert.match(j.text, /Required Qualifications/);
  assert.match(j.text, /Model Context Protocol|MCP/);
});
await test("greenhouse: double-encoded HTML content is decoded", () => {
  const j = normalizeGreenhouse(GREENHOUSE, "https://boards.greenhouse.io/stripe/jobs/1");
  assert.ok(j.title);
  assert.equal(j.source, "greenhouse");
  assert.ok(j.text.length > 300);
  assert.equal(/&lt;|&gt;|&amp;lt;/.test(j.text), false, "content was left escaped");
  assert.equal(/<[a-z]/i.test(j.text), false, "HTML survived into the text");
});
await test("lever: prefers the plain-text description", () => {
  const j = normalizeLever(LEVER, "https://jobs.lever.co/leverdemo/x");
  assert.ok(j.title);
  assert.ok(j.text.length > 200);
  assert.equal(/<[a-z]/i.test(j.text), false);
});
await test("ashby: selects the requested job from the board", () => {
  const wanted = ASHBY.jobs[0].id;
  const j = normalizeAshby(ASHBY, "https://jobs.ashbyhq.com/ramp/x", wanted);
  assert.equal(j.reqId, wanted);
  assert.ok(j.title);
  assert.ok(j.text.length > 200);
});
await test("a normaliser returns null rather than a half-built job", () => {
  assert.equal(normalizeWorkday({}, "u"), null);
  assert.equal(normalizeGreenhouse({ title: "x" }, "u"), null);
  assert.equal(normalizeLever({}, "u"), null);
  assert.equal(normalizeAshby({ jobs: [] }, "u"), null);
});

console.log("\n[fetchJob]");
await test("a workday URL is served from its JSON API in one request", async () => {
  const endpoint = detectBoard(ALTERYX_URL).endpoint;
  let calls = 0;
  const fetchImpl = async (url, init) => {
    calls++;
    return fakeFetch({ [endpoint]: { json: WORKDAY } })(url, init);
  };
  const job = await fetchJob(ALTERYX_URL, { fetchImpl, firecrawlKey: undefined });
  assert.equal(job.source, "workday");
  assert.equal(job.title, "AI Platform Engineer");
  assert.equal(calls, 1, `expected exactly one request, made ${calls}`);
});

await test("falls back to a plain fetch when the board API fails", async () => {
  const endpoint = detectBoard(ALTERYX_URL).endpoint;
  const html = `<html><body><h1>AI Platform Engineer</h1><p>${"Responsibilities and requirements. ".repeat(20)}</p></body></html>`;
  const fetchImpl = fakeFetch({
    [endpoint]: { status: 500, json: {} },
    [ALTERYX_URL]: { text: html },
  });
  const job = await fetchJob(ALTERYX_URL, { fetchImpl, firecrawlKey: undefined });
  assert.equal(job.source, "html");
  assert.match(job.text, /Responsibilities/);
});

await test("firecrawl is used when a key is set and the board API misses", async () => {
  const url = "https://example.com/careers/engineer";
  const markdown = `# Engineer\n\n${"Build and operate platforms. ".repeat(20)}`;
  const fetchImpl = fakeFetch({
    "https://api.firecrawl.dev/v1/scrape": { json: { success: true, data: { markdown } } },
  });
  const job = await fetchJob(url, { fetchImpl, firecrawlKey: "test-key" });
  assert.equal(job.source, "firecrawl");
  assert.match(job.text, /Build and operate/);
});

await test("a JS-rendered page with no usable text fails with every reason listed", async () => {
  // The exact live-run failure: Workday's HTML shell has no description in it.
  const endpoint = detectBoard(ALTERYX_URL).endpoint;
  const fetchImpl = fakeFetch({
    [endpoint]: { status: 404, json: {} },
    [ALTERYX_URL]: { text: "<html><body><div id=root></div></body></html>" },
  });
  await assert.rejects(
    () => fetchJob(ALTERYX_URL, { fetchImpl, firecrawlKey: undefined }),
    (err) => {
      assert.match(err.message, /could not extract/);
      assert.equal(err.attempts.length, 3, "every attempt should be reported, not just the last");
      assert.match(err.message, /FIRECRAWL_API_KEY not set/);
      assert.match(err.message, /JS-rendered/);
      return true;
    },
  );
});

await test("a too-short board response is rejected rather than returned", async () => {
  const endpoint = detectBoard(ALTERYX_URL).endpoint;
  const thin = { jobPostingInfo: { title: "Engineer", jobDescription: "<p>TBD</p>" } };
  const fetchImpl = fakeFetch({
    [endpoint]: { json: thin },
    [ALTERYX_URL]: { text: "<html><body>nope</body></html>" },
  });
  await assert.rejects(() => fetchJob(ALTERYX_URL, { fetchImpl, firecrawlKey: undefined }), /could not extract/);
});

console.log(`\nresult: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

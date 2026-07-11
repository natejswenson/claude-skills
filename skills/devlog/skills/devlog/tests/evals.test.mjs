// Deterministic ($0) coverage of the eval harness plumbing: budget math,
// judge-response parsing, the two-layer gate, and the runner. The live
// `claude -p` call site is injected away — no test here can spend money.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Budget, BudgetExceeded, DEFAULT_MAX_SPEND, estimateUsd, pricePer1k, mockEnabled } from '../evals/budget.mjs';
import { buildJudgePrompt, parseJudgeResponse, scorePost, DIMENSIONS } from '../evals/judge_post.mjs';
import { runCases, CASES } from '../evals/run_eval.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'evals', 'fixtures');
const fixture = (name) => readFileSync(join(FIXTURES, name), 'utf8');

const judgeReply = (score, dims = {}) => JSON.stringify({
  score,
  dimensions: Object.fromEntries(DIMENSIONS.map((d) => [d, dims[d] ?? score])),
  worst_problem: 'test',
});

// ─── budget ───────────────────────────────────────────────────────────────────

test('estimateUsd over-estimates and scales with prompt size and model', () => {
  const small = estimateUsd('x', 'claude-haiku-4-5-20251001');
  const big = estimateUsd('x'.repeat(40_000), 'claude-haiku-4-5-20251001');
  assert.ok(small > 0);
  assert.ok(big > small);
  assert.ok(estimateUsd('x', 'claude-opus-4-8') > estimateUsd('x', 'claude-haiku-4-5'));
  assert.equal(pricePer1k('unknown-model'), 0.02);
});

test('Budget.guard throws BEFORE overspending; record accumulates', () => {
  const b = new Budget(0.10);
  b.guard(0.05);
  b.record(0.05);
  assert.equal(b.spent, 0.05);
  assert.throws(() => b.guard(0.06), BudgetExceeded);
  b.guard(0.05); // exactly at cap is allowed
  assert.equal(DEFAULT_MAX_SPEND, 0.50);
});

test('mockEnabled forces mock when ANTHROPIC_API_KEY is absent', (t) => {
  const saved = process.env.ANTHROPIC_API_KEY;
  t.after(() => {
    if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved;
  });

  delete process.env.ANTHROPIC_API_KEY;
  assert.equal(mockEnabled(false), true); // no key → mock even without the flag
  process.env.ANTHROPIC_API_KEY = 'sk-test';
  assert.equal(mockEnabled(false), false);
  assert.equal(mockEnabled(true), true);
});

// ─── judge parsing ────────────────────────────────────────────────────────────

test('parseJudgeResponse extracts the JSON blob and validates ranges', () => {
  const r = parseJudgeResponse(`Here you go:\n${judgeReply(7.5)}`);
  assert.equal(r.score, 7.5);
  assert.equal(r.dimensions.reproducibility, 7.5);
  assert.equal(r.worstProblem, 'test');
});

test('parseJudgeResponse rejects garbage, bad scores, and missing dimensions', () => {
  assert.throws(() => parseJudgeResponse('no json here'), /no JSON/);
  assert.throws(() => parseJudgeResponse('{"score": 11, "dimensions": {}}'), /out of range/);
  assert.throws(() => parseJudgeResponse('{"score": "9", "dimensions": {}}'), /out of range/);
  const missingDim = JSON.stringify({ score: 8, dimensions: { reproducibility: 8 } });
  assert.throws(() => parseJudgeResponse(missingDim), /dimension/);
});

test('buildJudgePrompt includes the contract, the post, and optionally the voice guide', () => {
  const p = buildJudgePrompt('POST BODY', 'VOICE GUIDE');
  assert.ok(p.includes('stranger test'));
  assert.ok(p.includes('POST BODY'));
  assert.ok(p.includes('VOICE GUIDE'));
  assert.ok(!buildJudgePrompt('x').includes('=== VOICE GUIDE ==='));
});

// ─── scorePost gate ───────────────────────────────────────────────────────────

test('scorePost fails lint-violating posts at the $0 layer without calling the judge', () => {
  let judged = 0;
  const r = scorePost(fixture('bad-post.md'), { mock: false, runJudge: () => { judged += 1; return judgeReply(10); } });
  assert.equal(r.pass, false);
  assert.equal(judged, 0);
  assert.ok(r.lintFindings.length > 0);
});

test('scorePost mock passes a lint-clean post without spending', () => {
  const r = scorePost(fixture('good-post.md'), { mock: true });
  assert.deepEqual(r, { pass: true, score: 9.0, lintFindings: [], mocked: true });
});

test('scorePost live path judges lint-clean posts and applies minScore', () => {
  const low = scorePost(fixture('irreproducible-post.md'), { mock: false, runJudge: () => judgeReply(4.5) });
  assert.equal(low.pass, false);
  assert.equal(low.score, 4.5);
  const high = scorePost(fixture('good-post.md'), { mock: false, runJudge: () => judgeReply(8.5) });
  assert.equal(high.pass, true);
});

test('scorePost live path respects the budget guard', () => {
  const budget = new Budget(0.000001);
  assert.throws(
    () => scorePost(fixture('good-post.md'), { mock: false, budget, runJudge: () => judgeReply(9) }),
    BudgetExceeded,
  );
});

// ─── runner ───────────────────────────────────────────────────────────────────

test('runCases in mock mode: good ok, bad ok, live-only skipped', () => {
  const results = runCases({ mock: true });
  const byFile = Object.fromEntries(results.map((r) => [r.file, r]));
  assert.equal(byFile['good-post.md'].outcome, 'ok');
  assert.equal(byFile['bad-post.md'].outcome, 'ok');
  assert.equal(byFile['irreproducible-post.md'].outcome, 'skipped');
});

test('runCases live (faked judge): irreproducible must FAIL the judge to be ok', () => {
  // A judge that scores everything high exposes the irreproducible fixture.
  const gullible = runCases({ mock: false, runJudge: () => judgeReply(9) });
  assert.equal(gullible.find((r) => r.file === 'irreproducible-post.md').outcome, 'UNEXPECTED');

  // A discriminating judge lands every fixture on its expected side.
  const discriminating = runCases({
    mock: false,
    runJudge: (prompt) => (prompt.includes('pipeline learned to validate itself') ? judgeReply(4) : judgeReply(9)),
  });
  assert.ok(discriminating.every((r) => r.outcome === 'ok'));
});

test('CASES covers the three golden failure/success modes', () => {
  assert.deepEqual(CASES.map((c) => c.file), ['good-post.md', 'bad-post.md', 'irreproducible-post.md']);
});

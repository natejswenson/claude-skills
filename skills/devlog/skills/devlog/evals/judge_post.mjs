// Two-layer quality judge for generated posts.
// Layer 1 ($0, deterministic): lint-post findings are an automatic fail.
// Layer 2 ($, LLM): a cheap judge scores the post against the how-to contract
// and returns strict JSON. Mock mode substitutes a fixed passing score — it
// can catch contract violations (via layer 1) but NOT subtle quality drift;
// that is exactly what the irreproducible fixture documents.
import { spawnSync } from 'node:child_process';
import { lintPost } from '../lib/lint_post.mjs';
import { estimateUsd } from './budget.mjs';

export const DEFAULT_JUDGE_MODEL = 'claude-haiku-4-5-20251001';
export const DEFAULT_MIN_SCORE = 7.0;

export const DIMENSIONS = [
  'reproducibility',      // could a stranger build this from the post alone?
  'code_completeness',    // no phantom fixtures; blocks compose into a runnable whole
  'gotcha_quality',       // concrete trap → symptom → escape, plausibly from real history
  'citation_quality',     // distinct reputable sources actually supporting the claims
  'voice_fidelity',       // authentic first-person, no AI tells
  'scope_honesty',        // title/summary sized to what actually shipped
];

export function buildJudgePrompt(post, voiceGuide = '') {
  return `You are scoring a developer-blog release post against a strict "how-to guide" contract.

The contract: (1) REPRODUCIBILITY — a reader with no access to the author's repository can
follow the post and build the technique end-to-end (the "stranger test"); (2) CODE
COMPLETENESS — every symbol a code block references is defined in an earlier block or
explicitly stubbed; the blocks compose into a runnable whole, not fragments around an
essay; (3) GOTCHA QUALITY — the Gotchas section gives concrete trap → symptom → escape
items that read as genuinely experienced, not generic advice; (4) CITATION QUALITY —
distinct, reputable sources that actually support the specific claims made; (5) VOICE
FIDELITY — authentic first-person writing with no AI tells (no padded symmetry, no
hype, no filler)${voiceGuide ? ', judged against the voice guide below' : ''}; (6) SCOPE
HONESTY — the title and framing match what actually shipped (a single test file is not
"end-to-end").

Score each dimension 0-10 and give an overall 0-10 score (your holistic judgment, not an
average — a fatal reproducibility failure caps the overall at 5 even if prose is lovely).

Return ONLY a JSON object, no prose:
{"score": <0-10 float>, "dimensions": {"reproducibility": <0-10>, "code_completeness": <0-10>, "gotcha_quality": <0-10>, "citation_quality": <0-10>, "voice_fidelity": <0-10>, "scope_honesty": <0-10>}, "worst_problem": "<one sentence>"}
${voiceGuide ? `\n=== VOICE GUIDE ===\n${voiceGuide}\n` : ''}
=== POST ===
${post}`;
}

// Extract and validate the first {...} JSON blob from the judge's reply.
export function parseJudgeResponse(text) {
  const m = /\{[\s\S]*\}/.exec(text || '');
  if (!m) throw new Error(`Judge returned no JSON object: ${String(text).slice(0, 200)}`);
  const parsed = JSON.parse(m[0]);
  if (typeof parsed.score !== 'number' || parsed.score < 0 || parsed.score > 10) {
    throw new Error(`Judge score out of range: ${JSON.stringify(parsed.score)}`);
  }
  const dims = parsed.dimensions || {};
  for (const d of DIMENSIONS) {
    if (typeof dims[d] !== 'number' || dims[d] < 0 || dims[d] > 10) {
      throw new Error(`Judge dimension "${d}" missing or out of range`);
    }
  }
  return { score: parsed.score, dimensions: dims, worstProblem: parsed.worst_problem || null };
}

// Live call site — injectable so tests never touch the network.
export function callClaude(prompt, model) {
  const r = spawnSync('claude', ['-p', prompt, '--model', model], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120_000,
  });
  if (r.status !== 0) throw new Error(`claude -p failed (${r.status}): ${(r.stderr || '').slice(0, 300)}`);
  return r.stdout;
}

// Score one post. Returns
//   { pass, score, dimensions?, lintFindings, mocked, worstProblem? }
export function scorePost(content, {
  mock = true,
  model = DEFAULT_JUDGE_MODEL,
  minScore = DEFAULT_MIN_SCORE,
  minSources = 3,
  voiceGuide = '',
  budget = null,
  runJudge = callClaude,
} = {}) {
  // Layer 1: contract violations fail before any money is spent.
  const lint = lintPost(content, { minSources });
  if (!lint.ok) {
    return { pass: false, score: 0, lintFindings: lint.findings, mocked: false };
  }

  if (mock) {
    // $0 smoke path: lint passed, so report a passing score. Cannot catch
    // subtle quality drift — only a live judge can.
    return { pass: true, score: 9.0, lintFindings: [], mocked: true };
  }

  const prompt = buildJudgePrompt(content, voiceGuide);
  const estimate = estimateUsd(prompt, model);
  if (budget) budget.guard(estimate);
  const raw = runJudge(prompt, model);
  if (budget) budget.record(estimate); // conservative: record the estimate, not less
  const judged = parseJudgeResponse(raw);
  return {
    pass: judged.score >= minScore,
    score: judged.score,
    dimensions: judged.dimensions,
    worstProblem: judged.worstProblem,
    lintFindings: [],
    mocked: false,
  };
}

#!/usr/bin/env node
// Eval runner for the non-deterministic half of devlog: scores the golden
// fixtures with the two-layer judge and checks each lands on its expected
// side. Mock mode is $0 and runs in CI; live mode quotes its estimated spend
// up front and refuses to start over the cap.
//
//   node evals/run_eval.mjs --mock
//   node evals/run_eval.mjs --live [--max-spend 0.50] [--model <id>] [--min-score 7]
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Budget, DEFAULT_MAX_SPEND, estimateUsd, mockEnabled } from './budget.mjs';
import { scorePost, buildJudgePrompt, DEFAULT_JUDGE_MODEL, DEFAULT_MIN_SCORE, callClaude } from './judge_post.mjs';

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

// expect: which side of the gate the fixture must land on.
// liveOnly: passes the deterministic layer by design — only a live judge can
// fail it, so mock runs report it as skipped rather than vacuously green.
export const CASES = [
  { file: 'good-post.md', expect: 'pass', liveOnly: false },
  { file: 'bad-post.md', expect: 'fail', liveOnly: false },
  { file: 'irreproducible-post.md', expect: 'fail', liveOnly: true },
];

export function runCases({ mock, model = DEFAULT_JUDGE_MODEL, minScore = DEFAULT_MIN_SCORE, budget, runJudge = callClaude, fixturesDir = FIXTURES_DIR }) {
  return CASES.map((c) => {
    if (mock && c.liveOnly) {
      return { ...c, outcome: 'skipped', note: 'needs a live judge (passes the deterministic layer by design)' };
    }
    const content = readFileSync(join(fixturesDir, c.file), 'utf8');
    const result = scorePost(content, { mock, model, minScore, budget, runJudge });
    const got = result.pass ? 'pass' : 'fail';
    return { ...c, outcome: got === c.expect ? 'ok' : 'UNEXPECTED', got, result };
  });
}

function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      mock: { type: 'boolean', default: false },
      live: { type: 'boolean', default: false },
      model: { type: 'string', default: DEFAULT_JUDGE_MODEL },
      'min-score': { type: 'string', default: String(DEFAULT_MIN_SCORE) },
      'max-spend': { type: 'string', default: String(DEFAULT_MAX_SPEND) },
    },
  });

  const mock = mockEnabled(values.mock || !values.live);
  const model = values.model;
  const minScore = Number(values['min-score']);
  const maxSpend = Number(values['max-spend']);
  const budget = new Budget(maxSpend);

  if (!mock) {
    // Quote the worst-case spend before the first call and refuse over cap.
    const liveCases = CASES.filter((c) => c.file !== 'bad-post.md'); // fails at the $0 layer
    const estimate = liveCases.reduce((sum, c) => {
      const content = readFileSync(join(FIXTURES_DIR, c.file), 'utf8');
      return sum + estimateUsd(buildJudgePrompt(content), model);
    }, 0);
    console.log(`Estimated spend ~$${estimate.toFixed(3)} (cap $${maxSpend.toFixed(2)}, model ${model})`);
    if (estimate > maxSpend) {
      console.error('Estimated spend exceeds the cap — refusing to start. Raise --max-spend deliberately.');
      process.exit(2);
    }
  } else {
    console.log('Mock mode ($0). The live-only fixture is skipped; run --live to exercise the judge.');
  }

  const results = runCases({ mock, model, minScore, budget });
  let bad = 0;
  for (const r of results) {
    if (r.outcome === 'skipped') {
      console.log(`~ ${r.file}: skipped — ${r.note}`);
      continue;
    }
    const mark = r.outcome === 'ok' ? '✓' : '✗';
    if (r.outcome !== 'ok') bad += 1;
    const score = r.result.score !== undefined ? ` score=${r.result.score}` : '';
    const lint = r.result.lintFindings?.length ? ` lint=[${r.result.lintFindings.map((f) => f.rule).join(', ')}]` : '';
    const worst = r.result.worstProblem ? ` worst="${r.result.worstProblem}"` : '';
    console.log(`${mark} ${r.file}: expected ${r.expect}, got ${r.got}${score}${lint}${worst}`);
    if (r.result.dimensions) {
      console.log(`    ${Object.entries(r.result.dimensions).map(([k, v]) => `${k}=${v}`).join(' ')}`);
    }
  }
  if (!mock) console.log(`Recorded spend (conservative estimates): $${budget.spent.toFixed(3)}`);
  process.exit(bad === 0 ? 0 : 1);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) main();

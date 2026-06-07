/**
 * scoreEval — combine L1 lexicon + L2 stylometry (+ optional L3 judge)
 * into four continuous per-goal scores.
 *
 * Weights (from design doc):
 *   G1 Tailoring  — L3 judge (if useL3), else neutral 50
 *   G2 Word usage — L1 lexicon + TTR + verb concreteness
 *   G3 NOT-AI     — L1 lexicon + L2 full stylometry    [HARD FLOOR]
 *   G4 Writing    — L2 length variance + specificity (+ L3 judge for top variants)
 *
 * Aggregate fitness = 0.35·g1 + 0.15·g2 + 0.35·g3 + 0.15·g4
 */

import { scoreLexicon, lexiconScore } from "./lexicon.mjs";
import { scoreStylometry } from "./stylometry.mjs";
import { judgeTailoringFit, judgeWritingQuality } from "./judge.mjs";

/**
 * @param {{
 *   resume: object,                // ResumeJSON
 *   jobText: string,
 *   apiKey?: string,               // required if any L3 judge enabled
 *   budgetGate?: import('./budget.mjs').BudgetGate,
 *   useL3G1?: boolean,             // G1 tailoring judge
 *   useL3G4?: boolean,             // G4 writing judge
 * }} args
 */
export async function scoreEval({
  resume,
  jobText,
  apiKey,
  budgetGate,
  useL3G1 = false,
  useL3G4 = false,
}) {
  const bullets = resume.experience.flatMap((r) => r.bullets || []);
  const lex = scoreLexicon(bullets);
  const sty = scoreStylometry(bullets);
  const lexScoreVal = lexiconScore(lex);

  // ---- G1 Tailoring ----
  let g1 = 50;
  let g1Breakdown = { reason: "l3_disabled" };
  let g1Cost = 0;
  if (useL3G1 && apiKey && budgetGate) {
    try {
      const result = await judgeTailoringFit({ resume, jobText, apiKey, budgetGate });
      g1 = result.score;
      g1Breakdown = result.breakdown;
      g1Cost = result.cost;
    } catch (err) {
      g1Breakdown = { reason: "judge_failed", error: String(err) };
    }
  }

  // ---- G2 Word usage ----
  // Equal-weight lexicon, TTR (repetition), concreteness (verb choice).
  const g2 = Math.round(
    0.5 * lexScoreVal +
    0.25 * sty.ttrScore +
    0.25 * sty.concretenessScore,
  );

  // ---- G3 NOT-AI-generated ----
  // Sub-metrics tracked for hard-floor checks by caller.
  const g3_sub = {
    lexicon: lexScoreVal,
    length_variance: sty.lengthVarianceScore,
    tricolon: sty.tricolonScore,
    round_metric: sty.roundMetricScore,
    admitted_imperfection: sty.admittedImperfectionScore,
  };
  // Weights: lexicon heavier (direct signal), stylometry rounds it out.
  const g3 = Math.round(
    0.30 * g3_sub.lexicon +
    0.20 * g3_sub.length_variance +
    0.20 * g3_sub.tricolon +
    0.15 * g3_sub.round_metric +
    0.15 * g3_sub.admitted_imperfection,
  );

  // ---- G4 Writing quality ----
  let g4LlmSignal = null;
  let g4Cost = 0;
  if (useL3G4 && apiKey && budgetGate) {
    try {
      const result = await judgeWritingQuality({ resume, apiKey, budgetGate });
      g4LlmSignal = result.score;
      g4Cost = result.cost;
    } catch {
      /* ignore; fall back to deterministic */
    }
  }
  const g4Deterministic = Math.round(
    0.4 * sty.lengthVarianceScore +
    0.3 * sty.concretenessScore +
    0.3 * (sty.roundMetricScore),
  );
  const g4 = g4LlmSignal === null
    ? g4Deterministic
    : Math.round(0.6 * g4LlmSignal + 0.4 * g4Deterministic);

  const fitness = +(0.35 * g1 + 0.15 * g2 + 0.35 * g3 + 0.15 * g4).toFixed(2);

  return {
    g1, g2, g3, g4, fitness,
    g3_sub,
    details: {
      lexicon: {
        density: +lex.density.toFixed(2),
        weightedHits: lex.weightedHits,
        byCategory: lex.byCategory,
        punctuationHits: lex.punctuationHits,
        lexiconScore: lexScoreVal,
        flaggedBullets: lex.flaggedBullets.slice(0, 10),
      },
      stylometry: sty,
      g1Breakdown,
      g4LlmSignal,
    },
    judgeCost: g1Cost + g4Cost,
  };
}

/**
 * Compare two GoalScores — does the new regress any G3 sub-metric by > threshold?
 * @returns { regressed: boolean, regressedKeys: string[] }
 */
export function g3HardFloorCheck(incumbent, candidate, threshold = 5) {
  const regressed = [];
  for (const key of Object.keys(candidate.g3_sub)) {
    const delta = candidate.g3_sub[key] - (incumbent.g3_sub[key] ?? 0);
    if (delta < -threshold) regressed.push(key);
  }
  return { regressed: regressed.length > 0, regressedKeys: regressed };
}

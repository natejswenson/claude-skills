/**
 * L2 Stylometry scorer — catches "template-sounding" output that lexicon misses.
 *
 * Signals (from domain research):
 *   - length variance (humans scatter; AI clusters tight)
 *   - type-token ratio (verb repetition is an AI tell)
 *   - tricolon rate (three-item parallel lists — AI loves these)
 *   - round-metric ratio (all numbers end in 0/5 = AI)
 *   - admitted-imperfection rate (despite/after/with only — humans; AI never)
 *   - verb concreteness (Anglo-Saxon short verbs vs abstract)
 *
 * Deterministic. Free.
 */

const CONCRETE_VERBS = new Set([
  "built", "wrote", "shipped", "led", "fixed", "migrated",
  "cut", "grew", "sold", "hired", "launched", "made", "ran",
  "moved", "broke", "rebuilt", "scaled", "killed", "merged",
  "paid", "saved", "closed", "signed", "started", "stopped",
  "designed", "coded", "tested", "deployed", "owned", "reduced",
  "doubled", "tripled", "shrank", "trimmed", "rewrote", "added",
  "removed", "replaced", "mentored", "taught", "trained",
  "pitched", "chose", "picked", "partnered", "recruited",
]);

const ABSTRACT_VERBS = new Set([
  "leveraged", "orchestrated", "facilitated", "utilized",
  "spearheaded", "championed", "drove", "enabled", "empowered",
  "delivered", "oversaw", "synergized", "optimized", "harnessed",
  "executed", "strategized", "materialized", "actualized",
]);

const ADMITTED_IMPERFECTION = [
  /\bdespite\b/i,
  /\bafter the\b/i,
  /\bwith only\b/i,
  /\bwithin a?\s*(?:week|month|quarter)\b/i,
  /\bagainst\s+\w+\s+pressure\b/i,
  /\bdue to\b/i,
  /\beven though\b/i,
  /\bnotwithstanding\b/i,
];

// Tricolon: three short word-tokens separated by commas with "and" before the last.
// Matches both Oxford (A, B, and C) and no-Oxford (A, B and C) forms.
// Non-global — .test() doesn't carry lastIndex state.
function hasTricolon(text) {
  return /\b(\w{3,})\s*,\s*(\w{3,})\s*,?\s+and\s+(\w{3,})\b/i.test(text);
}

function wordsOf(bullet) {
  return bullet.trim().split(/\s+/).filter(Boolean);
}

function firstVerb(bullet) {
  // Assume first word is the action verb after stripping leading punctuation
  const w = bullet.trim().replace(/^[-•*\s]+/, "").split(/\s+/)[0] || "";
  return w.toLowerCase().replace(/[^a-z]/g, "");
}

function extractNumbers(bullet) {
  // Captures: 50%, 3x, $47K, 11 engineers, 3.2s, 800ms
  const re = /\b(\d+(?:\.\d+)?)[%xkKmM]?\b/g;
  const out = [];
  let m;
  while ((m = re.exec(bullet))) {
    out.push(parseFloat(m[1]));
  }
  return out;
}

function isRound(n) {
  if (n === 0) return true;
  if (Number.isInteger(n)) {
    if (n % 10 === 0) return true;
    if (n % 5 === 0) return true;
  }
  return false;
}

/**
 * @param {string[]} bullets
 * @returns {{
 *   lengthVarianceStd: number,
 *   lengthVarianceScore: number,    // 0-100
 *   ttr: number,
 *   ttrScore: number,               // 0-100
 *   tricolonRate: number,           // 0-1
 *   tricolonScore: number,          // 0-100
 *   roundMetricRatio: number,       // 0-1
 *   roundMetricScore: number,       // 0-100
 *   admittedImperfectionRate: number, // 0-1
 *   admittedImperfectionScore: number,// 0-100
 *   verbConcreteness: number,       // 0-1
 *   concretenessScore: number       // 0-100
 * }}
 */
export function scoreStylometry(bullets) {
  const nBullets = bullets.length;
  if (nBullets === 0) {
    return {
      lengthVarianceStd: 0,
      lengthVarianceScore: 0,
      ttr: 0, ttrScore: 0,
      tricolonRate: 0, tricolonScore: 0,
      roundMetricRatio: 0, roundMetricScore: 0,
      admittedImperfectionRate: 0, admittedImperfectionScore: 0,
      verbConcreteness: 0, concretenessScore: 0,
    };
  }

  // Length variance
  const lengths = bullets.map((b) => wordsOf(b).length);
  const meanLen = lengths.reduce((a, b) => a + b, 0) / nBullets;
  const variance = lengths.reduce((sum, l) => sum + (l - meanLen) ** 2, 0) / nBullets;
  const std = Math.sqrt(variance);
  // Human baseline: std ~6. Tight AI output: std <3.
  // Score: 0 at std=0, 100 at std≥6.
  const lengthVarianceScore = Math.min(100, Math.round((std / 6) * 100));

  // TTR on starting verbs (is AI reusing "delivered/drove/led" everywhere?)
  const verbs = bullets.map(firstVerb).filter(Boolean);
  const uniqVerbs = new Set(verbs);
  const ttr = verbs.length > 0 ? uniqVerbs.size / verbs.length : 0;
  // Humans reuse some verbs; <0.6 is AI-repetitive, >0.85 is clearly human-diverse
  const ttrScore = Math.max(0, Math.min(100, Math.round((ttr - 0.4) / 0.5 * 100)));

  // Tricolon rate
  const tricolonHits = bullets.filter(hasTricolon).length;
  const tricolonRate = tricolonHits / nBullets;
  // Human: <15%. AI: >30%.
  const tricolonScore = Math.max(0, Math.min(100, Math.round((1 - tricolonRate / 0.4) * 100)));

  // Round-metric ratio
  const allNumbers = bullets.flatMap(extractNumbers);
  const roundCount = allNumbers.filter(isRound).length;
  const roundMetricRatio = allNumbers.length > 0 ? roundCount / allNumbers.length : 0;
  // Human: ~30-40% round. AI: >70%. Score tapers from ~40% round.
  const roundMetricScore = allNumbers.length === 0
    ? 50  // no metrics — neutral (we can't judge)
    : Math.max(0, Math.min(100, Math.round((1 - Math.max(0, roundMetricRatio - 0.4) / 0.6) * 100)));

  // Admitted imperfection
  const imperfectCount = bullets.filter((b) =>
    ADMITTED_IMPERFECTION.some((re) => re.test(b)),
  ).length;
  const admittedImperfectionRate = imperfectCount / nBullets;
  // Any human-like context at all is a small positive signal. 0% = concerning; 15%+ = healthy.
  const admittedImperfectionScore = Math.min(100, Math.round(admittedImperfectionRate * 600));

  // Verb concreteness
  const concreteCount = verbs.filter((v) => CONCRETE_VERBS.has(v)).length;
  const abstractCount = verbs.filter((v) => ABSTRACT_VERBS.has(v)).length;
  const classifiedCount = concreteCount + abstractCount;
  const verbConcreteness = classifiedCount > 0
    ? concreteCount / classifiedCount
    : 0.5;
  const concretenessScore = Math.round(verbConcreteness * 100);

  return {
    lengthVarianceStd: +std.toFixed(2),
    lengthVarianceScore,
    ttr: +ttr.toFixed(3),
    ttrScore,
    tricolonRate: +tricolonRate.toFixed(3),
    tricolonScore,
    roundMetricRatio: +roundMetricRatio.toFixed(3),
    roundMetricScore,
    admittedImperfectionRate: +admittedImperfectionRate.toFixed(3),
    admittedImperfectionScore,
    verbConcreteness: +verbConcreteness.toFixed(3),
    concretenessScore,
  };
}

export const _CONCRETE_VERBS = CONCRETE_VERBS;
export const _ABSTRACT_VERBS = ABSTRACT_VERBS;

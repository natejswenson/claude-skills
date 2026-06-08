/**
 * L1 Lexicon scorer — detects AI-authored resume tells via weighted regex.
 *
 * 8 categories from domain research. Each bullet gets a per-category hit count;
 * aggregate density = total_hits / total_word_count. Deterministic, free.
 *
 * Exports:
 *   scoreLexicon(bullets: string[]) → { density, hits, byCategory, flaggedBullets }
 */

const CATEGORIES = {
  hollow_verbs: {
    weight: 1.0,
    terms: [
      "utiliz", "leverag", "facilitat", "orchestrat", "spearhead",
      "champion", "drove", "drive", "enabl", "empower", "deliver",
      "oversaw", "oversee", "synergiz",
    ],
  },
  empty_intensifiers: {
    weight: 0.8,
    terms: [
      "successfully", "effectively", "efficiently", "seamlessly",
      "significantly", "substantially", "meaningfully", "comprehensively",
      "strategically", "proactively",
    ],
  },
  hedge_padding: {
    weight: 1.2,
    terms: [
      "helped to", "worked on", "responsible for", "in order to",
      "played a key role", "was involved", "contributed to",
      "participated in", "assisted with", "tasked with",
    ],
  },
  corporate_abstractions: {
    weight: 1.0,
    terms: [
      "synerg", "stakeholder", "cross-functional", "end-to-end",
      "holistic", "best practices", "strategic initiative", "key result",
      "paradigm", "thought leader", "value-add", "go-to-market",
      "north star", "deep dive",
    ],
  },
  ai_summary_phrases: {
    weight: 1.5,   // hard tells — every resume-generator defaults to these
    terms: [
      "expertise in", "proven track record", "passionate", "seasoned",
      "dedicated", "results-oriented", "results-driven", "dynamic professional",
      "self-starter", "team player", "detail-oriented", "proactive professional",
      "adept at", "well-versed in", "extensive experience",
    ],
  },
  vague_impact: {
    weight: 0.7,
    terms: [
      "transformative", "innovative solution", "cutting-edge",
      "state-of-the-art", "next-generation", "world-class",
      "mission-critical", "game-chang",
    ],
  },
  buzz_metrics: {
    weight: 0.9,
    terms: [
      "bottom line", "top line", "kpi", "roi-driven",
      "high-impact", "high-performing",
    ],
  },
  impact_formula: {
    // "delivered X results by Y%" patterns
    weight: 0.6,
    terms: [
      "resulting in", "leading to a", "achieving a",
      "driving a", "contributing to a",
    ],
  },
};

// Em-dash / curly-quote punctuation tells
const PUNCTUATION_TELLS = /[\u2014\u2013]|\u2018|\u2019|\u201C|\u201D/g;

/**
 * @param {string[]} bullets
 * @returns {{
 *   density: number,              // hits per 100 words
 *   totalHits: number,
 *   totalWords: number,
 *   byCategory: Record<string, number>,
 *   punctuationHits: number,
 *   flaggedBullets: Array<{ bullet: string, hits: string[] }>
 * }}
 */
export function scoreLexicon(bullets) {
  const byCategory = Object.fromEntries(
    Object.keys(CATEGORIES).map((k) => [k, 0]),
  );
  const flaggedBullets = [];
  let totalHits = 0;
  let weightedHits = 0;
  let totalWords = 0;
  let punctuationHits = 0;

  for (const bullet of bullets) {
    const lower = bullet.toLowerCase();
    const words = bullet.trim().split(/\s+/).filter(Boolean);
    totalWords += words.length;

    const bulletHits = [];

    for (const [cat, { weight, terms }] of Object.entries(CATEGORIES)) {
      for (const term of terms) {
        // word-boundary match for single words, substring for phrases
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const pattern = term.includes(" ") || term.endsWith("-")
          ? new RegExp(escaped, "g")
          : new RegExp(`\\b${escaped}`, "g");
        const matches = lower.match(pattern) || [];
        if (matches.length > 0) {
          byCategory[cat] += matches.length;
          totalHits += matches.length;
          weightedHits += matches.length * weight;
          bulletHits.push(...matches.map((m) => `${cat}:${m.trim()}`));
        }
      }
    }

    punctuationHits += (bullet.match(PUNCTUATION_TELLS) || []).length;

    if (bulletHits.length > 0) {
      flaggedBullets.push({ bullet, hits: bulletHits });
    }
  }

  // density: weighted hits per 100 words (comparable across resumes)
  const density = totalWords > 0 ? (weightedHits / totalWords) * 100 : 0;

  return {
    density,
    totalHits,
    weightedHits,
    totalWords,
    byCategory,
    punctuationHits,
    flaggedBullets,
  };
}

/**
 * Convert a lexicon result into a 0-100 score. Higher = less AI-sounding.
 * Density of 0 → 100. Density of 8+ → 0.
 */
export function lexiconScore(result) {
  // Empirical scale: a human-written resume has density ~0.5-1.5.
  // Pure AI output often lands at 4-8.
  const raw = 100 - Math.min(result.density * 12, 100);
  // Punctuation tells (em-dashes) each subtract a small amount
  const punctPenalty = Math.min(result.punctuationHits * 2, 20);
  return Math.max(0, raw - punctPenalty);
}

// For tests / introspection
export const _CATEGORIES = CATEGORIES;

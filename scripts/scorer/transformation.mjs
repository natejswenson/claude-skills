/**
 * G5 — Transformation score.
 *
 * How much did the prompt actually rewrite bullets vs handing back near-
 * verbatim input? A resume that comes back looking like what was pasted in
 * is the exact complaint that triggered this metric.
 *
 * Inputs:
 *   - sourceBullets: array of original bullet strings (from parsed input)
 *   - resume: ResumeJSON (output). Uses resume.optimizedBullets + dropped.
 *
 * Per-source-bullet classification:
 *   - MATCHED_OPTIMIZED — appears in optimizedBullets as `original`
 *   - MATCHED_DROPPED  — appears in droppedBullets verbatim
 *   - UNCHANGED        — appears in experience bullets AND still matches
 *                        some source bullet verbatim (never rewritten)
 *   - ORPHAN           — cannot be matched (shouldn't happen with R3
 *                        accounting; counted as an accounting fault)
 *
 * Score:
 *   optimized_rate = (MATCHED_OPTIMIZED + MATCHED_DROPPED) / N
 *   avg_edit_rate  = mean over MATCHED_OPTIMIZED of
 *                    char-level edit distance(rewritten, original) /
 *                    max(len(rewritten), len(original))
 *   G5 = round( 0.5 * optimized_rate_score + 0.5 * edit_rate_score )
 *
 * optimized_rate_score maps:
 *   ≥ 0.80 → 100
 *   ≥ 0.60 → 80
 *   ≥ 0.40 → 60
 *   ≥ 0.20 → 40
 *   <  0.20 → 20
 *
 * edit_rate_score maps on the 0..0.6 band:
 *   0.55+ → 100      (heavy rewrite)
 *   0.40  → 85
 *   0.30  → 70
 *   0.20  → 55
 *   0.10  → 35
 *   <0.05 → 15       (micro-edit; the anti-pattern)
 *
 * A near-verbatim prompt (OPTIMIZE bullets with only punctuation/whitespace
 * deltas) will score < 40 on edit_rate_score — the explicit "it sounded
 * like my own resume" failure mode.
 */

/**
 * Levenshtein distance on characters. For <=2 KB inputs the O(n·m) cost is
 * <1 ms, so no need for Myers bit-parallel or similar. Returns an integer.
 */
function editDistance(a, b) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  const m = a.length;
  const n = b.length;
  // Two-row DP — we never need the full matrix.
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,       // deletion
        curr[j - 1] + 1,   // insertion
        prev[j - 1] + cost // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

function normalize(s) {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

function mapOptimizedRateToScore(rate) {
  if (rate >= 0.80) return 100;
  if (rate >= 0.60) return 80;
  if (rate >= 0.40) return 60;
  if (rate >= 0.20) return 40;
  return 20;
}

function mapEditRateToScore(rate) {
  if (rate >= 0.55) return 100;
  if (rate >= 0.40) return 85;
  if (rate >= 0.30) return 70;
  if (rate >= 0.20) return 55;
  if (rate >= 0.10) return 35;
  return 15;
}

/**
 * @param {{ sourceBullets: string[], resume: object }} args
 * @returns {{ g5: number, details: object }}
 */
export function scoreTransformation({ sourceBullets, resume }) {
  if (!Array.isArray(sourceBullets) || sourceBullets.length === 0) {
    return {
      g5: 50,
      details: {
        reason: "no_source_bullets",
        counts: { total: 0, optimized: 0, dropped: 0, unchanged: 0, orphan: 0 },
        avgEditRate: 0,
      },
    };
  }

  const sourceSet = new Map(sourceBullets.map((b) => [normalize(b), b]));
  const N = sourceBullets.length;

  const optimized = Array.isArray(resume.optimizedBullets) ? resume.optimizedBullets : [];
  const dropped = Array.isArray(resume.droppedBullets) ? resume.droppedBullets : [];
  const outputBullets = (resume.experience || []).flatMap((r) => r.bullets || []);

  let matchedOptimized = 0;
  let matchedDropped = 0;
  let unchanged = 0;
  let orphan = 0;
  const editRates = [];
  const claimedOriginals = new Set();

  for (const opt of optimized) {
    const orig = normalize(opt.original ?? "");
    if (!sourceSet.has(orig)) continue;
    if (claimedOriginals.has(orig)) continue;
    claimedOriginals.add(orig);
    matchedOptimized++;
    const a = opt.original ?? "";
    const b = opt.rewritten ?? "";
    const maxLen = Math.max(a.length, b.length) || 1;
    const rate = editDistance(a, b) / maxLen;
    editRates.push(rate);
  }

  for (const d of dropped) {
    const n = normalize(d);
    if (!sourceSet.has(n)) continue;
    if (claimedOriginals.has(n)) continue;
    claimedOriginals.add(n);
    matchedDropped++;
  }

  for (const ob of outputBullets) {
    const n = normalize(ob);
    if (sourceSet.has(n) && !claimedOriginals.has(n)) {
      claimedOriginals.add(n);
      unchanged++;
    }
  }

  orphan = N - (matchedOptimized + matchedDropped + unchanged);
  if (orphan < 0) orphan = 0;

  const optimizedRate = (matchedOptimized + matchedDropped) / N;
  const avgEditRate =
    editRates.length === 0
      ? 0
      : editRates.reduce((s, x) => s + x, 0) / editRates.length;

  const optScore = mapOptimizedRateToScore(optimizedRate);
  const editScore = mapEditRateToScore(avgEditRate);
  const g5 = Math.round(0.5 * optScore + 0.5 * editScore);

  return {
    g5,
    details: {
      counts: {
        total: N,
        optimized: matchedOptimized,
        dropped: matchedDropped,
        unchanged,
        orphan,
      },
      optimizedRate: +optimizedRate.toFixed(3),
      avgEditRate: +avgEditRate.toFixed(3),
      optScore,
      editScore,
    },
  };
}

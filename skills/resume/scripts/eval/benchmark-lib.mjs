/**
 * Pure, function-deterministic helpers for the benchmark harness.
 *
 * Kept separate from benchmark.mjs (which runs the pipeline on import via
 * top-level await) so these can be unit-tested offline with no claude spawn.
 */

// HARD partition: genuinely structural, source/format-independent → non-zero exit.
// Everything else in checkRules is source/format-sensitive → REPORTED only.
export const HARD_RULES = new Set(["R6_summary_phrase", "R9_optimized_noop"]);

/**
 * Split checkRules violations into HARD (gating) vs REPORTED (surfaced only).
 * @param {{rule:string, detail:string}[]} violations
 * @returns {{ hard: object[], reported: object[] }}
 */
export function partitionViolations(violations) {
  const hard = [];
  const reported = [];
  for (const v of violations ?? []) {
    (HARD_RULES.has(v.rule) ? hard : reported).push(v);
  }
  return { hard, reported };
}

/**
 * Second, additive normalization pass over already-parser-normalized résumé text
 * (parseResumeFile already did \r\n→\n, NBSP→space, trim). Removes extraction
 * artifacts before the source-gated checkRules rules and the grounding judge see
 * the text. Best-effort: it cannot fix model-output-format mismatches (that's why
 * R9_optimized_role_unknown is in the REPORTED partition, not HARD).
 */
export function normalizeSource(text) {
  return text
    .replace(/­/g, "") // soft hyphens
    .replace(/(\w)-\n(\w)/g, "$1$2") // de-hyphenate line-break splits
    .replace(/\s+/g, " ") // collapse whitespace runs
    .trim();
}

export function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export const mean = (nums) => (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0);

/**
 * Does the suite fail (non-zero exit)? ONLY treatment jobs gate. Control jobs
 * are deliberately bad-fit reference points for the discrimination check — they
 * exist to score low, so gating them on quality (G3 floor / faithfulness) would
 * conflate "intentionally off-target control" with "generator broken". Their
 * gate status is still computed and reported, just not exit-affecting. Mock
 * never fails (plumbing only).
 *
 * @param {{control?:boolean, error?:string, gateOk?:boolean}[]} rows
 * @param {{mock?:boolean}} [opts]
 */
export function suiteHardFail(rows, { mock } = {}) {
  if (mock) return false;
  return (rows ?? []).some((r) => !r.control && (Boolean(r.error) || r.gateOk === false));
}

/**
 * Directional discrimination check: every control's coverage must land below the
 * treatment median. NOT statistical proof — see the design doc.
 *
 * @param {{id:string, control:boolean, coverage:number, error?:string}[]} rows
 * @returns {null | { primarySignal, treatmentMedianCoverage, controls, pass, caveat }}
 */
export function discriminationCheck(rows) {
  const scored = (rows ?? []).filter((r) => r.coverage !== undefined && !r.error);
  const treatment = scored.filter((r) => !r.control);
  const controls = scored.filter((r) => r.control);
  if (!treatment.length || !controls.length) return null;

  const treatMedian = median(treatment.map((r) => r.coverage));
  const controlResults = controls.map((r) => ({
    id: r.id,
    coverage: r.coverage,
    below: r.coverage < treatMedian,
    gap: +(treatMedian - r.coverage).toFixed(4),
  }));
  return {
    primarySignal: "jd-coverage",
    treatmentMedianCoverage: +treatMedian.toFixed(4),
    controls: controlResults,
    pass: controlResults.every((c) => c.below),
    caveat:
      "Directional sanity check only — primary signal (JD-coverage) is weak/gameable and inherits LLM run-to-run variance. Not statistical proof.",
  };
}

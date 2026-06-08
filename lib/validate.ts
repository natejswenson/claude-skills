/**
 * Deterministic post-tailoring checks.
 *
 * These re-implement, in code, the audits the system prompt used to ask the
 * model to perform "string-by-string before emitting". Doing them here is both
 * faster (the model no longer burns thousands of output tokens narrating the
 * checks) and more reliable (string matching is exact, model self-scans are
 * not). A violation triggers at most one targeted corrective retry in the
 * pipeline; it never hard-fails a run.
 */
import type { ResumeJSON as ResumeJSONType } from "@/schemas/resume";

/** Lowercase + collapse whitespace for tolerant substring matching. */
function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Banned connective phrases that must never appear in the summary (R6). */
const BANNED_SUMMARY_PHRASES = [
  "expertise in",
  "deep expertise",
  "experienced in",
  "experienced with",
  "hands-on experience",
  "hands on experience",
  "hands-on in",
  "strong background",
  "strong experience",
  "strong foundation",
  "proven track record",
  "proven ability",
  "proven experience",
  "demonstrated ability",
  "demonstrated experience",
  "passionate",
  "seasoned",
  "results-driven",
  "results driven",
  "cutting-edge",
  "cutting edge",
  "world-class",
  "world class",
  "enterprise-grade",
  "enterprise grade",
];

/** Scope qualifiers that are only allowed if present in the source. */
const SCOPE_QUALIFIERS = [
  "at scale",
  "large-scale",
  "large scale",
  "enterprise-grade",
  "enterprise grade",
  "high-throughput",
  "high throughput",
  "world-class",
  "world class",
  "mission-critical",
  "multi-region",
  "petabyte",
];

/** All free text the model produced (summary + every bullet + skills). */
function outputText(resume: ResumeJSONType): string {
  return [
    resume.summary,
    ...resume.experience.flatMap((e) => e.bullets),
    ...resume.optimizedBullets.map((b) => b.rewritten),
    ...resume.skills,
  ].join("\n");
}

export interface ValidationResult {
  ok: boolean;
  violations: string[];
}

/**
 * Check tailored output against the source text. Returns a list of short,
 * model-actionable violation strings (empty when clean).
 */
export function validateTailoring(
  resume: ResumeJSONType,
  sourceText: string,
): ValidationResult {
  const violations: string[] = [];
  const src = norm(sourceText);
  const summary = norm(resume.summary);
  const allOut = norm(outputText(resume));

  // 1. Banned summary phrases.
  for (const phrase of BANNED_SUMMARY_PHRASES) {
    if (summary.includes(phrase)) {
      violations.push(`summary contains banned phrase "${phrase}"`);
    }
  }

  // 2. Scope qualifiers not present in source.
  for (const q of SCOPE_QUALIFIERS) {
    if (allOut.includes(q) && !src.includes(q)) {
      violations.push(`output uses scope qualifier "${q}" not in the source`);
    }
  }

  // 3. Derived durations in the summary not literally present in the source.
  //    Matches "6 years", "12 months", "a decade", "over 5 years", etc.
  const durationRe =
    /\b(?:over |nearly |almost |a |[0-9]+\+? )?(?:decade|year|month)s?\b/gi;
  for (const m of resume.summary.matchAll(durationRe)) {
    const phrase = norm(m[0]);
    // "a year"/"year" alone is rarely a derived claim; only flag numeric/decade.
    if (/\d/.test(phrase) || phrase.includes("decade")) {
      if (!src.includes(phrase)) {
        violations.push(
          `summary states duration "${m[0].trim()}" not literally in the source`,
        );
      }
    }
  }

  // 4. Invented numbers in the output not traceable to the source.
  //    Tolerant: matches shorthand K/M suffixes and comma/decimal grouping.
  const seenNums = new Set<string>();
  for (const m of allOut.matchAll(/\b\d[\d,.]*\s*[km]?\b/gi)) {
    const raw = m[0].replace(/\s+/g, "");
    const digits = raw.replace(/[,.]/g, "").replace(/[km]$/i, "");
    if (digits.length < 2) continue; // skip single digits (noisy)
    if (seenNums.has(digits)) continue;
    seenNums.add(digits);
    const srcDigits = src.replace(/[,\.]/g, "");
    if (!srcDigits.includes(digits)) {
      violations.push(`number "${raw}" in output not found in the source`);
    }
  }

  // De-dupe and cap so a retry prompt stays short.
  const unique = [...new Set(violations)].slice(0, 12);
  return { ok: unique.length === 0, violations: unique };
}

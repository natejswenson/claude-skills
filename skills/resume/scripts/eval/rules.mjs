/**
 * Deterministic rule-compliance checker for tailored ResumeJSON output.
 *
 * The full rule set (R1–R11 in lib/prompt.ts) governs the non-deterministic
 * LLM pass. Many rules require judgment (fact invention, agency upgrades) and
 * are covered by the L1/L2/L3 scorer. THIS module checks the subset that is
 * absolutely decidable from the output alone (plus the source text where it
 * sharpens a check) — so the eval can hard-fail on a black-and-white violation
 * regardless of score.
 *
 * Schema validity itself is already guaranteed upstream by zod, so we don't
 * re-check structure here — only semantic invariants.
 */

// R6 / final self-check: connective phrases the summary must NEVER contain.
export const SUMMARY_BANNED_PHRASES = [
  "expertise in",
  "deep expertise",
  "experienced in",
  "experienced with",
  "hands-on experience",
  "hands on experience",
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

// Final self-check #1: scope qualifiers that may not be added unless present
// in the source resume.
export const SCOPE_QUALIFIERS = [
  "at scale",
  "large-scale",
  "large scale",
  "enterprise-grade",
  "enterprise grade",
  "high-throughput",
  "high throughput",
  "world-class",
  "mission-critical",
  "multi-region",
  "petabyte",
];

/**
 * @param {object} resume   validated ResumeJSON
 * @param {{ sourceText?: string }} [opts]   raw source resume text; when
 *        provided, source-gated checks (scope qualifiers, derived "X years")
 *        only fire when the offending phrase is NOT in the source.
 * @returns {{ ok: boolean, violations: {rule:string, detail:string}[] }}
 */
export function checkRules(resume, opts = {}) {
  const violations = [];
  const add = (rule, detail) => violations.push({ rule, detail });
  const srcLower = (opts.sourceText ?? "").toLowerCase();
  const haveSource = !!opts.sourceText;

  // R6 — summary banned connective phrases (absolute).
  const summary = (resume.summary ?? "").toLowerCase();
  for (const p of SUMMARY_BANNED_PHRASES) {
    if (summary.includes(p)) add("R6_summary_phrase", `summary contains banned phrase "${p}"`);
  }

  // Final self-check #3 — derived "X years" in summary not present in source.
  if (haveSource) {
    const yearMatches = summary.match(/\b\d+\+?\s*years?\b/g) ?? [];
    for (const m of yearMatches) {
      if (!srcLower.includes(m.trim())) {
        add("R6_derived_years", `summary states "${m.trim()}" which is not a literal in the source`);
      }
    }
  }

  // R9 — every optimized bullet must actually differ from its original.
  for (const b of resume.optimizedBullets ?? []) {
    if ((b.original ?? "").trim() === (b.rewritten ?? "").trim()) {
      add("R9_optimized_noop", `optimizedBullets entry is unchanged: "${(b.original ?? "").slice(0, 60)}"`);
    }
  }

  // R9 — optimized bullet role must name a real experience entry.
  const companies = new Set(
    (resume.experience ?? []).map((e) => (e.company ?? "").toLowerCase().trim()).filter(Boolean),
  );
  for (const b of resume.optimizedBullets ?? []) {
    const role = (b.role ?? "").toLowerCase().trim();
    if (role && !companies.has(role)) {
      add("R9_optimized_role_unknown", `optimizedBullets role "${b.role}" is not an experience company`);
    }
  }

  // Final self-check #1 — scope qualifiers added that aren't in the source.
  for (const exp of resume.experience ?? []) {
    for (const bullet of exp.bullets ?? []) {
      const bl = bullet.toLowerCase();
      for (const q of SCOPE_QUALIFIERS) {
        if (bl.includes(q) && (!haveSource || !srcLower.includes(q))) {
          add("scope_qualifier", `bullet adds scope qualifier "${q}": "${bullet.slice(0, 60)}"`);
        }
      }
    }
  }

  return { ok: violations.length === 0, violations };
}

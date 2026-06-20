/**
 * Targeted summary-only repair.
 *
 * When the only post-tailoring violations are summary-scoped (a banned
 * connective phrase or a derived duration), regenerating the WHOLE résumé to fix
 * one sentence is wasteful and risky: on the subscription CLI every call
 * re-processes the full ~9k-token system prompt cold, and a full regeneration
 * can regress otherwise-valid bullets, roles, or numbers.
 *
 * Instead, this does a small, focused fix — a minimal prompt that rewrites ONLY
 * the summary, grounded in the candidate's facts — and splices the result back
 * into the already-valid pass-1 résumé, re-validating before accepting. Faster
 * (tiny call) and safer (the valid bullets are untouched). The caller falls back
 * to the existing full corrective retry if this returns null, so fix quality is
 * never lowered.
 */
import type { ResumeJSON as ResumeJSONType } from "@/schemas/resume";
import type { LLMClient } from "@/lib/llm/client";
import { validateTailoring, BANNED_SUMMARY_PHRASES } from "@/lib/validate";

const SUMMARY_FIX_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { summary: { type: "string" } },
  required: ["summary"],
} as const;

const FIX_SYSTEM = `You rewrite ONLY a resume summary to remove forbidden phrasing while keeping every fact identical. Output JSON {"summary":"..."} and nothing else.

Rules:
- 2-3 sentences. Ground every claim in the provided FACTS (role, named technologies, companies, numbers). Invent nothing — no new technologies, numbers, or scope.
- The summary MUST NOT contain any of these substrings or close synonyms (case-insensitive): expertise in, deep expertise, experienced in/with, hands-on experience, strong background/experience/foundation, proven track record/ability/experience, demonstrated ability/experience, passionate, seasoned, results-driven, cutting-edge, world-class, enterprise-grade, mission-critical.
- No "N years" unless that exact phrase is in the FACTS. No scope qualifiers (at scale, large-scale, high-throughput, multi-region, etc.) unless in the FACTS.
- Sentence 1: role title + 2-3 specific named technologies from the FACTS. Sentence 2: a specific accomplishment naming a company, technology, or number from the FACTS.`;

/**
 * True iff every violation is summary-scoped (so a summary-only fix can clear
 * them). The validator phrases summary violations as "summary ..." and
 * everything else as "output ..." / 'number "..." in output ...'.
 */
export function summaryScopedOnly(violations: string[]): boolean {
  return violations.length > 0 && violations.every((v) => v.startsWith("summary "));
}

/** Compact, grounded fact context for the fix prompt (kept small for speed). */
function factsContext(resume: ResumeJSONType): string {
  const exp = resume.experience
    .slice(0, 4)
    .map((e) => `- ${e.title} @ ${e.company}: ${e.bullets.slice(0, 3).join(" | ")}`)
    .join("\n");
  return [
    `ROLE: ${resume.experience[0]?.title ?? ""}`,
    `SKILLS: ${resume.skills.join(", ")}`,
    `EXPERIENCE:`,
    exp,
  ].join("\n");
}

/** Deterministic scrub used under MOCK_LLM (and as a safety net): strip banned
 *  phrases and derived "N years" so the result validates without an LLM call. */
function deterministicScrub(summary: string): string {
  let s = summary;
  for (const p of BANNED_SUMMARY_PHRASES) {
    s = s.replace(new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "");
  }
  s = s.replace(/\b\d+\+?\s*years?\b/gi, "");
  return s.replace(/\s+([.,;])/g, "$1").replace(/\s{2,}/g, " ").replace(/^[\s,;.]+/, "").trim();
}

/**
 * Attempt a summary-only fix. Returns a new ResumeJSON (a copy of `resume` with
 * a corrected, re-validated summary) on success, or null if the fix could not
 * produce a clean summary — in which case the caller should fall back to the
 * full corrective retry.
 */
export async function fixSummaryOnly(
  llm: LLMClient,
  resume: ResumeJSONType,
  sourceText: string,
  violations: string[],
  model?: string,
): Promise<ResumeJSONType | null> {
  let newSummary: string;

  if (process.env.MOCK_LLM === "1") {
    newSummary = deterministicScrub(resume.summary);
  } else {
    try {
      const out = (await llm.completeStructured({
        system: FIX_SYSTEM,
        user: [
          `FACTS:`,
          factsContext(resume),
          ``,
          `CURRENT SUMMARY (rewrite to remove the forbidden phrasing, keep all facts):`,
          resume.summary,
          ``,
          `Problems to fix: ${violations.join("; ")}`,
        ].join("\n"),
        schema: SUMMARY_FIX_SCHEMA,
        model,
      })) as { summary?: unknown } | null;
      newSummary = typeof out?.summary === "string" ? out.summary : "";
    } catch {
      return null;
    }
  }

  if (!newSummary.trim()) return null;
  const candidate: ResumeJSONType = { ...resume, summary: newSummary };
  return validateTailoring(candidate, sourceText).ok ? candidate : null;
}

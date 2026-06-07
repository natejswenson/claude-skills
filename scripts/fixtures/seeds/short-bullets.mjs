/**
 * Seed variant: push bullet length variance higher.
 * Appends a length-variance paragraph to R8 (OPTIMIZE behavior).
 */
export const SEED = {
  id: "short-bullets",
  rule_id: "R8",
  append: `

  **Bullet rhythm.** Human-written resumes scatter bullet length; templates cluster tight. When reframing bullets within a role:
  - Aim for a mix: some bullets should be 8-12 words, others 18-24 words.
  - Do not produce a role where every bullet is within ±3 words of the same length.
  - If a source bullet is short and precise (e.g., "Shipped v2 in six weeks"), keep it short — do not pad it to match longer bullets.
  - Trim hedge phrases ("helped to", "worked on", "was responsible for", "in order to", "with the goal of") even when the source contains them — R2 same-level synonyms permit this.`,
};

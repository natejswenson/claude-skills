/**
 * Seed variant: push generator toward concrete Anglo-Saxon verbs.
 * Appends a verb-preference paragraph to R8 (OPTIMIZE behavior).
 */
export const SEED = {
  id: "concrete-verbs",
  rule_id: "R8",
  append: `

  **Verb selection.** When reframing a bullet, prefer short concrete Anglo-Saxon verbs over abstract Latinate ones. These read as human; their abstract cousins read as templated:
  - PREFER: built, wrote, shipped, led, cut, grew, fixed, migrated, launched, hired, mentored, trained, rewrote, moved, scaled, closed, signed.
  - AVOID: leveraged, orchestrated, facilitated, utilized, spearheaded, championed, drove (unless the source uses "drove"), enabled, empowered, delivered (as a generic filler), oversaw (when "ran" or "led" fits).
  - This preference is about word choice, not truth. Never change WHAT happened — only the verb describing it, and only within same-level synonyms per R2.`,
};

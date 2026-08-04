/**
 * Card illustrations: validated, never generated.
 *
 * Each card carries a small original line-art scene composed for *that* item —
 * the same contract devlog uses for its covers, one level smaller. This module
 * does not draw anything. Drawing is judgment, and a drawing this file could
 * generate would by definition be the same drawing every time.
 *
 * What it does is refuse the ways the slot rots:
 *   - a hardcoded colour, which would put a brand value back in a hand-written file
 *   - a raster, a script, or anything that reaches off the page
 *   - a lone circle standing in for "I could not think of a picture"
 *   - the same scene reused on two cards
 */

export const VIEWBOX = '0 0 320 130';

/** Drawing primitives that count toward the complexity floor. */
const PRIMITIVE = /<(path|line|polyline|polygon|rect|circle|ellipse|text)\b/g;

/** Anything that reaches off the page, executes, or embeds a bitmap. */
const FORBIDDEN = [
  [/<script\b/i, 'a <script> element'],
  [/<image\b/i, 'a raster <image> — the art is line work, not a bitmap'],
  [/<foreignObject\b/i, 'a <foreignObject>'],
  [/<use\b[^>]*href\s*=\s*["']?https?:/i, 'an external <use> reference'],
  [/\son\w+\s*=/i, 'an inline event handler'],
  [/url\(\s*["']?(?:https?:)?\/\//i, 'an external url()'],
  [/<!ENTITY/i, 'an entity declaration'],
];

/**
 * A colour literal anywhere in the art is a hand-written brand value. The only
 * permitted paint keywords are `currentColor` and `none`, so ink comes from the
 * token that the surrounding CSS already resolved.
 */
const COLOUR_LITERAL = /(?:fill|stroke|stop-color|flood-color|color)\s*=\s*["']\s*(?!currentColor\b|none\b|inherit\b)([^"']+)["']/gi;

export const MIN_PRIMITIVES = 5;

export class ArtProblem extends Error {}

const countPrimitives = (svg) => (svg.match(PRIMITIVE) ?? []).length;

/** Normalised for the duplicate check: whitespace and numeric jitter removed. */
export const artFingerprint = (svg) => String(svg)
  .replace(/\s+/g, ' ')
  .replace(/(\d)\.\d+/g, '$1')
  .trim();

export function validateArt(svg, where) {
  const at = where ? `${where}: ` : '';
  if (typeof svg !== 'string' || svg.trim() === '') {
    throw new ArtProblem(`${at}no art — every card carries an illustration composed for it, see references/illustration.md`);
  }
  if (!/^<svg\b/.test(svg.trim())) throw new ArtProblem(`${at}art must be a single inline <svg> element`);

  for (const [re, what] of FORBIDDEN) {
    if (re.test(svg)) throw new ArtProblem(`${at}art contains ${what}`);
  }

  const colours = [...svg.matchAll(COLOUR_LITERAL)].map((m) => m[1].trim());
  if (colours.length) {
    throw new ArtProblem(`${at}art hardcodes a colour (${colours[0]}) — use currentColor or none so the ink comes from the brand token`);
  }

  const n = countPrimitives(svg);
  if (n < MIN_PRIMITIVES) {
    throw new ArtProblem(`${at}art has ${n} drawing element(s), below the floor of ${MIN_PRIMITIVES} — a lone shape is a placeholder, not a scene`);
  }

  if (!svg.includes(`viewBox="${VIEWBOX}"`)) {
    throw new ArtProblem(`${at}art must declare viewBox="${VIEWBOX}" so every card's scene shares one frame`);
  }
  return { primitives: n };
}

/**
 * Validate a whole draft's art at once, so a report cannot half-render and so
 * two cards can never wear the same scene.
 */
export function validateDraftArt(draft) {
  const seen = new Map();
  let total = 0;
  for (const [si, s] of (draft.sections ?? []).entries()) {
    for (const [ii, it] of (s.items ?? []).entries()) {
      const where = `sections[${si}].items[${ii}] "${it.title ?? ''}"`;
      validateArt(it.art, where);
      const fp = artFingerprint(it.art);
      if (seen.has(fp)) {
        throw new ArtProblem(`${where}: this scene is already used by "${seen.get(fp)}" — two cards may never look alike`);
      }
      seen.set(fp, it.title);
      total += 1;
    }
  }
  return { total, distinct: seen.size };
}

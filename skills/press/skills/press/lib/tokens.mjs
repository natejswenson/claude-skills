/**
 * Loading and resolving the token set.
 *
 * Nothing else in the codebase may hard-code a brand value. If a consumer needs
 * a color that isn't here, the answer is to add it here — that is the entire
 * point of the skill, and the terminal-panel quartet spent three files
 * undeclared before it was.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
export const BRAND_DIR = join(HERE, '..', 'brand');
export const TOKENS_PATH = join(BRAND_DIR, 'tokens.json');

let cached = null;

export function loadTokens(path = TOKENS_PATH) {
  if (path === TOKENS_PATH && cached) return cached;
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const resolved = resolve(raw);
  if (path === TOKENS_PATH) cached = resolved;
  return resolved;
}

/**
 * Flatten the file into one lookup of `name -> value`, computing the derived
 * values so that `hair` and `fill_steps` provably come from `ink` rather than
 * being a second place a color is written down.
 */
/** `$comment` keys are documentation for a human reading tokens.json; they must
 *  never reach an emitter's output. */
const clean = (group) => {
  const out = { ...(group ?? {}) };
  delete out.$comment;
  return out;
};

function resolve(raw) {
  const colors = clean(raw.colors);
  const terminal = clean(raw.terminal);

  const hairAlpha = raw.derived?.hair_alpha ?? 0.18;
  const [r, g, b] = hexToRgb(colors.ink);
  const hair = `rgba(${r}, ${g}, ${b}, ${hairAlpha})`;

  const fillSteps = (raw.derived?.fill_steps ?? []).map((name) => {
    const value = colors[name];
    if (!value) throw new Error(`derived.fill_steps names unknown color "${name}"`);
    return value;
  });

  return {
    name: raw.name,
    schema: raw.schema,
    colors,
    terminal,
    notes: clean(raw.color_notes),
    fonts: clean(raw.fonts),
    identity: clean(raw.identity),
    marks: clean(raw.marks),
    limits: clean(raw.limits),
    derived: { hair, hairAlpha, fillSteps },
    /** Every literal color the brand permits, for the off-palette lint. */
    palette: [...Object.values(colors), ...Object.values(terminal)],
  };
}

export function hexToRgb(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`not a 6-digit hex color: ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Look up a token by its flat name, including the derived ones. */
export function tokenValue(tokens, name) {
  if (name === 'hair') return tokens.derived.hair;
  if (name in tokens.colors) return tokens.colors[name];
  if (name in tokens.terminal) return tokens.terminal[name];
  if (name in tokens.fonts) return tokens.fonts[name];
  if (name in tokens.identity) return tokens.identity[name];
  if (name in tokens.marks) return tokens.marks[name];
  throw new Error(`unknown token "${name}"`);
}

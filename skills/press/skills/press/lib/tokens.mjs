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

/**
 * The three stacks for one rendering engine. An unknown profile name is an
 * error rather than a silent fall back to the default — a target asking for
 * `fontconfig` and quietly getting the browser chain is precisely the bug this
 * whole mechanism exists to prevent.
 */
function fontProfile(raw, name) {
  const profiles = raw.fonts?.profiles ?? {};
  const key = name ?? raw.fonts?.default_profile;
  const profile = profiles[key];
  if (!profile) {
    throw new Error(
      `unknown font profile "${key}" (available: ${Object.keys(profiles).join(', ')})`,
    );
  }
  return clean(profile);
}

function resolve(raw) {
  const colors = clean(raw.colors);
  const terminal = clean(raw.terminal);

  const [r, g, b] = hexToRgb(colors.ink);
  const [ar, ag, ab] = hexToRgb(colors.accent);
  const inkAlpha = (a) => `rgba(${r}, ${g}, ${b}, ${a})`;

  const hairAlpha = raw.derived?.hair_alpha ?? 0.18;
  const hair = inkAlpha(hairAlpha);
  // Named separately from `hair` on purpose — see derived.$comment in tokens.json.
  const border = inkAlpha(raw.derived?.border_alpha ?? hairAlpha);
  const borderHover = inkAlpha(raw.derived?.border_hover_alpha ?? 0.38);
  const accentDim = `rgba(${ar}, ${ag}, ${ab}, ${raw.derived?.accent_dim_alpha ?? 0.12})`;

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
    fonts: fontProfile(raw, raw.fonts?.default_profile),
    fontProfiles: Object.fromEntries(
      Object.keys(raw.fonts?.profiles ?? {}).map((p) => [p, fontProfile(raw, p)]),
    ),
    defaultFontProfile: raw.fonts?.default_profile,
    identity: clean(raw.identity),
    fontFiles: clean(raw.font_files),
    marks: clean(raw.marks),
    limits: clean(raw.limits),
    derived: { hair, hairAlpha, border, borderHover, accentDim, fillSteps },
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
  if (name === 'border') return tokens.derived.border;
  if (name === 'border_hover') return tokens.derived.borderHover;
  if (name === 'accent_dim') return tokens.derived.accentDim;
  if (name in tokens.colors) return tokens.colors[name];
  if (name in tokens.terminal) return tokens.terminal[name];
  if (name in tokens.fonts) return tokens.fonts[name];
  if (name in tokens.identity) return tokens.identity[name];
  if (name in tokens.marks) return tokens.marks[name];
  throw new Error(`unknown token "${name}"`);
}

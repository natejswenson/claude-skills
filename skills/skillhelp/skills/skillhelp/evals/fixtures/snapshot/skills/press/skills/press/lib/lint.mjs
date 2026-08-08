/**
 * The brand lint — the mechanical half of laws.md.
 *
 * Every rule here exists because a real artifact shipped wrong: a résumé that
 * looked perfect and was unparseable to an ATS, a PDF where the warning glyph
 * turned into a second loud color, a card that drifted a hex by one digit. Prose
 * rules an agent reads are necessary but not sufficient; these are the ones a
 * machine can hold.
 *
 * Every rule is two-sided in the tests: a real artifact must pass, and a mutated
 * copy of that same artifact must fail. A one-sided lint rots silently the day
 * someone weakens the checker.
 */
export const RULES = [
  'off-palette-hex',
  'tracking-max',
  'emoji-presentation',
  'no-shadow',
  'no-gradient',
  'no-radius',
  'accent-cap',
];

const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;
const TRACKING_RE = /letter-spacing\s*:\s*(-?[\d.]+)\s*em/gi;
// The negative lookahead sits immediately after the colon: with a `\s*` in
// front of it the engine backtracks to zero width and steps straight past the
// guard, so `box-shadow: none` would report as a shadow.
const SHADOW_RE = /\b(box|text)-shadow\s*:(?!\s*none\b)/gi;
const GRADIENT_RE = /\b(linear|radial|conic)-gradient\s*\(/gi;
const RADIUS_RE = /\bborder-radius\s*:(?!\s*0[a-z%]*\s*[;}!])/gi;
/** U+26A0 not already followed by the text-presentation selector U+FE0E. */
const BARE_WARN_RE = /⚠(?!︎)/g;

const DISABLE_RE = /press-lint-disable-next-line\s+([a-z-]+(?:\s*,\s*[a-z-]+)*)/;

/**
 * @param {string} text     file contents
 * @param {object} tokens   resolved token set
 * @param {object} options  { file, waivers: string[], accentCap: number|null,
 *                            rules: string[] }
 */
export function lintText(text, tokens, options = {}) {
  const file = options.file ?? '<input>';
  const enabled = new Set(options.rules ?? RULES);
  const waived = new Set(options.waivers ?? []);
  const palette = new Set(
    [...tokens.palette, ...(options.extraPalette ?? [])].map((c) => c.toLowerCase()),
  );
  const lines = text.split('\n');
  const findings = [];

  const add = (rule, lineNo, message) => {
    if (!enabled.has(rule) || waived.has(rule)) return;
    if (isDisabled(lines, lineNo, rule)) return;
    findings.push({ rule, file, line: lineNo, message });
  };

  lines.forEach((line, i) => {
    const lineNo = i + 1;

    for (const m of line.matchAll(HEX_RE)) {
      const hex = normalizeHex(m[0]);
      if (hex && !palette.has(hex)) {
        add('off-palette-hex', lineNo, `${m[0]} is not a brand token — add it to tokens.json or use an existing one`);
      }
    }

    // The tracking ceiling protects *text extraction*, so it applies to
    // documents a machine will read back — PDFs, HTML pages — and not to
    // rasterised cards, whose type is pixels by the time anyone sees it. The
    // card set really does run the eyebrow at .16em and is right to.
    if (options.textExtractable !== false) {
      for (const m of line.matchAll(TRACKING_RE)) {
        const em = Math.abs(Number.parseFloat(m[1]));
        const max = tokens.limits.max_letter_spacing_em;
        if (em > max) {
          add('tracking-max', lineNo, `letter-spacing ${m[1]}em exceeds ${max}em — above this, PDF text extraction silently breaks`);
        }
      }
    }

    for (const _ of line.matchAll(BARE_WARN_RE)) {
      add('emoji-presentation', lineNo, 'bare U+26A0 renders as a colored emoji — use the text-presentation form from tokens.marks.warn');
    }
    for (const _ of line.matchAll(SHADOW_RE)) {
      add('no-shadow', lineNo, 'shadows are not part of the brand — structure is ink rules and whitespace');
    }
    for (const _ of line.matchAll(GRADIENT_RE)) {
      add('no-gradient', lineNo, 'gradients are not part of the brand — paper is flat');
    }
    for (const _ of line.matchAll(RADIUS_RE)) {
      add('no-radius', lineNo, 'rounded corners are not part of the brand (a circular avatar is the one exception — waive it explicitly)');
    }
  });

  const cap = options.accentCap;
  if (cap !== null && cap !== undefined && enabled.has('accent-cap') && !waived.has('accent-cap')) {
    const accent = tokens.colors.accent.toLowerCase();
    const uses = text.toLowerCase().split(accent).length - 1;
    if (uses > cap) {
      findings.push({
        rule: 'accent-cap',
        file,
        line: 0,
        message: `the accent appears ${uses} times, cap is ${cap} — one loud moment per document`,
      });
    }
  }

  return { file, findings, ok: findings.length === 0 };
}

/** A `press-lint-disable-next-line <rule>` comment on the preceding line. */
function isDisabled(lines, lineNo, rule) {
  const prev = lines[lineNo - 2];
  if (!prev) return false;
  const m = DISABLE_RE.exec(prev);
  if (!m) return false;
  return m[1].split(',').map((r) => r.trim()).includes(rule);
}

/** #abc -> #aabbcc; #rrggbbaa -> #rrggbb. Returns null for lengths we skip. */
function normalizeHex(raw) {
  const body = raw.slice(1).toLowerCase();
  if (body.length === 3) return `#${body[0]}${body[0]}${body[1]}${body[1]}${body[2]}${body[2]}`;
  if (body.length === 6) return `#${body}`;
  if (body.length === 8) return `#${body.slice(0, 6)}`;
  return null;
}

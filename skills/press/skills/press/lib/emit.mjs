/**
 * The emitters — one per shape a consumer needs the brand in.
 *
 * An emitter returns a region *body* (no markers); region.mjs wraps it. Every
 * emitter is a pure function of (tokens, params), so the same inputs always
 * produce the same bytes and `check` can re-derive what should be on disk.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BRAND_DIR } from './tokens.mjs';

export class EmitError extends Error {}

/**
 * Preferred order for colors in generated output — a *sort key*, never a
 * filter. Anything not named here is appended rather than dropped, so a token
 * added to tokens.json always reaches every consumer. Filtering here instead
 * would mean a new brand value silently never shipped, with `check` still
 * reporting green.
 */
const COLOR_ORDER = [
  'paper', 'paper_surface', 'paper_elevated',
  'ink', 'dim', 'accent', 'rule', 'ink_mid', 'ink_faint',
];

const orderedColors = (tokens) => {
  const rank = (k) => (COLOR_ORDER.indexOf(k) === -1 ? COLOR_ORDER.length : COLOR_ORDER.indexOf(k));
  return Object.keys(tokens.colors)
    .sort((a, b) => rank(a) - rank(b))
    .map((k) => [k, tokens.colors[k]]);
};

// --------------------------------------------------------------------------
// python-theme
// --------------------------------------------------------------------------

/**
 * The token dict plus the loader every Python consumer shares: a deep-merge
 * over an optional local override file, falling back silently on any error
 * because a report in the wrong colors beats a report that didn't generate
 * (laws.md §6).
 */
function pythonTheme(tokens, params) {
  const envVar = required(params, 'env_var', 'python-theme');
  const extras = new Set(params.extras ?? []);
  const useLogging = params.logging === true;
  const stamp = params.stamp ?? tokens.identity.stamp;
  const brandLine = required(params, 'brand_line', 'python-theme');
  const byline = params.byline ?? tokens.identity.byline;
  const docKind = params.document_kind ?? 'DOCUMENT';
  const fonts = fontsFor(tokens, params);

  const out = [];
  out.push('import copy');
  out.push('import json');
  if (useLogging) out.push('import logging');
  out.push('import os');
  out.push('from pathlib import Path');
  out.push('');
  if (useLogging) {
    out.push('_LOG = logging.getLogger(__name__)');
    out.push('');
  }
  out.push(`_BRAND_FILE_ENV = ${py(envVar)}`);
  out.push('');

  if (extras.has('warn')) {
    out.push('#: Forces U+26A0 to text presentation. A bare warning sign renders as a');
    out.push('#: *colored emoji* glyph in Chromium, which would put a second loud color on');
    out.push('#: the page and break the accent law silently — it looks right in the HTML');
    out.push('#: and wrong in the PDF.');
    out.push(`WARN = ${py(tokens.marks.warn)}`);
    out.push('');
  }

  out.push('DEFAULT_THEME: dict = {');
  out.push(`    "name": ${py(tokens.name)},`);
  out.push('    "colors": {');
  for (const [key, value] of orderedColors(tokens)) {
    for (const line of wrapComment(tokens.notes[key], 8)) out.push(line);
    out.push(`        ${py(key)}: ${py(value)},`);
  }
  if (extras.has('terminal')) {
    out.push('        # The dark panel palette. Only ever inside a terminal element.');
    for (const [key, value] of Object.entries(tokens.terminal)) {
      out.push(`        ${py(key)}: ${py(value)},`);
    }
  }
  out.push('    },');
  out.push('    "fonts": {');
  out.push('        # Display/structure voice, set 800-900 with tight tracking by the CSS.');
  out.push(`        "display_stack": ${py(fonts.display_stack)},`);
  out.push('        # Commentary voice: serif italics for standfirsts and captions.');
  out.push(`        "serif_stack": ${py(fonts.serif_stack)},`);
  out.push('        # Data voice: labels, dates, tables, provenance.');
  out.push(`        "mono_stack": ${py(fonts.mono_stack)},`);
  if (extras.has('mono_file')) {
    out.push('        # Point at a real TTF to load an authentic mono face via @font-face.');
    out.push('        "mono_file": None,');
  }
  out.push('    },');
  out.push('    "identity": {');
  out.push('        # Typographic stamp (rotated square, accent border + initials).');
  out.push(`        "stamp": ${py(stamp)},`);
  out.push(`        # Masthead eyebrow, tracked caps: "{brand_line} · ${docKind} · date".`);
  out.push(`        "brand_line": ${py(brandLine)},`);
  out.push('        # Right-aligned dim byline in the masthead.');
  out.push(`        "byline": ${py(byline)},`);
  out.push('    },');
  out.push('}');

  if (extras.has('fill_steps')) {
    out.push('');
    out.push('#: Sequential fill steps, dark to light. Capped at three because the lighter');
    out.push('#: extensions of this ramp drop under 3:1 against paper. Encodes magnitude');
    out.push('#: only, never identity — see the brand laws on fills.');
    out.push(`FILL_STEPS = (${tokens.derived.fillSteps.map(py).join(', ')})`);
  }

  out.push('');
  out.push('');
  out.push('def _deep_merge(base: dict, override: dict) -> dict:');
  out.push('    """Recursively merge ``override`` into a copy of ``base``.');
  out.push('');
  out.push('    Non-dict values replace; unknown keys are kept, so a brand file written');
  out.push('    against a newer default still loads against an older one.');
  out.push('    """');
  out.push('    out = copy.deepcopy(base)');
  out.push('    for key, value in override.items():');
  out.push('        if isinstance(value, dict) and isinstance(out.get(key), dict):');
  out.push('            out[key] = _deep_merge(out[key], value)');
  out.push('        else:');
  out.push('            out[key] = copy.deepcopy(value)');
  out.push('    return out');
  out.push('');
  out.push('');
  out.push('def load_theme() -> dict:');
  out.push(`    """The active theme: \`\`DEFAULT_THEME\`\` merged with \`\`${envVar}\`\`.`);
  out.push('');
  out.push('    Read per render rather than cached, so editing the brand file takes effect');
  out.push('    on the next render without restarting anything. A missing or broken brand');
  out.push('    file must never break a render, so any load error falls back to the');
  out.push('    default.');
  out.push('    """');
  out.push('    theme = copy.deepcopy(DEFAULT_THEME)');
  out.push('    brand_file = os.environ.get(_BRAND_FILE_ENV)');
  out.push('    if brand_file:');
  out.push('        try:');
  out.push('            override = json.loads(Path(brand_file).expanduser().read_text(encoding="utf-8"))');
  out.push('            if isinstance(override, dict):');
  out.push('                theme = _deep_merge(theme, override)');
  if (useLogging) {
    out.push('            else:');
    out.push('                _LOG.warning(');
    out.push('                    "brand file %s is not a JSON object — using default theme", brand_file)');
    out.push('        except (OSError, ValueError):');
    out.push('            _LOG.warning(');
    out.push('                "could not load brand file %s — using default theme",');
    out.push('                brand_file, exc_info=True)');
  } else {
    out.push('        except (OSError, ValueError):');
    out.push('            pass');
  }
  if (extras.has('mono_file')) {
    out.push('    mono_file = theme.get("fonts", {}).get("mono_file")');
    out.push('    if mono_file:');
    out.push('        theme["fonts"]["mono_file"] = str(Path(mono_file).expanduser())');
  }
  out.push('    return theme');

  return out.join('\n');
}

// --------------------------------------------------------------------------
// css-vars
// --------------------------------------------------------------------------

/**
 * A custom-property block. `vars` names which tokens the medium wants and,
 * crucially, what to *call* them: the résumé's `--sig` and the site's `--fg`
 * stay medium-idiomatic while provably carrying one source's values. Forcing a
 * global rename would be churn for no gain.
 */
function cssVars(tokens, params) {
  const selector = params.selector ?? ':root';
  const vars = params.vars ?? [];
  if (vars.length === 0) throw new EmitError('css-vars needs a non-empty "vars" list');

  const decls = vars.map((entry) => {
    const spec = typeof entry === 'string' ? { token: entry } : entry;
    // Custom properties are kebab-case; token keys are snake_case.
    const name = (spec.name ?? spec.token).replace(/_/g, '-');
    const raw = spec.token === 'stamp'
      ? (params.stamp ?? tokens.identity.stamp)
      : lookup(tokens, spec.token, params);
    const value = spec.quote ? JSON.stringify(raw) : raw;
    // `comments: "explicit"` keeps only hand-written hints; the token notes are
    // written for a reader of tokens.json and are far too long for a CSS block.
    const fallback = params.comments === 'explicit' ? null : tokens.notes[spec.token] ?? null;
    return { name: `--${name}`, value, comment: spec.comment ?? fallback };
  });

  const pad = params.align ? Math.max(...decls.map((d) => d.name.length)) + 2 : 0;

  const body = decls.map((d) => {
    const line = `  ${`${d.name}:`.padEnd(pad)} ${d.value};`.replace(/ +;$/, ';');
    return d.comment && params.comments !== false
      ? `${line}${' '.repeat(Math.max(1, 48 - line.length))}/* ${d.comment} */`
      : line;
  });

  for (const extra of params.trailing ?? []) body.push(`  ${extra}`);

  return [`${selector} {`, ...body, '}'].join('\n');
}

// --------------------------------------------------------------------------
// md-palette / markdown-block / json
// --------------------------------------------------------------------------

/** The palette as a prose bullet list, for a style guide an agent reads. */
function mdPalette(tokens, params) {
  const skip = new Set(params.omit ?? []);
  const lines = orderedColors(tokens)
    .filter(([key]) => !skip.has(key))
    .map(([key, value]) => `- **${titleize(key)}** \`${value}\` — ${tokens.notes[key]}`);
  if (params.terminal !== false) {
    const keys = Object.keys(tokens.terminal);
    const names = keys.map((k) => k.replace(/^term_/, '')).join(', ');
    const values = keys.map((k) => `\`${tokens.terminal[k]}\``).join(', ');
    lines.push(
      `- **Terminal panel** (${names}) ${values} — the one place the dark palette`,
      '  survives, and only inside a terminal element. Never on paper.',
    );
  }
  return lines.join('\n');
}

/** Inline one of the brand contract documents verbatim. */
function markdownBlock(tokens, params) {
  const doc = required(params, 'doc', 'markdown-block');
  if (!/^[a-z-]+$/.test(doc)) throw new EmitError(`illegal doc name "${doc}"`);
  const text = readFileSync(join(BRAND_DIR, `${doc}.md`), 'utf8').replace(/\s+$/, '');
  const shift = params.heading_shift ?? 0;
  if (!shift) return text;
  return text
    .split('\n')
    .map((l) => (/^#{1,5} /.test(l) ? '#'.repeat(shift) + l : l))
    .join('\n');
}

/** Raw values, for anything that just wants the numbers. */
function jsonTokens(tokens, params) {
  const payload = {
    colors: tokens.colors,
    terminal: tokens.terminal,
    fonts: fontsFor(tokens, params),
    identity: { ...tokens.identity, ...(params.stamp ? { stamp: params.stamp } : {}) },
    derived: { hair: tokens.derived.hair, fill_steps: tokens.derived.fillSteps },
  };
  for (const key of params.omit ?? []) delete payload[key];
  return JSON.stringify(payload, null, 2);
}

// --------------------------------------------------------------------------


/**
 * Flat module constants plus optional dicts, for a script that reads tokens as
 * Python names rather than a theme dict. The profile README's SVG build is the
 * case: it has no override file to deep-merge and no stylesheet, so the full
 * `python-theme` machinery would be dead weight around four strings.
 */
function pythonConsts(tokens, params) {
  const out = [];
  for (const spec of params.consts ?? []) {
    const name = required(spec, 'name', 'python-consts');
    out.push(`${name} = ${py(lookup(tokens, required(spec, 'token', 'python-consts'), params))}`);
  }
  for (const spec of params.dicts ?? []) {
    const group = tokens[required(spec, 'group', 'python-consts')];
    if (!group) throw new EmitError(`python-consts: unknown token group "${spec.group}"`);
    if (out.length) out.push('');
    out.push(`${required(spec, 'name', 'python-consts')} = {`);
    for (const [key, value] of Object.entries(group)) {
      const k = spec.key_style === 'kebab' ? key.replace(/_/g, '-') : key;
      out.push(`    ${py(k)}: ${py(value)},`);
    }
    out.push('}');
  }
  if (out.length === 0) throw new EmitError('python-consts needs consts and/or dicts');
  return out.join('\n');
}

export const EMITTERS = {
  'python-theme': pythonTheme,
  'python-consts': pythonConsts,
  'css-vars': cssVars,
  'md-palette': mdPalette,
  'markdown-block': markdownBlock,
  json: jsonTokens,
};

export function emitBody(tokens, emitter, params = {}) {
  const fn = EMITTERS[emitter];
  if (!fn) {
    throw new EmitError(
      `unknown emitter "${emitter}" (expected one of: ${Object.keys(EMITTERS).join(', ')})`,
    );
  }
  return fn(tokens, params);
}

// --------------------------------------------------------------------------

function required(params, key, emitter) {
  const value = params[key];
  if (value === undefined || value === null || value === '') {
    throw new EmitError(`${emitter} requires params.${key}`);
  }
  return value;
}

/**
 * The font stacks for this target's rendering engine. Defaults to the token
 * set's own default profile, so a target that says nothing is unchanged.
 */
function fontsFor(tokens, params = {}) {
  const name = params.font_profile;
  if (!name) return tokens.fonts;
  const profile = tokens.fontProfiles?.[name];
  if (!profile) {
    throw new EmitError(
      `unknown font_profile "${name}" (available: ${Object.keys(tokens.fontProfiles ?? {}).join(', ')})`,
    );
  }
  return profile;
}

const DERIVED = {
  hair: 'hair',
  border: 'border',
  border_hover: 'borderHover',
  accent_dim: 'accentDim',
};

function lookup(tokens, name, params = {}) {
  if (name in DERIVED) return tokens.derived[DERIVED[name]];
  for (const group of [tokens.colors, tokens.terminal, fontsFor(tokens, params), tokens.fontFiles, tokens.identity, tokens.marks]) {
    if (name in group) return group[name];
  }
  throw new EmitError(`unknown token "${name}"`);
}

/** Python string literal. Double quotes, matching every existing consumer. */
function py(value) {
  if (value === null) return 'None';
  return JSON.stringify(value);
}

function wrapComment(text, indent) {
  if (!text) return [];
  const pad = ' '.repeat(indent);
  const words = text.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (`${pad}# ${next}`.length > 79 && current) {
      lines.push(`${pad}# ${current}`);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(`${pad}# ${current}`);
  return lines;
}

function titleize(key) {
  return key
    .split('_')
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join(' ');
}

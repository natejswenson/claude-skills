import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

import { loadTokens } from '../lib/tokens.mjs';
import { emitBody, EmitError } from '../lib/emit.mjs';

const tokens = loadTokens();

const PY_PARAMS = {
  env_var: 'DEMO_BRAND_FILE',
  brand_line: 'DEMO',
  document_kind: 'DEMO REPORT',
  extras: ['fill_steps', 'warn'],
};

test('python-theme emits importable Python that loads the real values', () => {
  const body = emitBody(tokens, 'python-theme', PY_PARAMS);
  const probe = `${body}\nimport json\nprint(json.dumps(load_theme()["colors"]))`;
  const out = execFileSync('python3', ['-c', probe], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(out), tokens.colors);
});

test('python-theme carries every color, so a new token cannot silently not ship', () => {
  const body = emitBody(tokens, 'python-theme', PY_PARAMS);
  for (const [name, value] of Object.entries(tokens.colors)) {
    assert.match(body, new RegExp(`"${name}": "${value}"`), name);
  }
});

test('python-theme extras are opt-in per consumer', () => {
  const bare = emitBody(tokens, 'python-theme', { ...PY_PARAMS, extras: [] });
  assert.doesNotMatch(bare, /FILL_STEPS/);
  assert.doesNotMatch(bare, /^WARN =/m);
  const full = emitBody(tokens, 'python-theme', PY_PARAMS);
  assert.match(full, /FILL_STEPS = \("#181510", "#4A423A", "#6E675C"\)/);
  assert.match(full, /^WARN = /m);
});

test('python-theme with logging emits the warning path, without it the silent one', () => {
  const quiet = emitBody(tokens, 'python-theme', PY_PARAMS);
  assert.match(quiet, /except \(OSError, ValueError\):\n {12}pass/);
  assert.doesNotMatch(quiet, /_LOG/);
  const loud = emitBody(tokens, 'python-theme', { ...PY_PARAMS, logging: true });
  assert.match(loud, /import logging/);
  assert.match(loud, /_LOG\.warning/);
});

test('python-theme requires the params that make it consumer-specific', () => {
  assert.throws(() => emitBody(tokens, 'python-theme', { brand_line: 'X' }), EmitError);
  assert.throws(() => emitBody(tokens, 'python-theme', { env_var: 'X' }), EmitError);
});

test('a broken brand file falls back to defaults rather than breaking a render', () => {
  const body = emitBody(tokens, 'python-theme', PY_PARAMS);
  const probe = [
    body,
    'import os, json',
    'os.environ["DEMO_BRAND_FILE"] = "/definitely/not/here.json"',
    'print(json.dumps(load_theme()["colors"]["paper"]))',
  ].join('\n');
  const out = execFileSync('python3', ['-c', probe], { encoding: 'utf8' });
  assert.equal(JSON.parse(out), tokens.colors.paper);
});

test('css-vars aliases names while keeping one source of values', () => {
  const body = emitBody(tokens, 'css-vars', {
    vars: [{ token: 'accent', name: 'sig' }, { token: 'paper', name: 'bg' }],
    comments: false,
  });
  assert.match(body, new RegExp(`--sig: ${tokens.colors.accent};`));
  assert.match(body, new RegExp(`--bg: ${tokens.colors.paper};`));
  assert.doesNotMatch(body, /--accent/);
});

test('css-vars kebab-cases snake_case token names', () => {
  const body = emitBody(tokens, 'css-vars', { vars: ['ink_mid'], comments: false });
  assert.match(body, /--ink-mid:/);
  assert.doesNotMatch(body, /--ink_mid:/);
});

test('css-vars quotes a value when the property needs a CSS string', () => {
  const body = emitBody(tokens, 'css-vars', {
    vars: [{ token: 'stamp', quote: true }],
    stamp: 'ZZ',
    comments: false,
  });
  assert.match(body, /--stamp: "ZZ";/);
});

test('css-vars "explicit" comment mode drops the long token notes', () => {
  const spec = { vars: [{ token: 'paper', comment: 'short' }, { token: 'ink' }] };
  const verbose = emitBody(tokens, 'css-vars', spec);
  const explicit = emitBody(tokens, 'css-vars', { ...spec, comments: 'explicit' });
  assert.match(verbose, /Near-black/);
  assert.doesNotMatch(explicit, /Near-black/);
  assert.match(explicit, /\/\* short \*\//);
});

test('css-vars refuses an empty var list rather than emitting an empty block', () => {
  assert.throws(() => emitBody(tokens, 'css-vars', { vars: [] }), EmitError);
});

test('an unknown token name is an error, never a blank value', () => {
  assert.throws(() => emitBody(tokens, 'css-vars', { vars: ['nope'] }), EmitError);
});

test('md-palette lists every color and the whole terminal group', () => {
  const body = emitBody(tokens, 'md-palette', {});
  for (const value of Object.values(tokens.colors)) assert.ok(body.includes(value), value);
  for (const value of Object.values(tokens.terminal)) assert.ok(body.includes(value), value);
});

test('md-palette omit drops only what a consumer asked to drop', () => {
  const body = emitBody(tokens, 'md-palette', { omit: ['ink_mid'] });
  assert.doesNotMatch(body, /\*\*Ink Mid\*\*/);
  assert.match(body, /\*\*Paper\*\*/);
});

test('markdown-block inlines a real brand document', () => {
  const body = emitBody(tokens, 'markdown-block', { doc: 'voice-core' });
  assert.match(body, /## Voice — the universal core/);
  assert.match(body, /No em dashes/);
});

test('markdown-block rejects a path-traversing doc name', () => {
  assert.throws(() => emitBody(tokens, 'markdown-block', { doc: '../../package' }), EmitError);
});

test('$comment keys documenting tokens.json never reach generated output', () => {
  for (const emitter of ['python-theme', 'md-palette', 'json']) {
    const params = emitter === 'python-theme' ? PY_PARAMS : {};
    assert.doesNotMatch(emitBody(tokens, emitter, params), /\$comment/, emitter);
  }
});

test('an unknown emitter is an error', () => {
  assert.throws(() => emitBody(tokens, 'sass', {}), EmitError);
});

test('emitters are pure — same inputs, same bytes', () => {
  assert.equal(
    emitBody(tokens, 'python-theme', PY_PARAMS),
    emitBody(tokens, 'python-theme', PY_PARAMS),
  );
});

// --- font profiles --------------------------------------------------------
// The brand's type intent is one thing; the chain that achieves it depends on
// the rendering engine. Chromium resolves -apple-system to SF and never walks
// the fallbacks; fontconfig walks them for real, where the browser chain lands
// on Helvetica Neue Heavy Condensed. Measured with pdffonts, not assumed.

test('omitting font_profile uses the token set default, so old targets are unchanged', () => {
  const a = emitBody(tokens, 'python-theme', PY_PARAMS);
  const b = emitBody(tokens, 'python-theme', { ...PY_PARAMS, font_profile: tokens.defaultFontProfile });
  assert.equal(a, b);
});

test('font_profile selects that engine\'s stacks', () => {
  const browser = emitBody(tokens, 'python-theme', { ...PY_PARAMS, font_profile: 'browser' });
  const fc = emitBody(tokens, 'python-theme', { ...PY_PARAMS, font_profile: 'fontconfig' });
  assert.match(browser, /Inter, Roboto/);
  assert.doesNotMatch(fc, /Inter, Roboto/, 'the fontconfig chain must not carry browser-only faces');
});

test('an unknown font_profile is an error, never a silent fall back to the default', () => {
  assert.throws(() => emitBody(tokens, 'python-theme', { ...PY_PARAMS, font_profile: 'ghost' }), EmitError);
});

test('the fontconfig profile stays shallower than the browser one', () => {
  for (const key of ['display_stack', 'serif_stack', 'mono_stack']) {
    const b = tokens.fontProfiles.browser[key].split(',').length;
    const f = tokens.fontProfiles.fontconfig[key].split(',').length;
    assert.ok(f <= b, `${key}: every extra face in a fontconfig chain is one that can win`);
  }
});

test('css-vars honours the profile too', () => {
  const fc = emitBody(tokens, 'css-vars', {
    vars: [{ token: 'display_stack', name: 'font' }], comments: false, font_profile: 'fontconfig',
  });
  assert.doesNotMatch(fc, /Inter/);
});

test('a WeasyPrint target is never emitted the browser display chain', async () => {
  const { loadTargets } = await import('../lib/targets.mjs');
  const lf = loadTargets().find((t) => t.id === 'local-fitness');
  assert.equal(lf.params.font_profile, 'fontconfig',
    'local-fitness renders through WeasyPrint; the browser chain visibly condenses its headlines');
  const body = emitBody(tokens, lf.emitter, lf.params);
  assert.doesNotMatch(body, /'Helvetica Neue'/);
});

// --- python-consts --------------------------------------------------------
// The profile README's SVG build reads tokens as plain Python names: it has no
// override file to deep-merge and no stylesheet, so `python-theme` would be
// dead weight around four strings.

const CONSTS = {
  consts: [{ name: 'PAPER', token: 'paper' }, { name: 'ACCENT', token: 'accent' }],
  dicts: [{ name: 'FACES', group: 'fontFiles', key_style: 'kebab' }],
};

test('python-consts emits importable Python with the real values', async () => {
  const { execFileSync } = await import('node:child_process');
  const body = emitBody(tokens, 'python-consts', CONSTS);
  const out = execFileSync('python3', ['-c', `${body}\nimport json;print(json.dumps([PAPER, ACCENT, FACES]))`], { encoding: 'utf8' });
  const [paper, accent, faces] = JSON.parse(out);
  assert.equal(paper, tokens.colors.paper);
  assert.equal(accent, tokens.colors.accent);
  assert.equal(faces['display-black'], tokens.fontFiles.display_black);
});

test('python-consts kebab-cases dict keys only when asked', () => {
  assert.match(emitBody(tokens, 'python-consts', CONSTS), /"display-black"/);
  const snake = emitBody(tokens, 'python-consts', { ...CONSTS, dicts: [{ name: 'FACES', group: 'fontFiles' }] });
  assert.match(snake, /"display_black"/);
});

test('python-consts carries every vendorable face, so a new one cannot be missed', () => {
  const body = emitBody(tokens, 'python-consts', CONSTS);
  for (const file of Object.values(tokens.fontFiles)) assert.ok(body.includes(file), file);
});

test('python-consts rejects an unknown group and an empty spec', () => {
  assert.throws(() => emitBody(tokens, 'python-consts', { dicts: [{ name: 'X', group: 'nope' }] }), EmitError);
  assert.throws(() => emitBody(tokens, 'python-consts', {}), EmitError);
});

// --- version-badge --------------------------------------------------------
// Without this, a repo's press version appears only in a CI pin and a comment
// marker — neither of which anyone reads when landing on the repo.

test('version-badge states the release it was emitted from', () => {
  const body = emitBody(tokens, 'version-badge', {}, { version: '9.9.9' });
  assert.match(body, /PRESS v9\.9\.9/);
  assert.match(body, /press\/brand\/tokens\.json/, 'must say where to change values');
});

test('version-badge takes the version from run context, not target params', () => {
  const a = emitBody(tokens, 'version-badge', {}, { version: '1.0.0' });
  const b = emitBody(tokens, 'version-badge', {}, { version: '2.0.0' });
  assert.notEqual(a, b, 'a new release must change the badge, or it can never go stale-detected');
});

test('version-badge describes what this consumer generates', () => {
  const body = emitBody(tokens, 'version-badge', { what: 'The tiles' }, { version: '1.0.0' });
  assert.match(body, /The tiles are generated/);
});

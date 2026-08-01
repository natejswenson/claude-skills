import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadTokens } from '../lib/tokens.mjs';
import { lintText, RULES } from '../lib/lint.mjs';

const tokens = loadTokens();

const CLEAN = `.card.press {
  --paper: ${tokens.colors.paper};
  --ink: ${tokens.colors.ink};
}
.card.press .eyebrow { letter-spacing: 0.09em; text-transform: uppercase; }
.card.press .mast { border-top: 8px solid var(--rule); }
.card.press .warn::before { content: "${tokens.marks.warn}"; }
`;

const lint = (text, options = {}) => lintText(text, tokens, options);
const rulesHit = (text, options) => lint(text, options).findings.map((f) => f.rule);

test('a clean brand document passes every rule', () => {
  assert.deepEqual(lint(CLEAN).findings, []);
  assert.equal(lint(CLEAN).ok, true);
});

// Each pair below is the two-sided contract: the clean document above passes,
// and one targeted mutation of it fails. A rule with only the passing half
// rots the day someone weakens the checker.
const MUTATIONS = [
  ['off-palette-hex', CLEAN.replace(tokens.colors.ink, '#123456')],
  ['tracking-max', CLEAN.replace('0.09em', '0.14em')],
  ['emoji-presentation', CLEAN.replace(tokens.marks.warn, '⚠')],
  ['no-shadow', `${CLEAN}.card.press .stat { box-shadow: 0 2px 4px #181510; }\n`],
  ['no-gradient', `${CLEAN}.card.press { background: linear-gradient(#F5F0E6, #ECE5D6); }\n`],
  ['no-radius', `${CLEAN}.card.press .stat { border-radius: 6px; }\n`],
];

for (const [rule, mutated] of MUTATIONS) {
  test(`${rule}: the mutated document fails`, () => {
    assert.ok(rulesHit(mutated).includes(rule), `expected ${rule}, got ${rulesHit(mutated)}`);
  });
}

test('every declared rule has a failing fixture', () => {
  const covered = new Set([...MUTATIONS.map(([r]) => r), 'accent-cap']);
  assert.deepEqual(RULES.filter((r) => !covered.has(r)), []);
});

test('accent-cap counts the signature colour and fires only above the cap', () => {
  const twice = `a: ${tokens.colors.accent}; b: ${tokens.colors.accent};`;
  assert.deepEqual(rulesHit(twice, { accentCap: 2 }), []);
  assert.ok(rulesHit(twice, { accentCap: 1 }).includes('accent-cap'));
});

test('accent-cap is off unless a cap is given, so a plain lint never guesses', () => {
  const many = Array(9).fill(tokens.colors.accent).join(' ');
  assert.deepEqual(rulesHit(many), []);
});

test('tracking exactly at the ceiling is allowed; one step over is not', () => {
  const at = `h1 { letter-spacing: ${tokens.limits.max_letter_spacing_em}em; }`;
  const over = 'h1 { letter-spacing: 0.11em; }';
  assert.deepEqual(rulesHit(at), []);
  assert.ok(rulesHit(over).includes('tracking-max'));
});

test('negative tracking is measured by magnitude, not sign', () => {
  assert.deepEqual(rulesHit('h1 { letter-spacing: -0.03em; }'), []);
  assert.ok(rulesHit('h1 { letter-spacing: -0.4em; }').includes('tracking-max'));
});

test('shorthand and 8-digit hexes are normalised before the palette check', () => {
  assert.deepEqual(rulesHit('a { color: #181510FF; }'), []);
  assert.ok(rulesHit('a { color: #123; }').includes('off-palette-hex'));
});

test('the terminal palette is in-palette — it is brand, not an exception', () => {
  const term = Object.values(tokens.terminal).map((c) => `x: ${c};`).join('\n');
  assert.deepEqual(rulesHit(term), []);
});

test('shadow: none and radius: 0 are not violations', () => {
  assert.deepEqual(rulesHit('a { box-shadow: none; border-radius: 0; }'), []);
});

test('a disable comment waives exactly one rule on exactly the next line', () => {
  const waived = [
    '/* the colophon avatar is a cropped photograph, not a container */',
    '/* press-lint-disable-next-line no-radius */',
    '.footer.brand::before { border-radius: 50%; }',
    '.stat { border-radius: 6px; }',
  ].join('\n');
  const hits = lint(waived).findings;
  assert.equal(hits.length, 1, 'only the un-waived line should fail');
  assert.equal(hits[0].line, 4);
});

test('a disable comment for one rule does not waive another', () => {
  const text = [
    '/* press-lint-disable-next-line no-radius */',
    '.x { border-radius: 4px; box-shadow: 0 0 2px #181510; }',
  ].join('\n');
  assert.deepEqual(rulesHit(text), ['no-shadow']);
});

test('a whole-file waiver silences only the named rule', () => {
  const mutated = CLEAN.replace('0.09em', '0.14em');
  assert.deepEqual(rulesHit(mutated, { waivers: ['tracking-max'] }), []);
  assert.ok(rulesHit(mutated, { waivers: ['no-radius'] }).includes('tracking-max'));
});

test('findings carry the file and line so they are actionable', () => {
  const result = lint('a{}\nb { border-radius: 3px; }\n', { file: 'x.css' });
  assert.equal(result.findings[0].file, 'x.css');
  assert.equal(result.findings[0].line, 2);
});

// The real corpus: the files this repo actually ships must lint clean, or the
// rules are wrong. A rule strict enough to reject shipped work is a bad rule.
test('every shipped brand stylesheet in this repo lints clean', async () => {
  const { readFileSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { repoRoot } = await import('../lib/targets.mjs');
  const root = repoRoot(dirname(new URL(import.meta.url).pathname));

  const corpus = [
    { rel: 'skills/resume/skills/resume/assets/themes/press.css', raster: false },
    { rel: 'skills/ghostwriter/skills/ghostwriter/assets/diagram.css.example', raster: true },
    { rel: 'skills/ghostwriter-x/skills/ghostwriter-x/assets/diagram.css.example', raster: true },
  ];
  assert.ok(corpus.length >= 3, 'corpus floor');

  for (const { rel, raster } of corpus) {
    const text = readFileSync(join(root, rel), 'utf8');
    // These files also carry the legacy non-press card themes, which predate
    // the brand and are out of scope; lint only the press region and below.
    const pressOnly = text.slice(text.indexOf('press:tokens'));
    const result = lintText(pressOnly, tokens, {
      file: rel,
      textExtractable: !raster,
      rules: ['tracking-max', 'emoji-presentation', 'no-gradient'],
    });
    assert.deepEqual(result.findings, [], rel);
  }
});

test('the résumé theme — a real PDF — is held to the tracking ceiling', async () => {
  const { readFileSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { repoRoot } = await import('../lib/targets.mjs');
  const root = repoRoot(dirname(new URL(import.meta.url).pathname));
  const rel = 'skills/resume/skills/resume/assets/themes/press.css';
  const text = readFileSync(join(root, rel), 'utf8');

  assert.deepEqual(rulesHit(text, { rules: ['tracking-max'] }), [], 'shipped résumé must pass');
  // …and the rule is live on this file, not accidentally disabled.
  const mutated = text.replace(/letter-spacing:\s*[\d.]+em/, 'letter-spacing: 0.30em');
  assert.notEqual(mutated, text, 'fixture must actually mutate');
  assert.ok(rulesHit(mutated, { rules: ['tracking-max'] }).includes('tracking-max'));
});

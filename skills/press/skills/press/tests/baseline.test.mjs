/**
 * The baseline eval — offline, deterministic, $0.
 *
 * Pinned against a real past state of the world: every brand value as it
 * actually existed, in eight files across four repos, before press generated
 * any of it. That snapshot is the migration's no-op proof. If a future token
 * edit silently changes a value that a shipped product depends on, this is what
 * goes red.
 *
 * Two-sided throughout: the real corpus must pass AND a mutated copy must fail.
 * Anti-vacuity floors throughout: a fixture that quietly shrank to nothing must
 * go red, not green.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { loadTokens } from '../lib/tokens.mjs';
import { emitBody } from '../lib/emit.mjs';
import { loadTargets } from '../lib/targets.mjs';

const HERE = dirname(new URL(import.meta.url).pathname);
const FIXTURES = join(HERE, 'fixtures');
const GOLDEN = join(FIXTURES, 'golden');
const REFRESH = 'node tests/fixtures/update-pre-migration.mjs';

const tokens = loadTokens();
const targets = loadTargets();
const frozen = JSON.parse(readFileSync(join(FIXTURES, 'pre-migration-values.json'), 'utf8'));
// Must match update-pre-migration.mjs: goldens pin emitter shape, not release.
const GOLDEN_VERSION = '0.0.0';
const manifest = JSON.parse(readFileSync(join(GOLDEN, 'manifest.json'), 'utf8'));

/** Every colour the brand knows, by value. */
const known = new Set(
  [...Object.values(tokens.colors), ...Object.values(tokens.terminal), tokens.derived.hair].map(
    (v) => v.toLowerCase(),
  ),
);

// --- anti-vacuity ---------------------------------------------------------

test('the frozen snapshot still covers every real source it claims to', () => {
  const sources = Object.keys(frozen.sources);
  assert.ok(
    sources.length >= frozen.min_sources,
    `only ${sources.length} sources, floor is ${frozen.min_sources} — the fixture shrank`,
  );
  for (const [id, source] of Object.entries(frozen.sources)) {
    assert.ok(Object.keys(source.values).length > 0, `${id} froze zero values`);
    assert.ok(source.path, `${id} has no path`);
    assert.ok(source.origin, `${id} does not say where it came from`);
  }
});

test('every golden is present and the golden set has not shrunk', () => {
  const files = readdirSync(GOLDEN).filter((f) => f.endsWith('.txt'));
  assert.ok(
    files.length >= manifest.min_targets,
    `${files.length} goldens, floor is ${manifest.min_targets} — refresh with: ${REFRESH}`,
  );
  for (const target of targets) {
    assert.ok(files.includes(`${target.id}.txt`), `no golden for ${target.id} — run: ${REFRESH}`);
  }
});

// --- the no-op proof ------------------------------------------------------

test('no brand value that existed before press has been dropped or changed', () => {
  const missing = [];
  for (const [id, source] of Object.entries(frozen.sources)) {
    for (const [name, value] of Object.entries(source.values)) {
      if (value.startsWith('rgba')) continue; // derived, checked below
      if (!known.has(value.toLowerCase())) missing.push(`${id}.${name} = ${value}`);
    }
  }
  assert.deepEqual(
    missing,
    [],
    'these values shipped in a real product and are no longer in tokens.json',
  );
});

test('that proof is live — a mutated token set fails it', () => {
  const mutated = new Set([...known]);
  mutated.delete(tokens.colors.accent.toLowerCase());
  const survivors = Object.values(frozen.sources).flatMap((s) =>
    Object.values(s.values).filter((v) => !v.startsWith('rgba') && !mutated.has(v.toLowerCase())),
  );
  assert.ok(survivors.length > 0, 'dropping the accent must be detected by the check above');
});

test('the derived hairline still matches what the résumé shipped', () => {
  assert.equal(frozen.sources['resume-theme'].values.hair, tokens.derived.hair);
});

test('the accent is one value everywhere, under five different names', () => {
  const aliases = ['accent', 'sig', 'press-sig'];
  const seen = new Set();
  for (const source of Object.values(frozen.sources)) {
    for (const alias of aliases) {
      if (source.values[alias]) seen.add(source.values[alias].toLowerCase());
    }
  }
  assert.ok(seen.size >= 1, 'no accent found in the snapshot');
  assert.deepEqual([...seen], [tokens.colors.accent.toLowerCase()], 'the accent forked');
});

// --- the renderer contract ------------------------------------------------

test('every target still emits exactly its golden bytes', () => {
  for (const target of targets) {
    const expected = readFileSync(join(GOLDEN, `${target.id}.txt`), 'utf8').replace(/\s+$/, '');
    const actual = emitBody(tokens, target.emitter, target.params ?? {}, { version: GOLDEN_VERSION })
      .replace(/\s+$/, '');
    assert.equal(actual, expected, `${target.id} drifted from its golden — refresh with: ${REFRESH}`);
  }
});

test('the golden comparison is live — a changed token breaks it', () => {
  const bent = structuredClone(tokens);
  bent.colors.paper = '#FFFFFF';
  const expected = readFileSync(join(GOLDEN, 'city-report.txt'), 'utf8').replace(/\s+$/, '');
  const actual = emitBody(bent, 'python-theme', targets.find((t) => t.id === 'city-report').params);
  assert.notEqual(actual.replace(/\s+$/, ''), expected);
});

/**
 * Per-consumer coverage: whatever a consumer shipped with, its own region must
 * still emit — with exactly one documented exception per target, because a
 * consumer may deliberately omit a value (devlog drops `rule`, which merely
 * duplicates ink). Anything omitted must be named here, so an accidental
 * omission cannot hide behind a general allowance.
 */
const OMISSIONS = {
  'devlog-palette': ['#181510'], // `rule`, identical to ink, listed once already
};

test('each emitted region still carries every value its own consumer shipped with', () => {
  let checked = 0;
  const gaps = [];
  for (const target of targets) {
    const source = frozen.sources[target.id];
    if (!source) continue;
    const body = emitBody(tokens, target.emitter, target.params ?? {}, { version: GOLDEN_VERSION });
    const allowed = OMISSIONS[target.id] ?? [];
    for (const [name, value] of Object.entries(source.values)) {
      checked += 1;
      if (body.includes(value)) continue;
      if (allowed.includes(value)) continue;
      gaps.push(`${target.id}.${name} = ${value}`);
    }
  }
  assert.ok(checked >= 30, `only ${checked} values compared — the corpus went hollow`);
  assert.deepEqual(gaps, [], 'a value a real consumer shipped with is no longer emitted to it');
});

test('that per-consumer coverage is live — dropping a var from a target fails it', () => {
  const target = targets.find((t) => t.id === 'resume-theme');
  const stripped = {
    ...target.params,
    vars: target.params.vars.filter((v) => v.token !== 'accent'),
  };
  const body = emitBody(tokens, 'css-vars', stripped);
  assert.ok(!body.includes(frozen.sources['resume-theme'].values.sig));
});

// --- the whole pipeline ---------------------------------------------------

test('the shipped tokens file is internally consistent', () => {
  assert.equal(tokens.derived.fillSteps.length, 3, 'the fill ramp is capped at three');
  for (const step of tokens.derived.fillSteps) assert.ok(known.has(step.toLowerCase()));
  assert.equal(tokens.colors.rule, tokens.colors.ink, 'rules are ink');
  assert.ok(tokens.limits.max_letter_spacing_em > 0);
  assert.match(tokens.marks.warn, /\u{FE0E}$/u, 'the warn mark must force text presentation');
});

test('every brand contract document referenced by the skill exists and is non-trivial', () => {
  for (const doc of ['laws', 'components', 'agent-ui', 'voice-core']) {
    const body = emitBody(tokens, 'markdown-block', { doc });
    assert.ok(body.length > 500, `${doc}.md is suspiciously short`);
  }
});

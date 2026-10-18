/**
 * Synthetic corpus boundary: reserved sender domains and reproducible generation.
 * This guard survives baseline refreshes. It does not import mailbox data or
 * enumerate personal names or organizations, and cannot establish provenance
 * of arbitrary prose; generator changes still require review.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE = join(HERE, '..', '..', 'evals', 'baseline');

const corpus = readdirSync(BASELINE)
  .filter((f) => /\.(json|txt)$/.test(f) && statSync(join(BASELINE, f)).isFile());

const RESERVED = /(\.example|\.invalid|\.test|\.localhost|example\.(com|net|org))$/;

test('the corpus is big enough that this test is worth running', () => {
  // Anti-vacuity. A corpus of zero files would pass every assertion below.
  assert.ok(corpus.length >= 12, `only ${corpus.length} corpus files found — the glob has stopped matching`);
  const threads = JSON.parse(readFileSync(join(BASELINE, 'threads.json'), 'utf8'));
  assert.ok(threads.length >= 50, `only ${threads.length} threads`);
});

test('every sender domain in the corpus uses a reserved name', () => {
  const offenders = [];
  for (const f of corpus) {
    const text = readFileSync(join(BASELINE, f), 'utf8');
    for (const m of text.matchAll(/[a-z0-9._%+-]+@([a-z0-9.-]+\.[a-z]{2,})/gi)) {
      // Table output truncates with "…", which yields a half-domain no
      // allow-list can match — and the character right after the match is not
      // reliably the ellipsis, because `[a-z]{2,}` backtracks past a one-letter
      // remnant (`…workable.e…` matches only `…workable`). So look at the whole
      // whitespace-delimited token and skip it if it was cut off. The full
      // string is asserted wherever it appears untruncated, which it always
      // does in the JSON fixtures.
      const token = /[^\s|]*/.exec(text.slice(m.index))[0];
      if (token.includes('…')) continue;
      const domain = m[1].toLowerCase().replace(/[.,;:)]+$/, '');
      if (!RESERVED.test(domain)) offenders.push(`${f}: ${domain}`);
    }
  }
  assert.deepEqual(offenders, [],
    'a real sender domain reached the corpus — regenerate it with `node evals/baseline/make-corpus.mjs`, never from a live mailbox');
});

test('the corpus is reproducible from the generator, byte for byte', () => {
  // The generator is the source of truth. If a fixture can be edited by hand
  // without this failing, then "the corpus is generated" is a claim rather
  // than a fact — and hand-edited fixtures are how real data gets back in.
  const before = Object.fromEntries(corpus
    .filter((f) => GENERATED.has(f))
    .map((f) => [f, readFileSync(join(BASELINE, f), 'utf8')]));
  assert.ok(Object.keys(before).length >= 12, 'the generated-file list has drifted from what make-corpus writes');

  execFileSync('node', [join(BASELINE, 'make-corpus.mjs')], { cwd: join(HERE, '..', '..') });
  for (const [f, text] of Object.entries(before)) {
    assert.equal(readFileSync(join(BASELINE, f), 'utf8'), text,
      `${f} differs from what make-corpus.mjs produces — it was hand-edited. Change the generator instead.`);
  }
});

const GENERATED = new Set([
  'threads.json', 'labels.json', 'rules.json',
  'filed.json', 'filed-after.json', 'filed-labels.json', 'rules-recruiting.json',
  'mailbox-before.json', 'mailbox-before-labels.json', 'mailbox-before-rules.json',
  'mailbox-after.json', 'mailbox-after-labels.json', 'mailbox-after-rules.json',
  'raw-inbox.json', 'raw-nolabel.json', 'raw-promos.json', 'raw-updates.json',
  'raw-labels.json', 'raw-inbox-metadata.json',
]);

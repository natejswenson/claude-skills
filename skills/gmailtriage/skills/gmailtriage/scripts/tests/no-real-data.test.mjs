/**
 * The corpus must contain nothing real.
 *
 * Deliberately its own file. `skillfactory freeze` rewrites baseline.test.mjs,
 * so a guard written there is deleted on the next refresh — and this is the one
 * guard that must survive every refresh, because the way it fails is somebody
 * regenerating fixtures from a live mailbox and committing them.
 *
 * Redaction used to be the answer here and it was the wrong tool. Pseudonymised
 * senders still left the SHAPE of a person's life in a public repo: which bank,
 * which health system, which school district, which employer they had applied
 * to. The corpus is now invented outright (`evals/baseline/make-corpus.mjs`),
 * and this file is what keeps it that way.
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

/**
 * RFC 2606 / 6761 reserved names, which can never be registered by anyone.
 *
 * `.gov` is allowed as a bare TLD for the one fixture that has to trip the
 * governmental guard — there is no reserved equivalent — and the domain in
 * front of it is fictional.
 */
const RESERVED = /(\.example|\.invalid|\.test|\.localhost|example\.(com|net|org)|\.gov)$/;

test('the corpus is big enough that this test is worth running', () => {
  // Anti-vacuity. A corpus of zero files would pass every assertion below.
  assert.ok(corpus.length >= 12, `only ${corpus.length} corpus files found — the glob has stopped matching`);
  const threads = JSON.parse(readFileSync(join(BASELINE, 'threads.json'), 'utf8'));
  assert.ok(threads.length >= 50, `only ${threads.length} threads`);
});

test('every sender domain in the corpus is a reserved, unregisterable name', () => {
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

// A hardcoded list of banned organisation names used to live here. It is gone,
// and its absence is the point: the only way to write that test was to spell
// out, in a public repo, every organisation the mailbox owner deals with — the
// exact disclosure the corpus was being cleaned of.
//
// The two checks that remain are stronger anyway. A real identifier can only
// enter a generated fixture as a sender domain (caught above, against a list of
// TLDs nobody can register) or by hand-editing one (caught below, by
// regenerating and byte-comparing). There is no third route.

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

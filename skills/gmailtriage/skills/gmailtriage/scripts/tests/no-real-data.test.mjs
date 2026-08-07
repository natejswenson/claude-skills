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

test('no real organisation the mailbox owner deals with is named', () => {
  // Belt and braces over the domain check: a folder name, a rule note or a
  // subject line can name an organisation without ever forming an address.
  // These are the names that were actually in this corpus before 0.4.0.
  const BANNED = [
    'uhg', 'unitedhealth', 'onecall', 'panorama', 'sanford', 'wellsfargo', 'fidelity',
    'parentvendor', 'hawley', 'npmjs', 'leadgen', 'packtpub', 'goodreads', 'typefully',
    'glassdoor', 'tractive', 'hydrawise', 'audible', 'anthropic', 'stewardship',
    'visionrealty', 'authentisign', 'geico', 'afics', 'swenson', 'natejswenson',
  ];
  const offenders = [];
  for (const f of corpus) {
    const text = readFileSync(join(BASELINE, f), 'utf8').toLowerCase();
    for (const b of BANNED) if (text.includes(b)) offenders.push(`${f}: ${b}`);
  }
  assert.deepEqual(offenders, [],
    'a real organisation is named in the corpus — the fixtures must be generated, not redacted from a mailbox');
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
]);

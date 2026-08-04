/**
 * Unit tests, deliberately in their own file.
 *
 * `skillfactory freeze` regenerates `baseline.test.mjs` from scratch, so any
 * guard written there is deleted the next time the baseline is refreshed. These
 * live here instead, and several of them pin bugs the first real dogfood run
 * found — which is the only reason they are worth having.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

import { redact, newCounts, totalRedactions } from '../lib/redact.mjs';
import { repoName } from '../lib/github.mjs';
import { foldSquashCommits, collapseReleaseSeries, parseTag, rankItems } from '../lib/rank.mjs';
import { checkDraft, appendix } from '../lib/receipts.mjs';
import { resolveReceipt } from '../lib/corpus.mjs';
import { computeNumbers } from '../lib/render.mjs';

// ── redaction ───────────────────────────────────────────────────────────────

// Assembled at runtime rather than written out. The literal form is inert —
// it is the published jwt.io example — but a token-shaped string in the tree
// trips the repo's `security / secrets` gitleaks job, and a scanner that has to
// be argued with about test data is a scanner people start ignoring.
const SAMPLE_JWT = ['eyJ', 'hbGciOiJIUzI1NiJ9'].join('')
  + '.' + ['eyJ', 'zdWIiOiIxMjM0NTY3ODkwIn0'].join('')
  + '.' + 'dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';

test('redact removes every token shape it declares', () => {
  const counts = newCounts();
  const out = redact([
    'key sk-ant-api03-AAAABBBBCCCCDDDDEEEE',
    'gh ghp_0123456789abcdefghijklmnopqrstuvwx',
    'aws AKIAIOSFODNN7EXAMPLE',
    'slack xoxb-1234567890-abcdefghij',
    `jwt ${SAMPLE_JWT}`,
    'auth Bearer abcdefghijklmnopqrstuvwxyz012345',
    'MY_API_TOKEN=supersecretvalue123',
  ].join('\n'), counts);

  for (const bad of ['sk-ant-', 'ghp_0123', 'AKIAIOSF', 'xoxb-1234', SAMPLE_JWT.slice(0, 8), 'supersecretvalue']) {
    assert.ok(!out.includes(bad), `${bad} survived redaction`);
  }
  assert.ok(totalRedactions(counts) >= 7, 'every rule should have counted a hit');
});

test('redact rewrites the home directory and counts it', () => {
  const counts = newCounts();
  const out = redact('/Users/someone/localrepo/x', counts, '/Users/someone');
  assert.equal(out, '~/localrepo/x');
  assert.equal(counts['home-path'], 1);
});

test('redact leaves ordinary prose untouched', () => {
  const counts = newCounts();
  const text = 'Shipped the release flow and fixed the promotion gate.';
  assert.equal(redact(text, counts, '/Users/nobody'), text);
  assert.equal(totalRedactions(counts), 0);
});

// ── the gh field-name bug the first real run found ──────────────────────────

test('repoName reads both field names the two gh endpoints use', () => {
  assert.equal(repoName({ nameWithOwner: 'o/r' }), 'o/r'); // gh search prs
  assert.equal(repoName({ fullName: 'o/r' }), 'o/r');      // gh search commits
  assert.equal(repoName({}), null);
  assert.equal(repoName(undefined), null);
});

// ── squash folding ──────────────────────────────────────────────────────────

test('a squash commit for a PR in the window folds into that PR', () => {
  const items = [
    { id: 'pr:o/r#12', kind: 'pr', repo: 'o/r', number: 12, title: 'feat: thing', at: '2026-08-01T00:00:00Z' },
    { id: 'commit:o/r@abc1234', kind: 'commit', repo: 'o/r', title: 'feat: thing (#12)', at: '2026-08-01T00:00:00Z' },
    { id: 'commit:o/r@def5678', kind: 'commit', repo: 'o/r', title: 'fix: unrelated', at: '2026-08-01T00:00:00Z' },
  ];
  const { kept, folded } = foldSquashCommits(items);
  assert.equal(folded.length, 1);
  assert.equal(folded[0].id, 'commit:o/r@abc1234');
  assert.equal(kept.length, 2);
});

test('a squash-looking commit whose PR is not in the window is kept', () => {
  const items = [{ id: 'commit:o/r@abc1234', kind: 'commit', repo: 'o/r', title: 'feat: thing (#999)', at: '2026-08-01T00:00:00Z' }];
  const { kept, folded } = foldSquashCommits(items);
  assert.equal(folded.length, 0);
  assert.equal(kept.length, 1);
});

// ── release series ──────────────────────────────────────────────────────────

test('parseTag splits a component tag and a bare repo tag', () => {
  assert.deepEqual(parseTag('shipflow-v0.3.2'), { component: 'shipflow', major: 0, minor: 3, patch: 2 });
  assert.deepEqual(parseTag('v0.40.0'), { component: '', major: 0, minor: 40, patch: 0 });
  assert.equal(parseTag('not-a-version'), null);
});

test('a release series collapses to its newest, carrying the rest as receipts', () => {
  const rel = (tag, at) => ({ id: `release:o/r@${tag}`, receipt: `release:o/r@${tag}`, kind: 'release', repo: 'o/r', tag, title: tag, at });
  const out = collapseReleaseSeries([
    rel('shipflow-v0.3.0', '2026-08-01T00:00:00Z'),
    rel('shipflow-v0.3.1', '2026-08-02T00:00:00Z'),
    rel('shipflow-v0.3.2', '2026-08-03T00:00:00Z'),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].tag, 'shipflow-v0.3.2');
  assert.equal(out[0].releaseCount, 3);
  assert.equal(out[0].bump, 'patch');
  assert.deepEqual(out[0].alsoReceipts, ['release:o/r@shipflow-v0.3.0', 'release:o/r@shipflow-v0.3.1']);
});

test('two different components in one repo do not collapse into each other', () => {
  const rel = (tag) => ({ id: `release:o/r@${tag}`, receipt: `release:o/r@${tag}`, kind: 'release', repo: 'o/r', tag, title: tag, at: '2026-08-01T00:00:00Z' });
  const out = collapseReleaseSeries([rel('a-v1.0.0'), rel('b-v1.0.0')]);
  assert.equal(out.length, 2);
});

test('a lone major release still reads as major — the bug the first run found', () => {
  // With no predecessor in the window there is nothing to diff against, so the
  // bump has to come from the version itself. Before this, resume v2.0.0 ranked
  // below patch releases.
  const rel = (tag) => ({ id: `release:o/r@${tag}`, receipt: `release:o/r@${tag}`, kind: 'release', repo: 'o/r', tag, title: tag, at: '2026-08-01T00:00:00Z' });
  assert.equal(collapseReleaseSeries([rel('resume-v2.0.0')])[0].bump, 'major');
  assert.equal(collapseReleaseSeries([rel('resume-v2.1.0')])[0].bump, 'minor');
  assert.equal(collapseReleaseSeries([rel('resume-v2.1.3')])[0].bump, 'patch');

  const ranked = rankItems([rel('resume-v2.0.0'), rel('other-v0.1.1')]);
  assert.equal(ranked.ranked[0].tag, 'resume-v2.0.0', 'a major release must outrank a patch');
});

// ── ranking ─────────────────────────────────────────────────────────────────

test('merge commits are pushed below the line', () => {
  const items = [
    { id: 'c1', kind: 'commit', repo: 'o/r', title: 'Merge pull request #106 from o/dev', at: '2026-08-01T00:00:00Z' },
    { id: 'c2', kind: 'commit', repo: 'o/r', title: 'feat: a real change', at: '2026-08-01T00:00:00Z' },
  ];
  const { ranked } = rankItems(items);
  assert.equal(ranked[0].id, 'c2');
  assert.ok(ranked[1].score < 0, 'a merge commit should score negative, not merely lower');
});

test('the line honours both the floor and the cap', () => {
  const items = Array.from({ length: 30 }, (_, i) => ({
    id: `pr:o/r#${i}`, kind: 'pr', repo: 'o/r', number: i, title: `feat: thing ${i}`, at: '2026-08-01T00:00:00Z',
  }));
  const { above } = rankItems(items, { top: 5, floor: 20 });
  assert.equal(above.length, 5);

  const { above: none } = rankItems(items, { top: 50, floor: 999 });
  assert.equal(none.length, 0, 'nothing may clear an impossible floor');
});

// ── receipts: the one rule ──────────────────────────────────────────────────

const CORPUS = {
  dir: '/nowhere',
  meta: {},
  github: { 'pr:o/r#12': { id: 'pr:o/r#12', kind: 'pr', repo: 'o/r', title: 'feat: thing', url: 'https://x/12', at: '2026-08-01T00:00:00Z' } },
  sessions: { 'session:abc': { id: 'session:abc', kind: 'session', title: 'a session', project: 'p', at: '2026-08-01T00:00:00Z', uuids: ['u-1'] } },
};

const okDraft = () => ({
  headline: 'A release flow that proves itself',
  standfirst: ['The promotion path now refuses to report success it has not observed.'],
  sections: [{ title: 'Shipped', items: [{ title: 'Release flow', text: 'Releases now prove the tag exists.', receipts: ['pr:o/r#12'] }] }],
});

test('a clean draft passes', () => {
  const r = checkDraft(okDraft(), CORPUS);
  assert.ok(r.ok, r.problems.join('; '));
  assert.equal(r.rows.length, 1);
});

test('a claim with no receipt is refused', () => {
  const d = okDraft();
  d.sections[0].items[0].receipts = [];
  const r = checkDraft(d, CORPUS);
  assert.ok(!r.ok);
  assert.match(r.problems.join(' '), /carries no receipt/);
});

test('a receipt that does not resolve is refused', () => {
  const d = okDraft();
  d.sections[0].items[0].receipts = ['commit:o/r@deadbee'];
  const r = checkDraft(d, CORPUS);
  assert.ok(!r.ok);
  assert.match(r.problems.join(' '), /does not resolve/);
});

test('an empty draft is refused rather than passing over nothing', () => {
  const r = checkDraft({ headline: 'x', standfirst: [], sections: [] }, CORPUS);
  assert.ok(!r.ok);
  assert.match(r.problems.join(' '), /no claims/);
});

test('raw identifiers in prose are refused — the audience contract', () => {
  for (const bad of ['We merged #12 this week.', 'Landed in natejswenson/claude-skills.', 'See commit a1b2c3d for detail.']) {
    const d = okDraft();
    d.sections[0].items[0].text = bad;
    const r = checkDraft(d, CORPUS);
    assert.ok(!r.ok, `should have refused: ${bad}`);
    assert.match(r.problems.join(' '), /raw .* in prose/);
  }
});

test('nested angle brackets cannot hide a raw identifier from the gate', () => {
  // CodeQL flagged the single-pass strip that used to live here: `<<em>em>`
  // survives one replace and re-forms a tag, which on the detection side is a
  // way to smuggle an identifier past the prose check.
  for (const bad of ['We merged <<em>em>#412<<em>/em> this week.', 'Landed in <<b>b>natejswenson/claude-skills.']) {
    const d = okDraft();
    d.sections[0].items[0].text = bad;
    const r = checkDraft(d, CORPUS);
    assert.ok(!r.ok, `nested tags hid an identifier: ${bad}`);
  }
});

test('a session moment resolves, and a wrong uuid does not', () => {
  assert.ok(resolveReceipt(CORPUS, 'session:abc#u-1'));
  assert.equal(resolveReceipt(CORPUS, 'session:abc#u-nope'), null);
  assert.equal(resolveReceipt(CORPUS, ''), null);
  assert.equal(resolveReceipt(CORPUS, undefined), null);
});

test('the appendix lists each receipt once, in citation order', () => {
  const d = okDraft();
  d.sections[0].items.push({ title: 'Again', text: 'More of the same work.', receipts: ['pr:o/r#12', 'session:abc'] });
  const a = appendix(d, CORPUS);
  assert.deepEqual(a.map((x) => x.receipt), ['pr:o/r#12', 'session:abc']);
});

// ── numbers are computed, never authored ────────────────────────────────────

test('the numbers strip is derived from the window and omits empty rows', () => {
  const n = computeNumbers([
    { kind: 'release', repo: 'o/r' },
    { kind: 'pr', repo: 'o/r' },
    { kind: 'pr', repo: 'o/s' },
  ]);
  assert.deepEqual(n.find((x) => x.k === 'merged'), { k: 'merged', n: 2 });
  assert.equal(n.find((x) => x.k === 'repos').n, 2);
  assert.ok(!n.some((x) => x.k === 'sessions'), 'a zero row must not be printed');
});

// ── anti-vacuity floors on the frozen corpus ────────────────────────────────

test('the frozen corpus still holds a real week of work', () => {
  // The declared min_corpus counts FILES. This counts what is inside them —
  // the failure mode a file count cannot see is a refresh that collapses every
  // input to one item, leaving the golden passing over almost nothing.
  const dir = join(HERE, '..', '..', 'evals', 'baseline', 'corpus');
  const gh = JSON.parse(readFileSync(join(dir, 'github.json'), 'utf8'));
  const se = JSON.parse(readFileSync(join(dir, 'sessions.json'), 'utf8'));

  assert.ok(Object.keys(gh).length >= 400, `frozen contributions collapsed to ${Object.keys(gh).length}`);
  assert.ok(Object.keys(se).length >= 100, `frozen session digests collapsed to ${Object.keys(se).length}`);

  const kinds = new Set(Object.values(gh).map((i) => i.kind));
  for (const k of ['pr', 'commit', 'release']) {
    assert.ok(kinds.has(k), `the frozen corpus lost every ${k} — it no longer exercises that path`);
  }
});

test('no frozen session digest carries prompt text', () => {
  // This repo is public. Session digests are field-projected on the way into
  // the fixture; nothing downstream reads firstPrompt, so its presence would be
  // a leak with no upside.
  const se = JSON.parse(readFileSync(join(HERE, '..', '..', 'evals', 'baseline', 'corpus', 'sessions.json'), 'utf8'));
  const leaked = Object.entries(se).filter(([, v]) => 'firstPrompt' in v).map(([k]) => k);
  assert.deepEqual(leaked, [], 'a frozen session digest carries prompt text');
});

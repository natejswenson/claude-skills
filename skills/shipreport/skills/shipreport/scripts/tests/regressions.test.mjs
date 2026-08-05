/**
 * Regressions found by grading a real run — session `cd77fae8`, 2026-08-05.
 *
 * These live in their own file on purpose. `skillfactory freeze` regenerates
 * `baseline.test.mjs` from the frozen manifest, so a hand-written guard placed
 * there is deleted the next time the baseline is refreshed.
 *
 * Every check is two-sided. A gate asserted only in the direction it should
 * refuse goes green the day someone weakens it; a gate asserted only in the
 * direction it should accept is how a false positive survives.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { validateArt, ArtProblem } from '../lib/art.mjs';
import { checkDraft, isRepoSlug, statedCounts } from '../lib/receipts.mjs';
import { rankItems, scopeOf, tieAtTheLine } from '../lib/rank.mjs';
import { redactDeep } from '../lib/redact.mjs';
import { excerpt, RELEASE_BODY_MAX } from '../lib/github.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = join(HERE, '..', '..');

// ── the art validator is the whole boundary ─────────────────────────────────
// `render` splices `art` in unescaped, because art is markup by definition, and
// the sheet is opened in a browser from file:// on its own. Everything this
// validator lets through reaches that page.

const scene = (inner, attrs = '') => `<svg viewBox="0 0 320 130" fill="none" stroke="currentColor"${attrs}>`
  + '<path d="M10 10 L90 10"/><line x1="10" y1="30" x2="90" y2="30"/>'
  + '<rect x="10" y="50" width="80" height="20"/><circle cx="150" cy="60" r="12"/>'
  + '<polyline points="200,20 240,60 280,20"/>'
  + `${inner}</svg>`;

test('a clean scene is still accepted — the validator did not simply get stricter', () => {
  const ok = validateArt(scene(''), 'good');
  assert.equal(ok.primitives, 5);
});

test('an SVG <style> is refused — inline SVG styles are document-scoped', () => {
  // The worst of the bypasses: a <style> inside inline SVG is NOT scoped to that
  // SVG, so one card could restyle the entire sheet — the accent law defeated by
  // the file that exists to enforce it.
  assert.throws(
    () => validateArt(scene('<style>* { stroke: #ff6600 }</style>'), 'styled'),
    ArtProblem,
  );
});

test('a colour hidden in a style attribute is refused, like one in a fill attribute', () => {
  // COLOUR_LITERAL reads presentation *attributes*, so `style="fill:#f60"` walked
  // straight past it — a brand value written down in a second place.
  assert.throws(() => validateArt(scene('<rect x="1" y="1" width="4" height="4" style="fill:#f60"/>'), 'a'), ArtProblem);
  assert.throws(() => validateArt(scene('<rect x="1" y="1" width="4" height="4" fill="#f60"/>'), 'b'), ArtProblem);
  // …but `style` carrying only geometry or opacity is not a colour.
  assert.doesNotThrow(() => validateArt(scene('<rect x="1" y="1" width="4" height="4" style="opacity:0.5"/>'), 'c'));
});

test('script-bearing and off-page constructs are refused', () => {
  const bad = [
    ['<a href="javascript:alert(1)"><text x="5" y="5">x</text></a>', 'javascript: link'],
    ['<a xlink:href="javascript:alert(1)"><text x="5" y="5">x</text></a>', 'xlink javascript: link'],
    ['<animate attributeName="x" to="99"/>', 'animation'],
    ['<set attributeName="href" to="javascript:alert(1)"/>', 'set'],
    ['<use href="//evil.example/x.svg"/>', 'protocol-relative use'],
    ['<use xlink:href="https://evil.example/x.svg"/>', 'xlink external use'],
    ['<use href="data:image/svg+xml;base64,AAAA"/>', 'data: use'],
    ['<script>alert(1)</script>', 'script'],
    ['<image href="http://evil.example/x.png"/>', 'raster'],
    ['<rect x="1" y="1" width="4" height="4" onload="alert(1)"/>', 'event handler'],
  ];
  for (const [inner, what] of bad) {
    assert.throws(() => validateArt(scene(inner), what), ArtProblem, `not refused: ${what}`);
  }
});

test('a same-document <use> and a plain fragment link are still allowed', () => {
  // Two-sided: the guard names external references, not every href.
  assert.doesNotThrow(() => validateArt(scene('<use href="#tick"/>'), 'fragment'));
});

// ── the prose gate must refuse identifiers, not English ─────────────────────

const CORPUS = {
  meta: { login: 'natejswenson' },
  github: {
    'pr:natejswenson/claude-skills#1': {
      id: 'pr:natejswenson/claude-skills#1', kind: 'pr', repo: 'natejswenson/claude-skills',
      title: 'feat(press): x', at: '2026-08-01T00:00:00Z', url: 'https://example.invalid/1',
    },
  },
  sessions: {},
};

const draftWith = (text) => ({
  headline: 'A headline',
  standfirst: ['A paragraph.'],
  sections: [{ title: 'Shipped', items: [{ title: 'An outcome', text, receipts: ['pr:natejswenson/claude-skills#1'] }] }],
});

test('ordinary prose is not mistaken for a raw identifier', () => {
  // The first real run was told the phrase "plus/minus" was a raw repo-slug and
  // reworded a true sentence to satisfy it — the exact inversion of "fix the
  // draft, never the checker". A false positive teaches a run that the gate is
  // an obstacle to be worded around, which is how a gate stops being believed.
  const fine = [
    'the sub-band modifier applied to plus/minus of the graded rows',
    'CI/CD stayed green throughout',
    'a read/write split, and an input/output boundary',
    '24/7 monitoring survived 1234567 requests',
    'it effaced the defaced templates',
    'rank agreement with the old rubric held at 9/10',
  ];
  for (const text of fine) {
    const r = checkDraft(draftWith(text), CORPUS);
    assert.ok(r.ok, `refused ordinary prose: ${text} → ${r.problems.join('; ')}`);
    assert.equal(r.proseProblems, 0);
  }
});

test('real identifiers are still refused — the audience contract holds', () => {
  const bad = [
    'Landed in natejswenson/claude-skills last week.',
    'We merged #412 this week.',
    'See commit a1b2c3d for the detail.',
    'Cited as pr:natejswenson/claude-skills#412.',
    // Nested tags re-form a tag after one strip pass; the identifier must not
    // survive that. This case used to be caught only by a repo-slug FALSE
    // POSITIVE on "412/em" — a test passing for the wrong reason.
    'We merged <<em>em>#412<<em>/em> this week.',
    'Landed in <<b>b>natejswenson/claude-skills.',
  ];
  for (const text of bad) {
    const r = checkDraft(draftWith(text), CORPUS);
    assert.ok(!r.ok, `let a raw identifier through: ${text}`);
    assert.ok(r.proseProblems >= 1, `prose problems not counted for: ${text}`);
  }
});

test('a repo slug is recognised by shape even when the corpus has never seen it', () => {
  // Corpus membership is the strongest evidence but cannot be the only test, or
  // a slug for a repo never indexed would read as prose.
  assert.equal(isRepoSlug('someone/their-repo', CORPUS), true);
  assert.equal(isRepoSlug('natejswenson/anything', CORPUS), true, 'known owner');
  assert.equal(isRepoSlug('plus/minus', CORPUS), false);
  assert.equal(isRepoSlug('24/7', CORPUS), false);
});

test('the verdict distinguishes an unresolved receipt from a prose violation', () => {
  // The run printed `Unresolved: 0` beside `Verdict: REFUSED` and the table
  // could not explain itself.
  const prose = checkDraft(draftWith('Landed in natejswenson/claude-skills.'), CORPUS);
  assert.equal(prose.proseProblems, 1);
  assert.equal(prose.rows.filter((r) => r[2] === 'NO').length, 0);

  const unresolved = draftWith('Plain prose.');
  unresolved.sections[0].items[0].receipts = ['commit:natejswenson/claude-skills@deadbee'];
  const r = checkDraft(unresolved, CORPUS);
  assert.equal(r.proseProblems, 0);
  assert.equal(r.rows.filter((x) => x[2] === 'NO').length, 1);
});

// ── a hand-written count never reaches the sheet ────────────────────────────
// The second graded run (2026-08-05) put "Eleven components shipped, two of them
// brand new" in the standfirst. The strip printed 16 released an inch below it,
// 15 releases were cited, and 3 were first releases. Every number wrong, with
// the correct ones rendered adjacent — drift arriving as a quantity rather than
// as a verb, which is the one failure mode the receipts gate did not cover.

const NUMBERS = [{ k: 'released', n: 16 }, { k: 'merged', n: 142 }, { k: 'sessions', n: 148 }];
const draftSaying = (headline, standfirst, text = 'Plain prose.') => ({
  headline,
  standfirst,
  sections: [{ title: 'Shipped', items: [{ title: 'An outcome', text, receipts: ['pr:natejswenson/claude-skills#1'] }] }],
});

test('a count of shipped things in the standfirst is refused', () => {
  const r = checkDraft(draftSaying('A week of work', ['Eleven components shipped, two of them brand new.']), CORPUS, NUMBERS);
  assert.ok(!r.ok, 'the exact prose that reached a real sheet was allowed through');
  assert.match(r.problems.join(' '), /writes a count the strip already computes \(16 released\)/);
});

test('a count is refused even when it happens to be right', () => {
  // The rule is "do not write numbers", not "write them correctly". A count
  // that is right today is still the figure written down in a second place,
  // which is how the strip and the prose drift apart tomorrow.
  const r = checkDraft(draftSaying('A week of work', ['Sixteen releases went out.']), CORPUS, NUMBERS);
  assert.ok(!r.ok);
});

test('numbers that belong to the artifact are not counts of the window', () => {
  // Two-sided, and this is the half that matters: item prose quotes measured
  // facts constantly, and flagging those would be the "plus/minus" false
  // positive all over again.
  const fine = [
    draftSaying('A week spent making the tools prove things', ['The thread is correction, not volume.']),
    draftSaying('A week of work', ['Measured over 240 real cards spanning 730 days.']),
    draftSaying('A week of work', ['Run against forty-seven transcripts, wrong on six of six.']),
    // The same shape as the refused case, but inside an item — a fact about the
    // past of one component, not a count of this window.
    draftSaying('A week of work', ['A rubric gained precision.'], 'Ten components carried ten hand-written front pages.'),
  ];
  for (const d of fine) {
    const r = checkDraft(d, CORPUS, NUMBERS);
    assert.ok(r.ok, `refused legitimate prose: ${JSON.stringify(d.standfirst)} / ${d.sections[0].items[0].text} → ${r.problems.join('; ')}`);
  }
});

test('the count scanner reads both digits and words, and maps them to a figure', () => {
  const found = statedCounts(draftSaying('A week', ['142 pull requests merged and eleven skills shipped.']));
  assert.deepEqual(found.map((c) => c.key).sort(), ['merged', 'released']);
  assert.equal(statedCounts(draftSaying('A week', ['Nothing countable here.'])).length, 0);
});

// ── the ranking has to actually rank ────────────────────────────────────────

const release = (tag, at, extra = {}) => ({
  id: `release:o/r@${tag}`, receipt: `release:o/r@${tag}`, kind: 'release',
  tag, repo: 'o/r', title: tag, at, ...extra,
});
const pr = (n, title, at) => ({
  id: `pr:o/r#${n}`, receipt: `pr:o/r#${n}`, kind: 'pr', number: n, repo: 'o/r', title, at,
});

test('two minor releases with different backing no longer score the same', () => {
  // The defect exactly: twelve items at `release+50 minor+10 corroborated+10`
  // and nothing else, so the line was drawn by a timestamp.
  const items = [
    release('alpha-v0.2.0', '2026-08-01T00:00:00Z'),
    release('beta-v0.2.0', '2026-08-01T00:00:00Z'),
    ...Array.from({ length: 12 }, (_, i) => pr(i + 1, `feat(alpha): thing ${i}`, '2026-08-01T00:00:00Z')),
    pr(99, 'feat(beta): one thing', '2026-08-01T00:00:00Z'),
  ];
  const { ranked } = rankItems(items, { owners: new Set(['o']) });
  const alpha = ranked.find((i) => i.tag === 'alpha-v0.2.0');
  const beta = ranked.find((i) => i.tag === 'beta-v0.2.0');
  assert.ok(alpha.score > beta.score, `backing did not separate them: ${alpha.score} vs ${beta.score}`);
  assert.match(alpha.signals.join(' '), /backed×12\+16/);
  assert.match(beta.signals.join(' '), /backed×1\+4/);
});

test('backing is scoped to the component, so a monorepo does not credit everyone', () => {
  const items = [
    release('alpha-v0.2.0', '2026-08-01T00:00:00Z'),
    ...Array.from({ length: 8 }, (_, i) => pr(i + 1, `feat(beta): not alpha ${i}`, '2026-08-01T00:00:00Z')),
  ];
  const { ranked } = rankItems(items, { owners: new Set(['o']) });
  const alpha = ranked.find((i) => i.tag === 'alpha-v0.2.0');
  assert.ok(!alpha.signals.join(' ').includes('backed'), 'alpha claimed beta\'s work');
});

test('a first release outranks a routine minor of the same shape', () => {
  const history = [release('old-v0.1.0', '2025-01-01T00:00:00Z'), release('old-v0.2.0', '2025-06-01T00:00:00Z')];
  const items = [release('new-v0.1.0', '2026-08-01T00:00:00Z'), release('old-v0.3.0', '2026-08-01T00:00:00Z')];
  const { ranked } = rankItems(items, { owners: new Set(['o']), history: [...history, ...items] });
  const fresh = ranked.find((i) => i.tag === 'new-v0.1.0');
  const routine = ranked.find((i) => i.tag === 'old-v0.3.0');
  assert.match(fresh.signals.join(' '), /first\+12/);
  assert.ok(!routine.signals.join(' ').includes('first+'), 'a fourth minor was called a first release');
  assert.ok(fresh.score > routine.score);
});

test('a longer changelog outranks a one-liner', () => {
  const items = [
    release('a-v0.2.0', '2026-08-01T00:00:00Z', { body: 'x'.repeat(3000) }),
    release('b-v0.2.0', '2026-08-01T00:00:00Z', { body: 'Fixed a typo.' }),
  ];
  const { ranked } = rankItems(items, { owners: new Set(['o']) });
  assert.ok(ranked[0].tag === 'a-v0.2.0', 'the substantial release did not win');
  assert.match(ranked[0].signals.join(' '), /notes\+9/);
});

test('session magnitude keeps climbing instead of topping out', () => {
  // Every session in the real window scored exactly 32, because `edits >= 20`
  // and `turns >= 60` stop discriminating the moment everything clears them.
  const session = (id, edits, turns) => ({
    id: `session:${id}`, receipt: `session:${id}`, kind: 'session', sessionId: id,
    at: '2026-08-01T00:00:00Z', project: 'p', title: id, edits,
    assistantTurns: turns, userTurns: 20, skills: [], tools: {},
  });
  const items = [session('small', 20, 60), session('big', 150, 400)];
  const { ranked } = rankItems(items, { owners: new Set(['o']) });
  const small = ranked.find((i) => i.sessionId === 'small');
  const big = ranked.find((i) => i.sessionId === 'big');
  assert.ok(big.score > small.score, `sessions still tie: ${big.score} vs ${small.score}`);
  // And no duration signal, which measured wall-clock span rather than work.
  assert.ok(!ranked.some((i) => i.signals.join(' ').includes('min+')), 'the duration signal came back');
});

test('the tie at the line is reported, and only when there is one', () => {
  const tied = [
    { score: 10, above: true }, { score: 10, above: true }, { score: 10, above: false },
  ];
  const t = tieAtTheLine(tied, tied.filter((i) => i.above));
  assert.deepEqual(t, { score: 10, count: 3, included: 2, excluded: 1 });

  const clean = [{ score: 20, above: true }, { score: 10, above: false }];
  assert.equal(tieAtTheLine(clean, clean.filter((i) => i.above)), null);
  // Anti-vacuity: an all-above ranking has no line to be tied at.
  assert.equal(tieAtTheLine(clean, clean), null);
});

test('the conventional-commit scope is read, and a bare subject has none', () => {
  assert.equal(scopeOf('feat(shipreport): a thing (#187)'), 'shipreport');
  assert.equal(scopeOf('fix(press)!: a thing'), 'press');
  assert.equal(scopeOf('feat: no scope here'), null);
  assert.equal(scopeOf('just a subject line'), null);
});

// ── redaction covers both halves of the corpus ──────────────────────────────

test('a secret in a GitHub body never reaches the corpus', () => {
  // Session digests went through redaction from the start and GitHub items did
  // not — safe only while nothing but a title was cached. Bodies are arbitrary
  // prose, and a token pasted into a changelog is a token written to disk.
  const items = [{
    id: 'release:o/r@v1.0.0', kind: 'release', repo: 'o/r', tag: 'v1.0.0',
    title: 'v1.0.0',
    body: 'Set GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789 and email nate@example.com',
  }];
  const counts = {};
  const out = redactDeep(items, counts, '/Users/someone');
  const body = out[0].body;
  assert.ok(!body.includes('ghp_abcdefghijklmnopqrstuvwxyz0123456789'), 'a token reached the corpus');
  assert.ok(!body.includes('nate@example.com'), 'an address reached the corpus');
  assert.ok(Object.keys(counts).length >= 1, 'redaction ran but counted nothing');
  // Two-sided: redaction must not eat the prose around the secret.
  assert.match(body, /Set GITHUB_TOKEN=/);
});

test('index redacts GitHub items, not only sessions', () => {
  // The wiring, not just the function: a redactor that is never called is a
  // redactor that does nothing.
  const src = readFileSync(join(SKILL, 'scripts', 'shipreport.js'), 'utf8');
  assert.match(src, /mergeItems\(corpus\.github, redactDeep\(/,
    'GitHub items are merged into the corpus without passing through redaction');
});

// ── bodies are cached, and bounded ──────────────────────────────────────────

test('a cached body is excerpted rather than stored whole', () => {
  const long = 'y'.repeat(RELEASE_BODY_MAX + 5000);
  const cut = excerpt(long, RELEASE_BODY_MAX);
  assert.ok(cut.length < long.length, 'a body was cached in full');
  assert.match(cut, /more characters not cached/, 'truncation was silent');
  // Two-sided: a short body is untouched, not padded or marked.
  assert.equal(excerpt('Fixed a typo.', RELEASE_BODY_MAX), 'Fixed a typo.');
  assert.equal(excerpt(null, RELEASE_BODY_MAX), '');
});

test('show shares one total budget instead of multiplying per receipt', () => {
  // `--chars` alone multiplied: six receipts at 2400 each is 14k characters, and
  // the run answered that by piping `show` through `head`/`tail` three times —
  // working around this skill's own "run every command bare" rule, which was
  // false for the one command that had no bound.
  const src = readFileSync(join(SKILL, 'scripts', 'shipreport.js'), 'utf8');
  assert.match(src, /budget \/ Math\.max\(1, receipts\.length\)/,
    'show no longer divides its character budget across the receipts asked for');
});

test('a forced backfill is not reported as an incremental pass', () => {
  const src = readFileSync(join(SKILL, 'scripts', 'shipreport.js'), 'utf8');
  assert.match(src, /args\.full \? 'full — forced backfill'/,
    '`index --full` reports the opposite of what it just did');
});

test('a four-item section lays out in pairs, not three-plus-an-orphan', () => {
  const src = readFileSync(join(SKILL, 'scripts', 'lib', 'render.mjs'), 'utf8');
  assert.match(src, /n === 2 \|\| n === 4/, 'the column count no longer fits the section');
  const css = readFileSync(join(SKILL, 'assets', 'report.css'), 'utf8');
  assert.match(css, /\.ledger--pairs\s*\{[^}]*repeat\(2/, 'the pairs layout has no CSS behind it');
});

test('release and pull request bodies are actually requested from gh', () => {
  // The whole point of `show` is that step 4 costs no network. If the fetch stops
  // asking for bodies, `show` degrades to "(no body cached)" on every item and
  // the run silently goes back to shelling out.
  const src = readFileSync(join(SKILL, 'scripts', 'lib', 'github.mjs'), 'utf8');
  assert.match(src, /--json[^\n]*,body'/, 'pull request bodies are no longer fetched');
    assert.match(src, /body: \.body/, 'release bodies are no longer fetched');
});

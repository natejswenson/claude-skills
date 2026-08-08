/**
 * Guards that must survive a re-freeze.
 *
 * `skillfactory freeze` REGENERATES baseline.test.mjs, deleting anything
 * hand-written in it. Every assertion that is not the generated golden lives
 * here instead.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildAll, checkAll, hasUngroundedFact, findRepo, indexDir, SKILL_DIR } from '../lib/store.mjs';
import { extractSkill, listSkillNames } from '../lib/extract.mjs';
import { ask, parseCard, FLOOR } from '../lib/ask.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SNAP = join(SKILL_DIR, 'evals', 'fixtures', 'snapshot');
const REPO = findRepo();

const cards = () => readdirSync(indexDir()).filter((f) => f.endsWith('.md'))
  .map((f) => parseCard(readFileSync(join(indexDir(), f), 'utf8')));

// ---------------------------------------------------------------------------
// Coverage corpus — the anti-vacuity floor.
// ---------------------------------------------------------------------------

test('every skill in the repo has a card, over a floor that cannot pass vacuously', () => {
  const live = listSkillNames(REPO);
  assert.ok(live.length >= 12, `only ${live.length} skills resolved — a resolver matching nothing must go red, not report a fully-covered index over zero skills`);
  const indexed = new Set(cards().map((c) => c.name));
  for (const name of live) assert.ok(indexed.has(name), `${name} has no card — run: node scripts/skillhelp.js build`);
});

test('the committed index is current — this is the drift gate itself', () => {
  const { ok, results } = checkAll(REPO);
  const bad = results.filter((r) => r.verdict !== 'ok');
  assert.ok(ok, `${bad.length} cards are not current (${bad.map((r) => `${r.name}:${r.verdict}`).join(', ')}) — run: node scripts/skillhelp.js build`);
});

// ---------------------------------------------------------------------------
// The one rule, as assertions rather than promises.
// ---------------------------------------------------------------------------

test('every fact in every committed card carries a file:line source', () => {
  let facts = 0;
  for (const f of readdirSync(indexDir()).filter((n) => n.endsWith('.md'))) {
    const text = readFileSync(join(indexDir(), f), 'utf8');
    assert.equal(hasUngroundedFact(text), false, `${f} contains a bullet with no file:line source`);
    facts += parseCard(text).facts.length;
  }
  assert.ok(facts >= 400, `only ${facts} grounded facts across the index — a card set this thin cannot ground the questions it claims to answer`);
});

test('a card with a sourceless fact is detected, not tolerated', () => {
  // The two-sided half of the test above: it would pass forever if
  // hasUngroundedFact simply stopped looking.
  const good = '# x\n\n## Setup\n\n- a real fact `skills/x/SKILL.md:4`\n';
  const bad = '# x\n\n## Setup\n\n- a fact someone hand-edited in with no source\n';
  assert.equal(hasUngroundedFact(good), false);
  assert.equal(hasUngroundedFact(bad), true);
});

test('naming a skill cannot manufacture an answer the index does not hold', () => {
  // The defect dogfooding found: "what is the retry limit in gmailtriage"
  // scored 10 and returned five confident, irrelevant facts, because naming the
  // skill was worth +3 and the skill's name appears throughout its own card.
  const r = ask(cards(), 'what is the retry limit in gmailtriage');
  assert.equal(r.hits.length, 0, `expected the not-documented block, got ${r.hits.length} hits: ${r.hits.map((h) => h.text.slice(0, 40)).join(' | ')}`);
  assert.ok(r.scoped, 'the search should disclose that it was scoped to the named skill');
});

test('the floor is applied to content match, never to a bonus', () => {
  const r = ask(cards(), 'zzzqqq nonexistent terminology xyzzy');
  assert.equal(r.hits.length, 0);
  for (const f of r.nearest) assert.ok(f.base < FLOOR, 'nearest must be sub-floor by definition');
});

test('a section listing only fires on a named skill, and says so', () => {
  const listed = ask(cards(), 'what commands does press have');
  assert.equal(listed.listing, 'commands', 'a whole-section question should retrieve that section');
  assert.ok(listed.hits.length > 0);
  // Unscoped, the same section words must NOT dump a section from every skill.
  const unscoped = ask(cards(), 'commands');
  assert.ok(!unscoped.listing, 'a section listing without a named skill would return 17 skills of noise');
});

test('a real question returns grounded facts from the skill it names', () => {
  const r = ask(cards(), 'how do I set up ghostwriter');
  assert.ok(r.hits.length > 0, 'setup questions must be answerable');
  assert.deepEqual([...new Set(r.hits.map((h) => h.skill))], ['ghostwriter'], 'a scoped question must not leak other skills');
  for (const h of r.hits) assert.match(h.source, /^skills\/[^:]+:\d+$/, `source ${h.source} is not a repo-relative file:line`);
});

// ---------------------------------------------------------------------------
// The secret refusal.
// ---------------------------------------------------------------------------

test('a secret pasted into a skill\'s markdown is refused, and code is never indexed verbatim', () => {
  // Two different guarantees, and the distinction is the point. Markdown is
  // copied into cards verbatim, so it needs an active refusal. Source files are
  // read only for identifiers — an env var NAME, a module path — so a secret in
  // code has no route into a card at all. An earlier version of this test
  // asserted the refusal fired on code, which the design never did and never
  // needed to; the assertion was wrong, not the code.
  const work = mkdtempSync(join(tmpdir(), 'skillhelp-secret-'));
  const inner = join(work, 'skills', 'demo', 'skills', 'demo');
  mkdirSync(join(inner, 'scripts'), { recursive: true });
  const FAKE = `ghp_${'B'.repeat(30)}`;
  writeFileSync(join(inner, 'SKILL.md'), [
    '---', 'name: demo', 'description: A demo skill for the secret guard.', 'version: 0.1.0', '---',
    '', '## Requirements', '', '- Node 18+.', `- Set your token to ${FAKE} before running.`, '',
  ].join('\n'));
  writeFileSync(join(inner, 'scripts', 'x.mjs'), `const secret = "${FAKE}";\nconst t = process.env.DEMO_TOKEN;\nexport { secret, t };\n`);

  const card = extractSkill(work, 'demo');
  const all = Object.values(card.sections).flat().map((f) => f.text).join('\n');
  assert.ok(!all.includes(FAKE), 'a token-shaped literal reached a card that gets committed to a public repo');
  assert.ok(card.secretsRefused >= 1, `the markdown refusal did not fire (${card.secretsRefused} refused)`);
  // The env var a run actually needs must still reach Setup — refusing secrets
  // must not cost the user the setup answer they came for.
  assert.ok(card.sections.setup.some((f) => /DEMO_TOKEN/.test(f.text)), 'the env var name must still be indexed');
  rmSync(work, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Determinism and hygiene of the committed artifacts.
// ---------------------------------------------------------------------------

test('building twice over the frozen snapshot produces identical bytes', () => {
  const a = buildAll(SNAP, { write: false });
  const b = buildAll(SNAP, { write: false });
  assert.equal(a.rows.length, 6, 'the frozen snapshot must hold its six skills');
  for (const [name, { text }] of a.cards) assert.equal(text, b.cards.get(name).text, `${name} is not deterministic`);
});

test('no committed card leaks a host path or a NUL byte', () => {
  for (const f of readdirSync(indexDir()).filter((n) => n.endsWith('.md'))) {
    const text = readFileSync(join(indexDir(), f), 'utf8');
    assert.ok(!text.includes('\0'), `${f} contains a NUL byte`);
    assert.ok(!/\/(Users|home)\//.test(text), `${f} embeds an absolute host path — it would pass locally and fail in CI`);
  }
});

test('the drift trap exits non-zero, and would be caught if it stopped', () => {
  const trap = join(SKILL_DIR, 'evals', 'trap.mjs');
  assert.ok(existsSync(trap));
  let code = 0;
  try { execFileSync(process.execPath, [trap], { stdio: 'pipe' }); } catch (e) { code = e.status; }
  assert.equal(code, 1, 'evals/trap.mjs must exit 1 — exit 0 means check no longer detects drift');
});

// Guards the non-code half of the skill: SKILL.md's prose guardrails, the
// CLI surface it references, and version agreement between package.json and
// the CHANGELOG (which lives at the plugin root, two levels up).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN_ROOT = resolve(SKILL_ROOT, '..', '..');

const skillMd = readFileSync(join(SKILL_ROOT, 'SKILL.md'), 'utf8');
const invariants = JSON.parse(readFileSync(join(SKILL_ROOT, 'skill-invariants.json'), 'utf8'));

test('every prose invariant is present in SKILL.md', () => {
  for (const { id, pattern, rationale } of invariants.prose) {
    const re = new RegExp(pattern, 'i');
    assert.ok(re.test(skillMd), `Missing prose guardrail "${id}" (${rationale}) — pattern: ${pattern}`);
  }
});

// COVER-Q-4/COVER-Q-8: generalizes the prose-array mechanism above to a caller-specified
// file (via each entry's own `file` field) instead of the hardcoded SKILL.md read — a real
// regression test, not just schema validation: it fails red if the guarded code is removed.
test('every code invariant is present in its named file', () => {
  for (const { id, file, pattern, rationale } of invariants.code || []) {
    const target = readFileSync(join(SKILL_ROOT, file), 'utf8');
    const re = new RegExp(pattern);
    assert.ok(re.test(target), `Missing code guardrail "${id}" in ${file} (${rationale}) — pattern: ${pattern}`);
  }
});

// COVER-Q-2: the hero-zone bounding box and 25px grid must be defined exactly once, as
// exported constants in lib/render_cover.mjs, and image-style/style-guide.example.md's
// prose must state the identical numbers rather than an independently-maintained copy.
// Combined-literal checks (not four/two independent number checks) — see the design doc's
// rounds 5/9/10 for why a bare-number check is vacuous once other invariants share digits.
test('hero-zone coordinates and grid value are defined once in code and mirrored in the style guide (COVER-Q-2)', () => {
  const renderCoverSrc = readFileSync(join(SKILL_ROOT, 'lib', 'render_cover.mjs'), 'utf8');
  assert.match(renderCoverSrc, /export const HERO_ZONE/, 'lib/render_cover.mjs must export a HERO_ZONE constant');
  assert.match(renderCoverSrc, /export const HERO_GRID_UNIT/, 'lib/render_cover.mjs must export a HERO_GRID_UNIT constant');

  const styleGuide = readFileSync(join(SKILL_ROOT, 'image-style', 'style-guide.example.md'), 'utf8');
  assert.ok(
    styleGuide.includes('x:150 y:425 width:1300 height:400'),
    'image-style/style-guide.example.md must state the HERO_ZONE box as the combined literal "x:150 y:425 width:1300 height:400"'
  );
  assert.ok(
    styleGuide.includes('25px coordinate grid'),
    'image-style/style-guide.example.md must state the grid rule as the combined literal "25px coordinate grid" (a bare "25px"/"25" check is vacuous — see COVER-Q-12/COVER-Q-2 history)'
  );
});

// COVER-Q-12: the round-5 accent-icon placement rule, its reconciliation with the
// terminal-glyph accent convention, and the round-7 two-node decoration-only rule must all
// be present, verbatim, in image-style/style-guide.example.md and/or SKILL.md. Exact
// literal phrases (not bare numbers) — see the design doc's round-7/8 history for why.
test('accent-icon placement/reconciliation/decoration-only rules are present verbatim (COVER-Q-12)', () => {
  const styleGuide = readFileSync(join(SKILL_ROOT, 'image-style', 'style-guide.example.md'), 'utf8');
  const combined = styleGuide + '\n' + skillMd; // "and/or" — union of both files, per phrase

  const requiredPhrases = [
    'bottom edge no lower than y:400',
    '25px buffer above',
    'Never combine the catalog-icon accent and the terminal-glyph accent in the same cover.',
    "the accent icon's presence must not be read as belonging to either node",
  ];
  for (const phrase of requiredPhrases) {
    assert.ok(combined.includes(phrase), `Missing exact COVER-Q-12 phrase in style-guide.example.md and/or SKILL.md: "${phrase}"`);
  }
});

test('every CLI command SKILL.md relies on exists in the dispatcher', () => {
  const dispatcher = readFileSync(join(SKILL_ROOT, 'bin', 'devlog.js'), 'utf8');
  for (const cmd of invariants.cli_commands_referenced) {
    assert.ok(skillMd.includes(cmd), `skill-invariants lists "${cmd}" but SKILL.md never mentions it`);
    assert.ok(dispatcher.includes(`case '${cmd}':`), `SKILL.md relies on "devlog ${cmd}" but bin/devlog.js has no dispatch case for it`);
  }
});

test('SKILL.md tells the agent to invoke the CLI via npx', () => {
  assert.match(skillMd, /npx -y @natjswenson\/devlog scan --json/);
});

test('package.json version matches the top CHANGELOG entry', () => {
  const pkg = JSON.parse(readFileSync(join(SKILL_ROOT, 'package.json'), 'utf8'));
  const changelog = readFileSync(join(PLUGIN_ROOT, 'CHANGELOG.md'), 'utf8');
  const top = changelog.match(/^## (\d+\.\d+\.\d+)/m);
  assert.ok(top, 'CHANGELOG.md has no `## x.y.z` heading');
  assert.equal(top[1], pkg.version, `CHANGELOG top entry (${top[1]}) must match package.json version (${pkg.version}) — a release is cut by a version bump plus a changelog entry`);
});

test('the required post sections in SKILL.md match lint-post', async () => {
  const { REQUIRED_SECTIONS } = await import('../lib/lint_post.mjs');
  for (const section of REQUIRED_SECTIONS) {
    assert.ok(skillMd.includes(`## ${section}`), `lint-post requires "## ${section}" but SKILL.md's template never shows it`);
  }
});

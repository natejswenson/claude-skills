import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = join(HERE, '..', '..');
const read = (p) => readFileSync(join(SKILL, p), 'utf8');
const inv = JSON.parse(read('skill-invariants.json'));

test('every prose guardrail is still in SKILL.md', () => {
  // Whitespace-normalised: a guardrail that survives intact but got re-wrapped
  // by an editor is not a lost guardrail, and a test that says otherwise
  // teaches people to weaken the patterns until it stops crying wolf.
  const md = read('SKILL.md').replace(/\s+/g, ' ');
  for (const rule of inv.prose) {
    const pattern = rule.pattern.replace(/\s+/g, '\\s+');
    assert.match(md, new RegExp(pattern, 'i'), `${rule.id} vanished: ${rule.rationale}`);
  }
  assert.ok(inv.prose.length >= 10, 'the guardrail list shrank — say why in the CHANGELOG');
});

test('the declared split is real', () => {
  assert.ok(inv.split.deterministic.length > 0, 'no deterministic half declared');
  assert.ok(inv.split.nondeterministic.length > 0, 'no model-judgment half declared');
  for (const step of inv.split.deterministic) {
    const file = String(step.command).match(/scripts\/[\w./-]+/)?.[0];
    assert.ok(file && existsSync(join(SKILL, file)), `deterministic step "${step.step}" names no real script`);
  }
  for (const step of inv.split.nondeterministic) {
    assert.ok(step.why, `"${step.step}" gives no reason a model is needed`);
  }
});

test('every CLI command the split names is dispatched', () => {
  const cli = read('scripts/smith.js');
  for (const step of inv.split.deterministic) {
    const sub = String(step.command).split(/\s+/).pop();
    assert.match(cli, new RegExp(`case '${sub}':`), `smith.js does not dispatch "${sub}"`);
  }
});

test('version fields are in lockstep', () => {
  const pkg = JSON.parse(read('package.json')).version;
  const plugin = JSON.parse(read('../../.claude-plugin/plugin.json')).version;
  const fm = read('SKILL.md').match(/^version:\s*(\S+)/m)?.[1];
  assert.equal(pkg, plugin, 'package.json and plugin.json disagree');
  assert.equal(pkg, fm, 'package.json and SKILL.md frontmatter disagree');
});

test('smith holds itself to the smith tier', () => {
  // The stricter tier is opt-in via the `smith` block. If smith itself ever
  // stopped claiming it, `verify` would quietly grade this skill on the house
  // tier and the split, the press region and the one-code-directory rule would
  // all become advisory — for the skill that enforces them on everyone else.
  assert.ok(inv.smith, 'smith no longer claims the smith tier');
  for (const stray of ['bin', 'lib', 'src']) {
    assert.ok(!existsSync(join(SKILL, stray)), `code at ${stray}/ — one code directory, and it is scripts/`);
  }
});

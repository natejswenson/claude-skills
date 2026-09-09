import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = join(HERE, '..', '..');
const read = (p) => readFileSync(join(SKILL, p), 'utf8');
const inv = JSON.parse(read('skill-invariants.json'));

test('budget: help and operator guidance document explicit recovery without changing review limits', () => {
  for (const file of ['SKILL.md', 'references/operator-stops.md', '../../README.md']) {
    const text = read(file).replace(/\s+/g, ' ');
    assert.match(text, /resume --run-dir.*--budget-seconds 1800/, file);
    assert.match(text, /never auto-renew/i, file);
    assert.match(text, /review (?:limits|rounds).*unchanged/i, file);
  }
});

test('budget: completion guidance sends native completion straight to next with one fallback settle', () => {
  const dispatch = read('references/dispatch.md').replace(/\s+/g, ' ');
  assert.match(dispatch, /native.*completion.*next immediately/i);
  assert.match(dispatch, /fallback.*twenty seconds/i);
  assert.match(dispatch, /no second.*settle/i);
  assert.match(read('SKILL.md'), /Do not add a second\s+20-second shell settle/);
});

test('the always-loaded entrypoint stays within its context budget', () => {
  const md = read('SKILL.md');
  const words = md.trim().split(/\s+/).length;
  assert.ok(words <= 1500, `SKILL.md grew to ${words} words; route conditional detail to references`);
  assert.ok(Buffer.byteLength(md) <= 12_000, 'SKILL.md exceeded the 12 KB runtime budget');
});

test('every prose guardrail is still in SKILL.md', () => {
  // Whitespace-normalised: a guardrail that survives intact but got re-wrapped
  // by an editor is not a lost guardrail, and a test that says otherwise
  // teaches people to weaken the patterns until it stops crying wolf.
  const md = read('SKILL.md').replace(/\s+/g, ' ');
  for (const rule of inv.prose) {
    const pattern = rule.pattern.replace(/\s+/g, '\\s+');
    assert.match(md, new RegExp(pattern, 'i'), `${rule.id} vanished: ${rule.rationale}`);
  }
});

test('the declared split is real', () => {
  assert.ok(inv.split.deterministic.length > 0, 'no deterministic half declared');
  assert.ok(inv.split.nondeterministic.length > 0, 'no model-judgment half declared');
  for (const step of inv.split.deterministic) {
    const file = String(step.command).match(/scripts\/[\w./-]+/)?.[0];
    assert.ok(file && existsSync(join(SKILL, file)), `deterministic step "${step.step}" names no real script`);
  }
});

test('no bare relative invocation survives in the shipped docs (#219)', () => {
  // A bare `node scripts/issueflow.js` depends on the shell's cwd; the
  // command takes an absolute `--run-dir` and needs none. Every documented
  // invocation must resolve `$SKILL_DIR` first — so the literal bare form
  // must not appear anywhere, and the `$SKILL_DIR` form must appear instead.
  let matched = 0;
  for (const file of ['SKILL.md', 'skill-invariants.json']) {
    const text = read(file);
    assert.doesNotMatch(text, /node\s+["'`]?scripts\/issueflow\.js/, `${file} has a bare relative invocation`);
    matched += (text.match(/\$SKILL_DIR\/scripts\/issueflow\.js/g) ?? []).length;
  }
  assert.ok(matched >= 8, `only ${matched} \$SKILL_DIR-form invocations found across both files — a table that lost its rows would pass by matching nothing`);

  for (const step of inv.split.deterministic) {
    assert.match(step.command, /\$SKILL_DIR\/scripts\/issueflow\.js/, `deterministic step "${step.step}" does not use the \$SKILL_DIR form`);
  }
});

test('version fields are in lockstep', () => {
  const pkg = JSON.parse(read('package.json')).version;
  const plugin = JSON.parse(read('../../.claude-plugin/plugin.json')).version;
  const fm = read('SKILL.md').match(/^version:\s*(\S+)/m)?.[1];
  assert.equal(pkg, plugin, 'package.json and plugin.json disagree');
  assert.equal(pkg, fm, 'package.json and SKILL.md frontmatter disagree');
});

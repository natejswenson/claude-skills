/**
 * The prose guardrails in SKILL.md are load-bearing: they are what an agent
 * reads instead of the code. This asserts they are still there, so an edit that
 * quietly removes one fails the PR rather than silently changing behaviour.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const HERE = dirname(new URL(import.meta.url).pathname);
const ROOT = join(HERE, '..');

// Patterns are matched against a whitespace-normalised copy: SKILL.md is hard
// wrapped, so a guardrail sentence spans lines and would otherwise have to
// encode where the wrap happens to be — which is not the invariant.
const skill = readFileSync(join(ROOT, 'SKILL.md'), 'utf8').replace(/\s+/g, ' ');
const invariants = JSON.parse(readFileSync(join(ROOT, 'skill-invariants.json'), 'utf8'));

test('the prose block is not empty', () => {
  assert.ok(invariants.prose.length >= 8, 'guardrails must not silently shrink');
});

for (const rule of invariants.prose) {
  test(`SKILL.md still states: ${rule.id}`, () => {
    assert.match(skill, new RegExp(rule.pattern, 'i'), rule.rationale);
  });
}

test('every prose rule explains why it matters', () => {
  for (const rule of invariants.prose) {
    assert.ok(rule.rationale && rule.rationale.length > 40, `${rule.id} has no real rationale`);
  }
});

test('every baseline entry names a test file that exists', () => {
  for (const entry of invariants.baseline) {
    assert.doesNotThrow(
      () => readFileSync(join(ROOT, entry.test), 'utf8'),
      `${entry.id} names a missing test: ${entry.test}`,
    );
    assert.ok(entry.update_command, `${entry.id} has no update_command`);
  }
});

test('SKILL.md documents every command the CLI actually exposes', () => {
  const usage = readFileSync(join(ROOT, 'bin', 'press.js'), 'utf8');
  const commands = [...usage.matchAll(/^ {4}case '([a-z-]+)':$/gm)].map((m) => m[1]);
  assert.ok(commands.length >= 5, 'expected the full command set');
  for (const command of commands) {
    assert.match(skill, new RegExp(`press\\.js ${command}\\b|press ${command}\\b`), command);
  }
});

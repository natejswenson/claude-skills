/**
 * The prose contract.
 *
 * `skill-invariants.json` declares the rules no code enforces. This asserts each
 * one is still actually written in SKILL.md — a declaration that nothing checks
 * is a comment, and the guardrails here are precisely the ones whose loss stays
 * invisible until they cause the failure they exist to prevent.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const skill = readFileSync(join(ROOT, 'SKILL.md'), 'utf8');
const invariants = JSON.parse(readFileSync(join(ROOT, 'skill-invariants.json'), 'utf8'));

test('the prose block is not empty', () => {
  assert.ok(invariants.prose.length >= 8, `only ${invariants.prose.length} prose rules declared`);
});

for (const rule of invariants.prose) {
  test(`SKILL.md still states: ${rule.id}`, () => {
    assert.match(skill, new RegExp(rule.pattern, 'i'), rule.rationale);
  });
}

test('every prose rule explains why it matters', () => {
  for (const rule of invariants.prose) {
    assert.ok(rule.rationale && rule.rationale.length > 60, `${rule.id} has no real rationale`);
  }
});

test('SKILL.md documents every command the CLI actually exposes', () => {
  const usage = readFileSync(join(ROOT, 'bin/ghfactory.js'), 'utf8');
  const exposed = [...usage.matchAll(/^  ghfactory (\w+)/gm)].map((m) => m[1]);
  assert.ok(exposed.length >= 5, `only found ${exposed.length} commands in the usage block`);
  for (const cmd of exposed) {
    assert.ok(
      invariants.cli_commands_referenced.includes(cmd),
      `bin/ghfactory.js exposes "${cmd}" but skill-invariants.json does not list it`,
    );
    assert.match(skill, new RegExp(`ghfactory\\.js ${cmd}\\b`), `SKILL.md never shows "ghfactory ${cmd}"`);
  }
});

test('the run-presentation contract is a generated region, not a hand-copy', () => {
  assert.match(
    skill,
    />>> press:agent-ui v[\d.]+ sha256:[0-9a-f]{12} GENERATED/,
    'the agent-ui region is missing — a hand-copied presentation contract drifts silently',
  );
});

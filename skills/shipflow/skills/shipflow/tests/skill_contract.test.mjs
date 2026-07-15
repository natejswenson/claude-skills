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

test('every CLI command SKILL.md relies on exists in the dispatcher', () => {
  const dispatcher = readFileSync(join(SKILL_ROOT, 'bin', 'shipflow.js'), 'utf8');
  for (const cmd of invariants.cli_commands_referenced) {
    assert.ok(skillMd.includes(cmd), `skill-invariants lists "${cmd}" but SKILL.md never mentions it`);
    assert.ok(dispatcher.includes(`case '${cmd}':`), `SKILL.md relies on "shipflow ${cmd}" but bin/shipflow.js has no dispatch case for it`);
  }
});

test('SKILL.md tells the agent to invoke the CLI via npx, pinned to @latest', () => {
  assert.match(skillMd, /npx -y @natjswenson\/shipflow@latest <command>/);
});

// Regression guard for a finding self-discovered 2026-07-15 during a live
// dogfood run: a bare `npx -y @natjswenson/shipflow <command>` (no version/tag)
// silently resolved a stale global install on PATH instead of fetching the
// current version from the registry — meaning every fix through 0.2.5,
// including the Critical template-injection fix, was silently skipped with
// no warning. Every invocation in SKILL.md must pin @latest; this test fails
// if a future edit reintroduces a bare, unpinned invocation anywhere.
test('every npx invocation of shipflow in SKILL.md pins @latest', () => {
  const invocations = skillMd.match(/npx -y @natjswenson\/shipflow(@\S+)?/g) ?? [];
  assert.ok(invocations.length > 0, 'expected at least one npx invocation in SKILL.md');
  for (const inv of invocations) {
    assert.match(inv, /^npx -y @natjswenson\/shipflow@latest$/, `unpinned or wrongly-pinned invocation: "${inv}"`);
  }
});

test('package.json version matches the top CHANGELOG entry', () => {
  const pkg = JSON.parse(readFileSync(join(SKILL_ROOT, 'package.json'), 'utf8'));
  const changelog = readFileSync(join(PLUGIN_ROOT, 'CHANGELOG.md'), 'utf8');
  const top = changelog.match(/^## (\d+\.\d+\.\d+)/m);
  assert.ok(top, 'CHANGELOG.md has no `## x.y.z` heading');
  assert.equal(
    top[1],
    pkg.version,
    `CHANGELOG top entry (${top[1]}) must match package.json version (${pkg.version}) — a release is cut by a version bump plus a changelog entry`
  );
});

test('plugin.json name and version stay mutually equal to package.json', () => {
  const pkg = JSON.parse(readFileSync(join(SKILL_ROOT, 'package.json'), 'utf8'));
  const pluginJson = JSON.parse(readFileSync(join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.equal(pluginJson.name, 'shipflow', 'plugin.json name must equal the directory name, never the scoped package.json name');
  assert.equal(pluginJson.version, pkg.version, 'plugin.json version must stay mutually equal to package.json version');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = join(HERE, '..', '..');
const read = (p) => readFileSync(join(SKILL, p), 'utf8');
const inv = JSON.parse(read('skill-invariants.json'));

const normalize = (text) => text.replace(/\s+/g, ' ').trim();

function parseModelGateRoutes(markdown) {
  const table = markdown.match(/^\| Host \| Reference \|\n^\|[- |]+\|\n((?:^\|.*\|\n?)+)/m)?.[1] ?? '';
  const rows = new Map();
  for (const row of table.matchAll(/^\|\s*([^|]+?)\s*\|\s*(.*?)\s*\|\s*$/gm)) {
    const references = row[2].match(/`[^`]+`/g) ?? [];
    rows.set(row[1], { source: row[0], reference: references[0]?.slice(1, -1), referenceCount: references.length });
  }
  return rows;
}

function resolveModelGate(host, model) {
  const routes = parseModelGateRoutes(read('SKILL.md'));
  const observedModel = arguments.length < 2 ? 'observable' : model;
  const route = observedModel === undefined || observedModel === null || observedModel === '' ? 'unknown' : host;
  const selected = routes.get(routes.has(route) ? route : 'unknown');
  if (!selected?.reference) return { path: undefined, text: '' };
  return { path: selected.reference, text: read(selected.reference) };
}

const LEGACY_CLAUDE_GATE = 'If this session is not on the most capable model, say so in one line and offer to switch (`/model opus`). One line, then continue if the user declines — never silently proceed as though it made no difference.';

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
  const cli = read('scripts/skillfactory.js');
  for (const step of inv.split.deterministic) {
    const sub = String(step.command).split(/\s+/).pop();
    assert.match(cli, new RegExp(`case '${sub}':`), `skillfactory.js does not dispatch "${sub}"`);
  }
});

test('version fields are in lockstep', () => {
  const pkg = JSON.parse(read('package.json')).version;
  const plugin = JSON.parse(read('../../.claude-plugin/plugin.json')).version;
  const fm = read('SKILL.md').match(/^version:\s*(\S+)/m)?.[1];
  assert.equal(pkg, plugin, 'package.json and plugin.json disagree');
  assert.equal(pkg, fm, 'package.json and SKILL.md frontmatter disagree');
});

test('skillfactory holds itself to the skillfactory tier', () => {
  // The stricter tier is opt-in via the `skillfactory` block. If skillfactory itself ever
  // stopped claiming it, `verify` would quietly grade this skill on the house
  // tier and the split, the press region and the one-code-directory rule would
  // all become advisory — for the skill that enforces them on everyone else.
  assert.ok(inv.skillfactory, 'skillfactory no longer claims the skillfactory tier');
  for (const stray of ['bin', 'lib', 'src']) {
    assert.ok(!existsSync(join(SKILL, stray)), `code at ${stray}/ — one code directory, and it is scripts/`);
  }
});

test('the model gate has exactly one closed route for each host case', () => {
  const routes = parseModelGateRoutes(read('SKILL.md'));
  assert.deepEqual([...routes.keys()].sort(), ['claude', 'codex', 'unknown']);
  for (const [host, route] of routes) {
    assert.equal(route.referenceCount, 1, `${host} must select exactly one reference`);
    assert.ok(existsSync(join(SKILL, route.reference)), `${host} selects no readable reference`);
  }
  assert.equal(routes.get('claude')?.reference, 'references/model-gate-claude.md');
  assert.equal(routes.get('codex')?.reference, 'references/model-gate-codex.md');
  assert.equal(routes.get('unknown')?.reference, 'references/model-gate-neutral.md');
  assert.doesNotMatch(routes.get('codex')?.source ?? '', /model-gate-claude/);
  assert.doesNotMatch(routes.get('unknown')?.source ?? '', /model-gate-(?:claude|codex)/);
});

test('the Claude route preserves the legacy model recommendation exactly', () => {
  const gate = resolveModelGate('claude');
  assert.equal(gate.path, 'references/model-gate-claude.md');
  assert.equal(normalize(gate.text), normalize(LEGACY_CLAUDE_GATE));
});

test('the Codex route asks for capability without a Claude command', () => {
  const gate = resolveModelGate('codex');
  assert.equal(gate.path, 'references/model-gate-codex.md');
  assert.match(gate.text, /strongest available Codex model/i);
  assert.match(gate.text, /highest available reasoning setting/i);
  assert.doesNotMatch(gate.text, /\/model opus/);
});

test('an unobservable host uses neutral strongest-capability guidance', () => {
  const gate = resolveModelGate('unobservable', undefined);
  assert.equal(gate.path, 'references/model-gate-neutral.md');
  assert.match(gate.text, /strongest supported capability available/i);
  assert.doesNotMatch(gate.text, /\/model opus/);
});

test('a known host with an unobservable model uses neutral guidance', () => {
  for (const host of ['claude', 'codex']) {
    const gate = resolveModelGate(host, undefined);
    assert.equal(gate.path, 'references/model-gate-neutral.md', `${host} must use the neutral route`);
    assert.match(gate.text, /strongest supported capability available/i);
    assert.doesNotMatch(gate.text, /\/model opus/);
  }
});

test('the shared entrypoint contains no Claude-only model command', () => {
  assert.equal(read('SKILL.md').match(/\/model opus/g)?.length ?? 0, 0);
});

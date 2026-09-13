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
});

test('the declared split is real', () => {
  assert.ok(inv.split.deterministic.length > 0, 'no deterministic half declared');
  assert.ok(inv.split.nondeterministic.length > 0, 'no model-judgment half declared');
  for (const step of inv.split.deterministic) {
    const file = String(step.command).match(/scripts\/[\w./-]+/)?.[0];
    assert.ok(file && existsSync(join(SKILL, file)), `deterministic step "${step.step}" names no real script`);
  }
});

test('version fields are in lockstep', () => {
  const pkg = JSON.parse(read('package.json')).version;
  const plugin = JSON.parse(read('../../.claude-plugin/plugin.json')).version;
  const fm = read('SKILL.md').match(/^version:\s*(\S+)/m)?.[1];
  assert.equal(pkg, plugin, 'package.json and plugin.json disagree');
  assert.equal(pkg, fm, 'package.json and SKILL.md frontmatter disagree');
});

// Offline instruction-contract evaluation, not a simulated dispatcher or live
// Claude/Codex transcript. Assert shipped prose independently of declarations.
const completion = read('SKILL.md').split('## Publish and hand off\n')[1]
  ?.split('\n## ')[0].replace(/\s+/g, ' ') ?? '';

const handoffRules = {
  'create-only awaiting an answer': [
    /For a verified issue from a create-only request, show its URL, a short scope summary, and any remaining limitations first\./,
    /Then make the final user-facing sentence exactly: “Would you like to pick up this issue with issueflow\?”/,
    /Do not put a footer, invocation suggestion, or summary after that question\./,
    /Issue creation authorization alone does not authorize implementation\./,
  ],
  acceptance: [
    /If the user accepts, start issueflow through the current host with the verified issue number and the explicit repository from the publication result\./,
    /Do not re-resolve the repository from the current working directory\./,
    /Resolve an absolute local checkout path and verify that its GitHub repository matches the publication repository before starting issueflow\./,
    /Its `--repo` takes that local path, never the publication's `OWNER\/REPO` slug\./,
    /If no matching checkout can be verified, request its location and leave pickup pending without starting implementation:/,
  ],
  decline: [/If the user declines, end the flow without starting implementation\./],
  'no answer': [/If the question is unanswered, leave it pending without starting implementation\./],
  'already authorized': [
    /If the user already explicitly authorized issueflow pickup, start the verified handoff without asking the same decision again\./,
  ],
  'local draft': [
    /For an unpublished local draft, return its file link and mark it unpublished\./,
    /Do not offer or start issueflow for a local draft, failed publication, or unverified publication\./,
  ],
  'failed publication': [
    /For failed or unverified publication, including created-unverified results, report the actual state\./,
    /Do not offer or start issueflow for a local draft, failed publication, or unverified publication\./,
  ],
  'created-unverified publication': [
    /For failed or unverified publication, including created-unverified results, report the actual state\./,
    /Do not offer or start issueflow for a local draft, failed publication, or unverified publication\./,
  ],
};

for (const [host, invocation] of [
  ['Claude Code', /Claude Code: `\/issueflow <verified-issue-number> --repo '<verified-local-checkout-path>'`/],
  ['Codex', /Codex: `\$issueflow <verified-issue-number> --repo '<verified-local-checkout-path>'`/],
]) {
  for (const [scenario, patterns] of Object.entries(handoffRules)) {
    test(`${host} completion contract: ${scenario}`, () => {
      assert.match(completion, invocation, 'the host must carry verified issue and repository');
      for (const pattern of patterns) assert.match(completion, pattern);
    });
  }
}

test('partial batches only hand off individually verified issues', () => {
  assert.match(completion, /In a partial batch, only individually verified issues can be handoff candidates\./);
});

test('handoff prose guardrails remain declared', () => {
  const ids = new Set(inv.prose.map(({ id }) => id));
  for (const id of ['handoff-final-question', 'handoff-verified-context',
    'handoff-decline', 'handoff-unanswered', 'handoff-existing-authorization',
    'handoff-publication-exclusions', 'handoff-claude', 'handoff-codex']) {
    assert.ok(ids.has(id), `${id} declaration vanished`);
  }
});

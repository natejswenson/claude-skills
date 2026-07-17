import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { renderTemplate } from '../lib/render.mjs';

// Regression guard for a Low/Hardening finding from a Siege security audit
// (2026-07-15, SIEGE-2026-07-15-005): nothing in the test suite parsed the
// rendered template as YAML — two prior bugs (missing --repo, hardcoded
// GITHUB_TOKEN) were both syntactically-valid-but-behaviorally-wrong YAML,
// so a parse check wouldn't have caught those specifically, but a genuinely
// malformed render (a stray token, an unbalanced quote, bad indentation)
// would previously have shipped silently — caught only by a live production
// run against a real PR, as already happened twice in one day. This test
// closes that gap by asserting the rendered output actually parses.

const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const AUTOMERGE_TEMPLATE_SOURCE = readFileSync(
  join(SKILL_ROOT, 'templates', 'dev-main-promotion', 'dev-to-main-automerge.yml.tmpl'),
  'utf8'
);
const GITHUB_FLOW_TEMPLATE_SOURCE = readFileSync(
  join(SKILL_ROOT, 'templates', 'github-flow', 'main-automerge.yml.tmpl'),
  'utf8'
);

test('the rendered dev-to-main-automerge workflow is syntactically valid YAML', () => {
  const rendered = renderTemplate(AUTOMERGE_TEMPLATE_SOURCE, {
    devBranch: 'dev',
    mainBranch: 'main',
    mergeFlag: '--merge',
    releaseCredentialSecret: 'SHIPFLOW_AUTOMERGE_PAT',
  });

  const doc = parseYaml(rendered);
  assert.ok(doc && typeof doc === 'object', 'expected the rendered template to parse to an object');
  assert.ok(doc.jobs, 'expected a top-level jobs: key');
  assert.ok(doc.jobs['auto-merge'], 'expected a jobs.auto-merge entry');
  assert.ok(doc.jobs['label-release-pending'], 'expected a jobs.label-release-pending entry');
});

test('the rendered workflow stays valid YAML across a range of legal branch/secret names', () => {
  const cases = [
    { devBranch: 'develop', mainBranch: 'trunk', mergeFlag: '--squash', releaseCredentialSecret: 'GH_AUTOMERGE_PAT' },
    { devBranch: 'feature/dev-branch', mainBranch: 'main', mergeFlag: '--rebase', releaseCredentialSecret: '_LEADING_UNDERSCORE' },
  ];
  for (const params of cases) {
    const rendered = renderTemplate(AUTOMERGE_TEMPLATE_SOURCE, params);
    assert.doesNotThrow(() => parseYaml(rendered), `expected valid YAML for params: ${JSON.stringify(params)}`);
  }
});

test('the rendered github-flow main-automerge workflow is syntactically valid YAML', () => {
  const rendered = renderTemplate(GITHUB_FLOW_TEMPLATE_SOURCE, {
    mainBranch: 'main',
    mergeFlag: '--merge',
    releaseCredentialSecret: 'SHIPFLOW_AUTOMERGE_PAT',
  });

  const doc = parseYaml(rendered);
  assert.ok(doc && typeof doc === 'object', 'expected the rendered template to parse to an object');
  assert.ok(doc.jobs, 'expected a top-level jobs: key');
  assert.ok(doc.jobs['auto-merge'], 'expected a jobs.auto-merge entry');
  assert.ok(doc.jobs['label-release-pending'], 'expected a jobs.label-release-pending entry');
});

test('the rendered github-flow workflow stays valid YAML across a range of legal branch/secret names', () => {
  const cases = [
    { mainBranch: 'trunk', mergeFlag: '--squash', releaseCredentialSecret: 'GH_AUTOMERGE_PAT' },
    { mainBranch: 'main', mergeFlag: '--rebase', releaseCredentialSecret: '_LEADING_UNDERSCORE' },
  ];
  for (const params of cases) {
    const rendered = renderTemplate(GITHUB_FLOW_TEMPLATE_SOURCE, params);
    assert.doesNotThrow(() => parseYaml(rendered), `expected valid YAML for params: ${JSON.stringify(params)}`);
  }
});

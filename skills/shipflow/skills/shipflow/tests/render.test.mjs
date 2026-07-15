import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderTemplate, mergeMethodToFlag } from '../lib/render.mjs';

const TEMPLATE = 'dev={{DEV_BRANCH}} main={{MAIN_BRANCH}} flag={{MERGE_FLAG}}';

const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const AUTOMERGE_TEMPLATE_SOURCE = readFileSync(
  join(SKILL_ROOT, 'templates', 'dev-to-main-automerge.yml.tmpl'),
  'utf8'
);

test('renderTemplate substitutes all known tokens', () => {
  const out = renderTemplate(TEMPLATE, { devBranch: 'develop', mainBranch: 'trunk', mergeFlag: '--squash' });
  assert.equal(out, 'dev=develop main=trunk flag=--squash');
});

test('renderTemplate throws on a missing param', () => {
  assert.throws(
    () => renderTemplate(TEMPLATE, { devBranch: 'develop', mainBranch: 'trunk' }),
    /missing param.*MERGE_FLAG/
  );
});

test('renderTemplate is pure — same input always produces the same output', () => {
  const params = { devBranch: 'dev', mainBranch: 'main', mergeFlag: '--merge' };
  assert.equal(renderTemplate(TEMPLATE, params), renderTemplate(TEMPLATE, params));
});

test('mergeMethodToFlag maps known methods', () => {
  assert.equal(mergeMethodToFlag('squash'), '--squash');
  assert.equal(mergeMethodToFlag('rebase'), '--rebase');
  assert.equal(mergeMethodToFlag('merge'), '--merge');
});

test('mergeMethodToFlag defaults to --merge for an unknown value', () => {
  assert.equal(mergeMethodToFlag('bogus'), '--merge');
  assert.equal(mergeMethodToFlag(undefined), '--merge');
});

// Regression test for a bug found by dogfooding shipflow on its own repo:
// neither `gh` call in the rendered workflow had an explicit --repo, so both
// silently failed off a checkout-less runner ("not a git repository") the
// moment the workflow ran from a fork-less, checkout-less job — exactly how
// this template always runs. No prior test caught it because none read the
// actual .tmpl file's gh invocations.
test('auto-merge job passes --repo to gh pr merge (no checkout step to infer it from)', () => {
  const rendered = renderTemplate(AUTOMERGE_TEMPLATE_SOURCE, {
    devBranch: 'dev',
    mainBranch: 'main',
    mergeFlag: '--merge',
  });
  const mergeLine = rendered.split('\n').find((l) => l.includes('gh pr merge'));
  assert.ok(mergeLine, 'expected a `gh pr merge` line in the rendered workflow');
  assert.match(mergeLine, /--repo "\$\{\{ github\.repository \}\}"/);
});

test('label-release-pending job passes --repo to gh pr edit (no checkout step to infer it from)', () => {
  const rendered = renderTemplate(AUTOMERGE_TEMPLATE_SOURCE, {
    devBranch: 'dev',
    mainBranch: 'main',
    mergeFlag: '--merge',
  });
  const labelLine = rendered.split('\n').find((l) => l.includes('gh pr edit'));
  assert.ok(labelLine, 'expected a `gh pr edit` line in the rendered workflow');
  assert.match(labelLine, /--repo "\$\{\{ github\.repository \}\}"/);
});

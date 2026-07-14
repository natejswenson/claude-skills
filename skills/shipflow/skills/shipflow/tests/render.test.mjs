import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderTemplate, mergeMethodToFlag } from '../lib/render.mjs';

const TEMPLATE = 'dev={{DEV_BRANCH}} main={{MAIN_BRANCH}} flag={{MERGE_FLAG}}';

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

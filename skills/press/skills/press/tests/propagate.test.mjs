import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import { loadTokens } from '../lib/tokens.mjs';
import { emitBody } from '../lib/emit.mjs';
import { renderRegion } from '../lib/region.mjs';
import { propagate } from '../lib/propagate.mjs';

const tokens = loadTokens();
const V = '9.9.9';

const TARGET = {
  id: 'demo',
  repo: 'demo',
  path: 'theme.css',
  region: 'tokens',
  syntax: 'css',
  emitter: 'css-vars',
  params: { vars: ['paper', 'ink'], comments: false },
};

const WORKFLOW = `jobs:
  ci:
    steps:
      - run: npx -y @natjswenson/press@0.1.0 check --repo .
`;

function sandbox({ regionVersion = V, tokenSet = tokens, workflow = WORKFLOW } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'press-prop-'));
  const body = emitBody(tokenSet, 'css-vars', TARGET.params);
  writeFileSync(
    join(root, 'theme.css'),
    `/* head */\n${renderRegion('tokens', 'css', body, regionVersion)}\n/* tail */\n`,
    'utf8',
  );
  if (workflow) {
    mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
    writeFileSync(join(root, '.github', 'workflows', 'ci.yml'), workflow, 'utf8');
  }
  return root;
}

const bend = () => {
  const t = structuredClone(tokens);
  t.colors.paper = '#FFFFFF';
  return t;
};

test('a consumer already on the current brand reports no change', () => {
  const root = sandbox();
  const r = propagate({ tokens, targets: [TARGET], root, version: V });
  assert.equal(r.changed, false);
  assert.deepEqual(r.stale, []);
  assert.equal(r.regions[0].status, 'current');
});

test('a consumer behind the current brand is detected and rewritten', () => {
  const root = sandbox({ tokenSet: bend() });
  const r = propagate({ tokens, targets: [TARGET], root, version: V });
  assert.equal(r.changed, true);
  assert.deepEqual(r.stale, ['demo']);
  assert.match(readFileSync(join(root, 'theme.css'), 'utf8'), /--paper: #F5F0E6;/);
});

test('--dry-run reports the change without touching the file', () => {
  const root = sandbox({ tokenSet: bend() });
  const before = readFileSync(join(root, 'theme.css'), 'utf8');
  const r = propagate({ tokens, targets: [TARGET], root, version: V, dryRun: true });
  assert.equal(r.changed, true, 'a dry run must still report that the repo is behind');
  assert.equal(r.regions[0].status, 'would update');
  assert.equal(readFileSync(join(root, 'theme.css'), 'utf8'), before, 'dry run wrote to disk');
});

test('the changed flag is a boolean, not a guess at the status wording', () => {
  // Regression: `status.endsWith("updated")` missed "would update", so a dry run
  // reported "nothing to do" while displaying a changed region.
  const root = sandbox({ tokenSet: bend() });
  const r = propagate({ tokens, targets: [TARGET], root, version: V, dryRun: true });
  assert.equal(r.regions[0].changed, true);
  assert.equal(r.changed, r.regions.some((x) => x.changed));
});

test('a stale pin alone is bumped but does NOT make the repo "behind"', () => {
  // The pin changes no shipped artifact, so it is not worth a pull request on
  // its own — otherwise every no-op release opens noise in four repos.
  const root = sandbox();
  const r = propagate({ tokens, targets: [TARGET], root, version: V });
  assert.equal(r.changed, false);
  assert.equal(r.pins[0].status, 'bumped');
  assert.match(readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8'),
    new RegExp(`@natjswenson/press@${V.replace(/\./g, '\\.')} check`));
});

test('an already-current pin is reported, not rewritten', () => {
  const root = sandbox({ workflow: WORKFLOW.replace('0.1.0', V) });
  const r = propagate({ tokens, targets: [TARGET], root, version: V });
  assert.equal(r.pins[0].status, 'current');
});

test('every pin in a repo moves together, across multiple workflow files', () => {
  const root = sandbox();
  writeFileSync(join(root, '.github/workflows/nightly.yml'),
    'run: npx -y @natjswenson/press@0.2.0 check --repo .\n', 'utf8');
  const r = propagate({ tokens, targets: [TARGET], root, version: V });
  assert.equal(r.pins.length, 2);
  for (const p of r.pins) assert.equal(p.to, V);
});

test('a repo with no workflows propagates fine and reports no pins', () => {
  const root = sandbox({ workflow: null });
  const r = propagate({ tokens, targets: [TARGET], root, version: V });
  assert.deepEqual(r.pins, []);
  assert.equal(r.changed, false);
});

test('a deleted region is surfaced separately from a stale one', () => {
  const root = sandbox();
  writeFileSync(join(root, 'theme.css'), ':root { --paper: #F5F0E6; }\n', 'utf8');
  const r = propagate({ tokens, targets: [TARGET], root, version: V });
  assert.deepEqual(r.missing, ['demo']);
  assert.equal(r.changed, false, 'a missing region needs a --init, not a propagate');
});

test('propagate records which press version wrote the region it found', () => {
  const root = sandbox({ regionVersion: '0.1.0' });
  const r = propagate({ tokens, targets: [TARGET], root, version: V });
  assert.equal(r.regions[0].wroteBy, '0.1.0');
});

test('content, not the version receipt, decides whether a repo is behind', () => {
  // natejswenson.io's region was written by 0.1.0 and is still byte-correct
  // under 0.3.0. Opening a PR for that would be pure noise.
  const root = sandbox({ regionVersion: '0.1.0' });
  const r = propagate({ tokens, targets: [TARGET], root, version: V });
  assert.equal(r.regions[0].wroteBy, '0.1.0');
  assert.equal(r.changed, false);
});

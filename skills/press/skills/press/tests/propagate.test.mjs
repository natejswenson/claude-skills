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

test('a consumer fully on the current release reports no change at all', () => {
  // "Current" now means region receipt AND pin both on this version — the whole
  // point of the policy is that those stay one number.
  const root = sandbox({ workflow: WORKFLOW.replace('0.1.0', V) });
  const r = propagate({ tokens, targets: [TARGET], root, version: V });
  assert.equal(r.changed, false);
  assert.deepEqual(r.stale, []);
  assert.deepEqual(r.brand, []);
  assert.equal(r.regions[0].status, 'current');
  assert.equal(r.pins[0].status, 'current');
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
  assert.equal(r.regions[0].status, 'would change brand');
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

test('a stale pin alone IS enough to need a pull request', () => {
  // Policy, chosen deliberately: pin, region receipt and current release stay
  // ONE number. The older "only open a PR when values move" rule left three
  // divergent versions per repo and no way to read a consumer's health.
  const root = sandbox();
  const r = propagate({ tokens, targets: [TARGET], root, version: V });
  assert.equal(r.changed, true);
  assert.deepEqual(r.brand, [], 'nothing renders differently, so no brand review needed');
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

test('a deleted region is surfaced as missing, never silently re-created', () => {
  const root = sandbox({ workflow: WORKFLOW.replace('0.1.0', V) });
  writeFileSync(join(root, 'theme.css'), ':root { --paper: #F5F0E6; }\n', 'utf8');
  const r = propagate({ tokens, targets: [TARGET], root, version: V });
  assert.deepEqual(r.missing, ['demo']);
  assert.deepEqual(r.stale, [], 'a missing region needs `emit --init`, not a propagate');
  assert.match(readFileSync(join(root, 'theme.css'), 'utf8'), /^:root \{ --paper/);
  assert.equal(r.changed, false, 'a missing region needs a --init, not a propagate');
});

test('propagate records which press version wrote the region it found', () => {
  const root = sandbox({ regionVersion: '0.1.0' });
  const r = propagate({ tokens, targets: [TARGET], root, version: V });
  assert.equal(r.regions[0].wroteBy, '0.1.0');
});

test('a stale region receipt is adopted, and reported as NOT a brand change', () => {
  const root = sandbox({ regionVersion: '0.1.0' });
  const r = propagate({ tokens, targets: [TARGET], root, version: V });
  assert.equal(r.regions[0].wroteBy, '0.1.0');
  assert.equal(r.regions[0].versionChanged, true);
  assert.equal(r.regions[0].brandChanged, false, 'no value moved, so no design review');
  assert.equal(r.changed, true);
  assert.deepEqual(r.brand, []);
});

test('a brand change is separated from a version bump, so review stays proportionate', () => {
  const root = sandbox({ tokenSet: bend(), regionVersion: '0.1.0' });
  const r = propagate({ tokens, targets: [TARGET], root, version: V });
  assert.equal(r.regions[0].brandChanged, true);
  assert.deepEqual(r.brand, ['demo'], 'a values change must be flagged for a human');
  assert.equal(r.regions[0].status, 'brand updated');
});

test('after propagating, the region records the new version — pin and receipt converge', () => {
  const root = sandbox({ regionVersion: '0.1.0' });
  propagate({ tokens, targets: [TARGET], root, version: V });
  const again = propagate({ tokens, targets: [TARGET], root, version: V });
  assert.equal(again.changed, false, 'a second run must be a no-op');
  assert.equal(again.regions[0].wroteBy, V);
});

// --- version-embedding emitters -------------------------------------------

const BADGE = {
  id: 'demo-readme',
  repo: 'demo',
  path: 'README.md',
  region: 'version',
  syntax: 'md',
  emitter: 'version-badge',
  params: { what: 'The tiles' },
};

function badgeSandbox(regionVersion) {
  const root = mkdtempSync(join(tmpdir(), 'press-badge-'));
  const body = emitBody(tokens, 'version-badge', BADGE.params, { version: regionVersion });
  writeFileSync(
    join(root, 'README.md'),
    `# demo\n\n${renderRegion('version', 'md', body, regionVersion)}\n`,
    'utf8',
  );
  return root;
}

/**
 * The 0.8.0 rollout regression, pinned.
 *
 * `version-badge` writes the version into its own body ("PRESS v0.7.2 — …"), so
 * comparing the on-disk body against the NEW body reported a values change on
 * every single release. Three of four consumers were titled BRAND VALUES CHANGED
 * for a release in which no token moved; only the one target without a badge got
 * it right. A title that is always loud is a title nobody reads.
 */
test('a version-only bump of a version-embedding emitter is NOT a brand change', () => {
  const root = badgeSandbox('0.1.0');
  const r = propagate({ tokens, targets: [BADGE], root, version: V });
  assert.equal(r.regions[0].versionChanged, true);
  assert.equal(
    r.regions[0].brandChanged,
    false,
    'the badge text moved only because the version did — that is routine adoption',
  );
  assert.deepEqual(r.brand, []);
  assert.equal(r.regions[0].status, 'adopted');
});

/**
 * The other side, and the one that matters most: the fix must not blind the
 * detector. A real values change that happens to arrive in the same release as a
 * version bump must still be flagged.
 */
test('a real values change is still caught when the version moved too', () => {
  const root = sandbox({ tokenSet: bend(), regionVersion: '0.1.0' });
  const r = propagate({ tokens, targets: [TARGET], root, version: V });
  assert.equal(r.regions[0].versionChanged, true, 'the version moved as well');
  assert.equal(r.regions[0].brandChanged, true, 'a token moved — this still needs a human');
  assert.deepEqual(r.brand, ['demo']);
});

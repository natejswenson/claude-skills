import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { readHouse, readSkill } from '../lib/house.mjs';
import { conform, summarize } from '../lib/conform.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..', '..', '..', '..');

// The corpus is this repo's own shipped skills. Pinning against real, working
// skills rather than a synthetic tree is the whole point: a conformance rule
// that has drifted away from what this repo actually does should go red here,
// not in the PR of whoever makes the next skill.
const MIN_CORPUS = 9;

test('the corpus is real', () => {
  // Anti-vacuity floor. A resolver that silently matched nothing would let
  // every assertion below iterate an empty list and report "all conformant"
  // having checked zero skills — the exact way a gate turns decorative.
  const house = readHouse(REPO);
  assert.ok(
    house.skills.length >= MIN_CORPUS,
    `found ${house.skills.length} skills, floor is ${MIN_CORPUS} — readHouse is matching nothing, not the repo shrinking`,
  );
  assert.ok(house.contexts.length >= MIN_CORPUS, 'repo-settings.sh contexts did not parse');
  assert.ok(house.pressTargets.length > 0, 'press targets.json did not parse');
});

test('every shipped skill satisfies the house tier', () => {
  const house = readHouse(REPO);
  // Repeated on purpose: without it a broken repo path makes this test pass
  // over an empty list while only the floor test above goes red, and the two
  // are read independently.
  assert.ok(house.skills.length >= MIN_CORPUS, `only ${house.skills.length} skills to check`);
  const failures = [];
  for (const name of house.skills) {
    const skill = readSkill(REPO, name);
    const { ok, failed } = summarize(skill, conform(house, skill));
    if (!ok) failures.push(`${name}: ${failed.map((f) => `${f.id} (${f.detail})`).join('; ')}`);
  }
  assert.deepEqual(failures, [], `house-tier conformance regressed:\n  ${failures.join('\n  ')}`);
});

test('the house tier is not vacuous', () => {
  // Two-sided. If every check returned true regardless of input, the test
  // above would pass forever. A skill that does not exist must fail loudly.
  const house = readHouse(REPO);
  const ghost = readSkill(REPO, 'no-such-skill-exists');
  const { ok, failed } = summarize(ghost, conform(house, ghost));
  assert.equal(ok, false, 'a nonexistent skill passed conformance — the checks assert nothing');
  assert.ok(failed.length >= 5, `only ${failed.length} checks noticed a missing skill`);
});

test('a skill missing from a registry is caught', () => {
  // The registries are where half-done wiring hides. Drop a real skill out of
  // each one in turn and assert the matching check goes red — otherwise the
  // house tier could pass while a skill is uninstallable or gating nothing.
  const base = readHouse(REPO);
  const skill = readSkill(REPO, 'forge');

  const noMarket = { ...base, marketplaceSources: {} };
  assert.ok(
    conform(noMarket, skill).some((c) => c.id === 'marketplace-entry' && !c.ok),
    'a skill absent from marketplace.json still passed',
  );

  const noContext = { ...base, contexts: [] };
  assert.ok(
    conform(noContext, skill).some((c) => c.id === 'required-check' && !c.ok),
    'a skill whose check gates nothing on main still passed',
  );
});

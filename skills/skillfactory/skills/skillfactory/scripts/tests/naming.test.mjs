/**
 * The name rule, both sides.
 *
 * Deliberately NOT in baseline.test.mjs: `skillfactory freeze` regenerates that
 * file from a template every time a run is frozen, so anything hand-added there
 * is silently deleted on the next refresh. A rule worth enforcing needs a test
 * the scaffolder does not own.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { nameCoverage } from '../lib/spec.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = join(HERE, '..', '..');
const sh = (cmd) => execFileSync('bash', ['-lc', cmd], { cwd: SKILL, encoding: 'utf8' });
const checkSpec = (spec, flags = '') =>
  sh(`node scripts/skillfactory.js check-spec --spec evals/inputs/${spec} --repo evals/inputs/house ${flags}`);

test('a metaphor name is refused, and refused for being a metaphor', () => {
  // metaphor.spec.json is identical to demo.spec.json in every field except the
  // name, so a failure here can only be the name rule.
  assert.throws(
    () => checkSpec('metaphor.spec.json'),
    'a spec named "forge" for a repository-counting skill was accepted — the name rule has been weakened, not the input fixed',
  );
  // Asserting the *reason*, not merely that it failed: a trap that fails
  // somewhere keeps passing on the day the name rule disappears and some
  // unrelated rule tightens.
  const { ok, problems } = JSON.parse(checkSpec('metaphor.spec.json', '--json'));
  assert.equal(ok, false);
  assert.deepEqual(
    problems.map((p) => p.field),
    ['name'],
    'the naming trap now fails for another reason too — it has stopped proving anything about the name',
  );
  assert.match(problems[0].why, /appears nowhere in what this skill says it does/);
});

test('the spec that scaffolds the golden is still accepted', () => {
  // The other side. A name check that rejects everything is not a check.
  assert.equal(JSON.parse(checkSpec('demo.spec.json', '--json')).ok, true, 'demo.spec.json stopped being scaffoldable');
});

test('every name this repo shipped is graded against its own description', () => {
  // Each pair is the same skill under the name it shipped with and the name it
  // was renamed to, judged against identical text — so the only variable is the
  // name itself.
  const spec = (summary, description) => ({
    summary,
    description,
    oneRule: 'x',
    commands: [],
  });
  const gh = spec(
    'Generate GitHub Actions workflows that are verified rather than hoped for.',
    'every action ref resolved to a real pinned SHA, actionlint and zizmor clean',
  );
  const factory = spec(
    'The skill that makes skills — branded, wired, and frozen as a baseline.',
    '"create a skill", "scaffold a skill"',
  );
  const grader = spec(
    'Grade a real run of a skill against its own committed contract.',
    '"write evals for my skill", "my evals are decorative"',
  );
  const plugins = spec(
    'Reconcile the plugins installed on this machine with what the marketplace offers.',
    'never call a plugin live before the restart that makes it so',
  );
  const counter = spec(
    'Count what a repository owes you — open PRs, stale branches, unreleased commits.',
    'what is outstanding, any stale branches',
  );

  for (const [name, s, expected] of [
    ['ghfactory', gh, true],
    ['forge', gh, false],
    ['skillfactory', factory, true],
    ['smith', factory, false],
    ['eval', grader, true],
    ['assay', grader, false],
    ['pluginsync', plugins, true],
    ['repocount', counter, true],
    ['tally', counter, false],
    ['anvil', gh, false],
  ]) {
    assert.equal(nameCoverage(name, s).ok, expected, `${name}: name coverage flipped`);
  }
});

test('a stopword in the prose cannot spell a name', () => {
  // The bug this rule shipped with: "verified, not hoped for" supplied the stem
  // "for", which was enough to accept `forge`. Any three-letter fragment of the
  // grammar around a description would do the same.
  const s = { summary: 'Generate GitHub Actions workflows that are verified, not hoped for.', description: 'x', oneRule: 'x', commands: [] };
  assert.equal(nameCoverage('forge', s).ok, false, 'a stopword is spelling names again');
  assert.equal(nameCoverage('thermos', { ...s, summary: 'The report and the thing' }).ok, false);
});

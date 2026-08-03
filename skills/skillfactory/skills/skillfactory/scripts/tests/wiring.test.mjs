/**
 * Named assertions over what a scaffold emits.
 *
 * The byte-comparison in `baseline.test.mjs` would surface both of these as a
 * diff, but a diff does not name the defect — and, more importantly, **this file
 * exists because `skillfactory freeze` regenerates `baseline.test.mjs` from a
 * template.** Anything hand-written there is silently deleted by the next
 * refresh, which is precisely the moment someone is trying to make a golden go
 * green. A guard that a refresh can erase is not a guard.
 *
 * So these live in a file `freeze` does not own, and they read the frozen
 * artifacts rather than re-running the scaffolder: a regression laundered
 * through `freeze --skill skillfactory` updates those artifacts, and these fail
 * on the updated ones.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE = join(HERE, '..', '..', 'evals', 'baseline');
const frozen = (p) => readFileSync(join(BASELINE, p), 'utf8');

test('a scaffolded release job is dispatch-only — never triggered by a push', () => {
  const caller = frozen('.github/workflows/repocount.yml');
  const releaseJob = caller.slice(caller.indexOf('\n  release:'));
  assert.ok(releaseJob.length > 0, 'the scaffolded caller has no release job at all');
  assert.doesNotMatch(
    releaseJob,
    /event_name == 'push'/,
    'the scaffolded release job admits push events. A dev → main auto-merge fires those, which made ' +
      'promotions publish-on-merge and cost two releases: city-report v0.4.0 tagged with stale notes ' +
      'before a planned CHANGELOG edit landed, and shipflow v0.4.0 tagged and published to npm ' +
      'seconds after a merge, with no dispatch and no decision.',
  );
  assert.match(releaseJob, /github\.event_name == 'workflow_dispatch'/, 'the release job can never be triggered at all');
});

test('a scaffolded skill is declared as a release component', () => {
  const components = JSON.parse(frozen('.github/shipflow.json')).release.components;
  assert.ok(
    components.includes('repocount'),
    'scaffold did not declare the new skill in release.components — `release` cannot see it at all, ' +
      'so `preflight` reports on every OTHER component and looks complete',
  );
  // The committed list is sorted; a wiring edit that also reorders produces a
  // diff nobody reads, which is how an unrelated change hides inside one.
  assert.deepEqual(components, [...components].sort(), 'release.components came back unsorted');
  // Anti-vacuity: appending to an empty list would prove nothing about appending.
  assert.ok(components.length >= 2, 'the fixture house must already declare a component, or "appends correctly" proves nothing');
});

test('every registry the wiring reference names is actually emitted', () => {
  // The reference is the contract a reader is pointed at. If it lists a registry
  // the scaffolder never touches, the doc is the thing that is wrong.
  const reference = readFileSync(join(HERE, '..', '..', 'references', 'wiring.md'), 'utf8');
  const scaffoldRows = reference
    .split('\n')
    .filter((l) => /^\| \d+ \| /.test(l) && l.includes('`scaffold`'))
    .map((l) => l.split('|')[2].trim());
  assert.ok(scaffoldRows.length >= 7, `wiring.md lists ${scaffoldRows.length} scaffold-applied registries — the resolver matched too few to prove anything`);
  for (const path of ['.claude-plugin/marketplace.json', '.github/repo-settings.sh', '.github/shipflow.json']) {
    assert.ok(
      scaffoldRows.some((row) => row.includes(path)),
      `wiring.md does not list ${path} as scaffold-applied, but the scaffolder writes it`,
    );
  }
});

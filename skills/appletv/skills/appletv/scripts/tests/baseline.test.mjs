import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE = join(HERE, '..', '..', 'evals', 'baseline');

// ---------------------------------------------------------------------------
// NOT YET FROZEN. appletv has no baseline until it has actually been run.
//
// Run the skill end to end on a real input, then:
//     skillfactory freeze --skill appletv --from <the run's output dir>
//
// which replaces this file with assertions over what that run really produced.
// Deleting this test to get green is the one shortcut that makes every other
// gate in this repo decorative.
// ---------------------------------------------------------------------------
test('a real run has been frozen as the baseline', () => {
  assert.ok(
    existsSync(join(BASELINE, 'MANIFEST.json')),
    'no real run frozen yet — appletv is at rung 2 (scaffolded and lint-clean), not rung 3. Run it for real, then `skillfactory freeze`.',
  );
});

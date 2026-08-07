import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = join(HERE, '..', '..');
const BASELINE = join(SKILL, 'evals', 'baseline');
const manifest = JSON.parse(readFileSync(join(BASELINE, 'MANIFEST.json'), 'utf8'));

// Pinned against a real run of shipreport. Refresh with:
//   C="--corpus evals/baseline/corpus --since 2026-07-28T00:00:00Z --until 2026-08-04T00:00:00Z"; node scripts/shipreport.js rank $C > <a fresh dir>/rank.txt && node scripts/shipreport.js rank $C --kind session --limit 15 > $OUT/rank-sessions.txt && node scripts/shipreport.js receipts --corpus evals/baseline/corpus --draft evals/baseline/draft.json > $OUT/receipts.txt && node scripts/shipreport.js render --corpus evals/baseline/corpus --draft evals/baseline/draft.json --out $OUT/report.html --byline natejswenson.io --no-open > /dev/null
//   skillfactory freeze --skill shipreport --from <that dir> --command "C=\"--corpus evals/baseline/corpus --since 2026-07-28T00:00:00Z --until 2026-08-04T00:00:00Z\"; node scripts/shipreport.js rank $C > $OUT/rank.txt && node scripts/shipreport.js rank $C --kind session --limit 15 > $OUT/rank-sessions.txt && node scripts/shipreport.js receipts --corpus evals/baseline/corpus --draft evals/baseline/draft.json > $OUT/receipts.txt && node scripts/shipreport.js render --corpus evals/baseline/corpus --draft evals/baseline/draft.json --out $OUT/report.html --byline natejswenson.io --no-open > /dev/null"

const sh = (cmd, cwd) => execFileSync('bash', ['-lc', cmd], { cwd, encoding: 'utf8' });

test('the frozen run covers real artifacts', () => {
  // Anti-vacuity floor: a manifest over zero artifacts would let every
  // assertion below iterate nothing and still report green.
  assert.ok(manifest.artifacts.length >= 4, 'the frozen run lost artifacts — refresh or explain');
  for (const a of manifest.artifacts) {
    assert.ok(existsSync(join(BASELINE, a.path)), `frozen artifact missing: ${a.path}`);
  }
});

test('re-running the frozen command reproduces it byte for byte', () => {
  const out = mkdtempSync(join(tmpdir(), 'shipreport-baseline-'));
  sh(manifest.command.replaceAll('$OUT', out), SKILL);
  for (const a of manifest.artifacts) {
    const produced = readFileSync(join(out, a.path));
    const frozen = readFileSync(join(BASELINE, a.path));
    assert.deepEqual(produced, frozen, `${a.path} drifted from the frozen run — inspect the diff before refreshing`);
  }
});

test('the known-bad case still fails', () => {
  // Two-sided. A baseline that only asserts good-input-passes goes green the
  // day someone weakens the checker.
  assert.throws(
    () => sh("node scripts/shipreport.js receipts --corpus evals/baseline/corpus --draft evals/baseline/draft-unresolvable.json", SKILL),
    'the known-bad input stopped failing — the checker has been weakened, not the input fixed',
  );
});

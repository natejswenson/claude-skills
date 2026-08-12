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

// Pinned against a real run of netwatch. Refresh with:
//   cp evals/baseline/capture.txt evals/baseline/baseline.json "<a fresh dir>"/ && node scripts/netwatch.js report --snapshot "$OUT/capture.txt" --baseline "$OUT/baseline.json" > "$OUT/report.txt"
//   skillfactory freeze --skill netwatch --from <that dir> --command "cp evals/baseline/capture.txt evals/baseline/baseline.json \"$OUT\"/ && node scripts/netwatch.js report --snapshot \"$OUT/capture.txt\" --baseline \"$OUT/baseline.json\" > \"$OUT/report.txt\""

const sh = (cmd, cwd) => execFileSync('bash', ['-lc', cmd], { cwd, encoding: 'utf8' });

test('the frozen run covers real artifacts', () => {
  // Anti-vacuity floor: a manifest over zero artifacts would let every
  // assertion below iterate nothing and still report green.
  assert.ok(manifest.artifacts.length >= 3, 'the frozen run lost artifacts — refresh or explain');
  for (const a of manifest.artifacts) {
    assert.ok(existsSync(join(BASELINE, a.path)), `frozen artifact missing: ${a.path}`);
  }
});

test('re-running the frozen command reproduces it byte for byte', () => {
  const out = mkdtempSync(join(tmpdir(), 'netwatch-baseline-'));
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
    () => sh("node scripts/netwatch.js report --snapshot evals/baseline/capture.txt --baseline evals/baseline/baseline.json --verdict dangerous", SKILL),
    'the known-bad input stopped failing — the checker has been weakened, not the input fixed',
  );
});

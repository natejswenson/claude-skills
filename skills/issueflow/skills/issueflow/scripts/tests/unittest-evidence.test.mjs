import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { parseEvidence, parseAllEvidence, twoSided } from '../lib/evidence.mjs';

const summary = (count, result) => `Ran ${count} tests in 0.012s\n\n${result}\n`;

test('unittest summaries preserve positive counts, failures, errors, and result order', () => {
  assert.deepEqual(parseEvidence(summary(9, 'OK')), {
    runner: 'python unittest', passed: 9, failed: 0, exitCode: null, green: true,
  });
  const results = parseAllEvidence(summary(9, 'FAILED (failures=1, errors=2)') + summary(9, 'OK'));
  assert.equal(results.length, 2);
  assert.equal(results[0].passed, 6);
  assert.equal(results[0].failed, 3);
  assert.equal(twoSided(results).ok, true);
  assert.equal(parseEvidence('Ran 1 test in 0.001s\r\n\r\nOK\r\n').passed, 1);
});

test('unittest skipped and expected failures do not become passing tests', () => {
  assert.equal(parseEvidence(summary(3, 'OK (skipped=1, expected failures=1)')).passed, 1);
  for (const [count, result] of [[0, 'OK'], [2, 'OK (skipped=2)'], [1, 'OK (expected failures=1)']]) {
    const parsed = parseEvidence(summary(count, result));
    assert.equal(parsed.passed, 0);
    assert.equal(twoSided(parseAllEvidence(summary(1, 'FAILED (failures=1)') + summary(count, result))).ok, false);
  }
  const unexpected = parseEvidence(summary(1, 'FAILED (unexpected successes=1)'));
  assert.equal(unexpected.green, false);
  assert.equal(unexpected.failed, 1);
});

test('unittest malformed or incomplete summaries never establish success', () => {
  for (const text of [summary(1, 'OK (unknown=1)'), summary(1, 'OK (skipped=2)'),
    summary(1, 'OK (skipped=0, skipped=0)'), summary(1, 'FAILED'), 'Ran 9 tests in 0.1s\n', 'OK\n']) {
    assert.notEqual(parseEvidence(text)?.green, true, text);
  }
  assert.equal(parseEvidence(summary(1, 'OK') + 'exit code 7\n').green, false);
  assert.equal(twoSided(parseAllEvidence('ModuleNotFoundError: missing_dependency\n' + summary(1, 'FAILED (errors=1)') + summary(1, 'OK'))).ok, false);
});

test('actual Python unittest processes provide recognized evidence for both outcomes', () => {
  const results = [];
  for (const expected of [false, true]) {
    const code = `import unittest\nclass Case(unittest.TestCase):\n    def test_value(self):\n        self.assertEqual(1, ${expected ? 1 : 2})\nunittest.main(verbosity=2)\n`;
    const run = spawnSync('python3', ['-B', '-c', code], { encoding: 'utf8' });
    assert.equal(run.error, undefined);
    assert.equal(run.status, expected ? 0 : 1, run.stderr);
    const text = `${run.stdout}\n${run.stderr}`;
    assert.equal(parseEvidence(text)?.green, expected, text);
    results.push(...parseAllEvidence(text));
  }
  assert.equal(twoSided(results).ok, true);
});

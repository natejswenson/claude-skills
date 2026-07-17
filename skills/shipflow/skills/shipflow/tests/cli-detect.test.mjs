import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BIN_PATH = join(SKILL_ROOT, 'bin', 'shipflow.js');

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'shipflow-cli-detect-test-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runCli(args) {
  return spawnSync('node', [BIN_PATH, ...args], { encoding: 'utf8', timeout: 15_000 });
}

test('detect prints a rankedPatterns array with all 3 pattern ids', () => {
  withTempDir((dir) => {
    const r = runCli(['detect', '--repo', dir]);
    const output = JSON.parse(r.stdout);
    assert.ok(Array.isArray(output.rankedPatterns));
    assert.deepStrictEqual(
      output.rankedPatterns.map((p) => p.id).sort(),
      ['dev-main-promotion', 'gitflow', 'github-flow']
    );
  });
});

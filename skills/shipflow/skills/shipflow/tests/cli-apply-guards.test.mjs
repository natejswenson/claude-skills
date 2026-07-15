import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Integration tests for the CLI-level guards added after a Siege security
// audit (2026-07-15): both checks must fire before any gh/git network call,
// so they're safe to exercise here without a real remote or `gh auth`.

const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BIN_PATH = join(SKILL_ROOT, 'bin', 'shipflow.js');

function withMinimalRepo(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'shipflow-cli-test-'));
  try {
    mkdirSync(join(dir, '.github'), { recursive: true });
    writeFileSync(
      join(dir, '.github', 'shipflow.json'),
      JSON.stringify({
        branches: { main: 'main', dev: 'dev' },
        requiredChecks: ['ci'],
        mergeMethod: { devToMainMethod: 'merge' },
        protectionOwner: 'external',
        release: { enabled: true, mode: 'manual-gate', releaseCredential: 'SHIPFLOW_AUTOMERGE_PAT' },
        branchCleanup: { deleteOnMerge: true, protectedBranches: ['dev', 'main'] },
        renderedTemplateHashes: {},
      })
    );
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runCli(args) {
  return spawnSync('node', [BIN_PATH, ...args], { encoding: 'utf8', timeout: 15_000 });
}

// SIEGE-2026-07-15-002 (High, Hardening): --force with no accompanying
// justification had zero code-level friction beyond the flag itself.
test('apply refuses --force without --force-reason', () => {
  withMinimalRepo((dir) => {
    const r = runCli(['apply', '--repo', dir, '--dry-run', '--force', 'template:.github/workflows/dev-to-main-automerge.yml']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /--force-reason/);
  });
});

test('apply accepts --force when --force-reason is also given', () => {
  withMinimalRepo((dir) => {
    const r = runCli([
      'apply', '--repo', dir, '--dry-run',
      '--force', 'template:.github/workflows/dev-to-main-automerge.yml',
      '--force-reason', 'confirmed with user: intentional hand-edit override for test',
    ]);
    assert.notEqual(r.status, null);
    assert.doesNotMatch(r.stderr, /--force-reason/);
  });
});

// SIEGE-2026-07-15-003 (Medium, Active): --expect-state-hash was optional,
// so a real apply could silently proceed with zero drift protection.
test('apply refuses a real (non-dry-run) apply with neither --expect-state-hash nor --skip-hash-check', () => {
  withMinimalRepo((dir) => {
    const r = runCli(['apply', '--repo', dir]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /--expect-state-hash/);
  });
});

test('apply --dry-run does not require --expect-state-hash', () => {
  withMinimalRepo((dir) => {
    const r = runCli(['apply', '--repo', dir, '--dry-run']);
    assert.doesNotMatch(r.stderr, /--expect-state-hash is required/);
  });
});

test('apply --skip-hash-check bypasses the requirement without a hash', () => {
  withMinimalRepo((dir) => {
    const r = runCli(['apply', '--repo', dir, '--skip-hash-check']);
    assert.doesNotMatch(r.stderr, /--expect-state-hash is required/);
  });
});

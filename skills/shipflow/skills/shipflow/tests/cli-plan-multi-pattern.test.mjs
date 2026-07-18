import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// End-to-end coverage through bin/shipflow.js itself for github-flow/gitflow —
// unit-level coverage of each pattern module's templates()/detect() is solid
// (tests/patterns/*.test.mjs), but nothing previously exercised
// buildTemplateSources reading multiple .tmpl files off disk and computePlan
// wiring them all the way through the actual CLI entry point for these two
// patterns (only dev-main-promotion had that coverage, unchanged from before
// this refactor). Found as a gap during pre-PR red-team review.

const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BIN_PATH = join(SKILL_ROOT, 'bin', 'shipflow.js');

function withConfiguredRepo(config, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'shipflow-cli-plan-test-'));
  try {
    mkdirSync(join(dir, '.github'), { recursive: true });
    writeFileSync(join(dir, '.github', 'shipflow.json'), JSON.stringify(config));
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runCli(args) {
  return spawnSync('node', [BIN_PATH, ...args], { encoding: 'utf8', timeout: 15_000 });
}

test('plan --repo resolves workflowPattern: "github-flow" through the full CLI and renders its one template', () => {
  withConfiguredRepo({
    workflowPattern: 'github-flow',
    branches: { main: 'main' },
    requiredChecks: ['ci'],
    mergeMethod: { devToMainMethod: 'merge' },
    protectionOwner: 'external',
    release: { enabled: true, mode: 'manual-gate', releaseCredential: 'SHIPFLOW_AUTOMERGE_PAT' },
    branchCleanup: { deleteOnMerge: true },
    renderedTemplateHashes: {},
  }, (dir) => {
    const r = runCli(['plan', '--repo', dir]);
    assert.equal(r.status, 0, r.stderr);
    const output = JSON.parse(r.stdout);
    const entry = output.plan.creates.find((e) => e.id.startsWith('template:'));
    assert.ok(entry, 'expected a template create entry');
    assert.equal(entry.path, '.github/workflows/main-automerge.yml');
    assert.match(entry.content, /gh pr merge --auto --merge/);
    const ifLines = entry.content.split('\n').filter((l) => l.trim().startsWith('if:'));
    assert.ok(ifLines.length > 0, 'expected at least one if: condition');
    for (const line of ifLines) {
      assert.doesNotMatch(line, /head\.ref/, `github-flow's template has no head.ref restriction, found in: ${line}`);
    }
    assert.deepStrictEqual(output.plan.protectedBranches, ['main']);
  });
});

test('plan --repo resolves workflowPattern: "gitflow" through the full CLI and renders all 4 templates', () => {
  withConfiguredRepo({
    workflowPattern: 'gitflow',
    branches: { dev: 'develop', main: 'main' },
    requiredChecks: ['ci'],
    mergeMethod: { devToMainMethod: 'merge' },
    protectionOwner: 'external',
    release: { enabled: true, mode: 'manual-gate', releaseCredential: 'SHIPFLOW_AUTOMERGE_PAT' },
    branchCleanup: { deleteOnMerge: true },
    patternConfig: { gitflow: { releaseBranchPrefix: 'release/', hotfixBranchPrefix: 'hotfix/' } },
    renderedTemplateHashes: {},
  }, (dir) => {
    const r = runCli(['plan', '--repo', dir]);
    assert.equal(r.status, 0, r.stderr);
    const output = JSON.parse(r.stdout);
    const templateEntries = output.plan.creates.filter((e) => e.id.startsWith('template:'));
    assert.deepStrictEqual(
      templateEntries.map((e) => e.path).sort(),
      [
        '.github/workflows/hotfix-automerge.yml',
        '.github/workflows/hotfix-merge-back.yml',
        '.github/workflows/release-automerge.yml',
        '.github/workflows/release-merge-back.yml',
      ]
    );
    const releaseAutomerge = templateEntries.find((e) => e.path === '.github/workflows/release-automerge.yml');
    assert.match(releaseAutomerge.content, /startsWith\(github\.event\.pull_request\.head\.ref, 'release\/'\)/);
    assert.deepStrictEqual(output.plan.protectedBranches, ['develop', 'main']);
  });
});

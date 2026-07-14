import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  listWorkflowJobNames,
  findSettingsAsCodeArtifact,
  classifyProtectionOwner,
} from '../lib/detect.mjs';

function withTempRepo(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'shipflow-test-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('listWorkflowJobNames extracts job names from workflow YAML', () => {
  withTempRepo((dir) => {
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
    writeFileSync(
      join(dir, '.github', 'workflows', 'ci.yml'),
      'name: ci\non:\n  push:\njobs:\n  build:\n    runs-on: ubuntu-latest\n  test:\n    runs-on: ubuntu-latest\n'
    );
    const names = listWorkflowJobNames(dir, ['.github/workflows/ci.yml']);
    assert.deepEqual(names, ['build', 'test']);
  });
});

test('listWorkflowJobNames dedupes job names across multiple workflow files', () => {
  withTempRepo((dir) => {
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
    writeFileSync(join(dir, '.github', 'workflows', 'a.yml'), 'jobs:\n  shared:\n    runs-on: ubuntu-latest\n');
    writeFileSync(join(dir, '.github', 'workflows', 'b.yml'), 'jobs:\n  shared:\n    runs-on: ubuntu-latest\n  only-in-b:\n    runs-on: ubuntu-latest\n');
    const names = listWorkflowJobNames(dir, ['.github/workflows/a.yml', '.github/workflows/b.yml']);
    assert.deepEqual(names, ['only-in-b', 'shared']);
  });
});

test('findSettingsAsCodeArtifact matches a repo-settings.sh-style filename', () => {
  withTempRepo((dir) => {
    mkdirSync(join(dir, '.github'), { recursive: true });
    writeFileSync(join(dir, '.github', 'repo-settings.sh'), '#!/bin/bash\necho hi\n');
    const found = findSettingsAsCodeArtifact(dir, ['.github/repo-settings.sh']);
    assert.equal(found, '.github/repo-settings.sh');
  });
});

test('findSettingsAsCodeArtifact matches Terraform content even with a generic filename', () => {
  withTempRepo((dir) => {
    writeFileSync(join(dir, 'main.tf'), 'resource "github_branch_protection" "main" {\n  pattern = "main"\n}\n');
    const found = findSettingsAsCodeArtifact(dir, ['main.tf']);
    assert.equal(found, 'main.tf');
  });
});

test('findSettingsAsCodeArtifact returns null when nothing matches', () => {
  withTempRepo((dir) => {
    writeFileSync(join(dir, 'README.md'), '# hello\n');
    const found = findSettingsAsCodeArtifact(dir, ['README.md']);
    assert.equal(found, null);
  });
});

test('classifyProtectionOwner returns "external" when a settings-as-code artifact was found', () => {
  const owner = classifyProtectionOwner({
    settingsAsCodeArtifact: '.github/repo-settings.sh',
    protection: { main: { requiredChecks: ['ci'] } },
  });
  assert.equal(owner, 'external');
});

test('classifyProtectionOwner returns "shipflow" when no protection exists at all', () => {
  const owner = classifyProtectionOwner({
    settingsAsCodeArtifact: null,
    protection: { main: null, dev: null },
  });
  assert.equal(owner, 'shipflow');
});

test('classifyProtectionOwner returns "ambiguous" when protection exists but no artifact was found', () => {
  const owner = classifyProtectionOwner({
    settingsAsCodeArtifact: null,
    protection: { main: { requiredChecks: ['ci'] }, dev: null },
  });
  assert.equal(owner, 'ambiguous');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  listWorkflowJobNames,
  findSettingsAsCodeArtifact,
  classifyProtectionOwner,
  resolveOwnerRepo,
  detectRepoState,
} from '../lib/detect.mjs';
import { readFileCapped, git } from '../lib/gh.mjs';
import { listPatterns } from '../lib/pattern-registry.mjs';

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
      'name: ci\non:\n  pull_request:\n  push:\njobs:\n  build:\n    runs-on: ubuntu-latest\n  test:\n    runs-on: ubuntu-latest\n'
    );
    const names = listWorkflowJobNames(dir, ['.github/workflows/ci.yml']);
    assert.deepEqual(names, ['build', 'test']);
  });
});

test('listWorkflowJobNames dedupes job names across multiple workflow files', () => {
  withTempRepo((dir) => {
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
    writeFileSync(join(dir, '.github', 'workflows', 'a.yml'), 'on:\n  pull_request:\njobs:\n  shared:\n    runs-on: ubuntu-latest\n');
    writeFileSync(join(dir, '.github', 'workflows', 'b.yml'), 'on:\n  pull_request:\njobs:\n  shared:\n    runs-on: ubuntu-latest\n  only-in-b:\n    runs-on: ubuntu-latest\n');
    const names = listWorkflowJobNames(dir, ['.github/workflows/a.yml', '.github/workflows/b.yml']);
    assert.deepEqual(names, ['only-in-b', 'shared']);
  });
});

test('listWorkflowJobNames excludes jobs from a workflow with no pull_request trigger', () => {
  withTempRepo((dir) => {
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
    writeFileSync(
      join(dir, '.github', 'workflows', 'weekly-archive.yml'),
      'name: Weekly Archive\non:\n  schedule:\n    - cron: "5 0 * * 1"\n  workflow_dispatch:\njobs:\n  archive:\n    runs-on: ubuntu-latest\n'
    );
    const names = listWorkflowJobNames(dir, ['.github/workflows/weekly-archive.yml']);
    assert.deepEqual(names, []);
  });
});

test('listWorkflowJobNames includes jobs from a pull_request_target-triggered workflow', () => {
  withTempRepo((dir) => {
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
    writeFileSync(
      join(dir, '.github', 'workflows', 'auto-merge.yml'),
      'on:\n  pull_request_target:\n    types: [opened]\njobs:\n  auto-merge:\n    runs-on: ubuntu-latest\n'
    );
    const names = listWorkflowJobNames(dir, ['.github/workflows/auto-merge.yml']);
    assert.deepEqual(names, ['auto-merge']);
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

function withGitRemote(remoteUrl, fn) {
  withTempRepo((dir) => {
    spawnSync('git', ['init', '--quiet'], { cwd: dir });
    spawnSync('git', ['remote', 'add', 'origin', remoteUrl], { cwd: dir });
    fn(dir);
  });
}

// Regression tests for findings from a Siege security audit (2026-07-15):
// an all-dots owner/repo segment (e.g. from a crafted remote URL like
// "github.com/../..") matched the [\w.-]+ capture and produced an
// ownerRepo string that would normalize away the intended
// repos/<owner>/<repo> prefix once interpolated into gh api paths.
test('resolveOwnerRepo returns the ownerRepo for a normal remote', () => {
  withGitRemote('https://github.com/natejswenson/claude-skills.git', (dir) => {
    assert.equal(resolveOwnerRepo(dir), 'natejswenson/claude-skills');
  });
});

test('resolveOwnerRepo rejects an all-dots owner segment', () => {
  withGitRemote('https://github.com/../claude-skills.git', (dir) => {
    assert.equal(resolveOwnerRepo(dir), null);
  });
});

test('resolveOwnerRepo rejects an all-dots repo segment', () => {
  withGitRemote('https://github.com/natejswenson/...git', (dir) => {
    assert.equal(resolveOwnerRepo(dir), null);
  });
});

// Regression test for a resource-exhaustion finding from the same audit:
// .github/shipflow.json and other repo-tracked files detect.mjs reads are
// repo-write-controlled, not admin-only — readFileCapped must refuse an
// oversized file rather than let JSON.parse/readFileSync run unbounded.
test('readFileCapped refuses a file over the safety cap', () => {
  withTempRepo((dir) => {
    const big = join(dir, 'big.json');
    writeFileSync(big, 'x'.repeat(1_000_001));
    assert.throws(() => readFileCapped(big), /exceeds the .* safety cap/);
  });
});

test('readFileCapped reads a normal-sized file fine', () => {
  withTempRepo((dir) => {
    const small = join(dir, 'small.json');
    writeFileSync(small, '{"ok":true}');
    assert.equal(readFileCapped(small), '{"ok":true}');
  });
});

// withTempRepo above does NOT git init — it only mkdtemps a bare directory,
// which is sufficient for every existing test in this file since they all call
// low-level functions directly with an explicit tracked-files array. The tests
// below call detectRepoState directly, which shells out to git tag/remote/ls-files
// — none of which work (or worse, silently no-op rather than crash, since
// lib/gh.mjs's git() wrapper never throws on a non-zero exit) against a bare
// directory with no .git at all. This helper actually initializes a repo with
// one commit so those calls have something real to operate on.
function withTempGitRepo(fn) {
  withTempRepo((dir) => {
    // -b main pins the initial branch name explicitly rather than relying on the
    // ambient init.defaultBranch config (which varies by machine/CI image) — every
    // test below asserts against config.branches.main === 'main', so the repo's
    // actual default branch must match that literally, not "whatever this git
    // install happens to default to".
    spawnSync('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
    spawnSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: dir });
    spawnSync('git', ['config', 'user.name', 'Shipflow Test'], { cwd: dir });
    // git tag/tag --merged both require at least one commit to exist (there is no
    // valid HEAD to tag or compare against in a brand-new repo) — a placeholder
    // commit gives every test below a real commit to build on.
    writeFileSync(join(dir, 'README.md'), '# fixture repo\n');
    spawnSync('git', ['add', 'README.md'], { cwd: dir });
    spawnSync('git', ['commit', '--quiet', '-m', 'init'], { cwd: dir });
    fn(dir);
  });
}

test('detectRepoState templateFiles covers every pattern\'s templateTargetPaths, not one hardcoded key', () => {
  withTempGitRepo((dir) => {
    const repoState = detectRepoState(dir, { branches: { main: 'main', dev: 'dev' } });
    const expectedKeys = listPatterns().flatMap((p) => p.templateTargetPaths);
    assert.deepStrictEqual(Object.keys(repoState.templateFiles).sort(), expectedKeys.sort());
  });
});

test('detectRepoState reports hasTagsFromMain', () => {
  withTempGitRepo((dir) => {
    git(['tag', 'v0.1.0'], { cwd: dir });
    const repoState = detectRepoState(dir, { branches: { main: 'main', dev: 'dev' } });
    assert.strictEqual(repoState.hasTagsFromMain, true);
  });
});

test('detectRepoState reports hasGitflowMarker via a .gitflow file', () => {
  // Plain withTempRepo is fine here — hasGitflowMarker is a pure existsSync check
  // (or a git-config read that fails closed to false), not tracked-file-list-backed,
  // so this test never needed a real repo.
  withTempRepo((dir) => {
    writeFileSync(join(dir, '.gitflow'), '[gitflow "branch"]\n\tmaster = main\n\tdevelop = develop\n');
    const repoState = detectRepoState(dir, { branches: { main: 'main', dev: 'dev' } });
    assert.strictEqual(repoState.hasGitflowMarker, true);
  });
});

test('detectRepoState scans a workflow\'s own job block, never a different job\'s head.ref == condition', () => {
  withTempGitRepo((dir) => {
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
    // Job A: gh pr merge --auto guarded by its own head.ref == 'dev'. Job B: an
    // unrelated job that also happens to contain a head.ref == check, for a
    // different purpose — this must NOT be attributed to job A.
    writeFileSync(join(dir, '.github', 'workflows', 'mixed.yml'), `
on:
  pull_request:
    branches: [main]
jobs:
  auto-merge:
    if: github.event.pull_request.head.ref == 'dev'
    steps:
      - run: gh pr merge --auto --merge "$PR"
  unrelated-job:
    if: github.event.pull_request.head.ref == 'something-else'
    steps:
      - run: echo hi
`);
    // detectRepoState finds workflow files via git ls-files (listTrackedFiles) —
    // they must be staged, not just written to disk, or the scanner never sees them.
    spawnSync('git', ['add', '-A'], { cwd: dir });
    const repoState = detectRepoState(dir, { branches: { main: 'main', dev: 'dev' } });
    assert.strictEqual(repoState.hasRestrictedPromotionWorkflow, true);
    assert.strictEqual(repoState.hasUnrestrictedAutomergeWorkflow, false);
  });
});

test('detectRepoState does NOT misattribute an unrelated job\'s head.ref == to an unrestricted auto-merge job in the same file', () => {
  withTempGitRepo((dir) => {
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
    // Job A: gh pr merge --auto with NO head.ref guard of its own (unrestricted).
    // Job B: unrelated, has a head.ref == check for something else entirely. If the
    // scan incorrectly spans the whole jobs: section (the bug this test guards
    // against), job B's condition would get misattributed to job A, and
    // hasRestrictedPromotionWorkflow would wrongly read true.
    writeFileSync(join(dir, '.github', 'workflows', 'mixed2.yml'), `
on:
  pull_request:
    branches: [main]
jobs:
  auto-merge:
    steps:
      - run: gh pr merge --auto --merge "$PR"
  unrelated-job:
    if: github.event.pull_request.head.ref == 'something-else'
    steps:
      - run: echo hi
`);
    spawnSync('git', ['add', '-A'], { cwd: dir });
    const repoState = detectRepoState(dir, { branches: { main: 'main', dev: 'dev' } });
    assert.strictEqual(repoState.hasUnrestrictedAutomergeWorkflow, true);
    assert.strictEqual(repoState.hasRestrictedPromotionWorkflow, false);
  });
});

test('detectRepoState reports configuredRemotes for pattern-registry.mjs\'s branch normalization', () => {
  withTempGitRepo((dir) => {
    git(['remote', 'add', 'origin', 'https://example.invalid/x/y.git'], { cwd: dir });
    const repoState = detectRepoState(dir, { branches: { main: 'main', dev: 'dev' } });
    assert.deepStrictEqual(repoState.configuredRemotes, ['origin']);
  });
});

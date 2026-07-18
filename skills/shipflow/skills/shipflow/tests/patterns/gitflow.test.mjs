import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, readFileSync as readFileSyncFs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { protectedBranches, detect, templates } from '../../lib/patterns/gitflow/index.mjs';
import { renderTemplate } from '../../lib/render.mjs';

test('protectedBranches returns [config.branches.dev, main] — release/hotfix branches excluded', () => {
  assert.deepStrictEqual(
    protectedBranches({ branches: { dev: 'develop', main: 'main' } }),
    ['develop', 'main']
  );
});

test('detect: +0.5 dev branch exists, +0.5 release/hotfix branch exists (independent, additive)', () => {
  assert.strictEqual(detect({
    hasDevBranch: true, hasReleaseOrHotfixBranch: true,
    hasGitflowMarker: false, hasRestrictedPromotionWorkflow: false, hasUnrestrictedAutomergeWorkflow: false, hasTagsFromMain: false,
  }).score, 1.0);
});

test('detect: lone hotfix branch with no develop scores 0.5', () => {
  assert.strictEqual(detect({
    hasDevBranch: false, hasReleaseOrHotfixBranch: true,
    hasGitflowMarker: false, hasRestrictedPromotionWorkflow: false, hasUnrestrictedAutomergeWorkflow: false, hasTagsFromMain: false,
  }).score, 0.5);
});

test('templates returns exactly 4 entries: release-automerge, hotfix-automerge, hotfix-merge-back, release-merge-back', () => {
  const config = {
    branches: { dev: 'develop', main: 'main' },
    mergeMethod: { devToMainMethod: 'merge' },
    release: { releaseCredential: 'RELEASE_PAT' },
    patternConfig: { gitflow: { releaseBranchPrefix: 'release/', hotfixBranchPrefix: 'hotfix/' } },
  };
  const entries = templates(config);
  assert.deepStrictEqual(entries.map((e) => e.id).sort(), [
    'hotfix-automerge', 'hotfix-merge-back', 'release-automerge', 'release-merge-back',
  ]);
  const releaseAutomerge = entries.find((e) => e.id === 'release-automerge');
  assert.strictEqual(releaseAutomerge.params.releaseBranchPrefix, 'release/');
});

// The template's YAML has no parser in this codebase's style (see detect.mjs's own
// no-YAML-parser precedent) — extract each named step's `run: |` block by locating
// its `name:` line, then its `run: |` line, then every subsequent line indented
// deeper than `run:` itself, matching listWorkflowJobNames'/scanWorkflowShapeSignals'
// existing dedent-detection approach rather than introducing a new one.
function extractRunBlock(yamlText, nameSubstring) {
  const lines = yamlText.split('\n');
  const nameIdx = lines.findIndex((l) => l.includes(nameSubstring));
  const runIdx = lines.findIndex((l, i) => i > nameIdx && l.trim() === 'run: |');
  const runIndent = lines[runIdx].match(/^(\s*)/)[1].length;
  const body = [];
  for (let i = runIdx + 1; i < lines.length; i++) {
    const indent = lines[i].match(/^(\s*)/)[1].length;
    if (lines[i].trim() !== '' && indent <= runIndent) break;
    body.push(lines[i].slice(runIndent + 2));
  }
  return body.join('\n');
}

test('hotfix-merge-back: a genuine conflict never force-pushes and opens a PR instead (INV-MP-8)', () => {
  const config = {
    branches: { dev: 'dev', main: 'main' },
    mergeMethod: { devToMainMethod: 'merge' },
    release: { releaseCredential: 'RELEASE_PAT' },
    patternConfig: { gitflow: { releaseBranchPrefix: 'release/', hotfixBranchPrefix: 'hotfix/' } },
  };
  const entry = templates(config).find((e) => e.id === 'hotfix-merge-back');
  const templateSource = readFileSyncFs(entry.templateSourcePath, 'utf8');
  const rendered = renderTemplate(templateSource, entry.params);

  // Static check: the invariant's literal claim — no force-push flag anywhere in
  // either run: block, independent of whether the dynamic conflict path below
  // happens to exercise every line.
  assert.doesNotMatch(rendered, /git push[^\n]*(--force|-f\b)/);

  const mergeScript = extractRunBlock(rendered, 'Attempt a clean merge');
  const fallbackScript = extractRunBlock(rendered, 'On any failure');

  const root = mkdtempSync(join(tmpdir(), 'shipflow-mergeback-'));
  const originDir = join(root, 'origin.git');
  const workDir = join(root, 'work');
  const binDir = join(root, 'bin');
  const ghLog = join(root, 'gh-calls.log');
  try {
    spawnSync('git', ['init', '--quiet', '--bare', '-b', 'main', originDir]);
    spawnSync('git', ['clone', '--quiet', originDir, workDir]);
    const gitIn = (args) => spawnSync('git', args, { cwd: workDir, encoding: 'utf8' });
    gitIn(['config', 'user.email', 'test@example.invalid']);
    gitIn(['config', 'user.name', 'Shipflow Test']);
    writeFileSync(join(workDir, 'shared.txt'), 'base\n');
    gitIn(['add', 'shared.txt']);
    gitIn(['commit', '--quiet', '-m', 'base']);
    gitIn(['push', '--quiet', 'origin', 'main']);
    gitIn(['checkout', '--quiet', '-b', 'dev']);
    writeFileSync(join(workDir, 'shared.txt'), 'dev-side change\n');
    gitIn(['commit', '--quiet', '-am', 'dev change']);
    gitIn(['push', '--quiet', 'origin', 'dev']);
    gitIn(['checkout', '--quiet', 'main']);
    writeFileSync(join(workDir, 'shared.txt'), 'main-side conflicting change\n');
    gitIn(['commit', '--quiet', '-am', 'main change']);
    gitIn(['push', '--quiet', 'origin', 'main']);
    gitIn(['fetch', '--quiet', 'origin']);
    const devHeadBefore = gitIn(['rev-parse', 'origin/dev']).stdout.trim();

    // Fake `gh` on PATH: records argv instead of touching the network.
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(binDir, 'gh'), '#!/bin/sh\necho "$@" >> ' + JSON.stringify(ghLog) + '\n');
    chmodSync(join(binDir, 'gh'), 0o755);
    const env = { ...process.env, PATH: `${binDir}:${process.env.PATH}` };

    // fallbackScript contains a literal `${{ github.run_id }}` GitHub Actions
    // expression (inside the shipflow/merge-back-...-${{ github.run_id }} branch
    // name) — in real GitHub Actions the runner textually pre-substitutes every
    // `${{ ... }}` expression BEFORE handing the script to bash; renderTemplate's
    // own token regex (\{\{(\w+)\}\}, no leading `$`, no space after `{{`)
    // deliberately does not touch it, so it survives extraction unresolved. Running
    // it through bash as-is is a bad substitution (bash reads `${{` as a parameter
    // expansion). Stand in for the runner's own pre-substitution step with a fixed
    // literal, exactly as the real runner would substitute a real run id:
    const executableFallback = fallbackScript.replace('${{ github.run_id }}', '999');

    writeFileSync(join(root, 'merge.sh'), mergeScript);
    writeFileSync(join(root, 'fallback.sh'), executableFallback);

    const mergeResult = spawnSync('bash', ['-e', '-o', 'pipefail', join(root, 'merge.sh')], { cwd: workDir, env, encoding: 'utf8' });
    assert.notStrictEqual(mergeResult.status, 0, 'the conflicting merge must fail, not silently resolve');

    const fallbackResult = spawnSync('bash', ['-e', '-o', 'pipefail', join(root, 'fallback.sh')], { cwd: workDir, env, encoding: 'utf8' });
    assert.strictEqual(fallbackResult.status, 0);

    const ghCalls = readFileSyncFs(ghLog, 'utf8');
    assert.match(ghCalls, /pr create/);
    assert.match(ghCalls, /--base dev/);

    const devHeadAfter = gitIn(['rev-parse', 'origin/dev']).stdout.trim();
    assert.strictEqual(devHeadAfter, devHeadBefore, 'origin/dev must be untouched — no merge landed and no force-push occurred');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

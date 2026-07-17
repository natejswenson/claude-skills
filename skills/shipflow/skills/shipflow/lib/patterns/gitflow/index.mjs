import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeMethodToFlag } from '../../render.mjs';

const PATTERN_DIR = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = join(PATTERN_DIR, '..', '..', '..', 'templates', 'gitflow');

export const id = 'gitflow';
export const templateTargetPaths = [
  '.github/workflows/release-automerge.yml',
  '.github/workflows/hotfix-automerge.yml',
  '.github/workflows/hotfix-merge-back.yml',
  '.github/workflows/release-merge-back.yml',
];

// release/*  and hotfix/*  are deliberately excluded — transient, cleaned up
// post-merge like any feature branch under every pattern.
export function protectedBranches(config) {
  return [config.branches.dev, config.branches.main];
}

export function templates(config) {
  const releasePrefix = config.patternConfig?.gitflow?.releaseBranchPrefix ?? 'release/';
  const hotfixPrefix = config.patternConfig?.gitflow?.hotfixBranchPrefix ?? 'hotfix/';
  const baseParams = {
    devBranch: config.branches.dev,
    mainBranch: config.branches.main,
    mergeFlag: mergeMethodToFlag(config.mergeMethod?.devToMainMethod),
    releaseCredentialSecret: config.release?.releaseCredential ?? 'GITHUB_TOKEN',
    releaseBranchPrefix: releasePrefix,
    hotfixBranchPrefix: hotfixPrefix,
  };
  return [
    { id: 'release-automerge', targetPath: '.github/workflows/release-automerge.yml',
      templateSourcePath: join(TEMPLATE_DIR, 'release-automerge.yml.tmpl'), params: baseParams },
    { id: 'hotfix-automerge', targetPath: '.github/workflows/hotfix-automerge.yml',
      templateSourcePath: join(TEMPLATE_DIR, 'hotfix-automerge.yml.tmpl'), params: baseParams },
    { id: 'hotfix-merge-back', targetPath: '.github/workflows/hotfix-merge-back.yml',
      templateSourcePath: join(TEMPLATE_DIR, 'hotfix-merge-back.yml.tmpl'), params: baseParams },
    { id: 'release-merge-back', targetPath: '.github/workflows/release-merge-back.yml',
      templateSourcePath: join(TEMPLATE_DIR, 'release-merge-back.yml.tmpl'), params: baseParams },
  ];
}

export function detect(signals) {
  const evidence = [];
  let score = 0;
  if (signals.hasDevBranch) { score += 0.5; evidence.push('a develop/dev/staging branch exists'); }
  if (signals.hasReleaseOrHotfixBranch) { score += 0.5; evidence.push('a release/*  or hotfix/*  branch exists'); }
  // hasGitflowMarker is a best-effort bonus signal only — carries no numeric
  // weight in v1 (see design doc's Autodetection section).
  return { score, evidence };
}

export function planEntries() { return []; }

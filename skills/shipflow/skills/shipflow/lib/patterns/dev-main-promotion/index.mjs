import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeMethodToFlag } from '../../render.mjs';

const PATTERN_DIR = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_SOURCE_PATH = join(
  PATTERN_DIR, '..', '..', '..', 'templates', 'dev-main-promotion', 'dev-to-main-automerge.yml.tmpl'
);
const TARGET_PATH = '.github/workflows/dev-to-main-automerge.yml';

export const id = 'dev-main-promotion';
export const templateTargetPaths = [TARGET_PATH];

export function protectedBranches(config) {
  return [config.branches.dev, config.branches.main];
}

export function templates(config) {
  return [{
    id: 'dev-to-main-automerge',
    targetPath: TARGET_PATH,
    templateSourcePath: TEMPLATE_SOURCE_PATH,
    params: {
      devBranch: config.branches.dev,
      mainBranch: config.branches.main,
      mergeFlag: mergeMethodToFlag(config.mergeMethod?.devToMainMethod),
      releaseCredentialSecret: config.release?.releaseCredential ?? 'GITHUB_TOKEN',
    },
  }];
}

// signals: precomputed DetectionSignals (see pattern-registry.mjs's computeDetectionSignals).
export function detect(signals) {
  const evidence = [];
  let score = 0;
  if (signals.hasDevBranch && !signals.hasReleaseOrHotfixBranch) {
    score += 0.5;
    evidence.push('a dev/develop/staging branch exists with no release/*  or hotfix/*  branches present');
  }
  if (signals.hasRestrictedPromotionWorkflow) {
    score += 0.5;
    evidence.push('an existing workflow restricts auto-merge-to-main to one specific branch');
  }
  return { score, evidence };
}

export function planEntries(_repoState, _config) {
  return [];
}

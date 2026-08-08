import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeMethodToFlag } from '../../render.mjs';

const PATTERN_DIR = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_SOURCE_PATH = join(PATTERN_DIR, '..', '..', '..', 'templates', 'github-flow', 'main-automerge.yml.tmpl');
const TARGET_PATH = '.github/workflows/main-automerge.yml';

export const id = 'github-flow';
export const templateTargetPaths = [TARGET_PATH];

export function protectedBranches(config) {
  return [config.branches.main];
}

export function templates(config) {
  return [{
    id: 'main-automerge',
    targetPath: TARGET_PATH,
    templateSourcePath: TEMPLATE_SOURCE_PATH,
    params: {
      mainBranch: config.branches.main,
      mergeFlag: mergeMethodToFlag(config.mergeMethod?.devToMainMethod),
      releaseCredentialSecret: config.release?.releaseCredential ?? 'GITHUB_TOKEN',
    },
  }];
}

export function detect(signals) {
  const evidence = [];
  let score = 0;
  if (signals.hasUnrestrictedAutomergeWorkflow || signals.hasTagsFromMain) {
    score += 0.5;
    evidence.push('an unrestricted auto-merge-to-main workflow exists, or tags are reachable from main');
  }
  if (!signals.hasDevBranch && !signals.hasReleaseOrHotfixBranch) {
    score += 0.3;
    evidence.push('no dev/develop/staging branch and no release/*  or hotfix/*  branches exist');
  }
  return { score, evidence };
}

export function planEntries() { return []; }

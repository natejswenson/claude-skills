export const id = 'gitflow';
export const templateTargetPaths = [
  '.github/workflows/release-automerge.yml',
  '.github/workflows/hotfix-automerge.yml',
  '.github/workflows/hotfix-merge-back.yml',
  '.github/workflows/release-merge-back.yml',
];
export function detect() { return { score: 0, evidence: [] }; }
export function protectedBranches(config) { return [config.branches.dev, config.branches.main]; }
export function templates() { return []; }
export function planEntries() { return []; }

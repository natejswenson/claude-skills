export const id = 'github-flow';
export const templateTargetPaths = ['.github/workflows/main-automerge.yml'];
export function detect() { return { score: 0, evidence: [] }; }
export function protectedBranches(config) { return [config.branches.main]; }
export function templates() { return []; }
export function planEntries() { return []; }

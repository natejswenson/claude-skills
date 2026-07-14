import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnArgs, ghApiJson, git, sha256 } from './gh.mjs';

const TEMPLATE_RELATIVE_PATH = '.github/workflows/dev-to-main-automerge.yml';
const CONFIG_RELATIVE_PATH = '.github/shipflow.json';

// Files/content patterns that indicate branch protection is already managed
// as code elsewhere in the repo — see the design's "Rulesets vs. an existing
// settings-as-code source of truth" discussion. Matching one of these is
// what makes protectionOwner classify as "external" instead of falling
// through to the ambiguous (protection-exists-but-no-artifact) prompt case.
const SETTINGS_AS_CODE_NAME_RE = /repo-settings\.(sh|js|mjs|py)$/i;
const SETTINGS_AS_CODE_CONTENT_RE =
  /github_branch_protection|github_repository_ruleset|branches\/[\w-]+\/protection/;

export function resolveOwnerRepo(repoPath) {
  const r = git(['remote', 'get-url', 'origin'], { cwd: repoPath });
  if (r.status !== 0) return null;
  const m = r.stdout.match(/github\.com[:/]([\w.-]+)\/([\w.-]+?)(\.git)?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

export function listTrackedFiles(repoPath) {
  const r = git(['ls-files'], { cwd: repoPath });
  return r.status === 0 ? r.stdout.split('\n').filter(Boolean) : [];
}

// Finds a settings-as-code artifact by name pattern first (cheap), then by
// content pattern for anything under .github/ or a common IaC directory
// (avoids grepping the whole tree — bounded to files a settings-as-code
// script/config plausibly lives in).
export function findSettingsAsCodeArtifact(repoPath, trackedFiles) {
  const byName = trackedFiles.find((f) => SETTINGS_AS_CODE_NAME_RE.test(f));
  if (byName) return byName;

  const candidates = trackedFiles.filter(
    (f) => f.startsWith('.github/') || /\.(tf|tfvars)$/i.test(f) || /pulumi/i.test(f)
  );
  for (const f of candidates) {
    const full = join(repoPath, f);
    if (!existsSync(full)) continue;
    let content;
    try {
      content = readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    if (SETTINGS_AS_CODE_CONTENT_RE.test(content)) return f;
  }
  return null;
}

export function listWorkflowJobNames(repoPath, trackedFiles) {
  const names = new Set();
  const jobNameRe = /^\s{2}([\w.-]+):\s*$/;
  for (const f of trackedFiles.filter((f) => /^\.github\/workflows\/.*\.ya?ml$/.test(f))) {
    const full = join(repoPath, f);
    if (!existsSync(full)) continue;
    let content;
    try {
      content = readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    const lines = content.split('\n');
    const jobsLineIdx = lines.findIndex((l) => l.trim() === 'jobs:');
    if (jobsLineIdx === -1) continue;
    for (const line of lines.slice(jobsLineIdx + 1)) {
      if (line.trim() !== '' && /^\S/.test(line)) break; // dedented out of the jobs: block
      const m = line.match(jobNameRe);
      if (m) names.add(m[1]);
    }
  }
  return [...names].sort();
}

export function readTemplateFileHash(repoPath) {
  const full = join(repoPath, TEMPLATE_RELATIVE_PATH);
  if (!existsSync(full)) return { exists: false, sha256: null };
  const content = readFileSync(full, 'utf8');
  return { exists: true, sha256: sha256(content) };
}

export function readExistingConfig(repoPath) {
  const full = join(repoPath, CONFIG_RELATIVE_PATH);
  if (!existsSync(full)) return null;
  try {
    return JSON.parse(readFileSync(full, 'utf8'));
  } catch {
    return null;
  }
}

export function fetchBranchProtection(ownerRepo, branch) {
  const r = ghApiJson(`repos/${ownerRepo}/branches/${branch}/protection`);
  if (!r.ok) return null;
  const checks = r.data?.required_status_checks?.contexts ?? [];
  return { requiredChecks: checks, raw: r.data };
}

export function fetchRulesets(ownerRepo) {
  const r = ghApiJson(`repos/${ownerRepo}/rulesets`);
  if (!r.ok) return [];
  const list = Array.isArray(r.data) ? r.data : [];
  return list.map((rs) => ({
    id: rs.id,
    name: rs.name,
    target: rs.target,
    enforcement: rs.enforcement,
  }));
}

// Rulesets' required_status_checks live under a rule of type
// "required_status_checks", not on the list-rulesets summary response — a
// second call per ruleset is required to get the parameter detail.
export function fetchRulesetRequiredChecks(ownerRepo, rulesetId) {
  const r = ghApiJson(`repos/${ownerRepo}/rulesets/${rulesetId}`);
  if (!r.ok) return [];
  const rules = r.data?.rules ?? [];
  const rule = rules.find((x) => x.type === 'required_status_checks');
  const checks = rule?.parameters?.required_status_checks ?? [];
  return checks.map((c) => c.context).filter(Boolean);
}

export function checkSecretPresent(ownerRepo, secretName) {
  const r = ghApiJson(`repos/${ownerRepo}/actions/secrets/${secretName}`);
  return r.ok;
}

export function fetchRepoSettings(ownerRepo) {
  const r = ghApiJson(`repos/${ownerRepo}`);
  if (!r.ok) return { deleteBranchOnMerge: null };
  return { deleteBranchOnMerge: r.data?.delete_branch_on_merge ?? false };
}

export function checkLabelExists(ownerRepo, labelName) {
  const r = ghApiJson(`repos/${ownerRepo}/labels/${encodeURIComponent(labelName)}`);
  return r.ok;
}

// branches: { main: string, dev: string } — the candidate names to inspect
// protection for. Caller (SKILL.md's setup wizard, or a re-run reading
// existingConfig) supplies these; detect.mjs does not guess branch names on
// its own, keeping it a pure "read what I'm told to look at" function.
export function detectRepoState(repoPath, { branches = { main: 'main', dev: 'dev' }, releaseCredentialName = null } = {}) {
  const ownerRepo = resolveOwnerRepo(repoPath);
  const trackedFiles = listTrackedFiles(repoPath);

  const branchList = git(['branch', '-a', '--format=%(refname:short)'], { cwd: repoPath });
  const localBranches = branchList.status === 0 ? branchList.stdout.split('\n').filter(Boolean) : [];

  const workflowJobNames = listWorkflowJobNames(repoPath, trackedFiles);
  const templateFiles = { [TEMPLATE_RELATIVE_PATH]: readTemplateFileHash(repoPath) };
  const settingsAsCodeArtifact = findSettingsAsCodeArtifact(repoPath, trackedFiles);

  const protection = ownerRepo
    ? {
        [branches.main]: fetchBranchProtection(ownerRepo, branches.main),
        [branches.dev]: fetchBranchProtection(ownerRepo, branches.dev),
      }
    : {};

  const rulesetsRaw = ownerRepo ? fetchRulesets(ownerRepo) : [];
  const rulesets = rulesetsRaw.map((rs) => ({
    ...rs,
    requiredChecks: ownerRepo ? fetchRulesetRequiredChecks(ownerRepo, rs.id) : [],
  }));

  const existingConfig = readExistingConfig(repoPath);
  const releaseCredentialPresent =
    ownerRepo && releaseCredentialName ? checkSecretPresent(ownerRepo, releaseCredentialName) : null;
  const repoSettings = ownerRepo ? fetchRepoSettings(ownerRepo) : { deleteBranchOnMerge: null };
  const releasePendingLabelExists = ownerRepo ? checkLabelExists(ownerRepo, 'release-pending') : null;

  const stateHash = sha256(
    JSON.stringify({
      branches: localBranches.sort(),
      protectionMain: protection[branches.main]?.requiredChecks ?? null,
      protectionDev: protection[branches.dev]?.requiredChecks ?? null,
      rulesetIds: rulesets.map((r) => r.id).sort(),
      workflowJobNames,
      deleteBranchOnMerge: repoSettings.deleteBranchOnMerge,
      releasePendingLabelExists,
    })
  );

  return {
    ownerRepo,
    branches: { configured: branches, local: localBranches },
    workflows: { jobNames: workflowJobNames },
    templateFiles,
    protection,
    rulesets,
    settingsAsCodeArtifact,
    existingConfig,
    releaseCredentialPresent,
    repoSettings,
    releasePendingLabelExists,
    stateHash,
  };
}

// Three-way protectionOwner classification (see design, "Rulesets vs. an
// existing settings-as-code source of truth"). Returns:
//   "external"  — a settings-as-code artifact was found; that mechanism
//                 owns protection, shipflow must not install a competing one
//   "shipflow"  — no protection exists at all; shipflow becomes the owner
//   "ambiguous" — protection exists but no artifact was found (e.g.
//                 hand-configured via the UI) — caller MUST prompt the user
//                 rather than silently pick either value (this is the
//                 round-2 false-positive fix: silently defaulting here left
//                 protection un-audited AND un-managed by anyone)
export function classifyProtectionOwner(repoState) {
  const { settingsAsCodeArtifact, protection } = repoState;
  if (settingsAsCodeArtifact) return 'external';

  const hasProtection = Object.values(protection).some(
    (p) => p && (p.requiredChecks?.length > 0 || p.raw)
  );
  if (!hasProtection) return 'shipflow';
  return 'ambiguous';
}

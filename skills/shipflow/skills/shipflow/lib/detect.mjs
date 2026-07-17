import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnArgs, ghApiJson, git, sha256, readFileCapped } from './gh.mjs';
import { listPatterns } from './pattern-registry.mjs';

const CONFIG_RELATIVE_PATH = '.github/shipflow.json';

// Files/content patterns that indicate branch protection is already managed
// as code elsewhere in the repo — see the design's "Rulesets vs. an existing
// settings-as-code source of truth" discussion. Matching one of these is
// what makes protectionOwner classify as "external" instead of falling
// through to the ambiguous (protection-exists-but-no-artifact) prompt case.
const SETTINGS_AS_CODE_NAME_RE = /repo-settings\.(sh|js|mjs|py)$/i;
const SETTINGS_AS_CODE_CONTENT_RE =
  /github_branch_protection|github_repository_ruleset|branches\/[\w-]+\/protection/;

// A segment made of only dots ("." / ".." / "...") matches [\w.-]+ but is
// never a real GitHub owner or repo name — reject it rather than build an
// ownerRepo string that could normalize away the intended repos/<owner>/<repo>
// prefix once interpolated into gh api paths downstream.
const ALL_DOTS_RE = /^\.+$/;

export function resolveOwnerRepo(repoPath) {
  const r = git(['remote', 'get-url', 'origin'], { cwd: repoPath });
  if (r.status !== 0) return null;
  const m = r.stdout.match(/github\.com[:/]([\w.-]+)\/([\w.-]+?)(\.git)?$/);
  if (!m) return null;
  const [, owner, repo] = m;
  if (ALL_DOTS_RE.test(owner) || ALL_DOTS_RE.test(repo)) return null;
  return `${owner}/${repo}`;
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
      content = readFileCapped(full);
    } catch {
      continue;
    }
    if (SETTINGS_AS_CODE_CONTENT_RE.test(content)) return f;
  }
  return null;
}

// A job that never runs on a pull_request can never satisfy a required
// status check — picking one as requiredChecks would block every future
// merge forever. This is a text-based heuristic (matching the rest of this
// file's no-YAML-parser style), not a full YAML parse: good enough to catch
// the common schedule/workflow_dispatch-only case.
const PULL_REQUEST_TRIGGER_RE = /pull_request(_target)?\b/;

export function listWorkflowJobNames(repoPath, trackedFiles) {
  const names = new Set();
  const jobNameRe = /^\s{2}([\w.-]+):\s*$/;
  for (const f of trackedFiles.filter((f) => /^\.github\/workflows\/.*\.ya?ml$/.test(f))) {
    const full = join(repoPath, f);
    if (!existsSync(full)) continue;
    let content;
    try {
      content = readFileCapped(full);
    } catch {
      continue;
    }
    const lines = content.split('\n');
    const jobsLineIdx = lines.findIndex((l) => l.trim() === 'jobs:');
    if (jobsLineIdx === -1) continue;
    const triggerSection = lines.slice(0, jobsLineIdx).join('\n');
    if (!PULL_REQUEST_TRIGGER_RE.test(triggerSection)) continue; // never PR-triggered
    for (const line of lines.slice(jobsLineIdx + 1)) {
      if (line.trim() !== '' && /^\S/.test(line)) break; // dedented out of the jobs: block
      const m = line.match(jobNameRe);
      if (m) names.add(m[1]);
    }
  }
  return [...names].sort();
}

const GH_PR_MERGE_AUTO_RE = /gh pr merge --auto/;
const HEAD_REF_EQ_RE = /head\.ref\s*==/;

// One level finer than listWorkflowJobNames()'s whole-jobs:-section boundary: bounds
// each INDIVIDUAL job's own line range (its jobNameRe-matching name line down to the
// next line at that same or lesser indent — the next sibling job, or EOF) so a
// head.ref == check in one job is never misattributed to a different job's
// gh pr merge --auto step in the same file.
export function scanWorkflowShapeSignals(repoPath, trackedFiles) {
  let restricted = false;
  let unrestricted = false;
  for (const f of trackedFiles.filter((f) => /^\.github\/workflows\/.*\.ya?ml$/.test(f))) {
    const full = join(repoPath, f);
    if (!existsSync(full)) continue;
    const lines = readFileCapped(full).split('\n');
    const jobsLineIdx = lines.findIndex((l) => l.trim() === 'jobs:');
    if (jobsLineIdx === -1) continue;
    let i = jobsLineIdx + 1;
    while (i < lines.length) {
      // Mirrors listWorkflowJobNames's own dedent-out-of-block termination: a line
      // that dedents all the way to column 0 ends the WHOLE jobs: section (a
      // trailing env:/concurrency: block, or EOF), not just the current job — stop
      // the outer scan entirely rather than treating it as another job candidate.
      if (lines[i].trim() !== '' && /^\S/.test(lines[i])) break;
      const nameMatch = lines[i].match(/^\s{2}([\w.-]+):\s*$/);
      if (!nameMatch) { i++; continue; }
      const jobStart = i;
      let jobEnd = lines.length;
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() === '') continue;
        if (/^\S/.test(lines[j])) { jobEnd = j; break; }          // dedents to column 0 — end of jobs: section
        if (lines[j].match(/^\s{2}([\w.-]+):\s*$/)) { jobEnd = j; break; } // next sibling job
      }
      const jobBlock = lines.slice(jobStart, jobEnd).join('\n');
      if (GH_PR_MERGE_AUTO_RE.test(jobBlock)) {
        if (HEAD_REF_EQ_RE.test(jobBlock)) restricted = true;
        else unrestricted = true;
      }
      i = jobEnd;
    }
  }
  return { hasRestrictedPromotionWorkflow: restricted, hasUnrestrictedAutomergeWorkflow: unrestricted };
}

export function hasTagsFromMain(repoPath, mainBranch) {
  const r = git(['tag', '--merged', mainBranch], { cwd: repoPath });
  return r.status === 0 && r.stdout.trim().length > 0;
}

export function hasGitflowMarker(repoPath) {
  if (existsSync(join(repoPath, '.gitflow'))) return true;
  return git(['config', '--get', 'gitflow.branch.develop'], { cwd: repoPath }).status === 0;
}

export function listConfiguredRemotes(repoPath) {
  const r = git(['remote'], { cwd: repoPath });
  return r.status === 0 ? r.stdout.split('\n').filter(Boolean) : [];
}

export function readTemplateFileHash(repoPath, targetPath) {
  const full = join(repoPath, targetPath);
  if (!existsSync(full)) return { exists: false, sha256: null };
  const content = readFileCapped(full);
  return { exists: true, sha256: sha256(content) };
}

export function readExistingConfig(repoPath) {
  const full = join(repoPath, CONFIG_RELATIVE_PATH);
  if (!existsSync(full)) return null;
  try {
    return JSON.parse(readFileCapped(full));
  } catch {
    return null;
  }
}

export function fetchBranchProtection(ownerRepo, branch) {
  const r = ghApiJson(`repos/${ownerRepo}/branches/${encodeURIComponent(branch)}/protection`);
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
  const r = ghApiJson(`repos/${ownerRepo}/actions/secrets/${encodeURIComponent(secretName)}`);
  return r.ok;
}

export function fetchRepoSettings(ownerRepo) {
  const r = ghApiJson(`repos/${ownerRepo}`);
  if (!r.ok) return { deleteBranchOnMerge: null, defaultBranch: null };
  return {
    deleteBranchOnMerge: r.data?.delete_branch_on_merge ?? false,
    defaultBranch: r.data?.default_branch ?? null,
  };
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
  // Union of every registered pattern's templateTargetPaths — computed unconditionally
  // with no resolved pattern in hand (there's no config yet on a genuine first run, so
  // nothing to call resolvePattern(config) with). detect.mjs never imports a
  // lib/patterns/<id>/index.mjs module directly, only listPatterns() — this is what
  // keeps "adding a 4th pattern needs no changes to detect.mjs" true in practice.
  const templateTargetPaths = listPatterns().flatMap((p) => p.templateTargetPaths);
  const templateFiles = Object.fromEntries(
    templateTargetPaths.map((path) => [path, readTemplateFileHash(repoPath, path)])
  );
  const settingsAsCodeArtifact = findSettingsAsCodeArtifact(repoPath, trackedFiles);
  const { hasRestrictedPromotionWorkflow, hasUnrestrictedAutomergeWorkflow } =
    scanWorkflowShapeSignals(repoPath, trackedFiles);

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
  const repoSettings = ownerRepo ? fetchRepoSettings(ownerRepo) : { deleteBranchOnMerge: null, defaultBranch: null };
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
    hasTagsFromMain: hasTagsFromMain(repoPath, branches.main),
    hasGitflowMarker: hasGitflowMarker(repoPath),
    configuredRemotes: listConfiguredRemotes(repoPath),
    hasRestrictedPromotionWorkflow,
    hasUnrestrictedAutomergeWorkflow,
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

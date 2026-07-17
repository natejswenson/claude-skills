import { resolvePattern } from './pattern-registry.mjs';
import { renderTemplate } from './render.mjs';
import { sha256 } from './gh.mjs';

// Pure function — no I/O, no gh/git calls. Diffs repoState (what detect.mjs
// observed) against config (what the user wants) into a Plan the caller
// shows to the user before any mutation happens.
export function computePlan(repoState, config, templateSources) {
  const pattern = resolvePattern(config);
  const protectedBranchList = pattern.protectedBranches(config);
  const creates = [];
  const updates = [];
  const noops = [];

  // 1. delete_branch_on_merge — unchanged, repo-wide boolean, no branch names involved.
  const wantDeleteOnMerge = config.branchCleanup?.deleteOnMerge ?? true;
  const haveDeleteOnMerge = repoState.repoSettings?.deleteBranchOnMerge;
  if (haveDeleteOnMerge === wantDeleteOnMerge) {
    noops.push({ id: 'delete-branch-on-merge', description: 'delete_branch_on_merge already set correctly' });
  } else {
    updates.push({
      id: 'delete-branch-on-merge',
      description: `set delete_branch_on_merge to ${wantDeleteOnMerge}`,
      desired: wantDeleteOnMerge,
    });
  }

  // 2. deletion-ruleset — protects protectedBranchList, not a hardcoded [dev, main].
  // Description strings below are copied VERBATIM from the pre-existing (single-pattern)
  // plan.mjs, not rephrased — this repo's own live .github/shipflow.json has
  // protectionOwner: "external", so the dogfood smoke test
  // (`node bin/shipflow.js plan --repo .../claude-skills`) exercises this exact else-branch
  // and must reproduce byte-identical plan-entry text, not just equivalent behavior.
  if (config.protectionOwner === 'shipflow') {
    if ((repoState.rulesets ?? []).length > 0) {
      noops.push({ id: 'deletion-ruleset', description: 'a ruleset already exists (coarse check — see plan.mjs comment)' });
    } else {
      creates.push({ id: 'deletion-ruleset', description: `create a ruleset protecting ${protectedBranchList.join('/')} from deletion` });
    }
  } else {
    noops.push({ id: 'deletion-ruleset', description: `protectionOwner is "${config.protectionOwner}" — deferring to existing mechanism, shipflow installs nothing` });
  }

  // 3. per-pattern templates — generalized from one hardcoded entry to N.
  for (const entry of pattern.templates(config)) {
    const templateSource = templateSources[entry.id];
    if (templateSource === undefined) {
      throw new Error(`computePlan: no templateSources entry for template id "${entry.id}"`);
    }
    const planEntry = computeTemplatePlanEntry(repoState, config, entry, templateSource);
    if (planEntry.kind === 'noop') noops.push(planEntry);
    else if (planEntry.kind === 'create') creates.push(planEntry);
    else updates.push(planEntry);
  }

  // 4. release-pending label — unconditional across every release.mode and pattern.
  if (repoState.releasePendingLabelExists) {
    noops.push({ id: 'release-pending-label', description: 'release-pending label already exists' });
  } else {
    creates.push({ id: 'release-pending-label', description: 'create the release-pending label' });
  }

  // 5. pattern-specific entries beyond the 4 common ones above (empty for all 3 v1 patterns).
  for (const entry of pattern.planEntries(repoState, config)) {
    if (entry.kind === 'noop') noops.push(entry);
    else if (entry.kind === 'create') creates.push(entry);
    else updates.push(entry);
  }

  // liveRequiredChecks: union of classic branch-protection required checks
  // (on the configured main branch) and every fetched ruleset's required
  // checks. v1 scope note: rulesets are unioned without filtering by which
  // branch they target (no ref-pattern matching implemented yet) — a
  // documented simplification, not a silent gap.
  const classicChecks = repoState.protection?.[config.branches.main]?.requiredChecks ?? [];
  const rulesetChecks = (repoState.rulesets ?? []).flatMap((rs) => rs.requiredChecks ?? []);
  const liveRequiredChecks = [...new Set([...classicChecks, ...rulesetChecks])].sort();

  return { creates, updates, noops, sourceStateHash: repoState.stateHash, liveRequiredChecks, protectedBranches: protectedBranchList };
}

// entry is one {id, targetPath, templateSourcePath, params} item from
// pattern.templates(config); templateSource is that entry's already-read-off-disk
// content (looked up from the caller-supplied templateSources map above).
//
// IMPORTANT: the returned plan entry's `id` field is NOT entry.id (the pattern
// module's own template identifier, e.g. 'release-automerge') — it MUST stay the
// pre-existing 'template:' + targetPath convention, because apply.mjs's dispatch
// (`entry.id.startsWith('template:')`) and the empty-required-checks refusal both
// key off that exact prefix today. Reusing the pattern module's own template id
// verbatim here would silently break both of those existing mechanisms.
function computeTemplatePlanEntry(repoState, config, entry, templateSource) {
  const planId = 'template:' + entry.targetPath;
  const renderedContent = renderTemplate(templateSource, entry.params);
  const freshHash = sha256(renderedContent);
  const onDisk = repoState.templateFiles?.[entry.targetPath];
  const lastRenderedHash = config.renderedTemplateHashes?.[entry.targetPath] ?? null;

  if (!onDisk || !onDisk.exists) {
    return { id: planId, kind: 'create', path: entry.targetPath, description: `write ${entry.targetPath}`, renderedHash: freshHash, content: renderedContent };
  }
  if (onDisk.sha256 === freshHash) {
    return { id: planId, kind: 'noop', path: entry.targetPath, description: `${entry.targetPath} already matches config` };
  }
  if (onDisk.sha256 === lastRenderedHash) {
    // On-disk content matches what shipflow itself last rendered, but the
    // config has changed since — a legitimate re-render, not a hand-edit.
    return { id: planId, kind: 'update', path: entry.targetPath, description: `re-render ${entry.targetPath} (config changed)`, renderedHash: freshHash, content: renderedContent, handEditDetected: false };
  }
  // On-disk content matches neither the fresh render nor our last recorded
  // render — someone hand-edited it (or it was never rendered by shipflow).
  // Flagged, not silently overwritten; apply.mjs blocks this entry unless
  // the caller passes an explicit force override naming this entry's id.
  return {
    id: planId,
    kind: 'update',
    path: entry.targetPath,
    description: `${entry.targetPath} was hand-edited — blocked pending --force`,
    renderedHash: freshHash,
    content: renderedContent,
    handEditDetected: true,
  };
}

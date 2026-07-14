import { renderTemplate, mergeMethodToFlag } from './render.mjs';
import { sha256 } from './gh.mjs';

const TEMPLATE_PATH = '.github/workflows/dev-to-main-automerge.yml';

// Pure function — no I/O, no gh/git calls. Diffs repoState (what detect.mjs
// observed) against config (what the user wants) into a Plan the caller
// shows to the user before any mutation happens.
export function computePlan(repoState, config, templateSource) {
  const creates = [];
  const updates = [];
  const noops = [];

  // 1. delete_branch_on_merge repo setting
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

  // 2. deletion-protecting ruleset — only shipflow's job when it owns protection.
  // Coarse check (v1 scope): whether *any* ruleset exists at all, not whether
  // it specifically restricts deletion on the configured branches — apply.mjs
  // re-checks live state immediately before creating (idempotency guarantee),
  // so an imprecise plan preview here cannot cause a wrong mutation, only a
  // possibly-stale preview label.
  if (config.protectionOwner === 'shipflow') {
    if ((repoState.rulesets ?? []).length > 0) {
      noops.push({ id: 'deletion-ruleset', description: 'a ruleset already exists (coarse check — see plan.mjs comment)' });
    } else {
      creates.push({ id: 'deletion-ruleset', description: `create a ruleset protecting ${config.branches.dev}/${config.branches.main} from deletion` });
    }
  } else {
    noops.push({ id: 'deletion-ruleset', description: `protectionOwner is "${config.protectionOwner}" — deferring to existing mechanism, shipflow installs nothing` });
  }

  // 3. dev-to-main-automerge.yml — content-hash diff against a fresh render,
  // with hand-edit detection against the last hash shipflow itself recorded.
  const templateEntry = computeTemplatePlanEntry(repoState, config, templateSource);
  if (templateEntry.kind === 'noop') noops.push(templateEntry);
  else if (templateEntry.kind === 'create') creates.push(templateEntry);
  else updates.push(templateEntry);

  // 4. release-pending label — unconditional across every release.mode
  // (round-6 fix: the labeling job in the template above ships regardless
  // of mode, so the label must exist regardless of mode too).
  if (repoState.releasePendingLabelExists) {
    noops.push({ id: 'release-pending-label', description: 'release-pending label already exists' });
  } else {
    creates.push({ id: 'release-pending-label', description: 'create the release-pending label' });
  }

  // liveRequiredChecks: union of classic branch-protection required checks
  // (on the configured main branch) and every fetched ruleset's required
  // checks. v1 scope note: rulesets are unioned without filtering by which
  // branch they target (no ref-pattern matching implemented yet) — a
  // documented simplification, not a silent gap.
  const classicChecks = repoState.protection?.[config.branches.main]?.requiredChecks ?? [];
  const rulesetChecks = (repoState.rulesets ?? []).flatMap((rs) => rs.requiredChecks ?? []);
  const liveRequiredChecks = [...new Set([...classicChecks, ...rulesetChecks])].sort();

  return {
    creates,
    updates,
    noops,
    sourceStateHash: repoState.stateHash,
    liveRequiredChecks,
  };
}

function computeTemplatePlanEntry(repoState, config, templateSource) {
  const params = {
    devBranch: config.branches.dev,
    mainBranch: config.branches.main,
    mergeFlag: mergeMethodToFlag(config.mergeMethod?.devToMainMethod),
  };
  const renderedContent = renderTemplate(templateSource, params);
  const freshHash = sha256(renderedContent);
  const onDisk = repoState.templateFiles?.[TEMPLATE_PATH];
  const lastRenderedHash = config.renderedTemplateHashes?.[TEMPLATE_PATH] ?? null;

  if (!onDisk || !onDisk.exists) {
    return { id: 'template:' + TEMPLATE_PATH, kind: 'create', path: TEMPLATE_PATH, description: `write ${TEMPLATE_PATH}`, renderedHash: freshHash, content: renderedContent };
  }
  if (onDisk.sha256 === freshHash) {
    return { id: 'template:' + TEMPLATE_PATH, kind: 'noop', path: TEMPLATE_PATH, description: `${TEMPLATE_PATH} already matches config` };
  }
  if (onDisk.sha256 === lastRenderedHash) {
    // On-disk content matches what shipflow itself last rendered, but the
    // config has changed since — a legitimate re-render, not a hand-edit.
    return { id: 'template:' + TEMPLATE_PATH, kind: 'update', path: TEMPLATE_PATH, description: `re-render ${TEMPLATE_PATH} (config changed)`, renderedHash: freshHash, content: renderedContent, handEditDetected: false };
  }
  // On-disk content matches neither the fresh render nor our last recorded
  // render — someone hand-edited it (or it was never rendered by shipflow).
  // Flagged, not silently overwritten; apply.mjs blocks this entry unless
  // the caller passes an explicit force override naming this entry's id.
  return {
    id: 'template:' + TEMPLATE_PATH,
    kind: 'update',
    path: TEMPLATE_PATH,
    description: `${TEMPLATE_PATH} was hand-edited — blocked pending --force`,
    renderedHash: freshHash,
    content: renderedContent,
    handEditDetected: true,
  };
}

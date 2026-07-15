import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnArgs, ghApiJson } from './gh.mjs';

// applyPlan(plan, opts): opts extends the schematic { dryRun, currentStateHash,
// force } from the design contract with the execution context (ownerRepo,
// repoPath, config) apply.mjs actually needs to perform mutations — the
// contract captured intent, not a literal final call signature.
//
// opts.force: an array of plan-entry ids the caller has explicitly confirmed
// should proceed despite a handEditDetected flag, OR the literal string
// "allow-no-checks" to override the empty-required-checks refusal. Never a
// global boolean — a force scoped to one entry can't accidentally blanket-
// override every other flagged entry in the same plan.
// Repository Rulesets are gated behind GitHub Pro/Team/Enterprise for
// private repos (free only for public repos) — this is GitHub's exact error
// string for that case, distinct from a generic 403 (bad token, no admin
// scope, etc.) which should still surface as a real error.
const RULESET_TIER_GATED_RE = /Upgrade to GitHub (Pro|Team|Enterprise)/i;

export function classifyRulesetError(stderr) {
  if (RULESET_TIER_GATED_RE.test(stderr)) {
    return {
      tierGated: true,
      reason:
        'deletion-protection ruleset requires GitHub Pro/Team/Enterprise for private repos on the free tier — skipped, not a shipflow bug. Make the repo public or upgrade to enable it.',
    };
  }
  return { tierGated: false, reason: null };
}

export function applyPlan(plan, opts) {
  const { dryRun, currentStateHash, force = [], forceReason = null, ownerRepo, repoPath, config } = opts;

  // TOCTOU guard — refuse before making ANY mutating call if live state has
  // drifted since the plan was computed. Idempotency is the primary safety
  // net (re-running is always safe); this is the narrower, single-shot
  // pre-flight that catches drift between plan-confirmation and apply-start.
  if (!dryRun && currentStateHash !== plan.sourceStateHash) {
    return {
      applied: [],
      skipped: [],
      errors: [
        {
          id: 'toctou',
          message: 'repo state changed since the plan was confirmed — re-run to get an updated plan',
        },
      ],
      renderedTemplateHashes: {},
    };
  }

  const applied = [];
  const skipped = [];
  const errors = [];
  const renderedTemplateHashes = {};

  const mutating = [...plan.creates, ...plan.updates];

  // Empty-required-checks hard refusal (fail-open guard). Effective required
  // checks are config.requiredChecks under shipflow-owned protection, or the
  // live-detected union (plan.liveRequiredChecks) under external ownership
  // — see the design's protectionOwner discussion for why these differ.
  const effectiveChecks = config.protectionOwner === 'shipflow' ? config.requiredChecks ?? [] : plan.liveRequiredChecks ?? [];
  const templateEntries = mutating.filter((e) => e.id.startsWith('template:'));
  if (effectiveChecks.length === 0 && templateEntries.length > 0 && !force.includes('allow-no-checks')) {
    for (const entry of templateEntries) {
      skipped.push({
        id: entry.id,
        reason:
          'refusing to enable auto-merge with zero required checks — set requiredChecks or pass force: ["allow-no-checks"] to override',
      });
    }
  }

  for (const entry of mutating) {
    if (skipped.some((s) => s.id === entry.id)) continue; // already skipped above (empty-checks refusal)

    if (entry.handEditDetected && !force.includes(entry.id)) {
      skipped.push({ id: entry.id, reason: `hand-edit detected — pass force: ["${entry.id}"] to override` });
      continue;
    }

    if (dryRun) {
      applied.push({ id: entry.id, description: entry.description, dryRun: true });
      continue;
    }

    const result = applyOne(entry, { ownerRepo, repoPath, config });
    if (result.ok) {
      const wasForced = force.includes(entry.id) || (entry.id.startsWith('template:') && force.includes('allow-no-checks'));
      applied.push({
        id: entry.id,
        description: entry.description,
        ...(wasForced ? { forced: true, forceReason } : {}),
      });
      if (entry.id.startsWith('template:') && entry.renderedHash) {
        renderedTemplateHashes[entry.path] = entry.renderedHash;
      }
    } else if (result.tierGated) {
      skipped.push({ id: entry.id, reason: result.error });
    } else {
      errors.push({ id: entry.id, message: result.error });
    }
  }

  return { applied, skipped, errors, renderedTemplateHashes };
}

function applyOne(entry, { ownerRepo, repoPath, config }) {
  if (entry.id === 'delete-branch-on-merge') {
    const r = ghApiJson(`repos/${ownerRepo}`, ['-X', 'PATCH', '-f', `delete_branch_on_merge=${entry.desired}`]);
    return r.ok ? { ok: true } : { ok: false, error: r.stderr };
  }

  if (entry.id === 'deletion-ruleset') {
    const body = JSON.stringify({
      name: 'shipflow-branch-deletion-protection',
      target: 'branch',
      enforcement: 'active',
      conditions: {
        ref_name: { include: [`refs/heads/${config.branches.dev}`, `refs/heads/${config.branches.main}`], exclude: [] },
      },
      rules: [{ type: 'deletion' }],
    });
    const r = spawnArgs('gh', ['api', `repos/${ownerRepo}/rulesets`, '-X', 'POST', '--input', '-'], { input: body });
    if (r.status === 0) return { ok: true };
    const { tierGated, reason } = classifyRulesetError(r.stderr);
    return tierGated ? { ok: false, tierGated: true, error: reason } : { ok: false, error: r.stderr };
  }

  if (entry.id === 'release-pending-label') {
    const r = ghApiJson(`repos/${ownerRepo}/labels`, [
      '-f', 'name=release-pending',
      '-f', 'color=0E8A16',
      '-f', 'description=shipflow: this dev-to-main promotion is awaiting a release decision',
    ]);
    return r.ok ? { ok: true } : { ok: false, error: r.stderr };
  }

  if (entry.id.startsWith('template:')) {
    const full = join(repoPath, entry.path);
    try {
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, entry.content, 'utf8');
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  }

  return { ok: false, error: `unknown plan entry id: ${entry.id}` };
}

// --- Manual-gate ask-flow helpers -----------------------------------------
//
// These are invoked by a SEPARATE, later shipflow invocation than the one
// that ran applyPlan for the promotion — the design established (round 3)
// that the ask cannot happen at promotion time, since native async
// auto-merge completes with no live session attached. A subsequent
// interactive run enumerates every promotion PR still labeled
// release-pending, confirms each is actually MERGED (not just labeled —
// belt and suspenders against a labeling-job race), and only clears a
// label after its own release dispatch is confirmed successful.

export function listPendingReleasePromotions(ownerRepo, mainBranch) {
  const r = ghApiJson(
    `search/issues?q=${encodeURIComponent(`repo:${ownerRepo} is:pr is:merged base:${mainBranch} label:release-pending`)}`
  );
  if (!r.ok) return { ok: false, error: r.stderr, promotions: [] };
  const items = r.data?.items ?? [];
  return { ok: true, promotions: items.map((i) => ({ number: i.number, title: i.title, mergedAt: i.pull_request?.merged_at ?? null })) };
}

export function confirmPromotionMerged(ownerRepo, prNumber) {
  const r = ghApiJson(`repos/${ownerRepo}/pulls/${prNumber}`);
  if (!r.ok) return { ok: false, merged: false, error: r.stderr };
  return { ok: true, merged: r.data?.merged === true, mergeCommitSha: r.data?.merge_commit_sha ?? null };
}

// Clears the release-pending label — MUST only be called after every
// changed skill's release dispatch for this promotion has been confirmed
// successful. A partial failure must leave the label in place so the whole
// set resurfaces on the next run (already-released skills re-dispatch as
// idempotent no-ops, per the design's Testing strategy).
export function clearReleasePendingLabel(ownerRepo, prNumber) {
  const r = ghApiJson(`repos/${ownerRepo}/issues/${prNumber}/labels/release-pending`, ['-X', 'DELETE']);
  return r.ok ? { ok: true } : { ok: false, error: r.stderr };
}

export function dispatchReleaseWorkflow(ownerRepo, skillWorkflowFile, ref) {
  const r = spawnArgs('gh', ['workflow', 'run', skillWorkflowFile, '--ref', ref]);
  return r.status === 0 ? { ok: true } : { ok: false, error: r.stderr };
}

// A one-time bootstrap action, not part of the steady-state plan/apply diff
// model — renaming a repo's default branch affects every collaborator and
// open PR, so it's a distinct, explicitly-confirmed CLI command rather than
// a plan entry. GitHub's rename endpoint natively moves the default-branch
// pointer and retargets open PRs when the renamed branch is the current
// default; no extra shipflow-side logic is needed for that part.
export function renameDefaultBranch(ownerRepo, fromBranch, toBranch) {
  const r = spawnArgs('gh', [
    'api', '-X', 'POST', `repos/${ownerRepo}/branches/${fromBranch}/rename`,
    '-f', `new_name=${toBranch}`,
  ]);
  return r.status === 0 ? { ok: true } : { ok: false, error: r.stderr };
}

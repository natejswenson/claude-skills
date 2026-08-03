/**
 * The run: a directory on disk, and the state machine that decides what may
 * happen next.
 *
 * The one rule lives here, as code. Every advance goes through `gateFor`, which
 * refuses a step whose predecessors are not approved — so "the gates are
 * enforced" is a property of the program rather than a paragraph the
 * orchestrator is trusted to have read.
 *
 * The run lives outside the target repo (`~/.claude/issueflow/…`) so a run
 * survives branch switches and never appears in the user's `git status`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { EVIDENCE_FILE, PER_ITEM_STAGES, SHARED_STAGES, stage } from './stages.mjs';
import { branchFor, slugify } from './policy.mjs';

export const SCHEMA = 1;
export class RunError extends Error {}

/** Where runs live. `--run-dir` overrides it, which is how the evals stay offline and hermetic. */
export function runRoot(override) {
  return override ? override : join(homedir(), '.claude', 'issueflow');
}

export const runDir = (root, owner, name, number) => join(root, `${owner}__${name}`, `issue-${number}`);

const statePath = (dir) => join(dir, 'run.json');

/** A stage entry, built from the declaration so the two can never disagree. */
const stageEntry = (id) => {
  const s = stage(id);
  return { id: s.id, model: s.model, agent: s.agent, artifact: s.artifact, state: 'pending' };
};

/** A fresh run for one issue, with a single unsplit lane. */
export function createRun({ repo, issue, policy }) {
  const lane = {
    id: 'root',
    slug: 'root',
    title: issue.title,
    branch: branchFor(policy, issue.number, 'root'),
    base: policy.base,
    stages: PER_ITEM_STAGES.map(stageEntry),
  };
  return {
    schema: SCHEMA,
    repo,
    issue: { number: issue.number, title: issue.title, url: issue.url },
    policy,
    split: false,
    stages: SHARED_STAGES.map(stageEntry),
    lanes: [lane],
  };
}

export function saveRun(dir, run) {
  mkdirSync(join(dir, SHARED_DIR), { recursive: true });
  for (const lane of run.lanes) mkdirSync(join(dir, lane.slug), { recursive: true });
  writeFileSync(statePath(dir), `${JSON.stringify(run, null, 2)}\n`);
  return run;
}

export function loadRun(dir) {
  if (!existsSync(statePath(dir))) {
    throw new RunError(`no run at ${dir} — start one with \`issueflow start --issue <number>\``);
  }
  const run = JSON.parse(readFileSync(statePath(dir), 'utf8'));
  if (run.schema !== SCHEMA) throw new RunError(`run.json is schema ${run.schema}, this issueflow speaks ${SCHEMA}`);
  return run;
}

/**
 * Every gate step in the order it must happen: the shared stages once, then each
 * lane's stages in landing order. This ordering IS the state machine — nothing
 * else decides what comes next.
 */
export function gateSteps(run) {
  const steps = run.stages.map((s) => ({ key: s.id, laneSlug: null, lane: null, stage: s }));
  for (const lane of run.lanes) {
    for (const s of lane.stages) steps.push({ key: `${lane.slug}/${s.id}`, laneSlug: lane.slug, lane, stage: s });
  }
  return steps;
}

/** Resolve one step by stage id (+ lane, when the stage is per-item). */
export function findStep(run, stageId, laneSlug = null) {
  const steps = gateSteps(run);
  if (SHARED_STAGES.includes(stageId)) {
    const step = steps.find((s) => s.laneSlug === null && s.stage.id === stageId);
    if (!step) throw new RunError(`no ${stageId} stage in this run`);
    return step;
  }
  if (!laneSlug) {
    const candidates = steps.filter((s) => s.stage.id === stageId);
    if (candidates.length > 1) {
      throw new RunError(
        `this run has ${candidates.length} work items — name one with --lane <${candidates.map((c) => c.laneSlug).join('|')}>`,
      );
    }
    if (candidates.length === 0) throw new RunError(`no ${stageId} stage in this run`);
    return candidates[0];
  }
  const step = steps.find((s) => s.laneSlug === laneSlug && s.stage.id === stageId);
  if (!step) throw new RunError(`no ${stageId} stage on lane "${laneSlug}"`);
  return step;
}

/**
 * The gate. Returns the steps that must be approved before `step` may run and
 * are not — empty means the gate is open.
 *
 * `skipped` is deliberately NOT approval. A skipped stage stays a hole the whole
 * way to `ship`, which is what stops a run reporting a stage it never did as
 * done.
 */
export function blockers(run, step) {
  const steps = gateSteps(run);
  const index = steps.findIndex((s) => s.key === step.key);
  return steps.slice(0, index).filter((s) => s.stage.state !== 'approved');
}

/**
 * Shared stages write to `shared/`, lanes to their own slug.
 *
 * Not `root/`: the unsplit lane is called `root`, and a split replaces it — so
 * putting the issue-wide artifacts there would leave the investigation sitting
 * in a directory belonging to a lane that no longer exists.
 */
export const SHARED_DIR = 'shared';

export const artifactPath = (dir, step) => join(dir, step.laneSlug ?? SHARED_DIR, step.stage.artifact);
export const evidencePath = (dir, step) => join(dir, step.laneSlug ?? SHARED_DIR, EVIDENCE_FILE);
export const briefPath = (dir, step) => join(dir, 'briefs', `${step.key.replace('/', '-')}.md`);

/** Non-empty means real content — a touched file is not an artifact. */
const hasContent = (path) => existsSync(path) && readFileSync(path, 'utf8').trim().length > 0;

/**
 * Record an artifact and the user's approval, advancing the state machine.
 *
 * Refuses on: an unopened gate, a missing or empty artifact, an artifact missing
 * a section the stage declares, and a test stage with no evidence file. Each of
 * those is a way a stage looks done without being done.
 */
export function accept(dir, run, step, { evidence = null } = {}) {
  const blocked = blockers(run, step);
  if (blocked.length > 0) {
    throw new RunError(
      `cannot accept ${step.key}: ${blocked.map((b) => `${b.key} is ${b.stage.state}`).join(', ')} — ` +
        'no stage runs on anything but its predecessor\'s approved artifact',
    );
  }

  const artifact = artifactPath(dir, step);
  if (!hasContent(artifact)) {
    throw new RunError(`cannot accept ${step.key}: no artifact at ${artifact} — the stage produced nothing to approve`);
  }

  const declared = stage(step.stage.id);
  const text = readFileSync(artifact, 'utf8').toLowerCase();
  const missing = declared.requires.filter((section) => !text.includes(section.toLowerCase()));
  if (missing.length > 0) {
    throw new RunError(
      `cannot accept ${step.key}: the artifact never mentions ${missing.join(', ')} — ` +
        `${step.stage.id} owes the next stage ${declared.requires.join(', ')}`,
    );
  }

  if (step.stage.id === 'test') {
    const proof = evidence ?? evidencePath(dir, step);
    if (!hasContent(proof)) {
      throw new RunError(
        `cannot accept ${step.key}: no test output at ${proof} — a suite reported green without its ` +
          'real output is the one thing this skill exists to refuse',
      );
    }
    step.stage.evidence = proof;
  }

  step.stage.state = 'approved';
  saveRun(dir, run);
  return run;
}

/** Mark a stage skipped. It never becomes approved, so `ship` keeps refusing. */
export function skip(dir, run, step, reason) {
  if (!reason) throw new RunError('a skip needs a reason — an unexplained hole in a run is indistinguishable from a bug');
  step.stage.state = 'skipped';
  step.stage.skipReason = reason;
  saveRun(dir, run);
  return run;
}

/**
 * Expand an approved design's work items into lanes.
 *
 * Each lane stacks on the one below it — the bottom targets the repo's base
 * branch and every layer above targets its predecessor, which is the house
 * shape for reviewable layered work. Splitting after implementation has begun
 * would strand commits on a branch no lane owns, so it is refused.
 */
export function split(dir, run, items) {
  if (run.split) throw new RunError('this run is already split — a second split would strand the first split\'s lanes');
  const design = findStep(run, 'design');
  if (design.stage.state !== 'approved') {
    throw new RunError('cannot split before the design is approved — the seams come from the design, not from the issue');
  }
  const started = run.lanes.some((l) => l.stages.some((s) => s.state !== 'pending'));
  if (started) throw new RunError('cannot split a run whose implementation has started — its commits belong to no lane');
  if (items.length < 2) throw new RunError(`a split needs at least 2 work items, got ${items.length}`);

  const seen = new Set();
  run.lanes = items.map((item, i) => {
    const slug = slugify(item.slug ?? item.title);
    if (seen.has(slug)) throw new RunError(`two work items slug to "${slug}" — each lane needs its own branch`);
    seen.add(slug);
    return {
      id: slug,
      slug,
      title: item.title,
      branch: branchFor(run.policy, run.issue.number, slug),
      base: i === 0 ? run.policy.base : branchFor(run.policy, run.issue.number, slugify(items[i - 1].slug ?? items[i - 1].title)),
      stages: PER_ITEM_STAGES.map(stageEntry),
    };
  });
  run.split = true;
  saveRun(dir, run);
  return run;
}

/** The run board: one row per gate step, in the order they must happen. */
export function board(run) {
  return gateSteps(run).map((step) => ({
    step: step.key,
    stage: step.stage.id,
    model: step.stage.model,
    state: step.stage.state,
    gate: blockers(run, step).length === 0 ? 'open' : 'blocked',
  }));
}

/** The next step that is neither approved nor skipped, or null when the run is complete. */
export function nextStep(run) {
  return gateSteps(run).find((s) => s.stage.state !== 'approved' && s.stage.state !== 'skipped') ?? null;
}

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
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { EVIDENCE_FILE, PER_ITEM_STAGES, SHARED_STAGES, stage } from './stages.mjs';
import { branchFor, slugify } from './policy.mjs';
import { parseEvidence, summarize, RUNNER_IDS } from './evidence.mjs';

export const SCHEMA = 2;
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
  return { id: s.id, model: s.model, agent: s.agent, artifact: s.artifact, state: 'pending', at: {} };
};

/** A fresh run for one issue, with a single unsplit lane. */
export function createRun({ repo, issue, policy, offline = false }) {
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
    // A run started from frozen `gh` payloads must never dial out later, no
    // matter which flags the next command carries. Recording it on the run is
    // what makes that a property of the run rather than of the invocation.
    offline,
    split: false,
    // The sticky issue comment this run keeps up to date. Adopted by marker
    // when a run is resumed on a machine that has no run.json.
    checkpoint: { commentId: null, commentUrl: null, pushed: {} },
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
  if (run.schema !== SCHEMA) {
    throw new RunError(
      `the run at ${dir} is schema ${run.schema} and this issueflow speaks ${SCHEMA} — ` +
        'its artifacts are still on disk, but the state machine cannot resume it; start the issue again',
    );
  }
  // Fields added after a run was created. Defaulted rather than migrated: the
  // run is the record of what happened, and inventing a checkpoint it never
  // made would be a lie told by the loader.
  run.checkpoint ??= { commentId: null, commentUrl: null, pushed: {} };
  run.offline ??= false;
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
 * What one step actually depends on.
 *
 * This used to be "every step listed above it", which is cheap to write and
 * wrong: it made a lane's `implement` wait on the *previous lane's tests*, a
 * dependency that does not exist. On the run this was measured against, lane 2
 * never started because lane 1's test stage was still awaiting approval — an
 * hour of gate for an edge nothing needs.
 *
 * The real edges:
 *
 *   investigate     ← nothing
 *   design          ← investigate
 *   lane.implement  ← design, plus the implement of the lane it stacks on
 *   lane.test       ← that same lane's implement
 *
 * The stacked-parent edge is real and load-bearing: a lane branches off the
 * branch below it, so its commits cannot exist until that branch does. What is
 * NOT real is waiting for the parent lane to have been *tested*.
 */
export function dependencies(run, step) {
  const steps = gateSteps(run);
  const at = (key) => steps.find((s) => s.key === key) ?? null;
  const out = [];

  if (step.stage.id === 'design') out.push(at('investigate'));
  if (step.stage.id === 'implement') {
    out.push(at('design'));
    const parent = run.lanes.find((l) => l.branch === step.lane?.base);
    if (parent) out.push(at(`${parent.slug}/implement`));
  }
  if (step.stage.id === 'test') out.push(at(`${step.laneSlug}/implement`));

  return out.filter(Boolean);
}

/**
 * The gate. Returns the steps that must be approved before `step` may run and
 * are not — empty means the gate is open.
 *
 * Walks the dependency graph transitively, so a hole two levels down is still
 * named rather than hidden behind an intermediate step that happens to look
 * approved. Reported in board order, because that is the order a reader expects
 * to fix them in.
 *
 * `skipped` is deliberately NOT approval. A skipped stage stays a hole the whole
 * way to `ship`, which is what stops a run reporting a stage it never did as
 * done.
 */
export function blockers(run, step) {
  const seen = new Set([step.key]);
  const found = [];
  const walk = (from) => {
    for (const dep of dependencies(run, from)) {
      if (seen.has(dep.key)) continue;
      seen.add(dep.key);
      if (dep.stage.state === 'approved') continue;
      found.push(dep);
      walk(dep);
    }
  };
  walk(step);
  const order = gateSteps(run).map((s) => s.key);
  return found.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
}

/**
 * Every step that could be dispatched right now — the fan-out set.
 *
 * More than one entry means those stages are genuinely independent and should
 * be dispatched together. This is the whole payoff of the graph above; without
 * a command that surfaces it, the orchestrator has no way to know two lanes
 * could be running at once.
 */
export function readySteps(run) {
  return gateSteps(run).filter(
    (s) => s.stage.state !== 'approved' && s.stage.state !== 'skipped' && blockers(run, s).length === 0,
  );
}

/** Every step still owed, approved or skipped aside. Empty means the run is done. */
export function remainingSteps(run) {
  return gateSteps(run).filter((s) => s.stage.state !== 'approved' && s.stage.state !== 'skipped');
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

/** Where a lane's stages work, so two lanes running at once never share a tree. */
export const worktreePath = (dir, lane) => join(dir, 'worktrees', lane.slug);

/** Non-empty means real content — a touched file is not an artifact. */
const hasContent = (path) => existsSync(path) && readFileSync(path, 'utf8').trim().length > 0;

/**
 * Does the artifact carry this section as a *heading*?
 *
 * The old check was `text.includes(section)`, which an artifact passes by
 * mentioning the words anywhere — "I couldn't find the root cause" satisfied a
 * required `Root cause` section. A stage owes the next one a section it can
 * find, and what makes a section findable is a heading.
 *
 * Bold-only headers (`**Root cause**` on its own line) count too: several real
 * artifacts use them and they are just as findable. Prose is what does not.
 */
function hasSection(text, section) {
  const escaped = section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const heading = new RegExp(`^\\s{0,3}#{1,6}\\s+.*${escaped}`, 'im');
  const bold = new RegExp(`^\\s{0,3}\\*\\*.*${escaped}.*\\*\\*:?\\s*$`, 'im');
  return heading.test(text) || bold.test(text);
}

/** The last real test result in an evidence file, or null when it holds none. */
export function readEvidence(path) {
  if (!hasContent(path)) return null;
  return parseEvidence(readFileSync(path, 'utf8'));
}

/**
 * Record an artifact and the user's approval, advancing the state machine.
 *
 * Refuses on: an unopened gate, a missing or empty artifact, an artifact missing
 * a section the stage declares, and a test stage with no evidence file. Each of
 * those is a way a stage looks done without being done.
 */
export function accept(dir, run, step, { evidence = null, now = () => new Date().toISOString() } = {}) {
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
  const text = readFileSync(artifact, 'utf8');
  const missing = declared.requires.filter((section) => !hasSection(text, section));
  if (missing.length > 0) {
    throw new RunError(
      `cannot accept ${step.key}: the artifact has no ${missing.join(' section, no ')} section — ` +
        `${step.stage.id} owes the next stage a heading for each of ${declared.requires.join(', ')}`,
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
    // A non-empty file is not a test run. Reading the runner's own summary out
    // of it is what makes the evidence evidence — a stage that wrote `ok` used
    // to clear this gate.
    const result = parseEvidence(readFileSync(proof, 'utf8'));
    if (!result) {
      throw new RunError(
        `cannot accept ${step.key}: ${proof} holds no summary in a format I can parse. ` +
          `I read: ${RUNNER_IDS.join(', ')}.`,
      );
    }
    step.stage.evidence = proof;
    step.stage.result = summarize(result);
  }

  step.stage.state = 'approved';
  // The artifact's mtime is when the subagent finished; `approved` is when the
  // human said yes. Keeping both apart is what lets the run report stage time
  // separately from review time instead of blaming the model for the wait.
  step.stage.at = { ...step.stage.at, delivered: mtimeOf(artifact), approved: now() };
  saveRun(dir, run);
  return run;
}

const mtimeOf = (path) => {
  try {
    return statSync(path).mtime.toISOString();
  } catch {
    return null;
  }
};

/** Mark a stage briefed, recording when — the clock the stage's duration is measured from. */
export function markBriefed(dir, run, step, now = () => new Date().toISOString()) {
  if (step.stage.state === 'pending') step.stage.state = 'briefed';
  step.stage.at = { ...step.stage.at, briefed: step.stage.at?.briefed ?? now() };
  saveRun(dir, run);
  return run;
}

/** Mark a stage skipped. It never becomes approved, so `ship` keeps refusing. */
export function skip(dir, run, step, reason, now = () => new Date().toISOString()) {
  if (!reason) throw new RunError('a skip needs a reason — an unexplained hole in a run is indistinguishable from a bug');
  step.stage.state = 'skipped';
  step.stage.skipReason = reason;
  step.stage.at = { ...step.stage.at, skipped: now() };
  saveRun(dir, run);
  return run;
}

/** How long a stage took, briefed to delivered — never counting the human's review. */
export function durationOf(entry) {
  const { briefed, delivered } = entry.at ?? {};
  if (!briefed || !delivered) return null;
  const ms = Date.parse(delivered) - Date.parse(briefed);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const total = Math.round(ms / 1000);
  return total < 60 ? `${total}s` : `${Math.floor(total / 60)}m${String(total % 60).padStart(2, '0')}s`;
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
    took: durationOf(step.stage) ?? '—',
    gate: blockers(run, step).length === 0 ? 'open' : 'blocked',
  }));
}

/** The first step that could be dispatched right now, or null when none can. */
export function nextStep(run) {
  return readySteps(run)[0] ?? null;
}

/**
 * The work items an approved design declared, read out of the design itself.
 *
 * The orchestrator used to retype these into a JSON file by hand, which is a
 * second, unreviewed copy of a decision the user already approved — and on the
 * run this was measured against, the retyped copy differed from the artifact.
 * Parsing the approved file removes the copy.
 *
 * The format is the one the design stage is asked for verbatim:
 * `- <slug>: <what lands in this layer>` under a `## Work items` heading.
 */
export function workItemsFromDesign(text) {
  const section = /^\s{0,3}#{1,6}\s+work items\s*$/im.exec(text);
  if (!section) {
    throw new RunError('the design declares no `## Work items` heading — it decided this issue is ONE change');
  }
  const rest = text.slice(section.index + section[0].length);
  const end = /^\s{0,3}#{1,6}\s+/m.exec(rest);
  const body = end ? rest.slice(0, end.index) : rest;

  const items = [];
  for (const line of body.split('\n')) {
    const m = /^\s*[-*]\s+`?([A-Za-z0-9][A-Za-z0-9 _-]*?)`?\s*:\s*(\S.*)$/.exec(line);
    // A work item's description is often a full paragraph, and the title ends
    // up in a branch's pull request title and every board row. Keep the first
    // clause for display; the design remains the place the whole thing lives.
    if (m) items.push({ slug: slugify(m[1]), title: firstClause(m[2].trim()) });
  }
  if (items.length === 0) {
    throw new RunError(
      'the design has a `## Work items` heading but no `- <slug>: <what lands>` lines under it — ' +
        'nothing there names a lane',
    );
  }
  return items;
}

/** The first sentence or clause of a work item, for the places a title has to fit. */
function firstClause(text, max = 72) {
  const clean = text.replace(/`/g, '').replace(/\s+/g, ' ').trim();
  const stop = clean.search(/[.;]\s/);
  const head = stop > 0 ? clean.slice(0, stop) : clean;
  if (head.length <= max) return head;
  const cut = head.slice(0, max + 1).lastIndexOf(' ');
  return `${(cut > 0 ? head.slice(0, cut) : head.slice(0, max)).replace(/[,;:]$/, '')}…`;
}

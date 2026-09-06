/**
 * The run: a directory on disk, and the state machine that decides what may
 * happen next.
 *
 * The one rule lives here, as code. Every advance goes through `blockers`,
 * which refuses a step whose predecessors are not approved — so "the gates are
 * enforced" is a property of the program rather than a paragraph the
 * orchestrator is trusted to have read.
 *
 * The run lives outside the target repo (`~/.claude/issueflow/…`) so a run
 * survives branch switches and never appears in the user's `git status`.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { EVIDENCE_FILE, PER_ITEM_STAGES, PLAN_STAGE, SHARED_STAGES, stage } from './stages.mjs';
import { branchFor, slugify } from './policy.mjs';
import { parseAllEvidence, summarize, twoSided, RUNNER_IDS } from './evidence.mjs';

/**
 * Schema 3: two stages instead of four, and a review loop on every lane. A
 * schema-2 run is not migrated — every one on the maintainer's machine is
 * `done`, and inventing a plan stage out of a separate investigate and design
 * would be the loader rewriting history. `runs` names the mismatch and the
 * remedy for any that remain.
 */
export const SCHEMA = 3;

/** A gate refusal: the work is not done, send it back. Exit code 2. */
export class RunError extends Error {}

/**
 * The run must stop and a human must decide: an exhausted stage, drift on
 * GitHub, a finding disputed twice, or the human stop itself. Exit code 4 —
 * distinct from a refusal (2) and from infrastructure (3), so a driver can
 * tell "send the work back" from "retry" from "ask the person" without
 * parsing English.
 */
export class HandBack extends Error {}

/** Where runs live. `--run-dir` overrides it, which is how the evals stay offline and hermetic. */
export function runRoot(override) {
  return override ? override : join(homedir(), '.claude', 'issueflow');
}

export const runDir = (root, owner, name, number) => join(root, `${owner}__${name}`, `issue-${number}`);

const statePath = (dir) => join(dir, 'run.json');

/** A stage entry, built from the declaration so the two can never disagree. */
const stageEntry = (id) => {
  const s = stage(id);
  return {
    id: s.id, model: s.model, agent: s.agent, artifact: s.artifact, state: 'pending', at: {},
    review: { rounds: [], feedback: null },
  };
};

/** The pull-request review loop's record on a lane — empty until `ship` opens the pull request. */
const laneReviewEntry = () => ({ rounds: [], converged: false, draft: null });

const laneEntry = (policy, issue, { slug, title, base }) => ({
  id: slug,
  slug,
  title,
  branch: branchFor(policy, issue.number, slug),
  base,
  pr: null,
  landed: null,
  review: laneReviewEntry(),
  stages: PER_ITEM_STAGES.map(stageEntry),
});

/** A fresh run for one issue, with a single unsplit lane. */
export function createRun({ repo, issue, policy, offline = false, auto = false }) {
  return {
    schema: SCHEMA,
    repo,
    issue: { number: issue.number, title: issue.title, url: issue.url },
    policy,
    // A run started from frozen `gh` payloads must never dial out later, no
    // matter which flags the next command carries. Recording it on the run is
    // what makes that a property of the run rather than of the invocation.
    offline,
    // Every run's plan is red-teamed. `auto` decides the one thing left to
    // decide: whether a human also reads the red-teamed plan before any code
    // is written. On the run like the offline flag, and for the same reason:
    // whether an approval needs a human is a property of the run, not of
    // whoever types the next command.
    auto,
    split: false,
    // The sticky issue comment this run keeps up to date. Adopted by marker
    // when a run is resumed on a machine that has no run.json.
    checkpoint: { commentId: null, commentUrl: null, pushed: {} },
    finished: null,
    stages: SHARED_STAGES.map(stageEntry),
    lanes: [laneEntry(policy, issue, { slug: 'root', title: issue.title, base: policy.base })],
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
  run.auto ??= false;
  run.finished ??= null;
  for (const lane of run.lanes) {
    lane.landed ??= null;
    lane.pr ??= null;
    lane.review ??= laneReviewEntry();
  }
  for (const s of [...run.stages, ...run.lanes.flatMap((l) => l.stages)]) {
    s.review ??= { rounds: [], feedback: null };
  }
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

/** Resolve one lane by slug, or the only lane when the run is unsplit. */
export function findLane(run, slug = null) {
  if (!slug) {
    if (run.lanes.length > 1) {
      throw new RunError(`this run has ${run.lanes.length} lanes — name one with --lane <${run.lanes.map((l) => l.slug).join('|')}>`);
    }
    return run.lanes[0];
  }
  const lane = run.lanes.find((l) => l.slug === slug);
  if (!lane) throw new RunError(`no lane "${slug}" in this run`);
  return lane;
}

/**
 * What one step actually depends on.
 *
 * This used to be "every step listed above it", which is cheap to write and
 * wrong: it made a lane's `implement` wait on the *previous lane's tests*, a
 * dependency that does not exist. The real edges, in the two-stage shape:
 *
 *   investigate     ← nothing
 *   lane.implement  ← investigate, plus the implement of the lane it stacks on
 *
 * The stacked-parent edge is real and load-bearing: a lane branches off the
 * branch below it, so its commits cannot exist until that branch does. What is
 * NOT real is waiting for the parent lane's pull request to be reviewed — the
 * review loop orders itself bottom-first separately (see `next.mjs`).
 */
export function dependencies(run, step) {
  const steps = gateSteps(run);
  const at = (key) => steps.find((s) => s.key === key) ?? null;
  const out = [];

  if (step.stage.id === 'implement') {
    out.push(at(PLAN_STAGE));
    const parent = run.lanes.find((l) => l.branch === step.lane?.base);
    if (parent) out.push(at(`${parent.slug}/implement`));
  }

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

/** Every step still owed, approved or skipped aside. Empty means the gate is clear. */
export function remainingSteps(run) {
  return gateSteps(run).filter((s) => s.stage.state !== 'approved' && s.stage.state !== 'skipped');
}

/**
 * The run's own state, in one place.
 *
 * `in progress` while any gate step is owed; `ready to ship` once the gate is
 * clear; `in review` while any lane's pull request is open and its review
 * loop has not converged; `shipped` once every lane's pull request has
 * converged and awaits a merge; `done` once `finish` has recorded every
 * landing. `remainingSteps()` itself is unchanged: it still means "every gate
 * step passed," which is what `readySteps`, `blockers` and the held-stage
 * message depend on.
 */
export function runState(run) {
  if (run.finished) return 'done';
  if (remainingSteps(run).length > 0) return 'in progress';
  if (!run.lanes.every((l) => l.pr)) return 'ready to ship';
  return run.lanes.every((l) => l.review?.converged) ? 'shipped' : 'in review';
}

/** Record that a lane's pull request merged and its checkout/branch are gone. */
export function recordLanding(dir, run, lane, { pr, url, mergedAt } = {}, now = () => new Date().toISOString()) {
  lane.landed = { pr, url, mergedAt, at: now() };
  saveRun(dir, run);
  return run;
}

/** Record that every lane has landed — the run is over. */
export function recordFinished(dir, run, { issueClosed = false } = {}, now = () => new Date().toISOString()) {
  run.finished = { at: now(), issueClosed };
  saveRun(dir, run);
  return run;
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

/**
 * Where a stage may report progress while it works — the fourth thing a stage
 * writes, alongside its artifact, its evidence and its brief. Never read by the
 * state machine and never required: a stage that never touches this path is
 * still fully visible through `board()`'s filesystem-observed clock, which is
 * what keeps this an enrichment rather than the primary liveness signal.
 */
export const progressPath = (dir, step) => join(dir, 'progress', `${step.key.replace('/', '-')}.log`);

/** Where a lane's stages work, so two lanes running at once never share a tree. */
export const worktreePath = (dir, lane) => join(dir, 'worktrees', lane.slug);

/** Non-empty means real content — a touched file is not an artifact. */
export const hasContent = (path) => existsSync(path) && readFileSync(path, 'utf8').trim().length > 0;

/** What a red-team verdict binds itself to: the exact bytes it reviewed. */
export const sha256OfFile = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

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
export function hasSection(text, section) {
  const escaped = section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const heading = new RegExp(`^\\s{0,3}#{1,6}\\s+.*${escaped}`, 'im');
  const bold = new RegExp(`^\\s{0,3}\\*\\*.*${escaped}.*\\*\\*:?\\s*$`, 'im');
  return heading.test(text) || bold.test(text);
}

/** Every real test result in an evidence file, in order — empty when it holds none. */
export function readEvidence(path) {
  if (!hasContent(path)) return [];
  return parseAllEvidence(readFileSync(path, 'utf8'));
}

const git = (args, cwd) => {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
};

/** The checkout a lane's stage worked in: its worktree when it has one, else the repo. */
export const laneTree = (dir, run, lane) =>
  lane && existsSync(worktreePath(dir, lane)) ? worktreePath(dir, lane) : run.repo.path;

/**
 * Record an artifact and its approval, advancing the state machine.
 *
 * Refuses on: an unopened gate, a missing or empty artifact, an artifact missing
 * a section the stage declares, an implement stage whose evidence holds no
 * runner result or no red run before its green one, an implement stage that
 * left uncommitted work in its tree, and a plan the red team never read. Each
 * of those is a way a stage looks done without being done.
 */
export function accept(dir, run, step, { evidence = null, auto = false, now = () => new Date().toISOString() } = {}) {
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

  if (PER_ITEM_STAGES.includes(step.stage.id)) {
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
    const results = parseAllEvidence(readFileSync(proof, 'utf8'));
    if (results.length === 0) {
      throw new RunError(
        `cannot accept ${step.key}: ${proof} holds no summary in a format I can parse. ` +
          `I read: ${RUNNER_IDS.join(', ')}.`,
      );
    }
    // The red half, mechanically. The separate test stage used to be the pair
    // of eyes that checked the test was seen failing; this is what replaced it.
    const sided = twoSided(results);
    if (!sided.ok) {
      throw new RunError(
        `cannot accept ${step.key}: ${proof} ${sided.reason}. The evidence must show the test failing ` +
          'against the unfixed behaviour, then passing — in that order.',
      );
    }
    // The pull request is opened from the branch's commits, so anything left
    // uncommitted in the tree is work the review would never see. Checked only
    // when git can answer: a run against no checkout has nothing to leave dirty.
    const tree = laneTree(dir, run, step.lane);
    const dirty = git(['status', '--porcelain'], tree);
    if (dirty !== null && dirty !== '') {
      throw new RunError(
        `cannot accept ${step.key}: ${dirty.split('\n').length} uncommitted path(s) in ${tree} — ` +
          'the pull request is opened from the commits, and uncommitted work is work the review never sees',
      );
    }
    step.stage.evidence = proof;
    step.stage.result = summarize(results.at(-1));
  }

  // The plan is red-teamed on every run. A human may approve a plan the red
  // team blocked — that is what the human stop is for — but never one it has
  // not read: a plan with no registered round is a plan whose rejected
  // alternatives nobody has attacked. The auto path is NARROWER, never a
  // bypass: every refusal above ran first, and this adds the verdict on top.
  if (step.stage.id === PLAN_STAGE) {
    const latest = step.stage.review?.rounds.at(-1) ?? null;
    if (!latest) {
      throw new RunError(
        `cannot accept ${step.key}: no red-team review is registered — ` +
          'the plan is attacked before anyone approves it; brief the reviewer first',
      );
    }
    if (auto) {
      if (!run.auto) {
        throw new RunError(
          `cannot auto-accept ${step.key}: this run was not started with --auto — ` +
            'its plan is approved by the user, and a flag on one command does not reassign that',
        );
      }
      if (latest.verdict !== 'pass') {
        throw new RunError(
          `cannot auto-accept ${step.key}: round ${latest.round} is blocked ` +
            `(${latest.findings.critical} critical, ${latest.findings.high} high) — ` +
            'send the stage back with the review; never approve over an open blocking finding',
        );
      }
      if (latest.artifactSha !== sha256OfFile(artifact)) {
        throw new RunError(
          `cannot auto-accept ${step.key}: the artifact changed after round ${latest.round} reviewed it — ` +
            'a verdict binds to the bytes it read; re-review the current artifact',
        );
      }
      step.stage.autoApproved = true;
    }
  } else if (auto) {
    if (!run.auto) {
      throw new RunError(
        `cannot auto-accept ${step.key}: this run was not started with --auto — ` +
          'a flag on one command does not reassign who holds the gate',
      );
    }
    step.stage.autoApproved = true;
  }

  step.stage.state = 'approved';
  // The artifact's mtime is when the subagent finished; `approved` is when the
  // gate said yes. Keeping both apart is what lets the run report stage time
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

/**
 * Did this artifact land after the step's latest brief? An artifact older
 * than its brief is the previous round's — a re-dispatched stage must not
 * render `delivered` the instant it is briefed again, which is exactly what
 * a plain existence check did.
 */
export function deliveredSince(dir, step) {
  const artifact = artifactPath(dir, step);
  if (!hasContent(artifact)) return null;
  const delivered = mtimeOf(artifact);
  const briefed = step.stage.at?.briefed;
  if (briefed && Date.parse(delivered) < Date.parse(briefed)) return null;
  return delivered;
}

/**
 * The run, with `at.delivered` filled in from disk for any step whose
 * artifact has already landed but is not yet approved — in memory only.
 * `accept()` remains the only writer: it records the same value from the same
 * mtime when the stage is approved, so `delivered` is identical whether it was
 * observed first or not. This only makes it visible earlier, to a reader who
 * is not the one approving.
 */
export function observe(dir, run) {
  const cloneEntry = (s) => ({ ...s, at: { ...s.at } });
  const observed = {
    ...run,
    stages: run.stages.map(cloneEntry),
    lanes: run.lanes.map((lane) => ({ ...lane, stages: lane.stages.map(cloneEntry) })),
  };
  for (const step of gateSteps(observed)) {
    if (step.stage.at.delivered) continue;
    const delivered = deliveredSince(dir, step);
    if (delivered) step.stage.at.delivered = delivered;
  }
  return observed;
}

/**
 * Record that the USER re-opened a rounds-capped stage for one more round.
 *
 * The cap stops the autonomous loop; it does not overrule the person the loop
 * works for. What makes the override legitimate is that it is recorded with
 * the user's reason — an unexplained fourth round is indistinguishable from
 * the oscillation the cap exists to stop.
 */
export function recordCapOverride(dir, run, step, reason, now = () => new Date().toISOString()) {
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    throw new RunError(
      'a cap override needs the user\'s direction as its reason — ' +
        'pass --another-round "<what the user decided>", never a bare flag',
    );
  }
  step.stage.review.overrides ??= [];
  step.stage.review.overrides.push({ round: step.stage.review.rounds.length + 1, reason: reason.trim(), at: now() });
  saveRun(dir, run);
  return run;
}

/**
 * Mark a stage briefed, recording when — the clock the stage's duration is
 * measured from.
 *
 * A re-brief (a stage sent back by the red team) starts a fresh clock: the
 * previous dispatch's `briefed`/`delivered` pair is archived under
 * `at.rounds` so the expectation line stops folding every review round into
 * one duration, and `delivered` is cleared so the board shows the stage
 * running again rather than `delivered` off the previous round's artifact.
 */
export function markBriefed(dir, run, step, now = () => new Date().toISOString()) {
  if (step.stage.state === 'pending') step.stage.state = 'briefed';
  const at = { ...step.stage.at };
  // `at.delivered` is persisted only by `accept`; a stage sent back before it
  // was accepted has its delivery on disk and nowhere else, so the artifact
  // is asked directly.
  const delivered = at.delivered ?? deliveredSince(dir, step);
  if (at.briefed && delivered) {
    at.rounds = [...(at.rounds ?? []), { briefed: at.briefed, delivered }];
    delete at.delivered;
    at.briefed = now();
  } else {
    at.briefed = at.briefed ?? now();
  }
  step.stage.at = at;
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

/** Render a millisecond span the way every duration in this file is shown. Exported so `timings.mjs` renders past durations identically instead of a second copy of the same rule. */
export const formatSpan = (ms) => {
  const total = Math.round(ms / 1000);
  return total < 60 ? `${total}s` : `${Math.floor(total / 60)}m${String(total % 60).padStart(2, '0')}s`;
};

/** How long a stage took, briefed to delivered — never counting the human's review. */
export function durationOf(entry) {
  const { briefed, delivered } = entry.at ?? {};
  if (!briefed || !delivered) return null;
  const ms = Date.parse(delivered) - Date.parse(briefed);
  if (!Number.isFinite(ms) || ms < 0) return null;
  return formatSpan(ms);
}

/**
 * How long a stage has been running, briefed to `now` — for a stage that has
 * not delivered yet. The `+` marks it as a lower bound ("at least this long"),
 * never a finished duration; `durationOf` is what reports a finished one.
 */
export function elapsedOf(entry, now) {
  const { briefed } = entry.at ?? {};
  if (!briefed) return null;
  const ms = Date.parse(now) - Date.parse(briefed);
  if (!Number.isFinite(ms) || ms < 0) return null;
  return `${formatSpan(ms)}+`;
}

/**
 * Expand an approved plan's work items into lanes.
 *
 * Each lane stacks on the one below it — the bottom targets the repo's base
 * branch and every layer above targets its predecessor, which is the house
 * shape for reviewable layered work. Splitting after a lane has delivered an
 * implementation would strand commits on a branch no lane owns, so it is
 * refused — but a lane that was merely *briefed* has produced nothing yet, and
 * a split is still safe. (A `brief --ready` straight after the plan used to
 * foreclose `split` forever.)
 */
export function split(dir, run, items) {
  if (run.split) throw new RunError('this run is already split — a second split would strand the first split\'s lanes');
  const plan = findStep(run, PLAN_STAGE);
  if (plan.stage.state !== 'approved') {
    throw new RunError('cannot split before the plan is approved — the seams come from the plan, not from the issue');
  }
  const started = gateSteps(run).some(
    (s) => s.laneSlug && (s.stage.state === 'approved' || s.stage.state === 'skipped' || hasContent(artifactPath(dir, s))),
  );
  if (started) throw new RunError('cannot split a run whose implementation has delivered — its commits belong to no lane');
  if (items.length < 2) throw new RunError(`a split needs at least 2 work items, got ${items.length}`);

  const seen = new Set();
  const issue = { number: run.issue.number };
  run.lanes = items.map((item, i) => {
    const slug = slugify(item.slug ?? item.title);
    if (seen.has(slug)) throw new RunError(`two work items slug to "${slug}" — each lane needs its own branch`);
    seen.add(slug);
    const base = i === 0
      ? run.policy.base
      : branchFor(run.policy, run.issue.number, slugify(items[i - 1].slug ?? items[i - 1].title));
    return laneEntry(run.policy, issue, { slug, title: item.title, base });
  });
  run.split = true;
  saveRun(dir, run);
  return run;
}

/**
 * The run board: one row per gate step, in the order they must happen.
 *
 * `now`, when given, is what makes `Took` answer for a stage that is still
 * running: a step that is `briefed` with nothing delivered yet renders its
 * elapsed time with a `+` suffix (`4m12s+`) — a lower bound, not a finished
 * duration. Without `now` this renders exactly as it always has, so a caller
 * that never passes it (or a frozen golden built before this change) stays
 * byte-identical.
 *
 * `state` here is a display state, not the persisted one: a step whose
 * `stage.state` is still `briefed` but whose `at.delivered` is already set
 * (via `observe`) shows as `delivered` — the artifact landed, nobody has
 * approved it yet. `stage.state` itself is untouched; only this row's
 * rendering changes.
 */
export function board(run, { now = null } = {}) {
  return gateSteps(run).map((step) => {
    const entry = step.stage;
    const delivered = Boolean(entry.at?.delivered);
    const running = entry.state === 'briefed' && !delivered;
    return {
      step: step.key,
      stage: step.stage.id,
      model: step.stage.model,
      state: entry.state === 'briefed' && delivered ? 'delivered' : entry.state,
      took: durationOf(entry) ?? (now && running ? elapsedOf(entry, now) : null) ?? '—',
      gate: blockers(run, step).length === 0 ? 'open' : 'blocked',
    };
  });
}

/** The first step that could be dispatched right now, or null when none can. */
export function nextStep(run) {
  return readySteps(run)[0] ?? null;
}

/**
 * The work items an approved plan declared, read out of the plan itself.
 *
 * The orchestrator used to retype these into a JSON file by hand, which is a
 * second, unreviewed copy of a decision the user already approved — and on the
 * run this was measured against, the retyped copy differed from the artifact.
 * Parsing the approved file removes the copy.
 *
 * The format is the one the plan stage is asked for verbatim:
 * `- <slug>: <what lands in this layer>` under a `## Work items` heading.
 */
export function workItemsFromPlan(text) {
  const section = /^\s{0,3}#{1,6}\s+work items\s*$/im.exec(text);
  if (!section) {
    throw new RunError('the plan declares no `## Work items` heading — it decided this issue is ONE change');
  }
  const rest = text.slice(section.index + section[0].length);
  const end = /^\s{0,3}#{1,6}\s+/m.exec(rest);
  const body = end ? rest.slice(0, end.index) : rest;

  // A split is the exception, and the heading carries its own reason. The
  // first 0.7.0 run fanned four small unrelated fixes into four lanes because
  // nothing asked why; a plan that cannot say so in numbers has not earned it.
  const why = /^[ \t]*(?:[-*][ \t]+)?\**why split\**[ \t]*:[ \t]*\**[ \t]*(\S.*)$/im.exec(body); // [ \t], not \s: an empty reason must not slurp the next line
  if (!why) {
    throw new RunError(
      'the plan has a `## Work items` heading but no `Why split: <the size or the layer, in numbers>` line under it — ' +
        'one pull request per issue is the default; a split has to say what makes this change too large to review as one',
    );
  }

  const items = [];
  for (const line of body.split('\n')) {
    if (/^\s*(?:[-*]\s+)?\**why split\**\s*:/i.test(line)) continue; // the reason line is never a lane
    const m = /^\s*[-*]\s+`?([A-Za-z0-9][A-Za-z0-9 _-]*?)`?\s*:\s*(\S.*)$/.exec(line);
    // A work item's description is often a full paragraph, and the title ends
    // up in a branch's pull request title and every board row. Keep the first
    // clause for display; the plan remains the place the whole thing lives.
    if (m) items.push({ slug: slugify(m[1]), title: firstClause(m[2].trim()) });
  }
  if (items.length === 0) {
    throw new RunError(
      'the plan has a `## Work items` heading but no `- <slug>: <what lands>` lines under it — ' +
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

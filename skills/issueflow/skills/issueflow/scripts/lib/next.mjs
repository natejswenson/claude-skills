/**
 * `next` — the one next action, computed from state.
 *
 * Before this, the auto-mode loop was an eight-step prose procedure the
 * orchestrator drove by hand, remembering which command came after which and
 * polling `status` to guess whether a subagent had finished. The orchestrator
 * flailed roughly five percent of every measured run doing that, and the
 * remaining failure modes — a review registered against a stale artifact, a
 * lane briefed before the one below it converged, a round started on a head
 * GitHub had not received — were all "forgot a step".
 *
 * So the steps are here. `decide()` reads the run and returns exactly one
 * action: `dispatch` (subagents to start, with the wait that tells you when
 * they are done), `run` (a deterministic command the CLI performs itself),
 * `wait` (something is in flight), or `stop` (a human must act: the human
 * stop, an exhausted cap, drift, a dispute, a stall). The CLI's `next`
 * performs every `run` it reaches and re-decides, so one invocation carries
 * the run to its next dispatch, wait or stop.
 *
 * Waiting is filesystem-observed: the wait line is `until [ <output> -nt
 * <brief> ]`, output newer than the brief that dispatched it, so a re-dispatch
 * over an existing artifact does not fire instantly and no sentinel the
 * subagent could forget is needed. The deadline is three times this repo's
 * median for the step, else thirty minutes; the wait exits 124 at it, and
 * `next` reads that as a stall.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PLAN_STAGE } from './stages.mjs';
import {
  artifactPath, briefPath, deliveredSince, evidencePath, findStep, laneTree, progressPath, readySteps, remainingSteps, runState, sha256OfFile,
} from './run.mjs';
import { latestRound, nextRound, reviewBriefPath, reviewPath, roundsExhausted } from './reviews.mjs';
import {
  MAX_REVIEW_ROUNDS, candidatesPath, currentRound, finderBriefPath, finderProfile, fixBriefPath,
  fixReportPath, openMajors, reviewExhausted, stackedOn, verdictsPath, verifierBriefPath,
  verifierProfile,
} from './prreview.mjs';
import { readTimings } from './timings.mjs';
import { dispatchLabel } from './runtime.mjs';
import { DISPATCHES, budgetStatus, budgetStop } from './budget.mjs';

const DEFAULT_TIMEOUT_S = 1800;
const STALL_FACTOR = 3;
/** How long an output's size must hold still before the wait believes it is finished. */
export const SETTLE_S = 2;
export const POLL_S = 1;
export const HEARTBEAT_TIMEOUT_S = 300;

const spanToSeconds = (span) => {
  const m = /^(?:(\d+)m)?(\d+)s$/.exec(span);
  return m ? Number(m[1] ?? 0) * 60 + Number(m[2]) : null;
};

/** Three times the repo's median for this stage, else the default. */
export function timeoutFor(dir, stageId) {
  const entry = readTimings(dir).find((t) => t.stage === stageId);
  if (!entry || entry.n < 2) return DEFAULT_TIMEOUT_S;
  const median = spanToSeconds(entry.median);
  return median ? Math.max(300, median * STALL_FACTOR) : DEFAULT_TIMEOUT_S;
}

export const sh = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/**
 * A background-Bash wait: exit 0 when every output is newer than its brief,
 * 124 at the deadline. Plain POSIX sh with a `date +%s` deadline — not GNU
 * `timeout`, which a stock Mac does not have; the first real run of 0.7.0
 * exited 127 on that within a second of arming the wait.
 */
export function waitLine({ pairs, timeout, settle = SETTLE_S }) {
  const conds = pairs.map(([output, brief]) => (brief ? `[ ${sh(output)} -nt ${sh(brief)} ]` : `[ -f ${sh(output)} ]`)).join(' && ');
  // Settle: a subagent writes its artifact in several passes, and the first
  // one already satisfies `-nt`. The first real 0.7.0 run briefed the red
  // team on a plan that was still being written (409 of 823 lines). So the
  // wait only returns once every output's size has held still for a while.
  const sizes = pairs.map(([output]) => `$(wc -c < ${sh(output)} 2>/dev/null)`).join(':');
  const script = `end=$(( $(date +%s) + ${timeout} )); until ${conds}; do [ $(date +%s) -ge $end ] && exit 124; sleep ${POLL_S}; done; a=${sizes}; sleep ${settle}; b=${sizes}; while [ "$a" != "$b" ]; do a=$b; sleep ${settle}; b=${sizes}; done`;
  return `sh -c '${script.replace(/'/g, `'\\''`)}'`;
}

const dispatch = (items, { pairs, timeout, note = null }) => ({ kind: 'dispatch', items, wait: waitLine({ pairs, timeout }), note });
const wait = (what, { pairs, timeout, note = null }) => ({ kind: 'wait', what, wait: waitLine({ pairs, timeout }), note });
const act = (command, args, note = null) => ({ kind: 'run', command, args, note });
const stop = (reason, detail, extra = {}) => ({ kind: 'stop', reason, detail, ...extra });

const promptFor = (path) => `Read ${path} and follow it exactly. It is your complete brief.`;

const git = (args, cwd) => {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
};

const mtime = (path) => (existsSync(path) ? statSync(path).mtimeMs : null);
const activityMtime = (dir, run, step) => {
  let latest = Math.max(mtime(progressPath(dir, step)) ?? 0, mtime(evidencePath(dir, step)) ?? 0) || null;
  if (!step.lane) return latest;
  const tree = laneTree(dir, run, step.lane);
  const changed = git(['status', '--short', '--untracked-files=all'], tree);
  for (const line of (changed ?? '').split('\n').filter(Boolean)) {
    const relative = line.slice(3).split(' -> ').at(-1);
    const changedAt = mtime(join(tree, relative));
    if (changedAt != null && (latest == null || changedAt > latest)) latest = changedAt;
  }
  return latest;
};
const heartbeatAge = (dir, run, step, now) => {
  const last = activityMtime(dir, run, step);
  return last == null ? null : Math.max(0, Date.parse(now) - last) / 1000;
};
const silentStop = (dir, run, step, now) => {
  const age = heartbeatAge(dir, run, step, now);
  if (age == null || age < HEARTBEAT_TIMEOUT_S) return null;
  return stop('stalled', `${step.key} has reported no progress, evidence, or worktree activity for ${Math.round(age / 60)} minutes — re-dispatch the worker instead of waiting for the full budget`, {
    items: [{ model: step.stage.model, reasoning: step.stage.reasoning, agent: step.stage.agent, prompt: promptFor(briefPath(dir, step)) }],
    command: `brief --stage ${step.stage.id}${step.laneSlug !== 'root' ? ` --lane ${step.laneSlug}` : ''} (re-render, then re-dispatch)`,
  });
};
const newerThan = (output, brief) => existsSync(output) && (!existsSync(brief) || mtime(output) >= mtime(brief));

/**
 * Has this step been briefed more recently than its last delivery or its last
 * blocked round? `markBriefed` writes `at.briefed`; a blocked registration
 * writes the round's `at`. A stage whose brief predates the block has not
 * been sent back yet.
 */
const briefedSince = (step, iso) => Boolean(step.stage.at?.briefed) && (!iso || Date.parse(step.stage.at.briefed) >= Date.parse(iso));

// ---------------------------------------------------------------------------
// The plan.
// ---------------------------------------------------------------------------

function decidePlan(dir, run, step, ctx) {
  const brief = briefPath(dir, step);
  const artifact = artifactPath(dir, step);
  const latest = latestRound(step);
  const timeout = timeoutFor(dir, step.stage.id);

  // A blocked round: the stage goes back, then delivers again, then is reviewed again.
  if (latest?.verdict === 'decision') {
    return stop('human', `the red team identified a scope change — read ${join(dir, latest.review)} and decide whether to narrow the issue or authorize it`, {
      artifact, review: join(dir, latest.review),
      command: `brief --stage ${step.stage.id} --another-round "<the user's scope decision>"`,
    });
  }
  if (latest?.verdict === 'blocked') {
    if (latest.repeated) {
      return stop('dispute', `the same blocking mechanism survived two plan rounds — read ${join(dir, latest.review)} and direct the next round`, {
        artifact, review: join(dir, latest.review),
        command: `brief --stage ${step.stage.id} --another-round "<how the repeated blocker should be resolved>"`,
      });
    }
    if (roundsExhausted(step)) {
      return stop('exhausted', `the red team refused the plan ${latest.round} times — the open findings are in ${join(dir, latest.review)}`, {
        command: `brief --stage ${step.stage.id} --another-round "<what the user decided>"`,
      });
    }
    if (!briefedSince(step, latest.at)) return act('brief', { stage: step.stage.id }, `round ${latest.round} blocked — sending the plan back with the findings`);
    if (!deliveredSince(dir, step)) return wait(`the plan, round ${latest.round + 1}`, { pairs: [[artifact, brief]], timeout });
  } else if (latest?.verdict === 'pass') {
    if (latest.artifactSha === sha256OfFile(artifact)) {
      if (run.auto) return act('accept', { stage: step.stage.id, auto: true }, `round ${latest.round} passed — approving the plan on the verdict`);
      return stop('human', 'the plan passed its red-team review — read it, then approve or send it back', {
        artifact, review: join(dir, latest.review),
        command: `accept --stage ${step.stage.id}`,
        alternative: `brief --stage ${step.stage.id} --another-round "<your direction>"`,
      });
    }
    // Edited after its pass: reviewed again before anyone approves it.
  } else if (!step.stage.at?.briefed) {
    return act('brief', { stage: step.stage.id }, 'the plan has not been briefed');
  } else if (!deliveredSince(dir, step)) {
    return wait('the plan', { pairs: [[artifact, brief]], timeout });
  }

  // Delivered and not yet reviewed at this delivery: the red team.
  const round = nextRound(step);
  const reviewBrief = reviewBriefPath(dir, step, round);
  const findings = reviewPath(dir, step, round);
  const briefedRound = step.stage.review?.briefed?.round ?? null;
  // Findings written after the artifact's last change reviewed THIS artifact,
  // whatever the brief's mtime says — a brief re-rendered under a finished
  // review must not make the review look stale. The registrar binds the
  // verdict to the artifact's bytes either way.
  if (briefedRound === round && newerThan(findings, artifact)) {
    return act('review', { stage: step.stage.id }, `red-team round ${round} delivered — registering it`);
  }
  if (briefedRound !== round || !newerThan(reviewBrief, artifact)) {
    return act('brief', { review: true, stage: step.stage.id }, `the plan is delivered — briefing red-team round ${round}`);
  }
  return wait(`red-team round ${round}`, { pairs: [[findings, reviewBrief]], timeout: DEFAULT_TIMEOUT_S });
}

// ---------------------------------------------------------------------------
// A lane's implement.
// ---------------------------------------------------------------------------

function decideImplement(dir, run, step, ctx) {
  const brief = briefPath(dir, step);
  const artifact = artifactPath(dir, step);
  const timeout = timeoutFor(dir, step.stage.id);
  if (!step.stage.at?.briefed) return act('brief', { stage: step.stage.id, lane: step.laneSlug }, `${step.key} is ready to be briefed`);
  if (!deliveredSince(dir, step)) {
    const silent = silentStop(dir, run, step, ctx.now());
    if (silent) return silent;
    const elapsed = (Date.parse(ctx.now()) - Date.parse(step.stage.at.briefed)) / 1000;
    const activityAge = heartbeatAge(dir, run, step, ctx.now());
    if (elapsed > timeout && (activityAge == null || activityAge >= HEARTBEAT_TIMEOUT_S)) {
      return stop('stalled', `${step.key} has run ${Math.round(elapsed / 60)} minutes with nothing delivered — past ${Math.round(timeout / 60)} minutes, the stall threshold for this repo`, {
        items: [{ model: step.stage.model, reasoning: step.stage.reasoning, agent: step.stage.agent, prompt: promptFor(brief) }],
        command: `brief --stage ${step.stage.id}${step.laneSlug !== 'root' ? ` --lane ${step.laneSlug}` : ''} (re-render, then re-dispatch)`,
      });
    }
    return wait(step.key, { pairs: [[artifact, brief]], timeout });
  }
  return act('accept', { stage: step.stage.id, lane: step.laneSlug, auto: run.auto }, `${step.key} delivered — running the gate`);
}

// ---------------------------------------------------------------------------
// A lane's review loop.
// ---------------------------------------------------------------------------

function allPresent(paths) {
  return paths.every((p) => existsSync(p));
}

/**
 * The cap. The fixer's last commit is on the branch unverified; the person
 * reads it and rules, or buys one more round. `next` never does either.
 */
const exhaustedStop = (lane) =>
  stop('exhausted', `${lane.slug}: ${MAX_REVIEW_ROUNDS} rounds and ${openMajors(lane).length} major(s) still open — read the last fix and each open thread, then rule`, {
    command: `review-rule --lane ${lane.slug} --finding <id> --fixed|--withdrawn --note "<what you checked>"`,
    alternative: `review-brief --lane ${lane.slug} --another-round "<why one more round>"`,
  });

function decideLoop(dir, run, lane, ctx) {
  const entry = currentRound(lane);
  const tree = laneTree(dir, run, lane);
  const head = git(['rev-parse', 'HEAD'], tree);

  if (!entry) {
    if (reviewExhausted(lane)) return exhaustedStop(lane);
    // A stacked lane's first round reviews it on top of the lane below AS IT
    // CONVERGED — every fix commit on the lane below changed the code this
    // lane was built on. Rebased once, before any thread exists; never after.
    const parent = run.lanes.find((l) => l.branch === lane.base);
    if (parent && head && !stackedOn(tree, lane.branch, parent.branch)) {
      return act('rebase', { lane: lane.slug }, `${lane.slug}: the lane below moved under it — rebasing onto ${parent.branch} before round 1`);
    }
    return act('review-brief', { lane: lane.slug }, `${lane.slug}: opening review round 1 on #${lane.pr.number}`);
  }

  if (!entry.registered) {
    const round = entry.round;
    // A reviewer fleet that never writes is the stall this exists for: the
    // first real loop lost all four round-3 finders to a session rate limit
    // at once, and a wait with no stall rule would have been printed forever.
    // Missing outputs whose briefs are older than the deadline stop the run
    // with exactly the prompts to re-dispatch — the same one-line prompts.
    const stalled = (files, briefs, profile, what) => {
      const missing = files.map((f, i) => [f, briefs[i]]).filter(([f]) => !existsSync(f));
      const oldest = Math.min(...missing.map(([, b]) => mtime(b) ?? Infinity));
      if (missing.length === 0 || !Number.isFinite(oldest)) return null;
      const elapsed = (Date.parse(ctx.now()) - oldest) / 1000;
      if (elapsed <= DEFAULT_TIMEOUT_S) return null;
      return stop('stalled', `${lane.slug} round ${round}: ${missing.length} ${what}(s) briefed ${Math.round(elapsed / 60)} minutes ago and never delivered — past the ${Math.round(DEFAULT_TIMEOUT_S / 60)}-minute threshold`, {
        items: missing.map(([, b]) => ({ ...profile, prompt: promptFor(b) })),
      });
    };
    if (entry.verifiers === null) {
      const files = Array.from({ length: entry.finders }, (_, i) => candidatesPath(dir, lane, round, i + 1));
      const briefs = Array.from({ length: entry.finders }, (_, i) => finderBriefPath(dir, lane, round, i + 1));
      if (allPresent(files)) return act('review-verify', { lane: lane.slug }, `${lane.slug} round ${round}: every finder delivered — planning verification`);
      return stalled(files, briefs, finderProfile(run), 'finder') ?? wait(`${lane.slug} round ${round} finders (${files.filter((f) => existsSync(f)).length}/${files.length} delivered)`, {
        pairs: files.map((f, i) => [f, briefs[i]]), timeout: DEFAULT_TIMEOUT_S,
      });
    }
    if (entry.verifiers === 0) return act('review-register', { lane: lane.slug }, `${lane.slug} round ${round}: nothing to verify — registering a clean round`);
    const files = Array.from({ length: entry.verifiers }, (_, i) => verdictsPath(dir, lane, round, i + 1));
    const briefs = Array.from({ length: entry.verifiers }, (_, i) => verifierBriefPath(dir, lane, round, i + 1));
    if (allPresent(files)) return act('review-register', { lane: lane.slug }, `${lane.slug} round ${round}: every verifier delivered — registering`);
    return stalled(files, briefs, verifierProfile(run), 'verifier') ?? wait(`${lane.slug} round ${round} verifiers (${files.filter((f) => existsSync(f)).length}/${files.length} delivered)`, {
      pairs: files.map((f, i) => [f, briefs[i]]), timeout: DEFAULT_TIMEOUT_S,
    });
  }

  // Registered. Post it, unless offline.
  if (!entry.posted && !run.offline && !ctx.offline) return act('review-post', { lane: lane.slug }, `${lane.slug} round ${entry.round}: registered — posting the review`);

  if (entry.verdict === 'converged') {
    // A CI-only fixer is still a real code change. Once dispatched, finish its
    // report/push/re-review lifecycle before fresh check state can become
    // pending or green and accidentally ready an unreviewed head.
    if (entry.fix?.briefed) return afterFixBrief(dir, run, lane, entry, head, ctx);
    const checks = ctx.checks(lane);
    const red = checks.filter((c) => c.bucket === 'fail');
    const pending = checks.filter((c) => c.bucket === 'pending');
    if (red.length > 0) {
      // Converged on findings, red on CI: a fix round for the checks.
      return act('review-fix-brief', { lane: lane.slug }, `${lane.slug}: converged, but ${red.map((c) => c.name).join(', ')} red — briefing a fix`);
    }
    if (pending.length > 0) {
      return {
        kind: 'wait', what: `${lane.slug}: CI (${pending.map((c) => c.name).join(', ')})`,
        wait: `gh pr checks ${lane.pr.number} --watch --fail-fast`, note: 'converged; waiting for CI before readying the pull request',
      };
    }
    return act('ready', { lane: lane.slug }, `${lane.slug}: converged and CI is ${checks.length === 0 ? 'absent' : 'green'} — readying the pull request`);
  }

  // Open majors: fix, report, next round.
  if (!entry.fix?.briefed) return act('review-fix-brief', { lane: lane.slug }, `${lane.slug} round ${entry.round}: ${openMajors(lane).length} major(s) open — briefing the fixer`);
  return afterFixBrief(dir, run, lane, entry, head, ctx);
}

function afterFixBrief(dir, run, lane, entry, head, ctx) {
  const report = fixReportPath(dir, lane, entry.round);
  const brief = fixBriefPath(dir, lane, entry.round);
  if (!entry.fix?.reported) {
    if (newerThan(report, brief)) return act('review-fix-report', { lane: lane.slug }, `${lane.slug} round ${entry.round}: the fixer reported — recording it`);
    return wait(`${lane.slug} round ${entry.round} fixer`, { pairs: [[report, brief]], timeout: timeoutFor(dir, 'implement') });
  }
  // Reported. The next round reviews the pushed fix — which must be pushed.
  if (head && head === entry.head) {
    return stop('unpushed', `${lane.slug}: the fixer reported but HEAD is still ${head.slice(0, 12)}, the head round ${entry.round} reviewed — nothing new to review`, {
      command: `review-fix-brief --lane ${lane.slug} (re-dispatch the fixer; it must commit)`,
    });
  }
  if (!run.offline && !ctx.offline) {
    const remote = ctx.remoteHead(lane);
    if (remote && remote !== head) {
      return stop('unpushed', `${lane.slug}: local HEAD ${String(head).slice(0, 12)} is not on origin (${remote.slice(0, 12)}) — the fixer did not push`, {
        command: `git -C ${laneTree(dir, run, lane)} push origin ${lane.branch}`,
      });
    }
  }
  if (reviewExhausted(lane)) return exhaustedStop(lane);
  return act('review-brief', { lane: lane.slug }, `${lane.slug}: fix pushed — opening round ${entry.round + 1}`);
}

// ---------------------------------------------------------------------------
// The decision.
// ---------------------------------------------------------------------------

/**
 * One action. `ctx` supplies the two things this needs from outside the run
 * directory — CI state and the remote head — so the evals can answer them
 * offline; with neither, the loop still runs, it just cannot wait on CI.
 */
export function decide(dir, run, ctx = {}) {
  const c = {
    now: ctx.now ?? (() => new Date().toISOString()),
    offline: ctx.offline ?? run.offline,
    checks: ctx.checks ?? (() => []),
    remoteHead: ctx.remoteHead ?? (() => null),
    landings: ctx.landings ?? (() => []),
  };
  const action = decideAction(dir, run, c);
  const budget = budgetStatus(run, c.now());
  if (budget?.expired && (action.kind === 'dispatch' || (action.kind === 'run' && DISPATCHES.has(action.command)))) return budgetStop(budget);
  return budget ? { ...action, budget } : action;
}

function decideAction(dir, run, c) {
  const state = runState(run);
  if (state === 'done') return stop('done', 'every lane landed — this run is over');

  // The plan first.
  const plan = findStep(run, PLAN_STAGE);
  if (plan.stage.state !== 'approved' && plan.stage.state !== 'skipped') return decidePlan(dir, run, plan, c);

  // A plan with work items splits the run, once.
  if (!run.split && run.lanes.length === 1 && plan.stage.state === 'approved') {
    const text = readFileSync(artifactPath(dir, plan), 'utf8');
    const startedLane = run.lanes[0].stages.some((s) => s.state !== 'pending');
    if (/^\s{0,3}#{1,6}\s+work items\s*$/im.test(text) && !startedLane) return act('split', {}, 'the approved plan lists work items — splitting into lanes');
  }

  // Implements, in stack order. Only the next lane up is ever ready.
  if (remainingSteps(run).length > 0) {
    const ready = readySteps(run);
    if (ready.length === 0) {
      const held = remainingSteps(run)[0];
      return stop('blocked', `nothing can run: ${held.key} is held — \`status\` names what by`);
    }
    return decideImplement(dir, run, ready[0], c);
  }

  // Every gate step approved: ship what is not shipped.
  if (run.lanes.some((l) => !l.pr)) return act('ship', {}, 'every stage is approved — opening the pull request(s) as drafts');

  // Review loops, bottom lane first; a lane above waits for the one below to converge.
  for (const lane of run.lanes) {
    if (lane.landed) continue;
    if (lane.review?.converged) continue;
    return decideLoop(dir, run, lane, c);
  }

  // Everything converged: finish what has merged.
  const landed = c.landings();
  if (landed.some((l) => l.state === 'merged' && !l.lane.landed)) return act('finish', {}, 'a pull request merged — finishing that lane');
  return stop('shipped', `every lane's review loop has converged — ${run.lanes.map((l) => l.pr.url).join(', ')} await a merge; \`finish\` once they land`);
}

/** The lines `next` prints for an action. Fixed shape: the orchestrator copies them, it does not read them. */
export function renderAction(action, { skillCommand, runDir }) {
  runDir = sh(runDir);
  const then = `then: ${skillCommand} next --run-dir ${runDir}`;
  const lines = [`next: ${action.kind}${action.kind === 'stop' ? ` — ${action.reason}` : ''}`];
  if (action.budget) {
    const b = action.budget;
    lines.push(`  budget: elapsed ${Math.floor(b.elapsedSeconds)}s total; allowance ${b.allowanceSeconds}s; remaining ${Math.ceil(b.remainingSeconds)}s; ${b.expired ? 'expired' : 'active'}`);
    if (b.expired && action.kind === 'wait') lines.push('  Already dispatched work may finish; its successor dispatch requires explicit resume.');
  }
  if (action.note) lines.push(`  ${action.note}`);
  if (action.kind === 'dispatch') {
    lines.push('');
    if (action.items.length === 1) lines.push(`  Dispatch ONE subagent, ${dispatchLabel(action.items[0])}, with exactly this prompt:`, '', `  ${action.items[0].prompt}`);
    else {
      lines.push(`  These ${action.items.length} are independent. Dispatch them as ${action.items.length} subagents in ONE message:`, '');
      for (const it of action.items) lines.push(`  [${dispatchLabel(it, { compact: true })}] ${it.prompt}`);
    }
    lines.push('', '  Native agent completion: run next immediately. Otherwise use the fallback wait below once.', `wait: ${action.wait}`, then);
  } else if (action.kind === 'wait') {
    lines.push(`  ${action.what} is in flight.`, '', '  Native agent completion: run next immediately. Otherwise use the fallback wait below once.', `wait: ${action.wait}`, then);
  } else if (action.kind === 'stop') {
    lines.push(`  ${action.detail}`);
    if (action.artifact) lines.push(`  plan:    ${action.artifact}`);
    if (action.review) lines.push(`  review:  ${action.review}`);
    if (action.items) for (const it of action.items) lines.push(`  [${dispatchLabel(it, { compact: true })}] ${it.prompt}`);
    if (action.command) lines.push(`  command: ${skillCommand} ${action.command} --run-dir ${runDir}`);
    if (action.alternative) lines.push(`  or:      ${skillCommand} ${action.alternative} --run-dir ${runDir}`);
  } else if (action.kind === 'run') {
    lines.push(`  ${action.command}`);
  }
  return lines.join('\n');
}

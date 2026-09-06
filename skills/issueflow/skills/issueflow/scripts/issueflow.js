#!/usr/bin/env node
/**
 * issueflow — the deterministic half of the skill.
 *
 * Everything mechanical lives here so the agent never reshapes output with
 * sed/grep/jq in the transcript: one command returns everything a step needs,
 * already as a table. The agent's job is the conversation; this binary's job
 * is facts — and, in `accept` and `ship`, the gate.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BOARD_COLUMNS, ISSUE_COLUMNS, boardRows, detailOf, issueRows, positionLine } from './lib/board.mjs';
import { loadIssue, writeBrief, writeReviewBrief } from './lib/brief.mjs';
import { MAX_ROUNDS, latestRound, markReviewBriefed, nextRound, registerReview, reviewable, roundsExhausted } from './lib/reviews.mjs';
import { decide, renderAction } from './lib/next.mjs';
import { PLAN_STAGE } from './lib/stages.mjs';
import { checkpoint, claimedIn } from './lib/checkpoint.mjs';
import { finish, FinishError } from './lib/finish.mjs';
import { GQL, GhError, graphql, listIssues, prChecks, prComment, prLabel, prReady, prRetitle, prView, repoInfo, viewIssue } from './lib/gh.mjs';
import {
  MAX_REVIEW_ROUNDS, ROUND_COLUMNS, applyFixReport, baseRef, converge, currentRound, fixItems, fixerModel, headOf,
  laneDiff, openFindings, openMajors, openRound, planVerification, postFixReplies, postRound, readCandidates,
  rebaseLane, registerRound, reviewDir, reviewExhausted, roundRows, ruleFinding,
} from './lib/prreview.mjs';
import { landings } from './lib/reconcile.mjs';
import { writeFinderBriefs, writeFixBrief, writeVerifierBriefs } from './lib/reviewbrief.mjs';
import { branchFor, resolvePolicy } from './lib/policy.mjs';
import { blockingDrift, reconcile } from './lib/reconcile.mjs';
import {
  HandBack, RunError, accept, artifactPath, blockers, board, claimRunDir, createRun, dependencies, durationOf, findLane,
  findStep, formatSpan, gateSteps, laneTree, loadRun, markBriefed, nextStep, observe, progressPath, readEvidence,
  readySteps, recordCapOverride, remainingSteps, runDir, runRoot, runState, saveRun, skip, split, workItemsFromPlan,
  worktreePath,
} from './lib/run.mjs';
import { ShipError, ship, shipBlockers } from './lib/ship.mjs';
import { readTimings } from './lib/timings.mjs';
import { FetchError, WorktreeError, ensureWorktree } from './lib/worktree.mjs';
import { execFileSync } from 'node:child_process';
import { verify } from './lib/verify.mjs';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

/**
 * Flags that never take a value. Without this list, `--auto` followed by a
 * positional would quietly eat it as its value — a boolean that sometimes is
 * not one is exactly the kind of parser surprise a gate flag cannot afford.
 */
const BOOLEAN_FLAGS = new Set(['auto', 'review', 'ready', 'dryRun', 'force', 'takeOver', 'offline', 'closeIssue', 'noWorktree', 'noDraft', 'version', 'fixed', 'withdrawn']);

function argv(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a.startsWith('--')) {
      const [k, inline] = a.slice(2).split('=');
      const key = k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (inline !== undefined) out[key] = inline;
      else if (BOOLEAN_FLAGS.has(key)) out[key] = true;
      else if (args[i + 1] && !args[i + 1].startsWith('--')) { out[key] = args[i + 1]; i += 1; }
      else out[key] = true;
    } else out._.push(a);
  }
  return out;
}

export const table = (headers, rows) => {
  if (rows.length === 0) return '';
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i] ?? '').length)));
  const line = (cells) => `| ${cells.map((c, i) => String(c ?? '').padEnd(widths[i])).join(' | ')} |`;
  return [line(headers), `|${widths.map((w) => '-'.repeat(w + 2)).join('|')}|`, ...rows.map(line)].join('\n');
};

const print = (headers, rows) => { const t = table(headers, rows); if (t) console.log(t); };

/** Repo identity, from a frozen file when one is given so the evals never touch the network. */
function identify(repo, args) {
  if (args.repoJson) return { ...JSON.parse(readFileSync(args.repoJson, 'utf8')), path: repo };
  return { ...repoInfo(repo), path: repo };
}

/**
 * Whether this invocation may touch the network.
 *
 * `--offline` is the explicit answer. Frozen `gh` payloads are the implicit one:
 * a run driven from `--repo-json` / `--issue-json` / `--issues-json` is a
 * replay, and a replay that dialled out would put the network — and its cost
 * and its flakiness — inside `ci / issueflow`.
 */
const isOffline = (args) => Boolean(args.offline || args.repoJson || args.issueJson || args.issuesJson);

const truncate = (text, max) => {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
};

/**
 * Locate the run for the current invocation.
 *
 * A named `--run-dir` short-circuits identification entirely: the run already
 * knows its own repo, and asking `gh` again would put the network in the path
 * of every offline command.
 */
function locate(args) {
  if (args.runDir) return { dir: resolve(args.runDir) };
  const repo = resolve(args.repo ?? '.');
  const info = identify(repo, args);
  return { dir: runDir(runRoot(), info.owner, info.name, readIssueNumber(args)) };
}

/** The issue number, which is required whenever a run dir is not named outright. */
function readIssueNumber(args) {
  if (!args.issue) throw new Error('name the run with --issue <number> (or point at it with --run-dir)');
  return args.issue;
}

const runBoard = (run, opts) => print(BOARD_COLUMNS, boardRows(board(run, opts)));

/** How a step is named on the command line. */
const stageArgs = (step) =>
  `--stage ${step.stage.id}${step.laneSlug && step.laneSlug !== 'root' ? ` --lane ${step.laneSlug}` : ''}`;

/**
 * What to do next — and, when more than one thing can happen at once, all of it.
 *
 * A run with two independent lanes has two dispatchable stages, and printing
 * only the first is how the measured run left its second lane untouched.
 */
function nextLine(run) {
  const state = runState(run);
  if (state === 'done') {
    console.log('\nThis run is done — every lane landed.');
    return;
  }
  if (state === 'shipped') {
    console.log('\nEvery lane\'s review loop has converged — `issueflow finish` once the pull requests merge.');
    return;
  }
  if (state === 'in review') {
    const lane = run.lanes.find((l) => l.pr && !l.review?.converged);
    console.log(`\nLane ${lane.slug} is under review — \`issueflow next\` drives the loop.`);
    return;
  }
  if (state === 'ready to ship') {
    console.log('\nEvery stage is approved — `issueflow ship` is the only step left.');
    return;
  }
  const remaining = remainingSteps(run);
  const ready = readySteps(run);
  if (ready.length === 0) {
    const held = remaining[0];
    console.log(
      `\nNothing can run: ${held.key} is held by ${blockers(run, held).map((b) => `${b.key} (${b.stage.state})`).join(', ')}.`,
    );
    return;
  }
  if (ready.length === 1) {
    if (ready[0].stage.state === 'briefed') {
      console.log(`\n${ready[0].key} is dispatched — \`issueflow next\` waits on it and takes the next step.`);
      return;
    }
    console.log(`\nNext: \`issueflow brief ${stageArgs(ready[0])}\` (${ready[0].stage.model})`);
    return;
  }
  console.log(`\n${ready.length} stages can run NOW, in parallel — dispatch them together:`);
  for (const step of ready) console.log(`  issueflow brief ${stageArgs(step)}    (${step.stage.model})`);
}

/**
 * What this stage usually takes on this repo, and what its approval unblocks —
 * printed at the moment a multi-minute wait begins, which used to tell the user
 * least.
 */
function expectationLine(dir, run, step) {
  const entry = readTimings(dir).find((t) => t.stage === step.stage.id);
  const duration = entry && entry.n >= 2
    ? `${step.stage.id} on this repo: ${entry.n} past runs, ${entry.min}–${entry.max} (median ${entry.median}).`
    : `${step.stage.id} has no past timings on this repo — nothing to compare against.`;
  const dependents = gateSteps(run).filter((s) => dependencies(run, s).some((d) => d.key === step.key));
  const unblocks = dependents.length > 0 ? ` It unblocks ${dependents.map((s) => s.key).join(', ')}.` : '';
  return `${duration}${unblocks}`;
}

/** Print a checkpoint's result. Silent only when there was genuinely nothing to send. */
function reportCheckpoint(rows) {
  const real = rows.filter((r) => r.state !== 'offline' && r.state !== 'nothing to send');
  if (real.length === 0) return;
  console.log('');
  print(['Checkpoint', 'State', 'Detail'], real.map((r) => [r.action, r.state, r.detail]));
  if (real.some((r) => r.state === 'failed')) {
    console.log('\nA checkpoint failed. The approval above is recorded locally; this run is NOT backed up to GitHub.');
  }
}

/**
 * Last-heartbeat liveness for every stage currently in flight — briefed, and
 * either still running or delivered and waiting for review. `Since` is always
 * populated from `at.briefed`, the same clock `board()`'s live `Took` reads;
 * `Last progress` degrades to `—` when the stage never wrote to its own log.
 * That degradation is the contract: this block must stay legible for a stage
 * that ignores the `## While you work` instruction, not just one that honours
 * it (#223).
 */
function livenessBlock(dir, run, now) {
  const rows = gateSteps(run)
    .filter((step) => step.stage.state === 'briefed')
    .map((step) => {
      const since = formatSpan(Date.parse(now) - Date.parse(step.stage.at.briefed));
      const log = progressPath(dir, step);
      let last = '—';
      if (existsSync(log)) {
        const lines = readFileSync(log, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
        if (lines.length > 0) {
          const age = formatSpan(Date.parse(now) - statSync(log).mtime.getTime());
          last = `${age} ago — ${lines[lines.length - 1]}`;
        }
      }
      return [step.key, since, last];
    });
  if (rows.length === 0) return;
  console.log('');
  print(['Step', 'Since', 'Last progress'], rows);
}

/** Print what has moved underneath the run, when anything has. */
function reportDrift(rows) {
  if (rows.length === 0) return;
  console.log('');
  print(['Reality check', 'State', 'Detail'], rows.map((r) => [r.check, r.state, r.detail]));
}

/**
 * Who already has each issue, keyed by issue number, for the `Run` column.
 *
 * Precedence is deliberate: a run directory on this machine outranks a marker
 * comment, because it is the one you can actually resume. `unreadable` is its
 * own cell and never degrades to `—` — a broken run reading as a free issue is
 * the single misreading this column exists to prevent.
 *
 * `root` is null when nothing is to be scanned, and then no filesystem read
 * happens at all. That is what keeps the frozen `board.txt` hermetic: this
 * machine really does hold a run for issue 132, which is a row in that golden,
 * so a board that scanned `homedir()` would freeze as `in progress` here and
 * `—` everywhere else.
 */
function runCellsFor(issues, info, root) {
  const cells = new Map();
  for (const issue of issues) {
    const dir = root ? runDir(root, info.owner, info.name, issue.number) : null;
    if (dir && existsSync(join(dir, 'run.json'))) {
      try {
        cells.set(issue.number, runState(loadRun(dir)));
      } catch {
        cells.set(issue.number, 'unreadable');
      }
      continue;
    }
    if (claimedIn(issue.comments, info.owner, info.name, issue.number)) cells.set(issue.number, 'claimed');
  }
  return cells;
}

async function cmdBoard(args) {
  const repo = resolve(args.repo ?? '.');
  const info = identify(repo, args);
  const issues = args.issuesJson ? JSON.parse(readFileSync(args.issuesJson, 'utf8')) : listIssues(repo);
  // An offline run reads nothing from git it was not handed: the frozen
  // repo.json is the whole remote, so the dev-on-origin detection is off.
  const policy = resolvePolicy(repo, info.defaultBranch, isOffline(args) ? { remoteBranches: [] } : {});
  // Keyed on `--issues-json`, NOT on `isOffline(args)`: this command still
  // calls `listIssues` over the network whenever `--issues-json` is absent, so
  // keying the scan on offlineness would blank the column on an invocation that
  // had just dialled out. `--issues-json` is the flag that makes the golden
  // hermetic, so it is the flag the rule names.
  const root = args.runRoot ? resolve(args.runRoot) : (args.issuesJson ? null : runRoot());

  if (issues.length === 0) {
    console.log(`No open issues in ${info.owner}/${info.name}.`);
    return;
  }
  print(ISSUE_COLUMNS, issueRows(issues, runCellsFor(issues, info, root)));
  console.log('');
  print(
    ['Repo', 'Base branch', 'Feature prefix', 'Merge', 'Policy from'],
    [[`${info.owner}/${info.name}`, policy.base, policy.featurePrefix, policy.mergeMethod, policy.source]],
  );
  console.log(
    '\nDetail is how much the issue text specifies, not how much work it is — a thin issue\n' +
      'under a broad title is the one most likely to come back from design as several work items.',
  );
  console.log(
    'Run says who already has it: a state means a run on this machine, `claimed` means a run\n' +
      'on another one. Pick a different issue, or resume that run with `next --run-dir <path>`.',
  );
}

/**
 * Refuse to `start` an issue somebody else is already working.
 *
 * A run's identity is `owner/name#N`, and until 0.8.0 nothing ever asked
 * whether that identity was taken: two sessions that both said "fix issue 42"
 * resolved to the same directory, and the second reset the first's state
 * machine to all-pending. Worse, the checkpoint that follows adopts the run's
 * sticky comment BY MARKER and rewrites it in place, so the second session
 * also published an empty board over the first's only artifact that leaves
 * this machine.
 *
 * Two claims, and they are not the same fact:
 *
 * - A local `run.json` is a local fact and refuses either way. What it tells
 *   you to do next depends on whether that run still loads: a loadable run
 *   gets the resume command, and one `loadRun` refuses gets `loadRun`'s own
 *   reason plus `--take-over` — printing `next --run-dir` there would send the
 *   reader to a command that fails for the same reason, which is a dead end
 *   rather than a guardrail.
 * - A marker comment with no local run means another machine has it, and that
 *   one is scoped to ONLINE invocations. The harm is `checkpoint()` PATCHing
 *   over a stranger's comment, and `checkpoint()` returns before any `gh` call
 *   on an offline run — an offline replay makes no claim and can clobber
 *   nothing, which is what keeps the frozen `issue-132.json` payload (whose
 *   real comment carries a real marker) replayable.
 */
function refuseClaimed(dir, info, issue, args) {
  if (args.takeOver) return;

  if (existsSync(join(dir, 'run.json'))) {
    let reason = `a run already exists at ${dir}`;
    let remedy = 'Resume it with `issueflow next --run-dir <dir>` — only if the session that started it is gone.';
    try {
      loadRun(dir);
    } catch (err) {
      reason = String(err?.message ?? err);
      remedy = 'Start over on top of it with `--take-over`, which overwrites it.';
    }
    throw new HandBack(`${reason}. ${remedy}`);
  }

  if (isOffline(args)) return;
  const claim = claimedIn(issue.comments, info.owner, info.name, issue.number);
  if (claim) {
    throw new HandBack(
      `${info.owner}/${info.name}#${issue.number} is already claimed by an issueflow run on another machine — ` +
        `read its comment first: ${claim.url ?? issue.url}. ` +
        'Starting here would republish an empty board over it. Take it over with `--take-over` once you have.',
    );
  }
}

async function cmdStart(args) {
  const repo = resolve(args.repo ?? '.');
  const info = identify(repo, args);
  const number = readIssueNumber(args);
  const issue = args.issueJson ? JSON.parse(readFileSync(args.issueJson, 'utf8')) : viewIssue(repo, number);
  // An offline run reads nothing from git it was not handed: the frozen
  // repo.json is the whole remote, so the dev-on-origin detection is off.
  const policy = resolvePolicy(repo, info.defaultBranch, isOffline(args) ? { remoteBranches: [] } : {});
  const dir = args.runDir ? resolve(args.runDir) : runDir(runRoot(), info.owner, info.name, issue.number);
  refuseClaimed(dir, info, issue, args);

  const run = createRun({ repo: info, issue, policy, offline: isOffline(args), auto: Boolean(args.auto) });
  // `claimRunDir`, not `saveRun`: this is the FIRST write, and it is the one
  // that must lose to a run already there rather than overwrite it.
  claimRunDir(dir, run, { takeOver: Boolean(args.takeOver) });
  mkdirSync(join(dir, 'inputs'), { recursive: true });
  writeFileSync(join(dir, 'inputs', 'issue.json'), `${JSON.stringify(issue, null, 2)}\n`);

  print(
    ['Issue', 'Branch', 'Base'],
    [[`${info.owner}/${info.name}#${issue.number}`, branchFor(policy, issue.number, 'root'), policy.base]],
  );
  // The issue itself, so nobody has to call `gh issue view` for what this
  // command already froze to disk — which is exactly what the measured run did,
  // one second after this table printed.
  console.log('');
  print(
    ['Title', 'Labels', 'Comments', 'Detail'],
    [[
      truncate(issue.title, 56),
      (issue.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name)).filter(Boolean).join(', ') || '—',
      String(Array.isArray(issue.comments) ? issue.comments.length : (issue.comments ?? 0)),
      detailOf(issue).detail,
    ]],
  );
  // The run path goes on its own line, never in a padded cell. An absolute path
  // is both long enough to blow the table's width out and machine-dependent, so
  // a table containing one cannot be compared across two machines.
  console.log(`\nRun: ${dir}\n`);
  runBoard(run);
  // Conditional so a gated run's `start` output stays byte-identical to the
  // frozen golden — the same rule every review-aware rendering follows.
  if (run.auto) {
    console.log(
      '\nAuto run: every stage is gated by a red-team review instead of a human.\n' +
        `A stage advances only on a registered pass; ${MAX_ROUNDS} blocked rounds stop the run.`,
    );
  }
  nextLine(run);
  reportCheckpoint(checkpoint(dir, run, { offline: isOffline(args) }));
}

/**
 * Brief one step: render its prompt, give it a checkout, and say how to dispatch it.
 *
 * `--ready` briefs every step whose gate is open instead, which is how a split
 * run gets its independent lanes dispatched in one message rather than one an
 * hour.
 */
async function cmdBrief(args) {
  const { dir } = locate(args);
  // Observed so a step whose artifact already landed (a retry, or a lane
  // dispatched earlier than the one named here) shows as delivered rather than
  // briefed the moment anything downstream renders it — see `run.observe()`.
  const run = observe(dir, loadRun(dir));

  // `--review` briefs the red team on a delivered artifact instead of briefing
  // the stage itself. It never provisions anything: the worktree, if the stage
  // has one, already exists — a reviewer that had to create the checkout would
  // be reviewing code the stage never ran in.
  if (args.review) {
    if (!args.stage) throw new Error('name the stage to review with --stage <id>');
    const step = findStep(run, args.stage, args.lane ?? null);
    if (!reviewable(step)) {
      throw new Error(`${step.key} is not red-teamed on disk — code is reviewed on its pull request, by the review loop`);
    }
    if (step.stage.state === 'approved' || step.stage.state === 'skipped') {
      throw new Error(`${step.key} is already ${step.stage.state} — there is nothing left to review`);
    }
    if (!existsSync(artifactPath(dir, step))) {
      throw new Error(`${step.key} has not delivered its artifact yet — there is nothing to review`);
    }
    if (roundsExhausted(step)) {
      if (typeof args.anotherRound === 'string' && args.anotherRound.trim()) {
        recordCapOverride(dir, run, step, args.anotherRound);
      } else {
        throw new HandBack(
          `the red team has refused ${step.key} ${MAX_ROUNDS} times — the loop is not converging. ` +
            'Stop, checkpoint, and surface the open findings to the user; never approve over them. ' +
            'A user-directed round re-opens the stage: --another-round "<what the user decided>"',
        );
      }
    }
    const round = nextRound(step);
    const workdir = step.lane && existsSync(worktreePath(dir, step.lane)) ? worktreePath(dir, step.lane) : null;
    const info = writeReviewBrief(dir, run, step, loadIssue(dir), round, workdir);
    markReviewBriefed(dir, run, step, round);
    print(['Review of', 'Round', 'Model', 'Agent'], [[step.key, `${round} of ${MAX_ROUNDS}`, info.model, info.agent]]);
    console.log(`\nIt must write: ${info.artifact}`);
    if (info.workdir !== run.repo.path) console.log(`Works in:      ${info.workdir}`);
    console.log(
      `\nDispatch ONE subagent, model \`${info.model}\`, with exactly this prompt:\n\n` +
        `  Read ${info.prompt} and follow it exactly. It is your complete brief.\n`,
    );
    return;
  }

  // `--ready` with one open gate is just `brief`. Printing a fan-out table over
  // a single row would tell the reader two stages can run when one can.
  if (args.ready && readySteps(run).length > 1) {
    const ready = readySteps(run);
    const briefed = ready.map((step) => briefOne(dir, run, step, args));
    // Where the run stands, and what each of these stages usually takes —
    // printed once, right before the wait begins. See the note at the single-
    // step path below.
    console.log(positionLine(run, ready));
    for (const step of ready) console.log(expectationLine(dir, run, step));
    console.log('');
    print(['Stage', 'Model', 'Agent', 'Lane'], briefed.map((b) => [b.stage, b.model, b.agent, b.step.split('/')[0] === b.stage ? '—' : b.step.split('/')[0]]));
    console.log(
      `\nThese ${briefed.length} stages are independent. Dispatch them as ${briefed.length} subagents in ONE message:\n`,
    );
    for (const b of briefed) console.log(`  [${b.model}] Read ${b.prompt} and follow it exactly. It is your complete brief.`);
    console.log('');
    return;
  }

  const next = nextStep(run);
  if (!args.stage && !next) throw new Error('no stage can run right now — `issueflow status` says what is holding them');
  const step = args.stage ? findStep(run, args.stage, args.lane ?? null) : next;
  const info = briefOne(dir, run, step, args);

  // Where the run stands, and how long this stage usually takes here — the
  // moment a multi-minute wait begins is exactly the moment the user used to
  // be told least (#223). Printed above the table on purpose; the dispatch
  // prompt below stays last, because that is the line that gets copied.
  console.log(positionLine(run, [step]));
  console.log(expectationLine(dir, run, step));
  console.log('');
  // Paths stay out of padded cells — see the note in cmdStart.
  print(['Stage', 'Model', 'Agent'], [[info.stage, info.model, info.agent]]);
  console.log(`\nIt must write: ${info.artifact}`);
  if (info.workdir !== run.repo.path) console.log(`Works in:      ${info.workdir}`);
  // The brief is handed over as a path, not pasted: it is long, the user has no
  // reason to read it in the transcript, and a subagent can open a file. The
  // file is still the only channel — this is how it is delivered.
  console.log(
    `\nDispatch ONE subagent, model \`${info.model}\`, with exactly this prompt:\n\n` +
      `  Read ${info.prompt} and follow it exactly. It is your complete brief.\n`,
  );
}

/** Render one step's brief, refusing a closed gate and provisioning its worktree. */
function briefOne(dir, run, step, args) {
  const blocked = blockers(run, step);
  if (blocked.length > 0) {
    throw new RunError(
      `${step.key} is gated behind ${blocked.map((b) => `${b.key} (${b.stage.state})`).join(', ')} — ` +
        'no stage runs on anything but its predecessor\'s approved artifact',
    );
  }

  // The rounds cap. A stage the red team has refused MAX_ROUNDS times does not
  // get a quiet fourth attempt — the loop is not converging, and the honest
  // move is to stop and put the open findings in front of the user. Only the
  // user re-opens it, and only with their direction recorded as the reason.
  if (roundsExhausted(step)) {
    if (typeof args.anotherRound === 'string' && args.anotherRound.trim()) {
      recordCapOverride(dir, run, step, args.anotherRound);
    } else {
      throw new HandBack(
        `the red team has refused ${step.key} ${MAX_ROUNDS} times — the loop is not converging. ` +
          'Stop, checkpoint, and surface the open findings to the user; never approve over them. ' +
          'A user-directed round re-opens the stage: --another-round "<what the user decided>"',
      );
    }
  }

  // A stage that commits gets its own checkout. Failing to provision one is not
  // fatal — the stage can still run in the repository — but it must be said,
  // because a lane silently sharing the user's tree is the hazard this removes.
  let workdir = null;
  let warning = null;
  if (step.lane && !args.noWorktree) {
    try {
      workdir = ensureWorktree(run.repo.path, dir, step.lane, { offline: run.offline }).path;
    } catch (err) {
      // A `FetchError` is the one provisioning failure that is not survivable:
      // continuing would cut the lane from whatever `origin/<base>` this
      // checkout last saw, which is the stale base the fetch exists to refuse.
      // Every other `WorktreeError` still warns and runs in the repository.
      if (err instanceof FetchError) throw err;
      warning = String(err.message ?? err).split('\n')[0];
    }
  }

  const info = writeBrief(dir, run, step, loadIssue(dir), workdir);
  markBriefed(dir, run, step);
  if (warning) console.error(`issueflow: no worktree for ${step.laneSlug} (${warning}) — the stage will work in the repository itself`);
  return info;
}

async function cmdAccept(args) {
  const { dir } = locate(args);
  const run = observe(dir, loadRun(dir));
  const stageId = args.stage ?? nextStep(run)?.stage.id;
  if (!stageId) throw new Error('every stage is already approved');
  const step = findStep(run, stageId, args.lane ?? null);
  const offline = isOffline(args);

  // Ask GitHub what is true before recording an approval against it. A stage
  // whose pull request already merged is a stage nobody should be approving,
  // and the run has no other way to find out.
  const drift = reconcile(run, { lane: step.lane, offline });
  const blocking = blockingDrift(drift);
  if (blocking.length > 0 && !args.force && !args.skip) {
    reportDrift(drift);
    throw new HandBack(
      `this run is out of date with GitHub: ${blocking.map((b) => `${b.check} ${b.state}`).join(', ')} — ` +
        'the work may already have landed. Re-read it, then pass --force if approving is still right',
    );
  }

  if (args.skip) skip(dir, run, step, typeof args.skip === 'string' ? args.skip : null);
  else accept(dir, run, step, { evidence: args.evidence ? resolve(args.evidence) : null, auto: Boolean(args.auto) });

  // A sibling lane's stage may still be running while this one is accepted —
  // its row should keep ticking rather than freeze at whatever it read on load.
  runBoard(run, { now: new Date().toISOString() });
  const facts = verify(dir, run, step);
  if (facts.length > 0) {
    console.log('');
    print(['Checked', 'Is'], facts);
  }
  reportDrift(drift);
  nextLine(run);
  reportCheckpoint(checkpoint(dir, run, { offline }));
}

/**
 * Register a completed red-team review and say what it decided.
 *
 * Exit 0 either way: registering a blocked review is a success — the gate
 * worked. Refusing to *advance* on it belongs to `accept --auto` and `brief`,
 * the same split that keeps `skip` out of `ship`'s way.
 */
async function cmdReview(args) {
  const { dir } = locate(args);
  const run = observe(dir, loadRun(dir));
  if (!args.stage) throw new Error('name the reviewed stage with --stage <id>');
  const step = findStep(run, args.stage, args.lane ?? null);
  const workdir = step.lane && existsSync(worktreePath(dir, step.lane)) ? worktreePath(dir, step.lane) : null;

  const result = registerReview(dir, run, step, { workdir });

  console.log(`Round ${result.round} of ${MAX_ROUNDS} on ${step.key}: ${result.verdict.toUpperCase()}`);
  if (result.items.length > 0) {
    console.log('');
    print(['Severity', 'Cite', 'Finding'], result.items.map((f) => [f.severity, f.cite, truncate(f.text, 72)]));
  } else {
    console.log('\nNo findings.');
  }
  // The coverage gap, always next to the finding count: three findings and
  // silence about what nobody looked at reads as "everything else is fine".
  console.log(`\nNot examined (${result.notExamined.length}):`);
  for (const item of result.notExamined) console.log(`  - ${truncate(item, 110)}`);

  if (result.verdict === 'pass') {
    console.log(`\nNext: \`issueflow accept --auto ${stageArgs(step)}\``);
  } else if (roundsExhausted(step)) {
    console.log(
      `\nThe red team has refused ${step.key} ${MAX_ROUNDS} times — the loop is not converging.\n` +
        'Stop here: checkpoint, and surface the open findings to the user; never approve over them.',
    );
  } else {
    console.log(`\nNext: \`issueflow brief ${stageArgs(step)}\` — the re-brief carries this review's findings.`);
  }
  reportCheckpoint(checkpoint(dir, run, { offline: isOffline(args) }));
}

async function cmdSplit(args) {
  const { dir } = locate(args);
  const run = loadRun(dir);

  // The items come out of the approved design by default. Hand-writing them is
  // a second copy of a decision the user already signed off, and on the run
  // this was measured against the copy differed from the artifact.
  let items;
  if (args.itemsJson) items = JSON.parse(readFileSync(resolve(args.itemsJson), 'utf8'));
  else if (args.items) items = JSON.parse(args.items);
  else {
    const plan = findStep(run, PLAN_STAGE);
    if (plan.stage.state !== 'approved') {
      throw new Error('cannot read work items from an unapproved plan — approve it, or pass --items-json');
    }
    items = workItemsFromPlan(readFileSync(artifactPath(dir, plan), 'utf8'));
    console.log(`Read ${items.length} work items from the approved plan.\n`);
  }

  split(dir, run, items);
  print(
    ['Lane', 'Work item', 'Branch', 'Stacks on'],
    run.lanes.map((l) => [l.slug, truncate(l.title, 48), l.branch, l.base]),
  );
  console.log('');
  runBoard(run);
  nextLine(run);
  reportCheckpoint(checkpoint(dir, run, { offline: isOffline(args) }));
}

async function cmdStatus(args) {
  const { dir } = locate(args);
  const run = observe(dir, loadRun(dir));
  print(
    ['Issue', 'Split', 'Lanes'],
    [[`${run.repo.owner}/${run.repo.name}#${run.issue.number}`, String(run.split), String(run.lanes.length)]],
  );
  console.log(`\nRun: ${dir}`);
  if (run.checkpoint?.commentUrl) console.log(`Checkpoint: ${run.checkpoint.commentUrl}`);
  console.log('');
  const now = new Date().toISOString();
  runBoard(run, { now });
  // Conditional on rounds existing, so a run the red team never touched
  // renders exactly as it always has.
  const reviewed = gateSteps(run).filter((s) => (s.stage.review?.rounds.length ?? 0) > 0);
  if (reviewed.length > 0) {
    console.log('');
    print(
      ['Step', 'Round', 'Verdict', 'Blocking', 'Notes'],
      reviewed.map((s) => {
        const r = latestRound(s);
        return [
          s.key,
          `${r.round} of ${MAX_ROUNDS}`,
          r.verdict,
          String(r.findings.critical + r.findings.high),
          String(r.findings.medium + r.findings.low),
        ];
      }),
    );
  }
  livenessBlock(dir, run, now);
  for (const lane of run.lanes) {
    if ((lane.review?.rounds.length ?? 0) === 0) continue;
    console.log(`\nReview loop — ${lane.slug} (#${lane.pr?.number ?? '?'})${lane.review.converged ? ' — converged' : ''}`);
    print(ROUND_COLUMNS, roundRows(lane));
    const open = openFindings(lane);
    if (open.length > 0) print(['Open', 'Where', 'Finding', 'Rounds open'], open.map((f) => [f.severity, `${f.file}:${f.line}`, truncate(f.short_summary, 60), String(f.stillOpenRounds + 1)]));
  }
  reportDrift(reconcile(run, { offline: isOffline(args) }));
  nextLine(run);
}

/**
 * Every run on this machine.
 *
 * The measured run could only be resumed by someone who remembered its
 * directory. A run you cannot find is a run you cannot resume, which makes the
 * whole state-on-disk design worth rather less than it should be.
 */
async function cmdRuns(args) {
  const root = args.runRoot ? resolve(args.runRoot) : runRoot();
  if (!existsSync(root)) { console.log(`No runs yet — ${root} does not exist.`); return; }

  const rows = [];
  // Full reason text for any run `loadRun` refused, one per line below the
  // table — never in a padded cell, which is how `baseline.test.mjs:75-87`'s
  // rule survives here too: an absolute path there is as wide as the host's
  // tmpdir, so it disagrees with CI on the separator row alone.
  const unreadable = [];
  for (const repoDir of readdirSync(root)) {
    const repoPath = join(root, repoDir);
    if (!existsSync(join(repoPath))) continue;
    for (const issueDir of readdirSync(repoPath)) {
      const dir = join(repoPath, issueDir);
      if (!existsSync(join(dir, 'run.json'))) continue;
      try {
        const run = loadRun(dir);
        const done = gateSteps(run).filter((s) => s.stage.state === 'approved').length;
        const total = gateSteps(run).length;
        const state = runState(run);
        const next = { done: 'done', shipped: 'shipped — awaiting merge', 'ready to ship': 'ready to ship' }[state]
          ?? (nextStep(run)?.key ?? 'blocked');
        rows.push([
          `${run.repo.owner}/${run.repo.name}#${run.issue.number}`,
          truncate(run.issue.title, 44),
          `${done}/${total}`,
          next,
          run.checkpoint?.commentUrl ? 'yes' : 'no',
        ]);
      } catch (err) {
        // `loadRun` already writes an actionable reason (e.g. a schema
        // mismatch names the schema and says the run is not resumable) — bind
        // it instead of discarding it. The cell gets a short, path-free
        // version so the table stays narrow; the full message, path and all,
        // goes below the table where a path is allowed.
        const message = String(err?.message ?? err);
        const leadIn = `the run at ${dir} is `;
        const reason = (message.startsWith(leadIn) ? message.slice(leadIn.length) : message.split(dir).join('this run'))
          .replace(/\s+/g, ' ').trim();
        rows.push([`${repoDir}/${issueDir}`, issueDir, '—', truncate(reason, 48), '—']);
        unreadable.push(`${repoDir}/${issueDir}: ${message}`);
      }
    }
  }
  if (rows.length === 0) { console.log(`No runs under ${root}.`); return; }
  print(['Issue', 'Title', 'Approved', 'Next', 'On GitHub'], rows);
  if (unreadable.length > 0) {
    console.log(`\n${unreadable.length === 1 ? 'Unreadable run' : `${unreadable.length} unreadable runs`}:\n`);
    for (const line of unreadable) console.log(`  ${line}`);
  }
  console.log(`\nRuns live under ${root}. Resume one with \`issueflow status --run-dir <path>\`.`);
}

async function cmdShip(args) {
  const { dir } = locate(args);
  const run = observe(dir, loadRun(dir));
  const blocked = shipBlockers(run);
  if (blocked.length > 0) {
    print(['Step', 'State', 'Reason'], blocked.map((b) => [b.step, b.state, b.reason ?? '—']));
    throw new RunError('cannot ship — every stage above must be approved first');
  }
  const drift = reconcile(run, { offline: isOffline(args) });
  const blocking = blockingDrift(drift);
  if (blocking.length > 0 && !args.force) {
    reportDrift(drift);
    throw new HandBack(
      `this run is out of date with GitHub: ${blocking.map((b) => `${b.check} ${b.state}`).join(', ')} — ` +
        'shipping now would open a pull request over work that already landed. Pass --force if it is still right',
    );
  }

  // Draft by default: the pull request opens under review, and `ready` lifts
  // the draft once the loop converges. `--no-draft` opts out.
  const results = ship(dir, run, { dryRun: Boolean(args.dryRun), draft: !args.noDraft });
  print(['Lane', 'Branch', 'Base', 'Commits', 'Pull request'], results.map((r) => [r.lane, r.branch, r.base, r.commits, r.url]));
  if (args.dryRun) {
    console.log('\nDry run — nothing was pushed and no pull request was opened.');
    return;
  }
  // `ship` used to print these URLs and throw them away — run.json carried no
  // record of its own pull requests. `finish` needs that record to answer
  // `runState()`'s "shipped" question without re-asking GitHub.
  const marks = [];
  for (const r of results) {
    const lane = run.lanes.find((l) => l.slug === r.lane);
    if (!lane || !r.number) continue;
    lane.pr = { number: r.number, url: r.url, title: r.title };
    lane.review.draft = r.draft;
    // The draft fallback: a repository whose plan has no draft pull requests
    // gets a label and a title prefix that `ready` removes, so "under review"
    // is still visible on the pull request itself.
    if (!r.draft && !args.noDraft && !isOffline(args)) {
      try {
        prLabel(run.repo.path, r.number, 'review-loop');
        prRetitle(run.repo.path, r.number, `[reviewing] ${r.title}`);
        lane.review.fallback = { label: 'review-loop', prefix: '[reviewing] ' };
        marks.push([lane.slug, 'labelled review-loop, titled [reviewing] — drafts are not available here']);
      } catch (err) {
        marks.push([lane.slug, `could not mark as under review: ${String(err.message).split('\n')[0]}`]);
      }
    } else if (r.draft) {
      marks.push([lane.slug, 'opened as a draft — `ready` lifts it once the review loop converges']);
    }
  }
  saveRun(dir, run);
  if (marks.length > 0) { console.log(''); print(['Lane', 'Under review'], marks); }
  console.log('');
  print(
    ['Stage', 'Model', 'Took'],
    gateSteps(run).map((s) => [s.key, s.stage.model, durationOf(s.stage) ?? '—']),
  );
  reportCheckpoint(checkpoint(dir, run, { offline: isOffline(args) }));
}

/**
 * The run's terminal state: verify each lane's pull request merged, remove
 * its worktree, delete its local branch, optionally close the issue, and —
 * once every lane has landed — mark the run `done`.
 *
 * Refuses a lane whose pull request has not merged, and leaves it completely
 * untouched: the only path to `git branch -D` is a merge GitHub confirmed,
 * the mirror of `accept`'s drift refusal.
 */
async function cmdFinish(args) {
  const { dir } = locate(args);
  const run = loadRun(dir);
  const offline = isOffline(args);

  try {
    const { rows } = finish(dir, run, { offline, closeIssueFlag: Boolean(args.closeIssue) });
    print(['Lane', 'State', 'Detail'], rows.map((r) => [r.lane, r.state, r.detail]));
    console.log(`\nRun: ${runState(run)}`);
    // Push is explicitly off: every landed lane's branch was just deleted, so
    // a push would find nothing to push and every row would say `skipped` —
    // saying `push: false` states the intent instead of relying on that
    // degradation to look like the right answer by accident.
    reportCheckpoint(checkpoint(dir, run, { offline, push: false }));
  } catch (err) {
    if (err instanceof FinishError && err.rows.length > 0) {
      print(['Lane', 'State', 'Detail'], err.rows.map((r) => [r.lane, r.state, r.detail]));
    }
    throw err;
  }
}


// ---------------------------------------------------------------------------
// The pull request review loop. Six commands, each one round step; `next`
// drives them in order. Every one is a registered CLI write, so a subagent
// that dies mid-flight leaves run state exactly where the last command put it.
// ---------------------------------------------------------------------------

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** The lane about to be reviewed, and the checkout its head is read from. */
function reviewLane(run, dir, args) {
  const lane = findLane(run, args.lane ?? null);
  if (!lane.pr) throw new RunError(`lane ${lane.slug} has no pull request yet — \`issueflow ship\` first`);
  return { lane, tree: laneTree(dir, run, lane) };
}

/** The pull request's node id, cached on the lane after the first `gh pr view`. */
function prIdentity(run, lane, offline) {
  if (offline) return { nodeId: lane.pr.nodeId ?? null, headRefOid: null, isDraft: lane.review.draft };
  const view = prView(run.repo.path, lane.pr.number);
  lane.pr.nodeId = view.id;
  return { nodeId: view.id, headRefOid: view.headRefOid, isDraft: view.isDraft, state: view.state };
}

function printDispatch(items, kind) {
  if (items.length === 1) {
    console.log(`\nDispatch ONE subagent, model \`${items[0].model}\`, with exactly this prompt:\n\n  Read ${items[0].prompt} and follow it exactly. It is your complete brief.\n`);
    return;
  }
  console.log(`\nThese ${items.length} ${kind} are independent. Dispatch them as ${items.length} subagents in ONE message:\n`);
  for (const it of items) console.log(`  [${it.model}] Read ${it.prompt} and follow it exactly. It is your complete brief.`);
  console.log('');
}

async function cmdReviewBrief(args) {
  const { dir } = locate(args);
  const run = loadRun(dir);
  const offline = isOffline(args);
  const { lane, tree } = reviewLane(run, dir, args);
  const head = headOf(tree);
  let remoteHead = null;
  let prHead = null;
  if (!offline) {
    // The round reviews what GitHub has. Fetch the branch and compare; a
    // failed fetch is infrastructure, not a refusal.
    try {
      git(['fetch', '--quiet', 'origin', lane.branch], run.repo.path);
      remoteHead = git(['rev-parse', `refs/remotes/origin/${lane.branch}`], run.repo.path);
    } catch (err) {
      throw new GhError(`could not fetch origin/${lane.branch}: ${String(err.stderr ?? err.message).split('\n')[0]}`);
    }
    prHead = prIdentity(run, lane, offline).headRefOid;
  }
  const diffText = laneDiff(tree, lane.base);
  const { round, plan, lines, files } = openRound(dir, run, lane, { head, remoteHead, prHead, diffText, anotherRound: args.anotherRound });
  const entry = currentRound(lane);
  const briefs = writeFinderBriefs(dir, run, lane, entry, { issue: loadIssue(dir), files, prior: openFindings(lane) });
  saveRun(dir, run);
  print(['Lane', 'Pull request', 'Round', 'Head', 'Changed lines', 'Finders', 'Verifiers (max)'],
    [[lane.slug, `#${lane.pr.number}`, `${round} of ${MAX_REVIEW_ROUNDS}`, head.slice(0, 12), String(lines), String(plan.finders), String(plan.maxVerifiers)]]);
  console.log('');
  print(['Finder', 'Model', 'Angles'], briefs.map((b) => [String(b.n), b.model, b.angles.join(', ')]));
  const prior = openFindings(lane);
  if (prior.length > 0) console.log(`\n${prior.length} finding(s) still open from earlier rounds will be re-judged this round.`);
  printDispatch(briefs, 'finders');
  console.log(`Then: \`issueflow review-verify --lane ${lane.slug}\` once every candidates file has landed.`);
}

async function cmdReviewVerify(args) {
  const { dir } = locate(args);
  const run = loadRun(dir);
  const { lane } = reviewLane(run, dir, args);
  const entry = currentRound(lane);
  if (!entry || entry.registered) throw new RunError(`no open review round on ${lane.slug} — \`issueflow review-brief\` starts one`);
  if (entry.verifiers !== null) throw new RunError(`round ${entry.round} of ${lane.slug} already has ${entry.verifiers} verifier brief(s) — dispatch those`);
  const { candidates, notExamined } = readCandidates(dir, lane, entry.round);
  const { batches, prior, fresh, auto } = planVerification(dir, run, lane, entry.round, candidates, { tree: laneTree(dir, run, lane) });
  print(['Lane', 'Round', 'Candidates', 'Prior re-judged', 'Prior unchanged', 'Verifiers', 'Not examined'],
    [[lane.slug, String(entry.round), String(fresh.length), String(prior.length), String(auto.length), String(batches.length), String(notExamined.length)]]);
  if (auto.length > 0) console.log(`\n${auto.length} prior nit/pre-existing finding(s) sit in files the fix did not touch — still open by construction, not sent to a verifier.`);
  if (batches.length === 0) {
    console.log('\nNothing to verify: no candidates and no prior open findings. Register the round to record a clean pass:');
    console.log(`  issueflow review-register --lane ${lane.slug}`);
    return;
  }
  const briefs = writeVerifierBriefs(dir, run, lane, entry, { batches, issue: loadIssue(dir) });
  console.log('');
  print(['Verifier', 'Model', 'Items'], briefs.map((b) => [String(b.n), b.model, String(b.items)]));
  printDispatch(briefs, 'verifiers');
  console.log(`Then: \`issueflow review-register --lane ${lane.slug}\` once every verdicts file has landed.`);
}

async function cmdReviewRegister(args) {
  const { dir } = locate(args);
  const run = loadRun(dir);
  const { lane, tree } = reviewLane(run, dir, args);
  const entry = currentRound(lane);
  if (!entry) throw new RunError(`no review round on ${lane.slug}`);
  if (entry.verifiers === null) {
    // No candidates and nothing prior: a clean round, registered as such.
    const { candidates } = readCandidates(dir, lane, entry.round);
    if (candidates.length > 0 || openFindings(lane).length > 0) throw new RunError(`round ${entry.round} of ${lane.slug} has not been verified — \`issueflow review-verify\` first`);
    planVerification(dir, run, lane, entry.round, []);
  }
  const record = registerRound(dir, run, lane, entry.round, { tree });
  const t = record.transitions;
  console.log(`Round ${record.round} of ${MAX_REVIEW_ROUNDS} on ${lane.slug} (#${lane.pr.number}): ${record.verdict.toUpperCase()} — ` +
    `${record.counts.majors} major open, ${record.counts.nits} nit, ${record.counts.preExisting} pre-existing`);
  if (record.round > 1) console.log(`Transitions: ${t.fixed.length} fixed, ${t.stillOpen.length} still open, ${t.withdrawn.length} withdrawn, ${t.new.length} new, ${t.suppressed.length} suppressed, ${t.dropped.length} refuted`);
  const rows = record.findings.map((f) => [f.severity, `${f.file}:${f.line}`, truncate(f.short_summary, 60), f.status === 'open' ? (f.firstRound === record.round ? 'new' : 'still open') : f.status, f.inline ? 'inline' : 'body']);
  if (rows.length > 0) { console.log(''); print(['Severity', 'Where', 'Finding', 'Status', 'Posts'], rows); }
  console.log(`\nNot examined (${record.notExamined.length}):`);
  for (const item of record.notExamined) console.log(`  - ${truncate(item, 110)}`);
  const offline = isOffline(args);
  if (offline) console.log('\nOffline run: the review payload is written beside the round; nothing is posted.');
  else console.log(`\nNext: \`issueflow review-post --lane ${lane.slug}\``);
  reportCheckpoint(checkpoint(dir, run, { offline, push: false }));
}

async function cmdReviewPost(args) {
  const { dir } = locate(args);
  const run = loadRun(dir);
  const offline = isOffline(args);
  const { lane } = reviewLane(run, dir, args);
  const entry = currentRound(lane);
  if (!entry?.registered) throw new RunError(`round ${entry?.round ?? '?'} of ${lane.slug} is not registered — \`issueflow review-register\` first`);
  if (offline) throw new RunError('cannot post a review on an offline run — the payload is on disk beside the round');
  const { nodeId } = prIdentity(run, lane, offline);
  const posted = postRound(dir, run, lane, entry.round, { prNodeId: nodeId });
  print(['Lane', 'Round', 'Review', 'Threads', 'Unanchored', 'Replies'],
    [[lane.slug, String(entry.round), posted.url, String(posted.threads), String(posted.unanchored), posted.replies.map((r) => r.state).join(', ') || '—']]);
  if (entry.verdict === 'converged') console.log(`\nConverged — \`issueflow ready --lane ${lane.slug}\` lifts the draft once CI is green.`);
  else console.log(`\nNext: \`issueflow review-fix-brief --lane ${lane.slug}\``);
}

async function cmdReviewFixBrief(args) {
  const { dir } = locate(args);
  const run = loadRun(dir);
  const offline = isOffline(args);
  const { lane } = reviewLane(run, dir, args);
  const entry = currentRound(lane);
  if (!entry?.registered) throw new RunError(`round ${entry?.round ?? '?'} of ${lane.slug} is not registered — nothing to fix yet`);
  if (entry.verdict === 'converged') throw new RunError(`round ${entry.round} of ${lane.slug} converged — there is nothing to fix; \`issueflow ready\``);
  const items = fixItems(lane);
  const checks = offline ? [] : prChecks(run.repo.path, lane.pr.number).filter((c) => c.bucket === 'fail');
  const model = fixerModel(lane);
  const info = writeFixBrief(dir, run, lane, entry, { items, checks, model, issue: loadIssue(dir) });
  entry.fix = { ...(entry.fix ?? {}), briefed: true, model, items: items.length, redChecks: checks.length };
  saveRun(dir, run);
  print(['Lane', 'Round', 'Model', 'Findings to fix', 'Red checks'], [[lane.slug, String(entry.round), model, String(items.length), String(checks.length)]]);
  if (model === 'opus') console.log('\nOpus this round: a major survived the previous fix.');
  printDispatch([info], 'fixers');
  console.log(`Then: \`issueflow review-fix-report --lane ${lane.slug}\` once the fix report has landed.`);
}

async function cmdReviewFixReport(args) {
  const { dir } = locate(args);
  const run = loadRun(dir);
  const offline = isOffline(args);
  const { lane } = reviewLane(run, dir, args);
  const entry = currentRound(lane);
  if (!entry?.registered) throw new RunError(`round ${entry?.round ?? '?'} of ${lane.slug} is not registered`);
  let replies;
  try {
    replies = applyFixReport(dir, run, lane, entry.round);
  } catch (err) {
    if (!(err instanceof HandBack)) throw err;
    // The report is recorded; the dispute is what stops the run. Print the sides, then hand back.
    for (const f of openMajors(lane).filter((x) => x.disputes >= 1 && x.dispute)) {
      console.log(`${f.id} ${f.file}:${f.line}\n  reviewer: ${f.summary}\n  fixer:    ${f.dispute}`);
    }
    throw err;
  }
  const rows = offline ? replies.map((r) => ({ id: r.id, state: 'offline', detail: 'nothing sent' })) : postFixReplies(dir, run, lane, entry.round, replies);
  print(['Finding', 'Reply', 'Detail'], rows.map((r) => [r.id, r.state, r.detail ?? '—']));
  if (reviewExhausted(lane)) {
    console.log(`\nRound ${entry.round} was the cap: no round verifies this fix. Read the fixer's commit and each open thread, then rule —`);
    console.log(`\`issueflow review-rule --lane ${lane.slug} --finding <id> --fixed|--withdrawn --note "<what you checked>"\` per major,`);
    console.log(`or \`issueflow review-brief --lane ${lane.slug} --another-round "<why>"\` to have round ${entry.round + 1} verify it instead.`);
  } else {
    console.log(`\nNext: \`issueflow review-brief --lane ${lane.slug}\` — round ${entry.round + 1} reviews the pushed fix.`);
  }
}

async function cmdReviewRule(args) {
  const { dir } = locate(args);
  const run = loadRun(dir);
  const offline = isOffline(args);
  const { lane, tree } = reviewLane(run, dir, args);
  if (typeof args.finding !== 'string' || !args.finding.trim()) throw new RunError('review-rule needs --finding <id>');
  if (Boolean(args.fixed) === Boolean(args.withdrawn)) throw new RunError('review-rule needs exactly one of --fixed or --withdrawn');
  const ruling = args.fixed ? 'fixed' : 'withdrawn';
  const { finding, body } = ruleFinding(dir, run, lane, { id: args.finding.trim(), ruling, note: args.note, head: headOf(tree) });
  const rows = [];
  if (!offline && finding.threadId) {
    const input = join(reviewDir(dir, lane, currentRound(lane).round), 'graphql.json');
    try {
      graphql(run.repo.path, input, { query: GQL.reply, variables: { thread: finding.threadId, body } });
      graphql(run.repo.path, input, { query: GQL.resolve, variables: { thread: finding.threadId } });
      rows.push(['thread', 'replied and resolved']);
    } catch (err) {
      rows.push(['thread', `failed: ${String(err.message).split('\n')[0]}`]);
    }
  } else if (!offline) {
    rows.push(['thread', 'none — the finding was body-only']);
  }
  const last = currentRound(lane);
  print(['Lane', 'Finding', 'Ruling', 'Majors open', 'Round verdict'], [[lane.slug, finding.id, ruling, String(openMajors(lane).length), last.verdict]]);
  if (rows.length > 0) { console.log(''); print(['Action', 'Result'], rows); }
  nextLine(run);
  reportCheckpoint(checkpoint(dir, run, { offline, push: false }));
}

async function cmdReady(args) {
  const { dir } = locate(args);
  const run = loadRun(dir);
  const offline = isOffline(args);
  const { lane } = reviewLane(run, dir, args);
  if (!offline) {
    const checks = prChecks(run.repo.path, lane.pr.number);
    const red = checks.filter((c) => c.bucket === 'fail');
    const pending = checks.filter((c) => c.bucket === 'pending');
    if (red.length > 0) throw new RunError(`cannot ready ${lane.slug}: ${red.map((c) => c.name).join(', ')} failing — a red check is a major`);
    if (pending.length > 0) throw new RunError(`cannot ready ${lane.slug}: ${pending.map((c) => c.name).join(', ')} still running — wait for CI`);
    if (checks.length === 0) console.log('No checks reported on this pull request — nothing to wait for.');
  }
  const last = converge(dir, run, lane);
  const rows = [];
  if (!offline) {
    const { isDraft } = prIdentity(run, lane, offline);
    if (isDraft) { prReady(run.repo.path, lane.pr.number); rows.push(['draft', 'lifted']); }
    if (lane.review.fallback) {
      prRetitle(run.repo.path, lane.pr.number, lane.pr.title);
      prLabel(run.repo.path, lane.pr.number, lane.review.fallback.label, { remove: true });
      rows.push(['title/label', 'restored']);
    }
    const summary = join(dir, lane.slug, 'review', 'summary.md');
    writeFileSync(summary, [
      `### issueflow review loop — converged after ${last.round} round${last.round === 1 ? '' : 's'}`,
      '',
      table(ROUND_COLUMNS, roundRows(lane)).replace(/^\|[-| ]+\|$/m, (m) => m.replace(/-+/g, '---')),
      '',
      `Open nits: ${openFindings(lane).filter((f) => f.severity === 'nit').length} · pre-existing: ${openFindings(lane).filter((f) => f.severity === 'pre-existing').length} · majors: 0.`,
      '',
      `<!-- issueflow:converged ${lane.slug} ${last.head} -->`,
      '',
    ].join('\n'));
    rows.push(['summary comment', prComment(run.repo.path, lane.pr.number, summary)]);
  }
  saveRun(dir, run);
  print(['Lane', 'Rounds', 'Head', 'State'], [[lane.slug, String(last.round), last.head.slice(0, 12), 'ready for review']]);
  if (rows.length > 0) { console.log(''); print(['Action', 'Result'], rows); }
  nextLine(run);
  reportCheckpoint(checkpoint(dir, run, { offline, push: false }));
}


async function cmdRebase(args) {
  const { dir } = locate(args);
  const run = loadRun(dir);
  const { lane, tree } = reviewLane(run, dir, args);
  const parent = run.lanes.find((l) => l.branch === lane.base);
  if (!parent) throw new RunError(`${lane.slug} stacks on ${lane.base}, which is not a lane — nothing to rebase onto`);
  if ((lane.review?.rounds.length ?? 0) > 0) throw new RunError(`${lane.slug} has posted review rounds — a lane is never rebased under its threads`);
  const result = rebaseLane(tree, lane, parent, { push: !isOffline(args) });
  print(['Lane', 'Onto', 'Before', 'After'], [[lane.slug, parent.branch, result.before.slice(0, 12), result.after.slice(0, 12)]]);
}

/**
 * The driver. Computes the one next action; performs every deterministic
 * one it reaches (a brief, the gate, a registration, a split, a ship, a
 * post) and re-decides, until the run needs a subagent, is waiting on one,
 * or needs a person. Prints that in a fixed shape the orchestrator copies.
 */
async function cmdNext(args) {
  const { dir } = locate(args);
  const offline = isOffline(args);
  const skillCommand = 'node "$SKILL_DIR/scripts/issueflow.js"';
  const ctx = {
    offline,
    checks: (lane) => (offline ? [] : prChecks(loadRun(dir).repo.path, lane.pr.number)),
    remoteHead: (lane) => {
      if (offline) return null;
      const run = loadRun(dir);
      try {
        git(['fetch', '--quiet', 'origin', lane.branch], run.repo.path);
        return git(['rev-parse', `refs/remotes/origin/${lane.branch}`], run.repo.path);
      } catch {
        return null;
      }
    },
    landings: () => (offline ? [] : landings(loadRun(dir))),
  };
  const perform = {
    brief: (a) => cmdBrief({ ...args, stage: a.stage, lane: a.lane, review: Boolean(a.review), ready: false }),
    review: (a) => cmdReview({ ...args, stage: a.stage, lane: a.lane }),
    accept: (a) => cmdAccept({ ...args, stage: a.stage, lane: a.lane, auto: Boolean(a.auto) }),
    split: () => cmdSplit({ ...args }),
    ship: () => cmdShip({ ...args, dryRun: false }),
    rebase: (a) => cmdRebase({ ...args, lane: a.lane }),
    'review-brief': (a) => cmdReviewBrief({ ...args, lane: a.lane }),
    'review-verify': (a) => cmdReviewVerify({ ...args, lane: a.lane }),
    'review-register': (a) => cmdReviewRegister({ ...args, lane: a.lane }),
    'review-post': (a) => cmdReviewPost({ ...args, lane: a.lane }),
    'review-fix-brief': (a) => cmdReviewFixBrief({ ...args, lane: a.lane }),
    'review-fix-report': (a) => cmdReviewFixReport({ ...args, lane: a.lane }),
    ready: (a) => cmdReady({ ...args, lane: a.lane }),
    finish: () => cmdFinish({ ...args }),
  };
  const DISPATCHES = new Set(['brief', 'review-brief', 'review-verify', 'review-fix-brief']);
  let dispatched = null;
  for (let i = 0; i < 12; i += 1) {
    const run = observe(dir, loadRun(dir));
    const action = decide(dir, run, ctx);
    if (action.kind !== 'run') {
      if (dispatched && action.kind === 'wait') {
        // The brief just rendered above is the thing in flight: report it as a dispatch.
        console.log(`\n${renderAction({ ...action, kind: 'dispatch', items: [], note: action.note }, { skillCommand, runDir: dir })
          .replace(/^next: dispatch/, `next: dispatch (${dispatched})`)
          .replace('\n\n  These 0 are independent. Dispatch them as 0 subagents in ONE message:\n', '\n  The prompt(s) to dispatch are printed above.')}`);
        return;
      }
      console.log(`\n${renderAction(action, { skillCommand, runDir: dir })}`);
      if (action.kind === 'stop' && ['exhausted', 'stalled', 'unpushed', 'blocked'].includes(action.reason)) process.exitCode = 4;
      return;
    }
    console.log(`▶ ${action.command}${action.note ? ` — ${action.note}` : ''}\n`);
    try {
      await perform[action.command](action.args);
    } catch (err) {
      if (action.command === 'accept' && err instanceof RunError) {
        // The gate refused a delivery: say why, re-render the brief (which
        // resets the stage's clock), and hand the same prompt back with the
        // refusal. The stage goes back; nobody edits the artifact.
        console.log(`gate refused: ${err.message}\n`);
        await cmdBrief({ ...args, stage: action.args.stage, lane: action.args.lane, review: false, ready: false });
        const run2 = observe(dir, loadRun(dir));
        const again = decide(dir, run2, ctx);
        console.log(`\n${renderAction({ ...again, kind: 'dispatch', items: [], note: 'send the stage back with the refusal above — append it to the prompt as: "The gate refused your last delivery: <reason>. Fix that first."' }, { skillCommand, runDir: dir })
          .replace(/^next: dispatch/, 'next: dispatch (send-back)')
          .replace('\n\n  These 0 are independent. Dispatch them as 0 subagents in ONE message:\n', '\n  The prompt to dispatch is printed above.')}`);
        process.exitCode = 2;
        return;
      }
      throw err;
    }
    dispatched = DISPATCHES.has(action.command) ? action.command : null;
    if (dispatched) {
      const run2 = observe(dir, loadRun(dir));
      const after = decide(dir, run2, ctx);
      if (after.kind === 'wait') {
        console.log(`\n${renderAction({ ...after, kind: 'dispatch', items: [] }, { skillCommand, runDir: dir })
          .replace(/^next: dispatch/, `next: dispatch (${dispatched})`)
          .replace('\n\n  These 0 are independent. Dispatch them as 0 subagents in ONE message:\n', '\n  The prompt(s) to dispatch are printed above.')}`);
        return;
      }
      // Nothing to wait for after a brief means the output already exists — fall through and keep going.
    }
    console.log('');
  }
  throw new Error('next performed 12 actions without reaching a dispatch, a wait or a stop — this is a bug in the driver');
}

const USAGE = `issueflow v${VERSION} — one open GitHub issue to a pull request: plan, red team, implement, review loop.

  issueflow next   [--issue <n>]                 the driver: performs every deterministic step it can, then
                                                 prints ONE thing to do — a dispatch, a wait, or a stop
  issueflow board  [--repo <path>] [--run-root <path>]
  issueflow start  --issue <n> [--repo <path>] [--auto] [--take-over]
  issueflow brief  [--stage <id>] [--lane <slug>] [--ready] [--review] [--issue <n>]
  issueflow review --stage <id> [--lane <slug>] [--issue <n>]
  issueflow accept [--stage <id>] [--lane <slug>] [--evidence <path>] [--skip "<reason>"] [--force] [--auto]
  issueflow split  [--items-json <path>] [--issue <n>]
  issueflow status [--issue <n>]
  issueflow runs
  issueflow ship   [--issue <n>] [--dry-run] [--no-draft] [--force]
  issueflow review-brief      --lane <slug>     open a review round: the diff, the finder briefs
  issueflow review-verify     --lane <slug>     pool the candidates, brief the verifiers
  issueflow review-register   --lane <slug>     the registrar: ids, transitions, convergence
  issueflow review-post       --lane <slug>     one GitHub review: threads, replies, resolves
  issueflow review-fix-brief  --lane <slug>     brief the fixer on every open major
  issueflow review-fix-report --lane <slug>     record the fixer's report, reply on the threads
  issueflow review-rule       --lane <slug> --finding <id> --fixed|--withdrawn --note "<what you checked>"
                                                the user's ruling on a major once the loop has spent its cap
  issueflow ready             --lane <slug>     lift the draft once the loop has converged and CI is green
  issueflow rebase            --lane <slug>     rebase a stacked lane onto the lane below, before its first round
  issueflow finish [--issue <n>] [--close-issue]

Exit codes: 0 ok · 2 a gate refused (send the work back) · 3 infrastructure (gh/git — retry) ·
4 hand back to the user (a cap, drift, a dispute, the human stop).

  --auto               on start: no human stop after the red-teamed plan;
                       on accept: approve on a registered, hash-bound passing review
  --review             brief the red-team reviewer of the delivered plan
  --another-round "<reason>"  re-open a rounds-capped stage — or, on review-brief, a capped review loop — on the user's direction
  --ready              brief EVERY stage whose gate is open, for parallel dispatch
  --force              advance despite drift GitHub reported (an already-merged lane)
  --take-over          on start: overwrite a run another session owns, and republish over its
                       checkpoint comment — only for a human who has READ that comment
  --offline            make no network call and no checkpoint
  --no-worktree        run stages in the repository itself instead of a per-lane checkout
  --run-dir <path>     work against a named run instead of ~/.claude/issueflow
  --issues-json <path> read issues from a file instead of the network (evals)
  --close-issue        finish also closes the issue, once every lane has landed

Every state change is checkpointed: the lane's branch is pushed and one comment
on the issue is rewritten in place, so a run survives losing this machine.
`;

async function main() {
  const args = argv(process.argv.slice(2));
  const cmd = args._[0];
  if (args.version) return console.log(VERSION);
  try {
    switch (cmd) {
      case 'board': return await cmdBoard(args);
      case 'start': return await cmdStart(args);
      case 'brief': return await cmdBrief(args);
      case 'accept': return await cmdAccept(args);
      case 'review': return await cmdReview(args);
      case 'split': return await cmdSplit(args);
      case 'status': return await cmdStatus(args);
      case 'runs': return await cmdRuns(args);
      case 'ship': return await cmdShip(args);
      case 'review-brief': return await cmdReviewBrief(args);
      case 'review-verify': return await cmdReviewVerify(args);
      case 'review-register': return await cmdReviewRegister(args);
      case 'review-post': return await cmdReviewPost(args);
      case 'review-fix-brief': return await cmdReviewFixBrief(args);
      case 'review-fix-report': return await cmdReviewFixReport(args);
      case 'review-rule': return await cmdReviewRule(args);
      case 'ready': return await cmdReady(args);
      case 'rebase': return await cmdRebase(args);
      case 'next': return await cmdNext(args);
      case 'finish': return await cmdFinish(args);
      default:
        console.log(USAGE);
        process.exitCode = cmd ? 2 : 0;
    }
  } catch (err) {
    console.error(`issueflow: ${err.message}`);
    process.exitCode = exitCodeFor(err);
  }
}

/**
 * The exit-code contract. A driver needs to tell "send the work back" from
 * "retry" from "ask the person" without parsing English: 2 is a gate
 * refusal, 3 is infrastructure, 4 is a hand-back, 1 is a bug in this tool.
 */
export function exitCodeFor(err) {
  if (err instanceof HandBack) return 4;
  if (err instanceof RunError || err instanceof ShipError || err instanceof FinishError) return 2;
  if (err instanceof GhError || err instanceof WorktreeError) return 3;
  return 1;
}

main();

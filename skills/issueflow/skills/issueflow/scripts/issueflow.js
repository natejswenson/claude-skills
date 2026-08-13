#!/usr/bin/env node
/**
 * issueflow — the deterministic half of the skill.
 *
 * Everything mechanical lives here so the agent never reshapes output with
 * sed/grep/jq in the transcript: one command returns everything a step needs,
 * already as a table. The agent's job is the conversation; this binary's job
 * is facts — and, in `accept` and `ship`, the gate.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BOARD_COLUMNS, ISSUE_COLUMNS, boardRows, detailOf, issueRows } from './lib/board.mjs';
import { loadIssue, writeBrief } from './lib/brief.mjs';
import { checkpoint } from './lib/checkpoint.mjs';
import { finish, FinishError } from './lib/finish.mjs';
import { listIssues, repoInfo, viewIssue } from './lib/gh.mjs';
import { branchFor, resolvePolicy } from './lib/policy.mjs';
import { blockingDrift, reconcile } from './lib/reconcile.mjs';
import {
  accept, artifactPath, blockers, board, createRun, durationOf, findStep, gateSteps, loadRun, markBriefed,
  nextStep, readEvidence, readySteps, remainingSteps, runDir, runRoot, runState, saveRun, skip, split,
  workItemsFromDesign,
} from './lib/run.mjs';
import { ship, shipBlockers } from './lib/ship.mjs';
import { ensureWorktree } from './lib/worktree.mjs';
import { verify } from './lib/verify.mjs';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

function argv(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a.startsWith('--')) {
      const [k, inline] = a.slice(2).split('=');
      const key = k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (inline !== undefined) out[key] = inline;
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

const runBoard = (run) => print(BOARD_COLUMNS, boardRows(board(run)));

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
    console.log('\nEvery lane has an open pull request — `issueflow finish` once they merge.');
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
    console.log(`\nNext: \`issueflow brief ${stageArgs(ready[0])}\` (${ready[0].stage.model})`);
    return;
  }
  console.log(`\n${ready.length} stages can run NOW, in parallel — dispatch them together:`);
  for (const step of ready) console.log(`  issueflow brief ${stageArgs(step)}    (${step.stage.model})`);
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

/** Print what has moved underneath the run, when anything has. */
function reportDrift(rows) {
  if (rows.length === 0) return;
  console.log('');
  print(['Reality check', 'State', 'Detail'], rows.map((r) => [r.check, r.state, r.detail]));
}

async function cmdBoard(args) {
  const repo = resolve(args.repo ?? '.');
  const info = identify(repo, args);
  const issues = args.issuesJson ? JSON.parse(readFileSync(args.issuesJson, 'utf8')) : listIssues(repo);
  const policy = resolvePolicy(repo, info.defaultBranch);

  if (issues.length === 0) {
    console.log(`No open issues in ${info.owner}/${info.name}.`);
    return;
  }
  print(ISSUE_COLUMNS, issueRows(issues));
  console.log('');
  print(
    ['Repo', 'Base branch', 'Feature prefix', 'Merge', 'Policy from'],
    [[`${info.owner}/${info.name}`, policy.base, policy.featurePrefix, policy.mergeMethod, policy.source]],
  );
  console.log(
    '\nDetail is how much the issue text specifies, not how much work it is — a thin issue\n' +
      'under a broad title is the one most likely to come back from design as several work items.',
  );
}

async function cmdStart(args) {
  const repo = resolve(args.repo ?? '.');
  const info = identify(repo, args);
  const number = readIssueNumber(args);
  const issue = args.issueJson ? JSON.parse(readFileSync(args.issueJson, 'utf8')) : viewIssue(repo, number);
  const policy = resolvePolicy(repo, info.defaultBranch);
  const dir = args.runDir ? resolve(args.runDir) : runDir(runRoot(), info.owner, info.name, issue.number);

  const run = createRun({ repo: info, issue, policy, offline: isOffline(args) });
  saveRun(dir, run);
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
  const run = loadRun(dir);

  // `--ready` with one open gate is just `brief`. Printing a fan-out table over
  // a single row would tell the reader two stages can run when one can.
  if (args.ready && readySteps(run).length > 1) {
    const ready = readySteps(run);
    const briefed = ready.map((step) => briefOne(dir, run, step, args));
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
    throw new Error(
      `${step.key} is gated behind ${blocked.map((b) => `${b.key} (${b.stage.state})`).join(', ')} — ` +
        'no stage runs on anything but its predecessor\'s approved artifact',
    );
  }

  // A stage that commits gets its own checkout. Failing to provision one is not
  // fatal — the stage can still run in the repository — but it must be said,
  // because a lane silently sharing the user's tree is the hazard this removes.
  let workdir = null;
  let warning = null;
  if (step.lane && !args.noWorktree) {
    try {
      workdir = ensureWorktree(run.repo.path, dir, step.lane).path;
    } catch (err) {
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
  const run = loadRun(dir);
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
    throw new Error(
      `this run is out of date with GitHub: ${blocking.map((b) => `${b.check} ${b.state}`).join(', ')} — ` +
        'the work may already have landed. Re-read it, then pass --force if approving is still right',
    );
  }

  if (args.skip) skip(dir, run, step, typeof args.skip === 'string' ? args.skip : null);
  else accept(dir, run, step, { evidence: args.evidence ? resolve(args.evidence) : null });

  runBoard(run);
  const facts = verify(dir, run, step);
  if (facts.length > 0) {
    console.log('');
    print(['Checked', 'Is'], facts);
  }
  reportDrift(drift);
  nextLine(run);
  reportCheckpoint(checkpoint(dir, run, { offline }));
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
    const design = findStep(run, 'design');
    if (design.stage.state !== 'approved') {
      throw new Error('cannot read work items from an unapproved design — approve it, or pass --items-json');
    }
    items = workItemsFromDesign(readFileSync(artifactPath(dir, design), 'utf8'));
    console.log(`Read ${items.length} work items from the approved design.\n`);
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
  const run = loadRun(dir);
  print(
    ['Issue', 'Split', 'Lanes'],
    [[`${run.repo.owner}/${run.repo.name}#${run.issue.number}`, String(run.split), String(run.lanes.length)]],
  );
  console.log(`\nRun: ${dir}`);
  if (run.checkpoint?.commentUrl) console.log(`Checkpoint: ${run.checkpoint.commentUrl}`);
  console.log('');
  runBoard(run);
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
      } catch {
        rows.push([`${repoDir}/${issueDir}`, '(unreadable run)', '—', '—', '—']);
      }
    }
  }
  if (rows.length === 0) { console.log(`No runs under ${root}.`); return; }
  print(['Issue', 'Title', 'Approved', 'Next', 'On GitHub'], rows);
  console.log(`\nRuns live under ${root}. Resume one with \`issueflow status --run-dir <path>\`.`);
}

async function cmdShip(args) {
  const { dir } = locate(args);
  const run = loadRun(dir);
  const blocked = shipBlockers(run);
  if (blocked.length > 0) {
    print(['Step', 'State', 'Reason'], blocked.map((b) => [b.step, b.state, b.reason ?? '—']));
    throw new Error('cannot ship — every stage above must be approved first');
  }
  const drift = reconcile(run, { offline: isOffline(args) });
  const blocking = blockingDrift(drift);
  if (blocking.length > 0 && !args.force) {
    reportDrift(drift);
    throw new Error(
      `this run is out of date with GitHub: ${blocking.map((b) => `${b.check} ${b.state}`).join(', ')} — ` +
        'shipping now would open a pull request over work that already landed. Pass --force if it is still right',
    );
  }

  const results = ship(dir, run, { dryRun: Boolean(args.dryRun), draft: Boolean(args.draft) });
  print(['Lane', 'Branch', 'Base', 'Commits', 'Pull request'], results.map((r) => [r.lane, r.branch, r.base, r.commits, r.url]));
  if (args.dryRun) {
    console.log('\nDry run — nothing was pushed and no pull request was opened.');
    return;
  }
  // `ship` used to print these URLs and throw them away — run.json carried no
  // record of its own pull requests. `finish` needs that record to answer
  // `runState()`'s "shipped" question without re-asking GitHub.
  for (const r of results) {
    const lane = run.lanes.find((l) => l.slug === r.lane);
    if (lane && r.number) lane.pr = { number: r.number, url: r.url };
  }
  saveRun(dir, run);
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

const USAGE = `issueflow v${VERSION} — one open GitHub issue to a pull request, through four gated stages.

  issueflow board  [--repo <path>]
  issueflow start  --issue <n> [--repo <path>]
  issueflow brief  [--stage <id>] [--lane <slug>] [--ready] [--issue <n>]
  issueflow accept [--stage <id>] [--lane <slug>] [--evidence <path>] [--skip "<reason>"] [--force]
  issueflow split  [--items-json <path>] [--issue <n>]
  issueflow status [--issue <n>]
  issueflow runs
  issueflow ship   [--issue <n>] [--dry-run] [--draft] [--force]
  issueflow finish [--issue <n>] [--close-issue]

  --ready              brief EVERY stage whose gate is open, for parallel dispatch
  --force              advance despite drift GitHub reported (an already-merged lane)
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
      case 'split': return await cmdSplit(args);
      case 'status': return await cmdStatus(args);
      case 'runs': return await cmdRuns(args);
      case 'ship': return await cmdShip(args);
      case 'finish': return await cmdFinish(args);
      default:
        console.log(USAGE);
        process.exitCode = cmd ? 2 : 0;
    }
  } catch (err) {
    console.error(`issueflow: ${err.message}`);
    process.exitCode = 1;
  }
}

main();

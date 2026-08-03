#!/usr/bin/env node
/**
 * issueflow — the deterministic half of the skill.
 *
 * Everything mechanical lives here so the agent never reshapes output with
 * sed/grep/jq in the transcript: one command returns everything a step needs,
 * already as a table. The agent's job is the conversation; this binary's job
 * is facts — and, in `accept` and `ship`, the gate.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BOARD_COLUMNS, ISSUE_COLUMNS, boardRows, issueRows } from './lib/board.mjs';
import { loadIssue, writeBrief } from './lib/brief.mjs';
import { listIssues, repoInfo, viewIssue } from './lib/gh.mjs';
import { branchFor, resolvePolicy } from './lib/policy.mjs';
import {
  accept, blockers, board, createRun, findStep, loadRun, nextStep, runDir, runRoot, saveRun, skip, split,
} from './lib/run.mjs';
import { ship, shipBlockers } from './lib/ship.mjs';

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

function nextLine(run) {
  const next = nextStep(run);
  if (!next) { console.log('\nEvery stage is approved — `issueflow ship` is the only step left.'); return; }
  const lane = next.laneSlug && next.laneSlug !== 'root' ? ` --lane ${next.laneSlug}` : '';
  console.log(`\nNext: \`issueflow brief --stage ${next.stage.id}${lane}\` (${next.stage.model})`);
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

  const run = createRun({ repo: info, issue, policy });
  saveRun(dir, run);
  mkdirSync(join(dir, 'inputs'), { recursive: true });
  writeFileSync(join(dir, 'inputs', 'issue.json'), `${JSON.stringify(issue, null, 2)}\n`);

  print(
    ['Issue', 'Run', 'Branch', 'Base'],
    [[`${info.owner}/${info.name}#${issue.number}`, dir, branchFor(policy, issue.number, 'root'), policy.base]],
  );
  console.log('');
  runBoard(run);
  nextLine(run);
}

async function cmdBrief(args) {
  const { dir } = locate(args);
  const run = loadRun(dir);
  const stageId = args.stage ?? nextStep(run)?.stage.id;
  if (!stageId) throw new Error('every stage is approved — there is nothing left to brief');
  const step = findStep(run, stageId, args.lane ?? null);

  const blocked = blockers(run, step);
  if (blocked.length > 0) {
    throw new Error(
      `${step.key} is gated behind ${blocked.map((b) => `${b.key} (${b.stage.state})`).join(', ')} — ` +
        'no stage runs on anything but its predecessor\'s approved artifact',
    );
  }

  const info = writeBrief(dir, run, step, loadIssue(dir));
  step.stage.state = step.stage.state === 'pending' ? 'briefed' : step.stage.state;
  saveRun(dir, run);
  print(
    ['Stage', 'Model', 'Agent', 'Artifact it must write'],
    [[info.stage, info.model, info.agent, info.artifact]],
  );
  // The brief is handed over as a path, not pasted: it is long, the user has no
  // reason to read it in the transcript, and a subagent can open a file. The
  // file is still the only channel — this is how it is delivered.
  console.log(
    `\nDispatch ONE subagent, model \`${info.model}\`, with exactly this prompt:\n\n` +
      `  Read ${info.prompt} and follow it exactly. It is your complete brief.\n`,
  );
}

async function cmdAccept(args) {
  const { dir } = locate(args);
  const run = loadRun(dir);
  const stageId = args.stage ?? nextStep(run)?.stage.id;
  if (!stageId) throw new Error('every stage is already approved');
  const step = findStep(run, stageId, args.lane ?? null);

  if (args.skip) skip(dir, run, step, typeof args.skip === 'string' ? args.skip : null);
  else accept(dir, run, step, { evidence: args.evidence ? resolve(args.evidence) : null });

  runBoard(run);
  nextLine(run);
}

async function cmdSplit(args) {
  const { dir } = locate(args);
  const run = loadRun(dir);
  const items = JSON.parse(args.itemsJson ? readFileSync(resolve(args.itemsJson), 'utf8') : (args.items ?? '[]'));
  split(dir, run, items);
  print(
    ['Lane', 'Work item', 'Branch', 'Stacks on'],
    run.lanes.map((l) => [l.slug, l.title, l.branch, l.base]),
  );
  console.log('');
  runBoard(run);
  nextLine(run);
}

async function cmdStatus(args) {
  const { dir } = locate(args);
  const run = loadRun(dir);
  print(
    ['Issue', 'Run', 'Split', 'Lanes'],
    [[`${run.repo.owner}/${run.repo.name}#${run.issue.number}`, dir, String(run.split), String(run.lanes.length)]],
  );
  console.log('');
  runBoard(run);
  nextLine(run);
}

async function cmdShip(args) {
  const { dir } = locate(args);
  const run = loadRun(dir);
  const blocked = shipBlockers(run);
  if (blocked.length > 0) {
    print(['Step', 'State', 'Reason'], blocked.map((b) => [b.step, b.state, b.reason ?? '—']));
    throw new Error('cannot ship — every stage above must be approved first');
  }
  const results = ship(dir, run, { dryRun: Boolean(args.dryRun), draft: Boolean(args.draft) });
  print(['Lane', 'Branch', 'Base', 'Commits', 'Pull request'], results.map((r) => [r.lane, r.branch, r.base, r.commits, r.url]));
  if (args.dryRun) console.log('\nDry run — nothing was pushed and no pull request was opened.');
}

const USAGE = `issueflow v${VERSION} — one open GitHub issue to a pull request, through four gated stages.

  issueflow board  [--repo <path>]
  issueflow start  --issue <n> [--repo <path>]
  issueflow brief  [--stage <id>] [--lane <slug>] [--issue <n>]
  issueflow accept [--stage <id>] [--lane <slug>] [--evidence <path>] [--skip "<reason>"]
  issueflow split  --items-json <path> [--issue <n>]
  issueflow status [--issue <n>]
  issueflow ship   [--issue <n>] [--dry-run] [--draft]

  --run-dir <path>     work against a named run instead of ~/.claude/issueflow
  --issues-json <path> read issues from a file instead of the network (evals)
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
      case 'ship': return await cmdShip(args);
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

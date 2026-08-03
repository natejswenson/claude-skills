/**
 * The last gate, and the only step that writes to GitHub.
 *
 * `ship` is where the one rule stops being about tidiness: an unapproved stage
 * here means a pull request whose reasoning nobody signed off, so the refusal is
 * absolute and names every hole it found rather than the first.
 *
 * Lanes stack. The bottom lane targets the repo's base branch and every layer
 * above targets the lane below it, so each pull request's diff is only that
 * layer — the shape a reviewer can actually read.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { artifactPath, gateSteps } from './run.mjs';
import { createPr } from './gh.mjs';

export class ShipError extends Error {}

const git = (args, cwd) => {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    throw new ShipError(String(err.stderr ?? err.message ?? '').trim().split('\n')[0] || `git ${args[0]} failed`);
  }
};

/** Every reason this run may not ship. All of them, never just the first. */
export function shipBlockers(run) {
  return gateSteps(run)
    .filter((s) => s.stage.state !== 'approved')
    .map((s) => ({ step: s.key, state: s.stage.state, reason: s.stage.skipReason ?? null }));
}

const branchExists = (repo, branch) => {
  try {
    git(['rev-parse', '--verify', `refs/heads/${branch}`], repo);
    return true;
  } catch {
    return false;
  }
};

/** Commits on `branch` that are not on `base` — zero means nothing to open a pull request about. */
const commitsAhead = (repo, branch, base) => {
  const out = git(['rev-list', '--count', `${base}..${branch}`], repo);
  return Number.parseInt(out, 10) || 0;
};

/** The pull request body: what was decided, and where to read it. */
export function prBody(dir, run, lane) {
  const shared = gateSteps(run).filter((s) => s.laneSlug === null);
  const own = gateSteps(run).filter((s) => s.laneSlug === lane.slug);
  const lines = [
    `Closes #${run.issue.number}.`,
    '',
    run.split ? `Work item **${lane.slug}** — ${lane.title}` : lane.title,
    '',
    '## How this was produced',
    '',
    '| Stage | Model | State |',
    '|---|---|---|',
    ...[...shared, ...own].map((s) => `| ${s.stage.id} | ${s.stage.model} | ${s.stage.state} |`),
    '',
    'Every stage above was approved by a human before the next one started.',
    '',
    '## Test evidence',
    '',
  ];
  const test = own.find((s) => s.stage.id === 'test');
  if (test?.stage.evidence) {
    const output = readFileSync(test.stage.evidence, 'utf8').trim().split('\n');
    const tail = output.slice(-25);
    lines.push('```', ...(output.length > tail.length ? [`… ${output.length - tail.length} earlier lines`] : []), ...tail, '```');
  } else {
    lines.push('_none recorded_');
  }
  lines.push('', '---', '', `<sub>Opened by issueflow. Artifacts: \`${artifactPath(dir, own[0] ?? shared[0])}\`</sub>`, '');
  return lines.join('\n');
}

/**
 * Push every lane and open its pull request, bottom layer first.
 *
 * `dryRun` returns the exact plan without touching the remote — the only honest
 * way to show a user what is about to be irreversible.
 */
export function ship(dir, run, { dryRun = false, draft = false } = {}) {
  const blocked = shipBlockers(run);
  if (blocked.length > 0) {
    throw new ShipError(
      `cannot ship: ${blocked.map((b) => `${b.step} is ${b.state}`).join(', ')} — ` +
        'a pull request over an unapproved stage is a change nobody signed off',
    );
  }

  const repo = run.repo.path;
  const results = [];
  for (const lane of run.lanes) {
    if (!branchExists(repo, lane.branch)) {
      throw new ShipError(`branch ${lane.branch} does not exist — the implement stage never committed to it`);
    }
    const ahead = commitsAhead(repo, lane.branch, lane.base);
    if (ahead === 0) {
      throw new ShipError(`${lane.branch} has no commits over ${lane.base} — there is nothing to open a pull request about`);
    }
    const title = run.split ? `${run.issue.title} — ${lane.title}` : run.issue.title;
    if (dryRun) {
      results.push({ lane: lane.slug, branch: lane.branch, base: lane.base, commits: ahead, url: '(dry run)' });
      continue;
    }
    git(['push', '-u', 'origin', lane.branch], repo);
    const bodyFile = join(dir, lane.slug, 'pr-body.md');
    writeFileSync(bodyFile, prBody(dir, run, lane));
    const url = createPr(repo, { head: lane.branch, base: lane.base, title, bodyFile, draft });
    results.push({ lane: lane.slug, branch: lane.branch, base: lane.base, commits: ahead, url });
  }
  return results;
}

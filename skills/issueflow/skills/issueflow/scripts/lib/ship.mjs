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
import { gateSteps } from './run.mjs';
import { assertVerified } from './verification.mjs';
import { createPr, prOperationView, prsForBranch } from './gh.mjs';
import { operation } from './operations.mjs';
import { dispatchProfile, modelLabel } from './runtime.mjs';

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

/** The number out of a pull request URL, so the caller can record it without a second `gh` call. */
const prNumberFromUrl = (url) => Number(/\/pull\/(\d+)/.exec(String(url ?? ''))?.[1]) || null;

const branchExists = (repo, branch) => {
  try {
    git(['rev-parse', '--verify', `refs/heads/${branch}`], repo);
    return true;
  } catch {
    return false;
  }
};

/**
 * Commits on `branch` that are not on `base` — zero means nothing to open a
 * pull request about.
 *
 * Measured against `origin/<base>` when the remote has it, because a local
 * `dev` that has not been fetched in a week reports commits that landed days
 * ago as this change's own. A stacked base is a sibling lane's branch, which
 * lives locally until that lane is pushed, so it falls back to the local ref.
 */
const commitsAhead = (repo, branch, base) => {
  let ref = base;
  try {
    git(['rev-parse', '--verify', `refs/remotes/origin/${base}`], repo);
    ref = `origin/${base}`;
  } catch {
    ref = base;
  }
  const out = git(['rev-list', '--count', `${ref}..${branch}`], repo);
  return Number.parseInt(out, 10) || 0;
};

/** The pull request body: what was decided, and where to read it. */
export function prBody(dir, run, lane) {
  const shared = gateSteps(run).filter((s) => s.laneSlug === null);
  const own = gateSteps(run).filter((s) => s.laneSlug === lane.slug);
  // On an auto run the approval sentence would be a lie — nobody signed these
  // stages off but the red team, and the pull request is where that claim is
  // published. Gated strictly on `run.auto` so the frozen (gated) body is
  // byte-identical.
  const produced = run.auto
    ? [
        '| Stage | Model | State | Review rounds |',
        '|---|---|---|---|',
        ...[...shared, ...own].map(
          (s) => `| ${s.stage.id} | ${modelLabel(dispatchProfile(run, s.stage.id))} | ${s.stage.state} | ${s.stage.review?.rounds.length ?? 0} |`,
        ),
        '',
        'The plan passed independent red-team review before implementation.',
        'Implementation acceptance checks its required evidence; independent code',
        'review follows on this pull request.',
      ]
    : [
        '| Stage | Model | State |',
        '|---|---|---|',
        ...[...shared, ...own].map((s) => `| ${s.stage.id} | ${modelLabel(dispatchProfile(run, s.stage.id))} | ${s.stage.state} |`),
        '',
        'The independently reviewed plan was approved by a human before implementation.',
        'Implementation acceptance checks its required evidence.',
      ];
  const lines = [
    `Closes #${run.issue.number}.`,
    '',
    run.split ? `Work item **${lane.slug}** — ${lane.title}` : lane.title,
    '',
    '## How this was produced',
    '',
    ...produced,
    '',
    '## Test evidence',
    '',
  ];
  const proved = own.find((s) => s.stage.evidence);
  if (run.harness && lane.verification) {
    const batch = assertVerified(dir, run, lane);
    lines.push(`Controller-observed verification at \`${batch.head}\`.`, '',
      ...batch.receipts.map((r) => `- \`${r.check}\`: passed (receipt \`${r.hash}\`).`), '',
      'Raw command logs remain in the local run; hashes detect changes, not origin.');
  } else if (proved) {
    if (proved.stage.result) lines.push(`\`${proved.stage.result}\``, '');
    const output = readFileSync(proved.stage.evidence, 'utf8').trim().split('\n');
    const tail = output.slice(-25);
    lines.push('```', ...(output.length > tail.length ? [`… ${output.length - tail.length} earlier lines`] : []), ...tail, '```');
  } else {
    lines.push('_none recorded_');
  }
  // No absolute path here. `dir` is `/Users/<someone>/.claude/issueflow/…`, and
  // this body is published — it named the maintainer's home directory in every
  // pull request the skill opened.
  lines.push('', '---', '', '<sub>Opened by issueflow. Every stage artifact is in this run\'s comment on the issue.</sub>', '');
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
  if (run.offline && !dryRun) throw new ShipError('offline run: remote shipping is disabled; use --dry-run to inspect the proposed PR');
  if (run.harness) for (const lane of run.lanes) assertVerified(dir, run, lane);

  const repo = run.repo.path;
  const results = [];
  for (const lane of run.lanes) {
    if (!branchExists(gitStore(dir, run), lane.branch)) {
      throw new ShipError(`branch ${lane.branch} does not exist — the implement stage never committed to it`);
    }
    const ahead = commitsAhead(gitStore(dir, run), lane.branch, lane.base);
    if (ahead === 0) {
      throw new ShipError(`${lane.branch} has no commits over ${lane.base} — there is nothing to open a pull request about`);
    }
    const title = run.split ? `${run.issue.title} — ${lane.title}` : run.issue.title;
    if (dryRun) {
      results.push({ lane: lane.slug, branch: lane.branch, base: lane.base, commits: ahead, url: '(dry run)' });
      continue;
    }
    const head = git(['rev-parse', `refs/heads/${lane.branch}`], gitStore(dir, run));
    if (run.harness) operation(dir, run, { kind: 'push', target: lane.branch, intent: { head }, retrySafe: true,
      read: () => git(['ls-remote', 'origin', `refs/heads/${lane.branch}`], gitStore(dir, run)).split(/\s+/)[0] === head ? { head } : null,
      write: () => git(['push', '-u', 'origin', lane.branch], gitStore(dir, run)),
    });
    else git(['push', '-u', 'origin', lane.branch], gitStore(dir, run));
    const bodyFile = join(dir, lane.slug, 'pr-body.md');
    writeFileSync(bodyFile, prBody(dir, run, lane));
    const opened = run.harness ? operation(dir, run, { kind: 'create-pr', target: lane.branch, intent: { head, base: lane.base, title },
      read: (key) => {
        const candidates = prsForBranch(repo, lane.branch).filter((p) => p.state === 'OPEN' && p.baseRefName === lane.base);
        if (!candidates.length) return null;
        if (candidates.length !== 1) throw new ShipError('multiple matching pull requests; reconcile before continuing');
        const pr = prOperationView(repo, candidates[0].number);
        if (pr.headRefOid !== head || !pr.body?.includes(`<!-- issueflow:operation ${key} -->`)) throw new ShipError('matching branch has an unowned or changed PR; reconcile before continuing');
        return { url: pr.url, draft: pr.isDraft };
      },
      write: (key) => {
        writeFileSync(bodyFile, prBody(dir, run, lane) + `\n<!-- issueflow:operation ${key} -->\n`);
        createPr(repo, { head: lane.branch, base: lane.base, title, bodyFile, draft });
      },
    }) : createPr(repo, { head: lane.branch, base: lane.base, title, bodyFile, draft });
    results.push({
      lane: lane.slug, branch: lane.branch, base: lane.base, commits: ahead, url: opened.url,
      number: prNumberFromUrl(opened.url), draft: opened.draft, title,
    });
  }
  return results;
}
import { gitStore } from './execution.mjs';

/**
 * The facts the orchestrator used to go and get for itself.
 *
 * After the test stage on the run this was measured against, the orchestrator
 * ran six ad-hoc shell commands to answer questions the CLI already had the
 * information for: `git status --porcelain`, `git rev-parse --abbrev-ref HEAD`,
 * `git log dev..HEAD`, `git fetch` + `git log origin/dev..HEAD`, `wc -l` on the
 * evidence file and `grep -nE` through it. Every one of those is a wall of raw
 * output in a transcript the user is reading, and the skill's own presentation
 * contract says the script should have handed them over.
 *
 * So it hands them over. One call, one table.
 */
import { execFileSync } from 'node:child_process';
import { PER_ITEM_STAGES } from './stages.mjs';
import { evidencePath, laneTree, readEvidence } from './run.mjs';
import { summarize, twoSided } from './evidence.mjs';
import { assertVerified } from './verification.mjs';

const git = (args, cwd) => {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
};

/**
 * Everything worth knowing about a step that has just been done.
 *
 * Returns rows, not prose, so every stage reports the same shape — and returns
 * what it could not determine as `unknown` rather than omitting the row, since
 * a missing row reads as "fine".
 */
export function verify(dir, run, step) {
  const rows = [];
  const lane = step.lane;

  if (lane) {
    const cwd = laneTree(dir, run, lane);
    rows.push(['workdir', cwd === run.repo.path ? 'the repository itself' : 'lane worktree']);
    rows.push(['branch', lane.branch]);

    const head = git(['rev-parse', '--short', `refs/heads/${lane.branch}`], gitStore(dir, run));
    rows.push(['head', head ?? 'the branch does not exist yet']);

    const base = git(['rev-parse', '--verify', `refs/remotes/origin/${lane.base}`], gitStore(dir, run))
      ? `origin/${lane.base}`
      : lane.base;
    const ahead = head ? git(['rev-list', '--count', `${base}..${lane.branch}`], gitStore(dir, run)) : null;
    rows.push([`commits over ${base}`, ahead ?? 'unknown']);

    const dirty = git(['status', '--porcelain'], cwd);
    rows.push(['tree', dirty === null ? 'unknown' : dirty === '' ? 'clean' : `${dirty.split('\n').length} uncommitted path(s)`]);
  }

  if (PER_ITEM_STAGES.includes(step.stage.id)) {
    if (run.harness) {
      const batch = assertVerified(dir, run, lane);
      rows.push(['verification', `${batch.receipts.length} required controller-observed obligations passed`]);
      rows.push(['verified head', batch.head]);
      rows.push(['evidence strength', 'captured process results; repository commands retain host permissions']);
      return rows;
    }
    const proof = step.stage.evidence ?? evidencePath(dir, step);
    const results = readEvidence(proof);
    rows.push(['test result', summarize(results.at(-1) ?? null)]);
    rows.push(['runs in evidence', String(results.length)]);
    const sided = twoSided(results);
    rows.push(['two-sided', sided.ok ? 'red run, then green' : sided.reason]);
  }

  return rows;
}
import { gitStore } from './execution.mjs';

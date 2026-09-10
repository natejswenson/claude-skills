/**
 * Shared fixtures for the test files. Not a test file itself — the runner's
 * glob is `*.test.mjs` — so nothing here is discovered as a test.
 *
 * Everything drives the real state machine. `approvePlan` walks the plan the
 * way a run does: artifact on disk, a registered red-team round, then
 * `accept`. There is no shortcut around the review, because the gate has none.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { STAGES } from '../lib/stages.mjs';
import { accept, artifactPath, blockers, evidencePath, findStep, saveRun } from '../lib/run.mjs';
import { ensureWorktree } from '../lib/worktree.mjs';
import { nextRound, registerReview, reviewPath } from '../lib/reviews.mjs';

/** Write an artifact that satisfies the stage's required sections. */
export function writeGood(dir, run, stageId, lane = null) {
  const step = findStep(run, stageId, lane);
  if (step.lane && blockers(run, step).length === 0) fixtureCheckout(dir, run, step.lane);
  const declared = STAGES.find((s) => s.id === stageId);
  const path = artifactPath(dir, step);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, declared.requires.map((r) => `## ${r}\n\nsomething real about ${r.toLowerCase()}.\n`).join('\n'));
  return step;
}

/** Synthetic gates still use a real isolated Git checkout for worker output. */
export function fixtureCheckout(dir, run, lane = run.lanes[0]) {
  if (run.checkout?.mode === 'source') return;
  if (!existsSync(run.repo.path)) {
    run.repo = { ...run.repo, path: join(dir, 'fixture-repo') };
    mkdirSync(run.repo.path, { recursive: true });
    const git = (args) => execFileSync('git', args, { cwd: run.repo.path, stdio: 'pipe' });
    git(['init', '-qb', run.policy.base]);
    git(['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-qm', 'seed']);
    saveRun(dir, run);
  }
  ensureWorktree(run.repo.path, dir, lane, { offline: true, lanes: run.lanes });
}

/** Write a red-team review for the step's next round, in the registrar's JSON shape. */
export function writeReview(dir, step, { findings = [], notExamined = ['the frobnicator path'], verdict } = {}) {
  const derived = findings.some((f) => (f.disposition ?? 'fixable') === 'fixable' && (f.severity === 'critical' || f.severity === 'high')) ? 'blocked' : findings.some((f) => f.disposition === 'scope-change' && (f.severity === 'critical' || f.severity === 'high')) ? 'decision' : 'pass';
  mkdirSync(join(dir, 'reviews'), { recursive: true });
  writeFileSync(reviewPath(dir, step, nextRound(step)), `${JSON.stringify({ findings, notExamined, verdict: verdict ?? derived }, null, 2)}\n`);
}

/** A passing round, registered — the plan has been attacked and nothing blocked. */
export function redTeamPass(dir, run, step) {
  writeReview(dir, step, { findings: [{ severity: 'low', cite: 'investigate.md § Root cause', text: 'the cause is stated but not traced.' }] });
  return registerReview(dir, run, step);
}

/** A blocked round, registered — the plan has an open blocking finding. */
export function redTeamBlock(dir, run, step, text = 'the evidence never reproduces the report.', cite = 'investigate.md § Evidence') {
  writeReview(dir, step, { findings: [{ severity: 'high', cite, text }] });
  return registerReview(dir, run, step);
}

/** The plan: written, red-teamed clean, approved. */
export function approvePlan(dir, run, opts = {}) {
  const step = writeGood(dir, run, 'investigate');
  redTeamPass(dir, run, step);
  accept(dir, run, step, opts);
  return step;
}

/** A two-sided evidence file: the test seen failing, then passing. */
export const GOOD_EVIDENCE = '# pass 0\n# fail 1\nexit code 1\n\n--- after the fix ---\n\n# pass 24\n# fail 0\nexit code 0\n';

/** An implement stage: artifact, two-sided evidence, approved. */
export function approveImplement(dir, run, lane = null, opts = {}) {
  const step = writeGood(dir, run, 'implement', lane);
  writeFileSync(evidencePath(dir, step), GOOD_EVIDENCE);
  accept(dir, run, step, opts);
  return step;
}

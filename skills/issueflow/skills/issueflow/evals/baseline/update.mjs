#!/usr/bin/env node
/**
 * Refresh the frozen baseline by re-running issueflow over the real inputs.
 *
 * The inputs are a real run: `natejswenson/local-fitness`'s actual open issues,
 * its actual issue #133, and the plan a real opus subagent produced from the
 * briefs this skill rendered (its investigation and its design, which since
 * 0.7.0 are one artifact). Nothing here is invented, and nothing here touches
 * the network — the frozen `gh` payloads are fed in through `--repo-json` /
 * `--issues-json` / `--issue-json`, which is what lets `ci / issueflow` run the
 * whole state machine for $0 and never flake.
 *
 * Run it when a deliberate change to the board, the state machine or a brief
 * makes the golden stale. The failing assertion prints this command.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STAGES } from '../../scripts/lib/stages.mjs';
import { REVIEWS, REVIEW_FORBIDS } from '../../scripts/lib/reviews.mjs';
import { renderComment } from '../../scripts/lib/checkpoint.mjs';
import { loadRun } from '../../scripts/lib/run.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = join(HERE, '..', '..');
const INPUTS = join(SKILL, 'evals', 'inputs');
const CLI = join(SKILL, 'scripts', 'issueflow.js');

/** The fixture repo: a real directory with no shipflow config, so policy falls back to defaults. */
const REPO = join(INPUTS, 'repo');

const cli = (args) =>
  execFileSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    // A parent `node --test` leaks NODE_TEST_CONTEXT into every child, which
    // makes a spawned script behave as though it were itself a test file.
    env: { ...process.env, NODE_TEST_CONTEXT: undefined },
  });

/**
 * Absolute paths differ per machine and per run. Normalising them is what makes
 * a byte-comparison meaningful instead of a machine-identity check.
 */
const normalize = (text, runDir) =>
  text.replaceAll(runDir, '<RUN>').replaceAll(REPO, '<REPO>').replaceAll(SKILL, '<SKILL>');

const sha = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);

export function generate() {
  const runDir = mkdtempSync(join(tmpdir(), 'issueflow-baseline-'));
  const artifacts = {};
  const at = (...p) => join(INPUTS, ...p);

  const common = ['--repo', REPO, '--repo-json', at('repo.json'), '--run-dir', runDir];

  artifacts['board.txt'] = cli(['board', '--repo', REPO, '--repo-json', at('repo.json'), '--issues-json', at('issues.json')]);
  artifacts['start.txt'] = cli(['start', ...common, '--issue', '133', '--issue-json', at('issue-133.json')]);

  // `next` at each state of the plan gate. Frozen because the driver's output
  // is what the orchestrator copies: a wait line that stopped naming the
  // brief, or a dispatch printed before the red team had run, would otherwise
  // regress in prose nobody diffs. The run directory has no siblings here, so
  // every timeout is the 1800s default and the golden is machine-independent.
  artifacts['next-1-fresh.txt'] = cli(['next', '--run-dir', runDir]);

  // investigate — the plan a real opus subagent wrote from the brief below,
  // red-teamed and approved. The round registered here is the real #132 review
  // (six path:line findings into the frozen local-fitness sources, verdict
  // pass): the #133 run predates the red team, so it has no review of its own,
  // and a review invented for the golden would pin the registrar against
  // nothing real. The dogfood run that freezes 0.7.0's review loop replaces it.
  artifacts['brief-investigate.md'] = readBrief(null, runDir, 'investigate');
  cpSync(at('artifacts', 'investigate.md'), join(runDir, 'shared', 'investigate.md'));
  artifacts['next-2-plan-delivered.txt'] = cli(['next', '--run-dir', runDir]);
  mkdirSync(join(runDir, 'reviews'), { recursive: true });
  cpSync(at('artifacts', 'review-investigate-r1.findings.json'), join(runDir, 'reviews', 'investigate-r1.findings.json'));
  artifacts['next-3-reviewed.txt'] = cli(['next', '--run-dir', runDir]);
  cli(['accept', '--stage', 'investigate', '--run-dir', runDir]);
  // The plan's clock is wall-clock — briefed, delivered and approved seconds
  // apart on whichever machine last ran this. Pinned to fixed instants so the
  // board `next` prints below carries a real-looking `Took` that never churns.
  {
    const state = loadRun(runDir);
    state.stages[0].at = { briefed: '2026-09-04T12:00:00.000Z', delivered: '2026-09-04T12:04:58.000Z', approved: '2026-09-04T12:10:00.000Z' };
    writeFileSync(join(runDir, 'run.json'), `${JSON.stringify(state, null, 2)}\n`);
  }

  // The approved plan lists work items, so `next` splits and briefs the bottom
  // lane — implement, briefable for real, because the plan it inherits is approved.
  artifacts['next-4-approved.txt'] = cli(['next', '--run-dir', runDir, '--no-worktree']);
  artifacts['brief-implement.md'] = readBrief(null, runDir, 'descriptions-implement');

  // The sticky issue comment this run would have posted. It is the durable
  // record of the whole run, so it is frozen for the same reason the briefs
  // are: it crosses out of this machine, and nobody reviews what is not pinned.
  //
  // Stage timings are stripped first. They are wall-clock, so freezing them
  // would pin the speed of the machine that last ran this script — the golden
  // pins the comment's SHAPE, and `durationOf` is covered by its own unit test.
  const state = loadRun(runDir);
  for (const s of [...state.stages, ...state.lanes.flatMap((l) => l.stages)]) s.at = {};
  artifacts['checkpoint-comment.md'] = renderComment(runDir, state);

  // The shipped stage contract, one file per stage. Two files, two stages:
  // the corpus floor is what stops a resolver that matches nothing from
  // reporting a state machine with a missing stage as complete.
  for (const s of STAGES) {
    artifacts[`stage-${s.id}.json`] = `${JSON.stringify(
      { id: s.id, title: s.title, model: s.model, agent: s.agent, artifact: s.artifact, requires: s.requires, asks: s.asks, forbids: s.forbids },
      null,
      2,
    )}\n`;
  }

  // The reviewer contract, frozen like the stage contracts and for the same
  // reason: a reviewer that silently changed model or dropped a hunt would
  // still render a complete-looking review brief.
  for (const r of REVIEWS) {
    artifacts[`review-${r.id}.json`] = `${JSON.stringify(
      { id: r.id, title: r.title, model: r.model, agent: r.agent, asks: r.asks, forbids: REVIEW_FORBIDS },
      null,
      2,
    )}\n`;
  }

  // The red-team round, in its own run directory.
  //
  // These fixtures are the first real auto-mode run — issue #132, its final
  // investigate artifact, and the round-3 review a real opus red-team subagent
  // wrote, which passed it. The review's path:line citations resolve against
  // frozen copies of the cited local-fitness sources (a public repo) under
  // `inputs/repo/`, so the registrar's citation gate runs for real, offline.
  // The review here still drives the real CLI — brief the reviewer, drop in the
  // reviewer's findings, and let `review` validate, derive and hash-bind it.
  {
    const reviewDir = mkdtempSync(join(tmpdir(), 'issueflow-baseline-review-'));
    cli(['start', '--repo', REPO, '--repo-json', at('repo.json'), '--run-dir', reviewDir, '--issue', '132', '--issue-json', at('issue-132.json'), '--auto']);
    cli(['brief', '--stage', 'investigate', '--run-dir', reviewDir]);
    cpSync(at('artifacts', 'investigate-132.md'), join(reviewDir, 'shared', 'investigate.md'));
    cli(['brief', '--review', '--stage', 'investigate', '--run-dir', reviewDir]);
    artifacts['brief-review-investigate.md'] = normalize(
      readFileSync(join(reviewDir, 'briefs', 'review-investigate-r1.md'), 'utf8'), reviewDir,
    );
    mkdirSync(join(reviewDir, 'reviews'), { recursive: true });
    cpSync(at('artifacts', 'review-investigate-r1.findings.json'), join(reviewDir, 'reviews', 'investigate-r1.findings.json'));
    artifacts['review-investigate-r1.txt'] = normalize(cli(['review', '--stage', 'investigate', '--run-dir', reviewDir]), reviewDir);
    artifacts['verdict-investigate-r1.json'] = normalize(
      readFileSync(join(reviewDir, 'reviews', 'investigate-r1.verdict.json'), 'utf8'), reviewDir,
    );
    rmSync(reviewDir, { recursive: true, force: true });
  }

  for (const key of Object.keys(artifacts)) artifacts[key] = normalize(artifacts[key], runDir);
  rmSync(runDir, { recursive: true, force: true });
  return artifacts;

  function readBrief(_stdout, dir, name) {
    return readFileSync(join(dir, 'briefs', `${name}.md`), 'utf8');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const artifacts = generate();
  // Clear only what a previous freeze wrote — the manifest's own list — never
  // the whole directory. The first `freeze-round.mjs` lived here for an
  // afternoon and was deleted by the next refresh without a word.
  const previous = existsSync(join(HERE, 'MANIFEST.json')) ? Object.keys(JSON.parse(readFileSync(join(HERE, 'MANIFEST.json'), 'utf8')).artifacts ?? {}) : [];
  for (const f of [...previous, 'MANIFEST.json']) rmSync(join(HERE, f), { force: true });
  mkdirSync(HERE, { recursive: true });
  const manifest = {};
  for (const [name, body] of Object.entries(artifacts)) {
    writeFileSync(join(HERE, name), body);
    manifest[name] = sha(body);
  }
  writeFileSync(
    join(HERE, 'MANIFEST.json'),
    `${JSON.stringify(
      {
        comment:
          'Frozen from a real issueflow run against natejswenson/local-fitness#133. Regenerate with `node evals/baseline/update.mjs`.',
        source: 'natejswenson/local-fitness#133',
        artifacts: manifest,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`froze ${Object.keys(manifest).length} artifacts`);
}

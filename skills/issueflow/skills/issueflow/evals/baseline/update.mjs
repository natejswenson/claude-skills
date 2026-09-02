#!/usr/bin/env node
/**
 * Refresh the frozen baseline by re-running issueflow over the real inputs.
 *
 * The inputs are a real run: `natejswenson/local-fitness`'s actual open issues,
 * its actual issue #133, and the investigation and design a real opus subagent
 * produced from the briefs this skill rendered. Nothing here is invented, and
 * nothing here touches the network — the frozen `gh` payloads are fed in
 * through `--repo-json` / `--issues-json` / `--issue-json`, which is what lets
 * `ci / issueflow` run the whole state machine for $0 and never flake.
 *
 * Run it when a deliberate change to the board, the state machine or a brief
 * makes the golden stale. The failing assertion prints this command.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STAGES } from '../../scripts/lib/stages.mjs';
import { REVIEWS, REVIEW_FORBIDS, REVIEW_REQUIRES } from '../../scripts/lib/reviews.mjs';
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

  // investigate — the artifact a real opus subagent wrote from the brief below.
  artifacts['brief-investigate.md'] = readBrief(cli(['brief', '--stage', 'investigate', '--run-dir', runDir]), runDir, 'investigate');
  cpSync(at('artifacts', 'investigate.md'), join(runDir, 'shared', 'investigate.md'));
  cli(['accept', '--stage', 'investigate', '--run-dir', runDir]);

  // design — same, and it inherits the approved investigation by path.
  artifacts['brief-design.md'] = readBrief(cli(['brief', '--stage', 'design', '--run-dir', runDir]), runDir, 'design');
  cpSync(at('artifacts', 'design.md'), join(runDir, 'shared', 'design.md'));
  cli(['accept', '--stage', 'design', '--run-dir', runDir]);

  // implement — briefable for real, because both stages it inherits are approved.
  artifacts['brief-implement.md'] = readBrief(cli(['brief', '--stage', 'implement', '--run-dir', runDir]), runDir, 'root-implement');

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

  // The shipped stage contract, one file per stage. Four files, four stages:
  // the corpus floor is what stops a resolver that matches nothing from
  // reporting a state machine with a missing stage as complete.
  for (const s of STAGES) {
    artifacts[`stage-${s.id}.json`] = `${JSON.stringify(
      { id: s.id, title: s.title, model: s.model, agent: s.agent, artifact: s.artifact, requires: s.requires, asks: s.asks, forbids: s.forbids },
      null,
      2,
    )}\n`;
  }

  // The reviewer contracts, frozen like the stage contracts and for the same
  // reason: a reviewer that silently changed model or dropped a hunt would
  // still render a complete-looking review brief.
  for (const r of REVIEWS) {
    artifacts[`review-${r.id}.json`] = `${JSON.stringify(
      { id: r.id, title: r.title, model: r.model, agent: r.agent, asks: r.asks, requires: REVIEW_REQUIRES, forbids: REVIEW_FORBIDS },
      null,
      2,
    )}\n`;
  }

  // The red-team round, in its own run directory: the golden run above stays a
  // gated run, so its checkpoint comment keeps pinning the pre-review shape.
  //
  // These fixtures are the first real auto-mode run — issue #132, its final
  // investigate artifact, and the round-3 review a real opus red-team subagent
  // wrote, which passed it. The review's path:line citations resolve against
  // frozen copies of the cited local-fitness sources (a public repo) under
  // `inputs/repo/`, so the registrar's citation gate runs for real, offline.
  // The review here still drives the real CLI — brief the reviewer, drop in the
  // reviewer's artifact, and let `review` validate, derive and hash-bind it.
  {
    const reviewDir = mkdtempSync(join(tmpdir(), 'issueflow-baseline-review-'));
    cli(['start', '--repo', REPO, '--repo-json', at('repo.json'), '--run-dir', reviewDir, '--issue', '132', '--issue-json', at('issue-132.json')]);
    cli(['brief', '--stage', 'investigate', '--run-dir', reviewDir]);
    cpSync(at('artifacts', 'investigate-132.md'), join(reviewDir, 'shared', 'investigate.md'));
    cli(['brief', '--review', '--stage', 'investigate', '--run-dir', reviewDir]);
    artifacts['brief-review-investigate.md'] = normalize(
      readFileSync(join(reviewDir, 'briefs', 'review-investigate-r1.md'), 'utf8'), reviewDir,
    );
    mkdirSync(join(reviewDir, 'reviews'), { recursive: true });
    cpSync(at('artifacts', 'review-investigate-r1.md'), join(reviewDir, 'reviews', 'investigate-r1.md'));
    cli(['review', '--stage', 'investigate', '--run-dir', reviewDir]);
    artifacts['verdict-investigate-r1.json'] = normalize(
      readFileSync(join(reviewDir, 'reviews', 'investigate-r1.json'), 'utf8'), reviewDir,
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
  for (const f of readdirSync(HERE)) if (f !== 'update.mjs') rmSync(join(HERE, f), { force: true });
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

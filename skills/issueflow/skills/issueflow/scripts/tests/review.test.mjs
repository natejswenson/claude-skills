/**
 * The red team, two-sided.
 *
 * Every suite here pairs the good path with the defect it exists to refuse:
 * a review that registers beside one that cites nothing, an auto-accept that
 * approves beside four that must not, a cap that stops the loop beside the
 * quiet fourth round that must never happen. A one-sided version of any of
 * these goes green the day the checker is weakened — which is the exact
 * failure an adversarial gate cannot have.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STAGES } from '../lib/stages.mjs';
import {
  accept, artifactPath, createRun, findStep, loadRun, saveRun,
} from '../lib/run.mjs';
import { renderBrief, renderReviewBrief, writeReviewBrief } from '../lib/brief.mjs';
import {
  BLOCKING, MAX_ROUNDS, REVIEWS, REVIEW_REQUIRES, latestRound, nextRound, registerReview, reviewPath,
  roundsExhausted, verdictPath,
} from '../lib/reviews.mjs';
import { renderComment } from '../lib/checkpoint.mjs';
import { prBody } from '../lib/ship.mjs';

const HERE = new URL('.', import.meta.url).pathname;
const CLI = join(HERE, '..', 'issueflow.js');

const ISSUE = { number: 7, title: 'Fix the widget cache', url: 'https://example.invalid/7', body: 'the cache is stale' };
const POLICY = { base: 'dev', featurePrefix: 'feature/', mergeMethod: 'squash', source: 'test', shipflow: true };

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** A real git repo with one commit, so head-binding has something to bind to. */
function gitRepo() {
  const path = mkdtempSync(join(tmpdir(), 'issueflow-review-repo-'));
  git(['init', '-b', 'dev'], path);
  git(['config', 'user.email', 'test@example.invalid'], path);
  git(['config', 'user.name', 'test'], path);
  writeFileSync(join(path, 'widget.js'), 'export const cache = new Map();\nexport const get = (k) => cache.get(k);\n');
  git(['add', 'widget.js'], path);
  git(['commit', '-m', 'seed'], path);
  return path;
}

function freshRun({ auto = false, repoPath = '/nowhere' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'issueflow-review-'));
  const repo = { owner: 'acme', name: 'widgets', path: repoPath, defaultBranch: 'dev' };
  const run = createRun({ repo, issue: ISSUE, policy: POLICY, offline: true, auto });
  saveRun(dir, run);
  mkdirSync(join(dir, 'inputs'), { recursive: true });
  writeFileSync(join(dir, 'inputs', 'issue.json'), `${JSON.stringify(ISSUE, null, 2)}\n`);
  mkdirSync(join(dir, 'reviews'), { recursive: true });
  return { dir, run, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Write an artifact that satisfies the stage's required sections. */
function writeGood(dir, run, stageId, lane = null) {
  const step = findStep(run, stageId, lane);
  const declared = STAGES.find((s) => s.id === stageId);
  writeFileSync(artifactPath(dir, step), declared.requires.map((r) => `## ${r}\n\nsomething real.\n`).join('\n'));
  return step;
}

/** Write a review artifact for the step's next round. */
function writeReview(dir, step, { findings = [], notExamined = 'the frobnicator path', verdict }) {
  const derived = findings.some((f) => /\[(critical|high)\]/.test(f)) ? 'blocked' : 'pass';
  const body = [
    '# review',
    '',
    '## Findings',
    '',
    ...findings,
    '',
    '## Not examined',
    '',
    notExamined,
    '',
    '## Verdict',
    '',
    verdict ?? derived,
    '',
  ].join('\n');
  writeFileSync(reviewPath(dir, step, nextRound(step)), body);
}

// ---------------------------------------------------------------------------
// review-verdict-two-sided — the registrar accepts a citing review and refuses
// every way a review can lie about itself.
// ---------------------------------------------------------------------------

test('review-verdict-two-sided: a clean pass with a cited note registers, hash-bound', () => {
  const { dir, run, cleanup } = freshRun();
  const step = writeGood(dir, run, 'investigate');
  writeReview(dir, step, { findings: ['- [medium] investigate.md § Root cause — the cause is stated but not traced.'] });
  const result = registerReview(dir, run, step);
  assert.equal(result.verdict, 'pass');
  assert.equal(result.findings.medium, 1);
  assert.equal(result.round, 1);
  assert.match(result.artifactSha, /^[0-9a-f]{64}$/);
  assert.equal(result.head, null, 'a document review binds to no commit');
  const persisted = JSON.parse(readFileSync(verdictPath(dir, step, 1), 'utf8'));
  assert.equal(persisted.verdict, 'pass');
  assert.ok(!('items' in persisted), 'the verdict file carries counts, not prose');
  const reloaded = loadRun(dir);
  assert.equal(latestRound(findStep(reloaded, 'investigate')).verdict, 'pass');
  assert.equal(findStep(reloaded, 'investigate').stage.review.feedback, null);
  cleanup();
});

test('review-verdict-two-sided: a blocked round records its findings and sets the feedback path', () => {
  const { dir, run, cleanup } = freshRun();
  const step = writeGood(dir, run, 'investigate');
  writeReview(dir, step, { findings: ['- [high] investigate.md § Evidence — the evidence never reproduces the report.'] });
  const result = registerReview(dir, run, step);
  assert.equal(result.verdict, 'blocked');
  const reloaded = findStep(loadRun(dir), 'investigate');
  assert.equal(reloaded.stage.review.feedback, 'reviews/investigate-r1.md');
  assert.equal(reloaded.stage.review.rounds[0].items[0].severity, 'high');
  cleanup();
});

test('review-verdict-two-sided: a citation naming a file that does not exist refuses the whole review', () => {
  const { dir, run, cleanup } = freshRun();
  const step = writeGood(dir, run, 'investigate');
  writeReview(dir, step, { findings: ['- [high] nowhere/nope.js:12 — this file is invented.'] });
  assert.throws(() => registerReview(dir, run, step), /does not resolve/);
  assert.ok(!existsSync(verdictPath(dir, step, 1)), 'a refused review must write no verdict');
  cleanup();
});

test('review-verdict-two-sided: a citation naming a heading the artifact lacks refuses', () => {
  const { dir, run, cleanup } = freshRun();
  const step = writeGood(dir, run, 'investigate');
  writeReview(dir, step, { findings: ['- [high] investigate.md § Imaginary Section — cited into thin air.'] });
  assert.throws(() => registerReview(dir, run, step), /does not resolve/);
  cleanup();
});

test('review-verdict-two-sided: a finding line that does not match the grammar refuses', () => {
  const { dir, run, cleanup } = freshRun();
  const step = writeGood(dir, run, 'investigate');
  writeReview(dir, step, { findings: ['- the root cause seems shaky to me'] });
  assert.throws(() => registerReview(dir, run, step), /does not match|do not match/);
  cleanup();
});

test('review-verdict-two-sided: a review missing a required section refuses', () => {
  const { dir, run, cleanup } = freshRun();
  const step = writeGood(dir, run, 'investigate');
  writeFileSync(reviewPath(dir, step, 1), '## Findings\n\n\n## Verdict\n\npass\n');
  assert.throws(() => registerReview(dir, run, step), /no Not examined section/);
  cleanup();
});

test('review-verdict-two-sided: a declared pass over a high finding refuses — the severities decide', () => {
  const { dir, run, cleanup } = freshRun();
  const step = writeGood(dir, run, 'investigate');
  writeReview(dir, step, {
    findings: ['- [high] investigate.md § Unknowns — a guess is presented as a finding.'],
    verdict: 'pass',
  });
  assert.throws(() => registerReview(dir, run, step), /declares pass but its own findings derive blocked/);
  cleanup();
});

test('review-verdict-two-sided: zero findings with an empty Not examined refuses — clean must not mean unreviewed', () => {
  const { dir, run, cleanup } = freshRun();
  const step = writeGood(dir, run, 'investigate');
  writeReview(dir, step, { findings: [], notExamined: '' });
  assert.throws(() => registerReview(dir, run, step), /Not examined/);
  writeReview(dir, step, { findings: [], notExamined: 'the config loading path — out of scope for this issue' });
  assert.equal(registerReview(dir, run, step).verdict, 'pass');
  cleanup();
});

test('review-verdict-two-sided: a path:line citation into the repo resolves; a line past EOF does not', () => {
  const repoPath = gitRepo();
  const { dir, run, cleanup } = freshRun({ repoPath });
  const step = writeGood(dir, run, 'investigate');
  writeReview(dir, step, { findings: ['- [medium] widget.js:2 — the getter never invalidates.'] });
  assert.equal(registerReview(dir, run, step).findings.medium, 1);
  writeReview(dir, step, { findings: ['- [medium] widget.js:9999 — cited past the end of the file.'] });
  assert.throws(() => registerReview(dir, run, step), /cited line 9999/);
  cleanup();
  rmSync(repoPath, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// auto-accept-trap — the mirror of the unapproved-stage trap. The pass path
// approves; every other shape must refuse and leave the stage unapproved.
// ---------------------------------------------------------------------------

/** An auto run with investigate delivered and, optionally, reviewed. */
function autoRun({ auto = true, repoPath = '/nowhere' } = {}) {
  const ctx = freshRun({ auto, repoPath });
  const step = writeGood(ctx.dir, ctx.run, 'investigate');
  return { ...ctx, step };
}

test('auto-accept-trap: --auto on a run that was not started auto refuses', () => {
  const { dir, run, step, cleanup } = autoRun({ auto: false });
  writeReview(dir, step, { findings: [] });
  registerReview(dir, run, step);
  assert.throws(() => accept(dir, run, step, { auto: true }), /not started with --auto/);
  assert.notEqual(step.stage.state, 'approved', 'the refusal must not approve');
  cleanup();
});

test('auto-accept-trap: no registered review refuses — in an auto run the review IS the approval', () => {
  const { dir, run, step, cleanup } = autoRun();
  assert.throws(() => accept(dir, run, step, { auto: true }), /no red-team review is registered/);
  assert.notEqual(step.stage.state, 'approved');
  cleanup();
});

test('auto-accept-trap: a blocked round refuses', () => {
  const { dir, run, step, cleanup } = autoRun();
  writeReview(dir, step, { findings: ['- [critical] investigate.md § Root cause — the cause is wrong.'] });
  registerReview(dir, run, step);
  assert.throws(() => accept(dir, run, step, { auto: true }), /round 1 is blocked/);
  assert.notEqual(step.stage.state, 'approved');
  cleanup();
});

test('auto-accept-trap: an artifact edited after its review refuses — the verdict binds to bytes', () => {
  const { dir, run, step, cleanup } = autoRun();
  writeReview(dir, step, { findings: [] });
  registerReview(dir, run, step);
  writeFileSync(artifactPath(dir, step), '## Root cause\n\nrewritten after the review\n\n## Evidence\n\nx\n\n## Unknowns\n\nx\n');
  assert.throws(() => accept(dir, run, step, { auto: true }), /artifact changed after round 1/);
  assert.notEqual(step.stage.state, 'approved');
  cleanup();
});

test('auto-accept-trap: the pass path approves and records who approved', () => {
  const { dir, run, step, cleanup } = autoRun();
  writeReview(dir, step, { findings: [] });
  registerReview(dir, run, step);
  accept(dir, run, step, { auto: true });
  assert.equal(step.stage.state, 'approved');
  assert.equal(step.stage.autoApproved, true);
  cleanup();
});

test('auto-accept-trap: a human approval still works on an auto run, and records no autoApproved', () => {
  const { dir, run, step, cleanup } = autoRun();
  accept(dir, run, step);
  assert.equal(step.stage.state, 'approved');
  assert.notEqual(step.stage.autoApproved, true);
  cleanup();
});

test('auto-accept-trap: a commit after a code review refuses — the branch moved under the verdict', () => {
  const repoPath = gitRepo();
  const { dir, run, cleanup } = freshRun({ auto: true, repoPath });
  // walk the shared stages through on the human path; the trap is implement's
  for (const id of ['investigate', 'design']) accept(dir, run, writeGood(dir, run, id));
  const step = writeGood(dir, run, 'implement');
  writeReview(dir, step, { findings: [] });
  const registered = registerReview(dir, run, step);
  assert.match(registered.head, /^[0-9a-f]{40}$/, 'a code review must bind to a commit');
  writeFileSync(join(repoPath, 'widget.js'), 'export const cache = new WeakMap();\n');
  git(['commit', '-am', 'moved after review'], repoPath);
  assert.throws(() => accept(dir, run, step, { auto: true }), /branch moved after round 1/);
  assert.notEqual(step.stage.state, 'approved');
  cleanup();
  rmSync(repoPath, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// rounds-cap-trap — three blocked rounds stop the loop. No quiet fourth
// attempt, and the run still refuses to ship.
// ---------------------------------------------------------------------------

const cli = (args) => {
  try {
    const out = execFileSync(process.execPath, [CLI, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_TEST_CONTEXT: undefined },
    });
    return { code: 0, out, err: '' };
  } catch (e) {
    return { code: e.status ?? 1, out: String(e.stdout ?? ''), err: String(e.stderr ?? '') };
  }
};

function exhaustedRun() {
  const ctx = autoRun();
  for (let round = 1; round <= MAX_ROUNDS; round += 1) {
    writeReview(ctx.dir, ctx.step, {
      findings: [`- [high] investigate.md § Root cause — still wrong in round ${round}.`],
    });
    registerReview(ctx.dir, ctx.run, ctx.step);
  }
  assert.equal(roundsExhausted(ctx.step), true);
  return ctx;
}

test('rounds-cap-trap: a fourth brief of the refused stage exits non-zero and approves nothing', () => {
  const { dir, cleanup } = exhaustedRun();
  const r = cli(['brief', '--stage', 'investigate', '--run-dir', dir, '--offline']);
  assert.notEqual(r.code, 0, 'the cap let a fourth round be briefed');
  assert.match(r.err, /refused .* 3 times|not converging/);
  assert.notEqual(findStep(loadRun(dir), 'investigate').stage.state, 'approved');
  cleanup();
});

test('rounds-cap-trap: a fourth review brief is refused the same way', () => {
  const { dir, cleanup } = exhaustedRun();
  const r = cli(['brief', '--review', '--stage', 'investigate', '--run-dir', dir, '--offline']);
  assert.notEqual(r.code, 0);
  assert.match(r.err, /not converging/);
  cleanup();
});

test('rounds-cap-trap: auto-accept still refuses the exhausted stage, and ship refuses the run', () => {
  const { dir, cleanup } = exhaustedRun();
  const a = cli(['accept', '--auto', '--stage', 'investigate', '--run-dir', dir, '--offline']);
  assert.notEqual(a.code, 0, 'an exhausted stage was approved over its open findings');
  const s = cli(['ship', '--run-dir', dir, '--offline']);
  assert.notEqual(s.code, 0, 'ship opened a pull request over an exhausted stage');
  cleanup();
});

test('rounds-cap-trap: a bare --another-round is not an override — the reason is the user\'s, and required', () => {
  const { dir, cleanup } = exhaustedRun();
  const r = cli(['brief', '--stage', 'investigate', '--run-dir', dir, '--offline', '--another-round']);
  assert.notEqual(r.code, 0, 'a reasonless flag re-opened a capped stage');
  assert.match(r.err, /not converging|--another-round/);
  cleanup();
});

test('rounds-cap-trap: a user-directed round re-opens the stage, records the reason, and briefs it verbatim', () => {
  const { dir, cleanup } = exhaustedRun();
  const direction = 'restore the positive lock test alongside the seam fix';
  const r = cli(['brief', '--stage', 'investigate', '--run-dir', dir, '--offline', '--another-round', direction]);
  assert.equal(r.code, 0, r.err);
  const brief = readFileSync(join(dir, 'briefs', 'investigate.md'), 'utf8');
  assert.match(brief, /## The user directed this round/);
  assert.ok(brief.includes(direction), 'the direction must cross verbatim');
  const step = findStep(loadRun(dir), 'investigate');
  assert.deepEqual(
    step.stage.review.overrides.map((o) => ({ round: o.round, reason: o.reason })),
    [{ round: MAX_ROUNDS + 1, reason: direction }],
  );
  assert.equal(roundsExhausted(step), false, 'the recorded override re-opens the stage');
  // and the round-4 review brief renders too, without needing the flag again
  const rv = cli(['brief', '--review', '--stage', 'investigate', '--run-dir', dir, '--offline']);
  assert.equal(rv.code, 0, rv.err);
  cleanup();
});

test('rounds-cap-trap: two-sided — below the cap the loop continues: brief carries the feedback', () => {
  const { dir, run, step, cleanup } = autoRun();
  writeReview(dir, step, { findings: ['- [high] investigate.md § Evidence — evidence never reproduces.'] });
  registerReview(dir, run, step);
  const r = cli(['brief', '--stage', 'investigate', '--run-dir', dir, '--offline']);
  assert.equal(r.code, 0, r.err);
  const brief = readFileSync(join(dir, 'briefs', 'investigate.md'), 'utf8');
  assert.match(brief, /## Review feedback — round 2/);
  assert.match(brief, /evidence never reproduces/);
  cleanup();
});

// ---------------------------------------------------------------------------
// conditional rendering — a run the red team never touched renders exactly as
// it always has, in the brief, the checkpoint comment and the PR body.
// ---------------------------------------------------------------------------

test('conditional-brief: a stage with no rounds renders byte-identically to a pre-review run', () => {
  const { dir, run, cleanup } = freshRun();
  const step = writeGood(dir, run, 'investigate');
  const withField = renderBrief(dir, run, step, ISSUE);
  const legacy = structuredClone(run);
  for (const s of [...legacy.stages, ...legacy.lanes.flatMap((l) => l.stages)]) delete s.review;
  const withoutField = renderBrief(dir, legacy, findStep(legacy, 'investigate'), ISSUE);
  assert.equal(withField, withoutField);
  assert.doesNotMatch(withField, /Review feedback/);
  cleanup();
});

test('conditional-comment: no rounds keeps the human lead-in; an auto run with rounds tells the truth', () => {
  const { dir, run, step, cleanup } = autoRun();
  const before = renderComment(dir, run);
  assert.match(before, /gated by an adversarial\nred-team review/);
  assert.doesNotMatch(before, /Blocking found/);
  writeReview(dir, step, { findings: ['- [high] investigate.md § Root cause — wrong.'] });
  registerReview(dir, run, step);
  const after = renderComment(dir, run);
  assert.match(after, /\| Step \| Rounds \| Blocking found \| Notes \|/);
  assert.match(after, /\| investigate \| 1 \| 1 \| 0 \|/);
  const gated = freshRun();
  assert.match(renderComment(gated.dir, gated.run), /approved by a human/);
  cleanup();
  gated.cleanup();
});

test('conditional-pr-body: an auto run says the red team gated it; a gated run keeps the human sentence', () => {
  const { dir, run, cleanup } = autoRun();
  const auto = prBody(dir, run, run.lanes[0]);
  assert.match(auto, /gated by an adversarial red-team review/);
  assert.match(auto, /\| Review rounds \|/);
  assert.doesNotMatch(auto, /approved by a human/);
  const gated = freshRun();
  const human = prBody(gated.dir, gated.run, gated.run.lanes[0]);
  assert.match(human, /approved by a human/);
  assert.doesNotMatch(human, /red-team/);
  cleanup();
  gated.cleanup();
});

// ---------------------------------------------------------------------------
// the review brief — same contract as a stage brief: cold start, citations
// spelled out, completion message addressed to main.
// ---------------------------------------------------------------------------

test('review-brief: carries the artifact under attack, the grammar, the severity split and the completion contract', () => {
  const { dir, run, cleanup } = freshRun();
  const step = writeGood(dir, run, 'investigate');
  const text = renderReviewBrief(dir, run, step, ISSUE, 1);
  assert.match(text, /red-team/);
  assert.ok(text.includes(artifactPath(dir, step)), 'the brief must name the artifact under review');
  assert.match(text, /- \[critical\|high\|medium\|low\] <citation> — <one-sentence finding>/);
  assert.match(text, /critical and high block the stage; medium and low are notes/);
  for (const section of REVIEW_REQUIRES) assert.ok(text.includes(`**${section}**`), `must require ${section}`);
  assert.match(text, /`SendMessage`/);
  assert.match(text, /addressed to `main`/);
  assert.match(text, /the issue has no body|the cache is stale/);
  cleanup();
});

test('review-brief: a code-stage review names the diff command; a document review does not', () => {
  const { dir, run, cleanup } = freshRun();
  for (const id of ['investigate', 'design']) accept(dir, run, writeGood(dir, run, id));
  const implement = writeGood(dir, run, 'implement');
  const code = renderReviewBrief(dir, run, implement, ISSUE, 1);
  assert.match(code, /git diff dev\.\.\.HEAD/);
  assert.match(code, /diff:<path>/);
  const doc = renderReviewBrief(dir, run, findStep(run, 'investigate'), ISSUE, 1);
  assert.doesNotMatch(doc, /diff:<path>/);
  cleanup();
});

test('review-brief: writeReviewBrief dispatches on opus for every stage — the model is not a suggestion', () => {
  const { dir, run, cleanup } = freshRun();
  const step = writeGood(dir, run, 'investigate');
  const info = writeReviewBrief(dir, run, step, ISSUE, 1);
  assert.equal(info.model, 'opus');
  assert.equal(info.agent, 'general-purpose');
  for (const r of REVIEWS) assert.equal(r.model, 'opus', `${r.id} reviewer must run on opus`);
  assert.deepEqual(REVIEWS.map((r) => r.id), STAGES.map((s) => s.id), 'one reviewer per stage, same order');
  cleanup();
});

// The constants the choreography quotes.
test('review contract constants: blocking severities and the cap are what SKILL.md promises', () => {
  assert.deepEqual(BLOCKING, ['critical', 'high']);
  assert.equal(MAX_ROUNDS, 3);
});

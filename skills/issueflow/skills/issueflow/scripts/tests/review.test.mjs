/**
 * The red team, two-sided.
 *
 * Every suite here pairs the good path with the defect it exists to refuse:
 * a review that registers beside one that cites nothing, an auto-accept that
 * approves beside the shapes that must not, a cap that stops the loop beside
 * the quiet fourth round that must never happen. A one-sided version of any of
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
import { accept, artifactPath, createRun, findStep, loadRun, saveRun } from '../lib/run.mjs';
import { renderBrief, renderReviewBrief, writeReviewBrief } from '../lib/brief.mjs';
import {
  BLOCKING, MAX_ROUNDS, REVIEWS, latestRound, parseFindings, registerReview, reviewPath, reviewable,
  roundsExhausted, verdictPath,
} from '../lib/reviews.mjs';
import { renderComment } from '../lib/checkpoint.mjs';
import { approvePlan, redTeamBlock, redTeamPass, writeGood, writeReview } from './helpers.mjs';

const HERE = new URL('.', import.meta.url).pathname;
const CLI = join(HERE, '..', 'issueflow.js');

const ISSUE = { number: 7, title: 'Fix the widget cache', url: 'https://example.invalid/7', body: 'the cache is stale' };
const POLICY = { base: 'dev', featurePrefix: 'feature/', mergeMethod: 'squash', source: 'test', shipflow: true };

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** A real git repo with one commit, so a path:line citation has a file to resolve against. */
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

const note = (cite, text) => ({ severity: 'medium', cite, text });
const high = (cite, text) => ({ severity: 'high', cite, text });

// ---------------------------------------------------------------------------
// review-verdict-two-sided — the registrar accepts a citing review and refuses
// every way a review can lie about itself.
// ---------------------------------------------------------------------------

test('review-verdict-two-sided: a clean pass with a cited note registers, hash-bound', () => {
  const { dir, run, cleanup } = freshRun();
  const step = writeGood(dir, run, 'investigate');
  writeReview(dir, step, { findings: [note('investigate.md § Root cause', 'the cause is stated but not traced.')] });
  const result = registerReview(dir, run, step);
  assert.equal(result.verdict, 'pass');
  assert.equal(result.findings.medium, 1);
  assert.equal(result.round, 1);
  assert.match(result.artifactSha, /^[0-9a-f]{64}$/);
  const persisted = JSON.parse(readFileSync(verdictPath(dir, step, 1), 'utf8'));
  assert.equal(persisted.verdict, 'pass');
  assert.ok(!('items' in persisted), 'the verdict file carries counts, not prose');
  assert.equal(persisted.review, 'reviews/investigate-r1.findings.json');
  const reloaded = loadRun(dir);
  assert.equal(latestRound(findStep(reloaded, 'investigate')).verdict, 'pass');
  assert.equal(findStep(reloaded, 'investigate').stage.review.feedback, null);
  cleanup();
});

test('review-verdict-two-sided: a blocked round records its findings and sets the feedback path', () => {
  const { dir, run, cleanup } = freshRun();
  const step = writeGood(dir, run, 'investigate');
  writeReview(dir, step, { findings: [high('investigate.md § Evidence', 'the evidence never reproduces the report.')] });
  const result = registerReview(dir, run, step);
  assert.equal(result.verdict, 'blocked');
  const reloaded = findStep(loadRun(dir), 'investigate');
  assert.equal(reloaded.stage.review.feedback, 'reviews/investigate-r1.findings.json');
  assert.equal(reloaded.stage.review.rounds[0].items[0].severity, 'high');
  cleanup();
});

test('review-verdict-two-sided: a citation naming a file that does not exist refuses the whole review', () => {
  const { dir, run, cleanup } = freshRun();
  const step = writeGood(dir, run, 'investigate');
  writeReview(dir, step, { findings: [high('nowhere/nope.js:12', 'this file is invented.')] });
  assert.throws(() => registerReview(dir, run, step), /does not resolve/);
  assert.ok(!existsSync(verdictPath(dir, step, 1)), 'a refused review must write no verdict');
  cleanup();
});

test('review-verdict-two-sided: a citation naming a heading the artifact lacks refuses', () => {
  const { dir, run, cleanup } = freshRun();
  const step = writeGood(dir, run, 'investigate');
  writeReview(dir, step, { findings: [high('investigate.md § Imaginary Section', 'cited into thin air.')] });
  assert.throws(() => registerReview(dir, run, step), /does not resolve/);
  cleanup();
});

test('review-verdict-two-sided: a finding with no citation, no severity or no text refuses — and a review that is not JSON refuses', () => {
  const { dir, run, cleanup } = freshRun();
  const step = writeGood(dir, run, 'investigate');
  writeReview(dir, step, { findings: [{ severity: 'high', text: 'the root cause seems shaky to me' }] });
  assert.throws(() => registerReview(dir, run, step), /cite is missing/);
  writeReview(dir, step, { findings: [{ severity: 'blocking', cite: 'investigate.md § Root cause', text: 'x' }] });
  assert.throws(() => registerReview(dir, run, step), /severity must be one of/);
  writeFileSync(reviewPath(dir, step, 1), '## Findings\n\n- [high] investigate.md § Root cause — the old grammar\n');
  assert.throws(() => registerReview(dir, run, step), /not valid JSON/);
  cleanup();
});

test('review-verdict-two-sided: a citation wrapped in backticks is a citation — punctuation never refuses a review', () => {
  // Opus reviewers wrapped the citation in backticks in 2 of 24 real rounds,
  // and the one-line grammar refused the whole review each time.
  const { dir, run, cleanup } = freshRun();
  const step = writeGood(dir, run, 'investigate');
  writeReview(dir, step, { findings: [note('`investigate.md § Root cause`', 'stated, not traced.')] });
  assert.equal(registerReview(dir, run, step).findings.medium, 1);
  cleanup();
});

test('review-verdict-two-sided: a review missing its notExamined list refuses', () => {
  const { dir, run, cleanup } = freshRun();
  const step = writeGood(dir, run, 'investigate');
  writeFileSync(reviewPath(dir, step, 1), JSON.stringify({ findings: [], verdict: 'pass' }));
  assert.throws(() => registerReview(dir, run, step), /no `notExamined` list/);
  cleanup();
});

test('review-verdict-two-sided: a declared pass over a high finding refuses — the severities decide', () => {
  const { dir, run, cleanup } = freshRun();
  const step = writeGood(dir, run, 'investigate');
  writeReview(dir, step, { findings: [high('investigate.md § Unknowns', 'a guess is presented as a finding.')], verdict: 'pass' });
  assert.throws(() => registerReview(dir, run, step), /declares pass but its own findings derive blocked/);
  cleanup();
});

test('review-verdict-two-sided: zero findings with an empty notExamined refuses — clean must not mean unreviewed', () => {
  const { dir, run, cleanup } = freshRun();
  const step = writeGood(dir, run, 'investigate');
  writeReview(dir, step, { findings: [], notExamined: [] });
  assert.throws(() => registerReview(dir, run, step), /notExamined/);
  writeReview(dir, step, { findings: [], notExamined: ['the config loading path — out of scope for this issue'] });
  assert.equal(registerReview(dir, run, step).verdict, 'pass');
  cleanup();
});

test('review-verdict-two-sided: a path:line citation into the repo resolves; a line past EOF does not', () => {
  const repoPath = gitRepo();
  const { dir, run, cleanup } = freshRun({ repoPath });
  const step = writeGood(dir, run, 'investigate');
  writeReview(dir, step, { findings: [note('widget.js:2', 'the getter never invalidates.')] });
  assert.equal(registerReview(dir, run, step).findings.medium, 1);
  writeReview(dir, step, { findings: [note('widget.js:9999', 'cited past the end of the file.')] });
  assert.throws(() => registerReview(dir, run, step), /cited line 9999/);
  cleanup();
  rmSync(repoPath, { recursive: true, force: true });
});

test('review-verdict-two-sided: only the plan is red-teamed on disk — a review of implement is refused', () => {
  const { dir, run, cleanup } = freshRun();
  approvePlan(dir, run);
  const step = writeGood(dir, run, 'implement');
  assert.equal(reviewable(step), false);
  writeReview(dir, step, { findings: [] });
  assert.throws(() => registerReview(dir, run, step), /code is reviewed on its pull request/);
  cleanup();
});

test('parseFindings tolerates a notExamined string and lower-cases the verdict, and nothing else', () => {
  const ok = parseFindings(JSON.stringify({ findings: [], notExamined: 'the whole config path', verdict: 'PASS' }));
  assert.deepEqual(ok, { findings: [], notExamined: ['the whole config path'], verdict: 'pass' });
  assert.match(parseFindings('[]').error, /must be a JSON object/);
  assert.match(parseFindings('{}').error, /no `findings` array/);
  assert.match(parseFindings(JSON.stringify({ findings: [], notExamined: ['x'], verdict: 'meh' })).error, /"pass" or "blocked"/);
});

// ---------------------------------------------------------------------------
// auto-accept-trap — the mirror of the unapproved-stage trap. The pass path
// approves; every other shape must refuse and leave the stage unapproved.
// ---------------------------------------------------------------------------

/** An auto run with the plan delivered and, optionally, reviewed. */
function autoRun({ auto = true, repoPath = '/nowhere' } = {}) {
  const ctx = freshRun({ auto, repoPath });
  const step = writeGood(ctx.dir, ctx.run, 'investigate');
  return { ...ctx, step };
}

test('auto-accept-trap: --auto on a run that was not started auto refuses', () => {
  const { dir, run, step, cleanup } = autoRun({ auto: false });
  redTeamPass(dir, run, step);
  assert.throws(() => accept(dir, run, step, { auto: true }), /not started with --auto/);
  assert.notEqual(step.stage.state, 'approved', 'the refusal must not approve');
  cleanup();
});

test('auto-accept-trap: no registered review refuses on both paths — the plan is attacked before anyone approves it', () => {
  const { dir, run, step, cleanup } = autoRun();
  assert.throws(() => accept(dir, run, step, { auto: true }), /no red-team review is registered/);
  assert.throws(() => accept(dir, run, step), /no red-team review is registered/);
  assert.notEqual(step.stage.state, 'approved');
  cleanup();
});

test('auto-accept-trap: a blocked round refuses the auto path — and the human path may still approve over it', () => {
  const { dir, run, step, cleanup } = autoRun();
  redTeamBlock(dir, run, step);
  assert.throws(() => accept(dir, run, step, { auto: true }), /round 1 is blocked/);
  assert.notEqual(step.stage.state, 'approved');
  // The human stop exists exactly so a person can overrule the red team, having read it.
  accept(dir, run, step);
  assert.equal(step.stage.state, 'approved');
  assert.notEqual(step.stage.autoApproved, true);
  cleanup();
});

test('auto-accept-trap: an artifact edited after its review refuses — the verdict binds to bytes', () => {
  const { dir, run, step, cleanup } = autoRun();
  redTeamPass(dir, run, step);
  const declared = STAGES.find((s) => s.id === 'investigate');
  writeFileSync(artifactPath(dir, step), declared.requires.map((r) => `## ${r}\n\nrewritten after the review\n`).join('\n'));
  assert.throws(() => accept(dir, run, step, { auto: true }), /artifact changed after round 1/);
  assert.notEqual(step.stage.state, 'approved');
  cleanup();
});

test('auto-accept-trap: the pass path approves and records who approved', () => {
  const { dir, run, step, cleanup } = autoRun();
  redTeamPass(dir, run, step);
  accept(dir, run, step, { auto: true });
  assert.equal(step.stage.state, 'approved');
  assert.equal(step.stage.autoApproved, true);
  cleanup();
});

test('auto-accept-trap: an implement stage needs no on-disk review — its review happens on the pull request', () => {
  const { dir, run, cleanup } = autoRun();
  approvePlan(dir, run, { auto: true });
  const step = writeGood(dir, run, 'implement');
  writeFileSync(join(dir, 'root', 'test-output.txt'), '# pass 0\n# fail 1\n\n# pass 3\n# fail 0\n');
  accept(dir, run, step, { auto: true });
  assert.equal(step.stage.state, 'approved');
  assert.equal(step.stage.autoApproved, true);
  cleanup();
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
  for (let round = 1; round <= MAX_ROUNDS; round += 1) redTeamBlock(ctx.dir, ctx.run, ctx.step, `still wrong in round ${round}.`);
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
  redTeamBlock(dir, run, step, 'evidence never reproduces.');
  const r = cli(['brief', '--stage', 'investigate', '--run-dir', dir, '--offline']);
  assert.equal(r.code, 0, r.err);
  const brief = readFileSync(join(dir, 'briefs', 'investigate.md'), 'utf8');
  assert.match(brief, /## Review feedback — round 2/);
  assert.match(brief, /evidence never reproduces/);
  assert.match(brief, /investigate-r1\.findings\.json/, 'the re-brief must point at the full review');
  cleanup();
});

// ---------------------------------------------------------------------------
// conditional rendering — a run the red team has not yet touched renders
// without review tables, in the brief and the checkpoint comment.
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

test('conditional-comment: no rounds renders no round table; a registered round renders one', () => {
  const { dir, run, step, cleanup } = autoRun();
  const before = renderComment(dir, run);
  assert.doesNotMatch(before, /Blocking found/);
  redTeamBlock(dir, run, step, 'wrong.');
  const after = renderComment(dir, run);
  assert.match(after, /\| Step \| Rounds \| Blocking found \| Notes \|/);
  assert.match(after, /\| investigate \| 1 \| 1 \| 0 \|/);
  cleanup();
});

// ---------------------------------------------------------------------------
// the review brief — same contract as a stage brief: cold start, citations
// spelled out, completion message addressed to main.
// ---------------------------------------------------------------------------

test('review-brief: carries the artifact under attack, the JSON shape, the severity split and the completion contract', () => {
  const { dir, run, cleanup } = freshRun();
  const step = writeGood(dir, run, 'investigate');
  const text = renderReviewBrief(dir, run, step, ISSUE, 1);
  assert.match(text, /red-team/);
  assert.ok(text.includes(artifactPath(dir, step)), 'the brief must name the artifact under review');
  assert.match(text, /"severity": "critical\|high\|medium\|low"/);
  assert.match(text, /"notExamined"/);
  assert.match(text, /critical and high block the stage; medium and low are notes/);
  assert.match(text, /investigate-r1\.findings\.json/);
  assert.match(text, /`SendMessage`/);
  assert.match(text, /addressed to `main`/);
  assert.match(text, /the issue has no body|the cache is stale/);
  assert.match(text, /Round 1 of at most 3/);
  cleanup();
});

test('review-brief: the reviewer hunts the plan, not only the investigation — files, proof, rejected alternative, work items', () => {
  const { dir, run, cleanup } = freshRun();
  const step = writeGood(dir, run, 'investigate');
  const text = renderReviewBrief(dir, run, step, ISSUE, 1);
  assert.match(text, /Files section misses/);
  assert.match(text, /Proof maps to the behaviour the issue reports/);
  assert.match(text, /Rejected alternative is real/);
  assert.match(text, /Work items/);
  cleanup();
});

test('review-brief: writeReviewBrief dispatches on opus — the model is not a suggestion — and implement has no reviewer', () => {
  const { dir, run, cleanup } = freshRun();
  const step = writeGood(dir, run, 'investigate');
  const info = writeReviewBrief(dir, run, step, ISSUE, 1);
  assert.equal(info.model, 'opus');
  assert.equal(info.agent, 'general-purpose');
  assert.deepEqual(REVIEWS.map((r) => r.id), ['investigate']);
  approvePlan(dir, run);
  assert.throws(() => renderReviewBrief(dir, run, writeGood(dir, run, 'implement'), ISSUE, 1), /no red-team reviewer/);
  cleanup();
});

// The constants the choreography quotes.
test('review contract constants: blocking severities and the cap are what SKILL.md promises', () => {
  assert.deepEqual(BLOCKING, ['critical', 'high']);
  assert.equal(MAX_ROUNDS, 3);
});

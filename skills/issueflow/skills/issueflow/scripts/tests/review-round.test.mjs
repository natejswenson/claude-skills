/**
 * The review-loop golden: two REAL rounds of the first real pull request
 * review loop (natejswenson/local-fitness#236, the perf lane of #232), frozen
 * by `evals/freeze-round.mjs` and re-registered here from scratch.
 *
 * A throwaway git repository is rebuilt whose two commits carry exactly the
 * files each round could look at, at that round's head. The real finders'
 * candidates and the real verifiers' verdicts are dropped in, the registrar
 * runs for real — hunk classification against the real diff, citations
 * against the rebuilt trees, ids, transitions, the convergence rules — and
 * its record and the review payload it would post are byte-compared with
 * what the live run produced, heads normalised. Round 2 carries the round-1
 * fix report, so a real `fixed` transition and real resolves are pinned, not
 * a synthetic one.
 *
 * Anti-vacuity floors: two rounds, at least three majors in round 1, at
 * least eight findings fixed in round 2, and a review payload with inline
 * threads. A fixture refresh that collapsed to an empty round cannot pass.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRun, saveRun } from '../lib/run.mjs';
import {
  applyFixReport, buildPayload, candidatesPath, fixReportPath, headOf, openRound, planVerification, readCandidates,
  registerRound, registeredPath, payloadPath, verdictsPath,
} from '../lib/prreview.mjs';
import { approveImplement, approvePlan } from './helpers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, '..', '..', 'evals', 'inputs', 'review-round');
const REFRESH = 'node evals/freeze-round.mjs --run-dir <run> --lane <slug> --rounds 1,2';

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const meta = JSON.parse(readFileSync(join(FIX, 'meta.json'), 'utf8'));

/** Copy a snapshot tree over a repo and commit it. */
function commitSnapshot(repo, round, message) {
  const snap = join(FIX, 'files', `r${round}`);
  cpSync(snap, repo, { recursive: true });
  git(['add', '-A'], repo);
  git(['commit', '-q', '--allow-empty', '-m', message], repo);
  return headOf(repo);
}

/** Heads differ per rebuild; everything else must not. */
function normalize(text, map) {
  let out = text;
  for (const [from, to] of map) out = out.split(from).join(to);
  return out;
}

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

function rebuild() {
  const repo = mkdtempSync(join(tmpdir(), 'issueflow-round-repo-'));
  git(['init', '-q', '-b', meta.base], repo);
  git(['config', 'user.email', 'test@example.invalid'], repo);
  git(['config', 'user.name', 'test'], repo);
  writeFileSync(join(repo, '.keep'), '');
  git(['add', '.keep'], repo);
  git(['commit', '-qm', 'base'], repo);
  git(['checkout', '-q', '-b', meta.branch], repo);

  const dir = mkdtempSync(join(tmpdir(), 'issueflow-round-'));
  const [owner, rest] = meta.source.split('/');
  const name = rest.split('#')[0];
  const issue = { number: Number(rest.split('#')[1]), title: 'frozen', url: `https://github.com/${meta.source.replace('#', '/issues/')}` };
  const run = createRun({
    repo: { owner, name, path: repo, defaultBranch: meta.base },
    issue, policy: { base: meta.base, featurePrefix: 'feature/', mergeMethod: 'squash', source: 'test', shipflow: false },
    offline: true, auto: true,
  });
  run.lanes[0].slug = meta.lane; run.lanes[0].id = meta.lane; run.lanes[0].branch = meta.branch;
  saveRun(dir, run);
  mkdirSync(join(dir, 'inputs'), { recursive: true });
  writeFileSync(join(dir, 'inputs', 'issue.json'), `${JSON.stringify(issue)}\n`);
  approvePlan(dir, run, { auto: true });
  approveImplement(dir, run, meta.lane, { auto: true });
  const lane = run.lanes[0];
  lane.pr = { number: meta.pr, url: `https://github.com/${owner}/${name}/pull/${meta.pr}`, title: 'frozen', nodeId: 'PR_frozen' };
  saveRun(dir, run);
  return { repo, dir, run, lane, cleanup: () => { rmSync(repo, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true }); } };
}

/** Drive one frozen round through the real registrar; returns the produced record and payload, normalised. */
function replayRound(ctx, n, heads) {
  const { repo, dir, run, lane } = ctx;
  const frozenDir = join(FIX, `r${n}`);
  const head = commitSnapshot(repo, n, `round ${n} head`);
  heads.set(meta.rounds.find((r) => r.round === n).head, head);
  openRound(dir, run, lane, { head, diffText: readFileSync(join(frozenDir, 'diff.patch'), 'utf8') });
  const entry = lane.review.rounds.at(-1);
  assert.equal(entry.finders, meta.rounds.find((r) => r.round === n).finders, `round ${n} fleet size drifted — run \`${REFRESH}\``);
  for (let i = 1; i <= entry.finders; i += 1) cpSync(join(frozenDir, `candidates-${i}.json`), candidatesPath(dir, lane, n, i));
  // The candidates files are read (the registrar needs their notExamined), but
  // the pooling is the live round's, replayed from plan.json: the golden pins
  // the registrar, and the pooling rule may move on its own tests.
  readCandidates(dir, lane, n);
  const plan = readJson(join(frozenDir, 'plan.json'));
  const { prior, auto } = planVerification(dir, run, lane, n, [], { tree: repo });
  assert.deepEqual([...prior.map((p) => p.id), ...auto].sort(), [...plan.priorIds].sort(), `round ${n}: the prior open findings differ from the live round's — ids must be assigned once`);
  // The live rounds predate the unchanged-file rule: every prior finding was
  // sent to a verifier and every verifier ruled. Replay the live plan exactly.
  Object.assign(entry, { verifiers: plan.verifiers, candidateIds: plan.candidateIds, priorIds: plan.priorIds, autoStillOpen: [], candidates: plan.candidates });
  saveRun(dir, run);
  for (let i = 1; i <= plan.verifiers; i += 1) cpSync(join(frozenDir, `verdicts-${i}.json`), verdictsPath(dir, lane, n, i));
  const record = registerRound(dir, run, lane, n, { tree: repo });
  buildPayload(dir, lane, n, record);
  // Heads: the replay's shas become the live ones. Thread ids: the live
  // GitHub ids become the replay's stand-ins (applied to the expected side).
  const headMap = [...heads.entries()].filter(([k]) => /^[0-9a-f]{40}$/.test(k)).flatMap(([real, mine]) => [[mine, real], [mine.slice(0, 12), real.slice(0, 12)]]);
  const threadMap = [...heads.entries()].filter(([k]) => !/^[0-9a-f]{40}$/.test(k));
  return {
    record: normalize(readFileSync(registeredPath(dir, lane, n), 'utf8'), headMap),
    payload: normalize(readFileSync(payloadPath(dir, lane, n), 'utf8'), headMap),
    expectedPayload: normalize(readFileSync(join(frozenDir, 'review-payload.json'), 'utf8'), threadMap),
  };
}

test('review-round-golden: the frozen rounds are real — two rounds, majors, a fix report, inline threads', () => {
  assert.ok(existsSync(join(FIX, 'meta.json')), `no review round frozen — run \`${REFRESH}\``);
  assert.ok(meta.rounds.length >= 2, `${meta.rounds.length} round(s) frozen — the golden needs a fix and a re-review`);
  const r1 = readJson(join(FIX, 'r1', 'registered.json'));
  assert.ok(r1.counts.majors >= 3, `round 1 froze ${r1.counts.majors} majors — a round over nothing proves nothing`);
  assert.ok(r1.findings.length >= 10, `round 1 froze ${r1.findings.length} findings`);
  assert.ok(existsSync(join(FIX, 'r1', 'fix-report.json')), 'round 1 has no fix report — nothing for round 2 to resolve');
  const r2 = readJson(join(FIX, 'r2', 'registered.json'));
  assert.ok(r2.transitions.fixed.length >= 8, `round 2 froze ${r2.transitions.fixed.length} fixed transitions`);
  assert.ok(r2.transitions.suppressed.length >= 5, 'round 2 suppressed no new nits — the round-1 rule is not exercised');
  const p1 = readJson(join(FIX, 'r1', 'review-payload.json'));
  assert.ok(p1.threads.length >= 8, `round 1 payload has ${p1.threads.length} threads`);
  assert.equal(p1.event, 'COMMENT');
  for (const n of [1, 2]) assert.ok(readdirSync(join(FIX, 'files', `r${n}`)).length >= 3, `round ${n} snapshot is nearly empty`);
});

test('review-round-golden: no frozen file carries a machine path outside the repository\'s own content', () => {
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
  for (const f of walk(FIX)) {
    if (/\/files\/r\d+\//.test(f)) continue; // the target repo's own files, verbatim, public
    assert.doesNotMatch(readFileSync(f, 'utf8'), /\/(Users|home)\/[a-z]/i, `${f.replace(FIX, '')} carries a local path — the registrar must make finding text repository-relative`);
  }
});

test('review-round-golden: re-registering the frozen rounds reproduces the record and the payload byte for byte, heads aside', () => {
  const ctx = rebuild();
  const heads = new Map();
  try {
    const one = replayRound(ctx, 1, heads);
    assert.equal(one.record, readFileSync(join(FIX, 'r1', 'registered.json'), 'utf8'), `round 1 record drifted — if deliberate, run \`${REFRESH}\``);
    assert.equal(one.payload, one.expectedPayload, `round 1 payload drifted — if deliberate, run \`${REFRESH}\``);

    // The live round posted a thread per inline finding and GitHub handed back
    // a thread id each; round 2's replies and resolves address those ids. The
    // replay posts nothing, so it stands in `PRRT_<finding id>` for exactly the
    // findings the live round posted, and the live ids are mapped to the same
    // stand-ins before comparing — which pins WHICH findings were replied to
    // and resolved, and with what text, without a network.
    const liveThreads = readJson(join(FIX, 'r1', 'review-payload.json')).threads.map((t) => t.id);
    for (const f of ctx.lane.review.findings) if (liveThreads.includes(f.id)) { f.threadId = `PRRT_${f.id}`; f.posted = true; }
    for (const r of readJson(join(FIX, 'r2', 'review-payload.json')).replies) heads.set(r.threadId, `PRRT_${r.id}`);

    // The real fix report between the rounds: disputes and replies come from it.
    cpSync(join(FIX, 'r1', 'fix-report.json'), fixReportPath(ctx.dir, ctx.lane, 1));
    const replies = applyFixReport(ctx.dir, ctx.run, ctx.lane, 1);
    assert.ok(replies.length >= 5, 'the round-1 fix report addressed fewer than five findings');

    const two = replayRound(ctx, 2, heads);
    assert.equal(two.record, readFileSync(join(FIX, 'r2', 'registered.json'), 'utf8'), `round 2 record drifted — if deliberate, run \`${REFRESH}\``);
    assert.equal(two.payload, two.expectedPayload, `round 2 payload drifted — if deliberate, run \`${REFRESH}\``);
    const owed = JSON.parse(two.payload).replies;
    assert.ok(owed.filter((r) => r.resolve).length >= 8, `round 2 resolved ${owed.filter((r) => r.resolve).length} threads — the fixed transitions must reach the pull request`);
    assert.ok(owed.some((r) => !r.resolve && /still open/i.test(r.body)), 'a still-open finding must be replied to, not resolved');

    const r2 = JSON.parse(two.record);
    const fixedIds = new Set(r2.transitions.fixed);
    const r1 = readJson(join(FIX, 'r1', 'registered.json'));
    assert.ok([...fixedIds].every((id) => r1.findings.some((f) => f.id === id)), 'a round-2 fixed transition names an id round 1 never registered — ids must be assigned once');
    assert.ok(r2.findings.filter((f) => f.status === 'open' && f.severity === 'major').length >= 1, 'round 2 left no major open; the frozen loop had not converged');
  } finally {
    ctx.cleanup();
  }
});

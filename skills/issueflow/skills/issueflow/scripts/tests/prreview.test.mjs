/**
 * The pull request review loop, two-sided, over a real git repository.
 *
 * Every rule the registrar enforces is paired with the shape it refuses: a
 * finding on a context line posts inline beside one outside every hunk that
 * does not; a nit in round 1 posts beside a nit in round 2 that is suppressed;
 * a moved line stays open beside a guarded one that is fixed; a plausible
 * major on untouched code becomes a note beside a confirmed one that stays a
 * major. The posting tests drive a stubbed `gh` that answers GraphQL from a
 * table, and the stub is the assertion: one pending review per round, one
 * thread per finding, a refused anchor costing one thread and not the round.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HandBack, createRun, saveRun } from '../lib/run.mjs';
import {
  CLEANUP_ANGLES, CORE_ANGLES, MAX_REVIEW_ROUNDS, NIT_CAP, applyFixReport, batchItems, buildPayload, candidatesPath,
  changedLines, converge, currentRound, dedupCandidates, findingId, fixItems, fixerModel, fleetPlan, headOf,
  inlineEligible, laneDiff, openFindings, openMajors, openRound, parseDiff, payloadPath, planVerification, postRound,
  readCandidates, registerRound, registeredPath, reviewBody, reviewExhausted, ruleFinding, threadBody, touched, validateCandidates,
  validateVerdicts, verdictsPath, fixReportPath,
} from '../lib/prreview.mjs';
import { renderFinderBrief, renderFixBrief, renderVerifierBrief, methodSection } from '../lib/reviewbrief.mjs';
import { approveImplement, approvePlan } from './helpers.mjs';

const ISSUE = { number: 5, title: 'Cache returns stale values', url: 'https://example.invalid/5', body: 'stale' };
const POLICY = { base: 'dev', featurePrefix: 'feature/', mergeMethod: 'squash', source: 'test', shipflow: true };

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const WIDGET_V1 = [
  'export const cache = new Map();',
  '',
  'export function get(key) {',
  '  if (!cache.has(key)) return undefined;',
  '  return cache.get(key);',
  '}',
  '',
  'export function set(key, value) {',
  '  cache.set(key, value);',
  '}',
  '',
  'export function size() {',
  '  return cache.size;',
  '}',
  '',
].join('\n');

const WIDGET_V2 = WIDGET_V1
  .replace('  if (!cache.has(key)) return undefined;\n', '') // the removed guard
  .replace('  cache.set(key, value);\n', '  cache.set(key, value);\n  if (cache.size > 100) cache.clear();\n');

/** A repo on `dev` with widget.js, and a lane branch that removed a guard and added an eviction. */
function repoWithLane() {
  const path = mkdtempSync(join(tmpdir(), 'issueflow-prreview-repo-'));
  git(['init', '-q', '-b', 'dev'], path);
  git(['config', 'user.email', 'test@example.invalid'], path);
  git(['config', 'user.name', 'test'], path);
  writeFileSync(join(path, 'widget.js'), WIDGET_V1);
  writeFileSync(join(path, 'README.md'), '# widgets\n');
  git(['add', 'widget.js', 'README.md'], path);
  git(['commit', '-qm', 'seed'], path);
  git(['checkout', '-q', '-b', 'feature/issue-5'], path);
  writeFileSync(join(path, 'widget.js'), WIDGET_V2);
  git(['commit', '-qam', 'drop the has() guard, add eviction'], path);
  return path;
}

function fixture({ auto = true } = {}) {
  const repoPath = repoWithLane();
  const dir = mkdtempSync(join(tmpdir(), 'issueflow-prreview-'));
  const run = createRun({ repo: { owner: 'acme', name: 'widgets', path: repoPath, defaultBranch: 'dev' }, issue: ISSUE, policy: POLICY, offline: true, auto });
  saveRun(dir, run);
  mkdirSync(join(dir, 'inputs'), { recursive: true });
  writeFileSync(join(dir, 'inputs', 'issue.json'), `${JSON.stringify(ISSUE, null, 2)}\n`);
  approvePlan(dir, run, { auto });
  // implement approved against the repo itself (no worktree): the evidence is what accept reads
  approveImplement(dir, run, null, { auto });
  const lane = run.lanes[0];
  lane.pr = { number: 42, url: 'https://example.invalid/pull/42', title: ISSUE.title, nodeId: 'PR_node' };
  lane.review.draft = true;
  saveRun(dir, run);
  return { dir, run, lane, repoPath, cleanup: () => { rmSync(dir, { recursive: true, force: true }); rmSync(repoPath, { recursive: true, force: true }); } };
}

const cand = (over) => ({
  file: 'widget.js', line: 4, side: 'RIGHT', category: 'line-by-line',
  summary: 'get() now returns whatever Map.get returns for a missing key, which is undefined either way but no longer guards a falsy stored value',
  short_summary: 'get() lost its has() guard', failure_scenario: 'set(k, 0) then get(k) — the caller cannot tell 0 from missing', introduced_by_diff: true, ...over,
});

function writeCandidates(dir, lane, round, n, candidates, notExamined = ['the README']) {
  mkdirSync(join(dir, lane.slug, 'review', `r${round}`), { recursive: true });
  writeFileSync(candidatesPath(dir, lane, round, n), JSON.stringify({ candidates, notExamined }));
}

function writeVerdicts(dir, lane, round, n, verdicts) {
  writeFileSync(verdictsPath(dir, lane, round, n), JSON.stringify({ verdicts }));
}

/** Distribute verdicts across the round's verifier batches, one file per batch — the shape N verifiers produce. */
function writeAllVerdicts(dir, lane, round, batches, verdicts) {
  batches.forEach((items, i) => {
    const ids = new Set(items.map((it) => it.id));
    writeVerdicts(dir, lane, round, i + 1, verdicts.filter((v) => ids.has(v.id)));
  });
}

/** Open a round over the lane's real diff, offline (no remote head to compare). */
function open(dir, run, lane, repoPath) {
  const head = headOf(repoPath);
  return openRound(dir, run, lane, { head, diffText: laneDiff(repoPath, lane.base) });
}

// ---------------------------------------------------------------------------
// Reading the diff.
// ---------------------------------------------------------------------------

test('parseDiff: hunks carry context lines, and inline eligibility follows them — not just the changed lines', () => {
  const repoPath = repoWithLane();
  const files = parseDiff(laneDiff(repoPath, 'dev'));
  assert.equal(files.length, 1);
  assert.equal(files[0].path, 'widget.js');
  assert.equal(changedLines(files), 2, 'one line removed, one added');
  // line 3 (`export function get`) is a context line of the first hunk — inline-eligible
  assert.equal(inlineEligible(files, 'widget.js', 3, 'RIGHT'), true);
  // the removed guard is old line 4, LEFT side
  assert.equal(inlineEligible(files, 'widget.js', 4, 'LEFT'), true);
  // line 13 (`return cache.size`) is far from every hunk
  assert.equal(inlineEligible(files, 'widget.js', 13, 'RIGHT'), false);
  assert.equal(inlineEligible(files, 'README.md', 1, 'RIGHT'), false, 'a file not in the diff is never inline');
  // the added eviction line is touched; the context line above it is not
  const added = [...files[0].newLines][0];
  assert.equal(touched(files, 'widget.js', added), true);
  assert.equal(touched(files, 'widget.js', 3), false);
  rmSync(repoPath, { recursive: true, force: true });
});

test('fleetPlan: sized to the diff, cleanup angles in round 1 only, a small diff gets one finder', () => {
  assert.deepEqual(fleetPlan(20, 1), { finders: 1, maxVerifiers: 2, angles: [[...CORE_ANGLES, ...CLEANUP_ANGLES]] });
  assert.equal(fleetPlan(300, 1).finders, 2);
  assert.equal(fleetPlan(2000, 1).finders, 5, 'five is the cap');
  const r2 = fleetPlan(300, 2);
  assert.ok(r2.angles.flat().every((a) => CORE_ANGLES.includes(a)), 'no cleanup angle after round 1');
  assert.deepEqual([...new Set(fleetPlan(600, 1).angles.flat())].sort(), [...CORE_ANGLES, ...CLEANUP_ANGLES].sort(), 'every angle is dealt to someone');
  assert.equal(batchItems(Array.from({ length: 30 }, (_, i) => i), { per: 3, maxBatches: 8 }).length, 8, 'batches grow rather than exceed the verifier cap');
});

test('validateCandidates and validateVerdicts refuse every shape the registrar will not guess about', () => {
  assert.match(validateCandidates('nope', 1).error, /not valid JSON/);
  assert.match(validateCandidates(JSON.stringify({ candidates: [] }), 1).error, /notExamined/);
  assert.match(validateCandidates(JSON.stringify({ candidates: [{ file: 'a', line: 1 }], notExamined: [] }), 1).error, /category/);
  assert.match(validateCandidates(JSON.stringify({ candidates: [cand({ short_summary: 'x'.repeat(81) })], notExamined: [] }), 1).error, /80 characters/);
  assert.equal(validateCandidates(JSON.stringify({ candidates: [cand({ short_summary: 'x'.repeat(64) })], notExamined: ['y'] }), 1).candidates.length, 1, 'a 64-character summary is over the target, not over the cap');
  assert.match(validateCandidates(JSON.stringify({ candidates: [cand({ failure_scenario: '' })], notExamined: [] }), 1).error, /failure_scenario/);
  const ok = validateCandidates(JSON.stringify({ candidates: [cand()], notExamined: ['x'] }), 2);
  assert.equal(ok.candidates[0].id, 'c-2-1');

  const expected = new Set(['c-1-1', 'f-abcd1234']);
  assert.match(validateVerdicts(JSON.stringify({ verdicts: [{ id: 'c-9-9', verdict: 'CONFIRMED', quote: 'x' }] }), expected).error, /nobody filed/);
  assert.match(validateVerdicts(JSON.stringify({ verdicts: [{ id: 'c-1-1', verdict: 'fixed', quote: 'x' }] }), expected).error, /CONFIRMED\|PLAUSIBLE\|REFUTED/);
  assert.match(validateVerdicts(JSON.stringify({ verdicts: [{ id: 'f-abcd1234', verdict: 'CONFIRMED', quote: 'x' }] }), expected).error, /fixed\|still-open\|withdrawn/);
  assert.match(validateVerdicts(JSON.stringify({ verdicts: [{ id: 'c-1-1', verdict: 'CONFIRMED', severity: 'major' }] }), expected).error, /quote/);
  assert.match(validateVerdicts(JSON.stringify({ verdicts: [{ id: 'c-1-1', verdict: 'CONFIRMED', quote: 'x' }] }), expected).error, /severity/);
  assert.ok(validateVerdicts(JSON.stringify({ verdicts: [{ id: 'c-1-1', verdict: 'REFUTED', quote: 'x' }] }), expected).verdicts.has('c-1-1'), 'a refutation needs no severity');
});

test('dedupCandidates keeps the most concrete of two candidates on the same mechanism, and folds same-line candidates across angles', () => {
  const a = { ...cand(), id: 'c-1-1', failure_scenario: 'short' };
  const b = { ...cand({ line: 5 }), id: 'c-2-1', failure_scenario: 'a much longer, more concrete failure scenario naming inputs' };
  const c = { ...cand({ category: 'cross-file' }), id: 'c-2-2', failure_scenario: 'x' }; // same line 4 as `a`, different angle
  const d = { ...cand({ line: 9, category: 'cross-file' }), id: 'c-3-1' };          // a different line: kept
  const kept = dedupCandidates([a, b, c, d]);
  assert.deepEqual(kept.map((k) => k.id), ['c-2-1', 'c-3-1']);
  assert.deepEqual(kept[0].mergedFrom.sort(), ['c-1-1', 'c-2-2'], 'three finders on one line is one finding');
});

// ---------------------------------------------------------------------------
// A round, end to end, over the real repo.
// ---------------------------------------------------------------------------

test('round 1: a confirmed major on a context line posts inline; a nit posts; a finding outside every hunk is body-only but keeps its severity', () => {
  const { dir, run, lane, repoPath, cleanup } = fixture();
  const { round, plan } = open(dir, run, lane, repoPath);
  assert.equal(round, 1);
  assert.equal(plan.finders, 1, 'two changed lines is a small diff');
  writeCandidates(dir, lane, 1, 1, [
    cand(),                                                                                   // context line 3-ish: inline
    cand({ line: 13, category: 'cross-file', short_summary: 'size() unaffected but callers assume no eviction', summary: 'size() callers assume monotonic growth', failure_scenario: 'a caller caches size() and indexes past it after an eviction' }),
    cand({ line: 9, category: 'simplification', short_summary: 'inline the clear() threshold constant', summary: 'the 100 is a magic number', failure_scenario: 'cost: the threshold is duplicated in the test' }),
  ]);
  const { candidates } = readCandidates(dir, lane, 1);
  assert.equal(candidates.length, 3);
  const { batches } = planVerification(dir, run, lane, 1, candidates);
  assert.equal(batches.length, 1);
  writeVerdicts(dir, lane, 1, 1, [
    { id: 'c-1-1', verdict: 'CONFIRMED', severity: 'major', quote: 'return cache.get(key);' },
    { id: 'c-1-2', verdict: 'PLAUSIBLE', severity: 'major', quote: 'return cache.size;' },
    { id: 'c-1-3', verdict: 'CONFIRMED', severity: 'major', quote: 'if (cache.size > 100) cache.clear();' }, // a cleanup angle cannot be a major
  ]);
  const record = registerRound(dir, run, lane, 1, { tree: repoPath });
  assert.equal(record.verdict, 'open');
  assert.equal(record.counts.majors, 2);
  const [guard, size, magic] = record.findings;
  assert.match(guard.id, /^f-[0-9a-f]{8}$/);
  assert.equal(guard.inline, true, 'a finding on a context line of a hunk posts inline');
  assert.equal(size.inline, false, 'line 13 is outside every hunk');
  assert.equal(size.severity, 'major', 'body-only does not demote — an outside-hunk major still blocks');
  assert.equal(magic.severity, 'nit');
  assert.equal(magic.demoted, 'cleanup-angles-are-nits');
  assert.ok(existsSync(registeredPath(dir, lane, 1)));
  assert.doesNotMatch(readFileSync(registeredPath(dir, lane, 1), 'utf8'), /\d{4}-\d{2}-\d{2}T/, 'the record is timestamp-free');

  const payload = buildPayload(dir, lane, 1, record);
  assert.equal(payload.event, 'COMMENT');
  assert.deepEqual(payload.threads.map((t) => t.id), [guard.id, magic.id], 'inline threads for the inline findings only');
  assert.match(payload.body, /^\*\*Blocking: 2 majors open\.\*\* Round 1 · 2 majors open · 1 nit · 0 pre-existing/);
  assert.match(payload.body, /Could not anchor/);
  assert.match(payload.body, new RegExp(size.id));
  assert.match(payload.body, /<!-- issueflow:review root r1 [0-9a-f]{40} -->/);
  assert.match(payload.threads[0].body, new RegExp(`<!-- issueflow:finding ${guard.id} -->`));
  assert.match(payload.threads[0].body, /🔴 \*\*Major\*\*/);
  assert.ok(existsSync(payloadPath(dir, lane, 1)));
  assert.throws(() => converge(dir, run, lane), /2 major\(s\) open/);
  cleanup();
});

test('round 1: the nit cap counts posted nits, and the rest are counted in the body', () => {
  const { dir, run, lane, repoPath, cleanup } = fixture();
  open(dir, run, lane, repoPath);
  const nits = Array.from({ length: NIT_CAP + 2 }, (_, i) => cand({ line: 9, category: 'reuse', short_summary: `nit number ${i}`, summary: `nit ${i}`, failure_scenario: `cost ${i}` }));
  writeCandidates(dir, lane, 1, 1, nits.map((n, i) => ({ ...n, line: 8 + (i % 2), category: i % 2 ? 'reuse' : 'efficiency', short_summary: `distinct nit ${i}` })));
  const { candidates } = readCandidates(dir, lane, 1);
  planVerification(dir, run, lane, 1, candidates);
  writeVerdicts(dir, lane, 1, 1, candidates.map((c) => ({ id: c.id, verdict: 'CONFIRMED', severity: 'nit', quote: 'cache.set(key, value);' })));
  const record = registerRound(dir, run, lane, 1, { tree: repoPath });
  assert.equal(record.verdict, 'converged', 'nits never block');
  const posted = record.findings.filter((f) => !f.suppressed);
  assert.ok(posted.length <= NIT_CAP, `posted ${posted.length} nits over the cap of ${NIT_CAP}`);
  const body = reviewBody(lane, 1, record);
  if (record.findings.length > NIT_CAP) assert.match(body, /more nits? not posted inline/);
  assert.match(body, /No majors open — converged/);
  converge(dir, run, lane);
  assert.equal(lane.review.converged, true);
  cleanup();
});

test('round 2: every prior finding needs a verdict; fixed resolves, a moved line stays open, no new nit posts, plausible-on-unchanged is a note', () => {
  const { dir, run, lane, repoPath, cleanup } = fixture();
  open(dir, run, lane, repoPath);
  writeCandidates(dir, lane, 1, 1, [
    cand(),
    cand({ line: 9, category: 'removed-behaviour', short_summary: 'eviction clears the whole cache', summary: 'clear() drops every entry at 101', failure_scenario: 'the 101st set() empties the cache mid-request' }),
  ]);
  planVerification(dir, run, lane, 1, readCandidates(dir, lane, 1).candidates);
  writeVerdicts(dir, lane, 1, 1, [
    { id: 'c-1-1', verdict: 'CONFIRMED', severity: 'major', quote: 'return cache.get(key);' },
    { id: 'c-1-2', verdict: 'CONFIRMED', severity: 'major', quote: 'cache.clear();' },
  ]);
  const r1 = registerRound(dir, run, lane, 1, { tree: repoPath });
  const [guard, evict] = r1.findings;
  assert.equal(fixerModel(lane), 'sonnet', 'every open major is new');
  assert.deepEqual(fixItems(lane).map((f) => f.id), [guard.id, evict.id]);

  // The fix: restore the guard (fixes `guard`), move the eviction two lines down (moves `evict`, does not fix it).
  const fixed = WIDGET_V2
    .replace('export function get(key) {\n', 'export function get(key) {\n  if (!cache.has(key)) return undefined;\n')
    .replace('  cache.set(key, value);\n  if (cache.size > 100) cache.clear();\n', '  cache.set(key, value);\n  // evict when full\n  // (todo: LRU)\n  if (cache.size > 100) cache.clear();\n');
  writeFileSync(join(repoPath, 'widget.js'), fixed);
  git(['commit', '-qam', `review round 1: ${guard.id} ${evict.id}`], repoPath);

  const r2open = open(dir, run, lane, repoPath);
  assert.equal(r2open.round, 2);
  assert.equal(currentRound(lane).prevHead, r1.head);
  writeCandidates(dir, lane, 2, 1, [
    cand({ line: 13, category: 'cross-file', short_summary: 'size() semantics changed silently', summary: 'size() now shrinks', failure_scenario: 'plausible: a consumer indexes by size()' }),
    cand({ line: 12, category: 'line-by-line', short_summary: 'todo comment left in', summary: 'a TODO shipped', failure_scenario: 'cost: an open question in production code' }),
  ]);
  const { candidates } = readCandidates(dir, lane, 2);
  const { batches, prior } = planVerification(dir, run, lane, 2, candidates);
  assert.deepEqual(prior.map((p) => p.id), [guard.id, evict.id], 'both prior findings are mandatory items');
  assert.ok(batches.flat().some((i) => i.prior), 'prior findings ride in the verifier batches');

  // Missing a verdict on a prior finding refuses the whole round.
  const all = [
    { id: guard.id, verdict: 'fixed', quote: 'if (!cache.has(key)) return undefined;' },
    { id: evict.id, verdict: 'still-open', quote: 'if (cache.size > 100) cache.clear();', line: 13 },
    { id: 'c-1-1', verdict: 'PLAUSIBLE', severity: 'major', quote: 'return cache.size;' },   // untouched line → note
    { id: 'c-1-2', verdict: 'CONFIRMED', severity: 'nit', quote: '// (todo: LRU)' },          // new nit after round 1 → suppressed
  ];
  writeAllVerdicts(dir, lane, 2, batches, all.filter((v) => v.id !== evict.id));
  assert.throws(() => registerRound(dir, run, lane, 2, { tree: repoPath }), new RegExp(`no verdict for .*${evict.id}`));

  writeAllVerdicts(dir, lane, 2, batches, all);
  const r2 = registerRound(dir, run, lane, 2, { tree: repoPath });
  assert.deepEqual(r2.transitions.fixed, [guard.id]);
  assert.deepEqual(r2.transitions.stillOpen, [evict.id]);
  const evictNow = lane.review.findings.find((f) => f.id === evict.id);
  assert.equal(evictNow.status, 'open');
  assert.equal(evictNow.line, 13, 'a moved line is tracked, not fixed');
  assert.equal(evictNow.stillOpenRounds, 1);
  assert.equal(fixerModel(lane), 'opus', 'a still-open major escalates the fixer');
  const note = lane.review.findings.find((f) => f.short_summary === 'size() semantics changed silently');
  assert.equal(note.severity, 'nit');
  assert.equal(note.demoted, 'plausible-on-unchanged-lines');
  const todo = lane.review.findings.find((f) => f.short_summary === 'todo comment left in');
  assert.equal(todo.suppressed, 'no-new-nits-after-round-1');
  assert.equal(r2.counts.majors, 1, 'only the moved eviction blocks');
  assert.equal(r2.verdict, 'open');
  const body = reviewBody(lane, 2, r2);
  assert.match(body, /1 fixed · 1 still open · new nits suppressed \(round-1 rule\)/);
  assert.match(body, /\*\*Notes\*\* — plausible, on lines the last fix did not touch/);
  assert.doesNotMatch(body, /todo comment left in/, 'a suppressed nit is not in the table');
  const payload = buildPayload(dir, lane, 2, r2);
  assert.deepEqual(payload.threads, [], 'nothing new posts inline in round 2 here');
  assert.deepEqual(payload.replies.map((r) => [r.id, r.resolve]).filter(([id]) => id === guard.id), [], 'no thread id yet (never posted) means no reply owed');
  cleanup();
});

test('round 2: a prior nit in a file the fix never touched is still open by construction — no verifier item; a prior major always gets one', () => {
  const { dir, run, lane, repoPath, cleanup } = fixture();
  open(dir, run, lane, repoPath);
  writeCandidates(dir, lane, 1, 1, [
    cand(),                                                                                                                     // major, widget.js
    cand({ file: 'README.md', line: 1, category: 'conventions', short_summary: 'README never mentions eviction', summary: 'docs', failure_scenario: 'cost: the README lies' }), // nit, README.md
  ]);
  planVerification(dir, run, lane, 1, readCandidates(dir, lane, 1).candidates);
  writeVerdicts(dir, lane, 1, 1, [
    { id: 'c-1-1', verdict: 'CONFIRMED', severity: 'major', quote: 'return cache.get(key);' },
    { id: 'c-1-2', verdict: 'CONFIRMED', severity: 'nit', quote: '# widgets' },
  ]);
  const r1 = registerRound(dir, run, lane, 1, { tree: repoPath });
  const [major, readme] = r1.findings;
  // the fix touches widget.js only
  writeFileSync(join(repoPath, 'widget.js'), WIDGET_V2.replace('export function get(key) {\n', 'export function get(key) {\n  if (!cache.has(key)) return undefined;\n'));
  git(['commit', '-qam', 'fix'], repoPath);
  open(dir, run, lane, repoPath);
  writeCandidates(dir, lane, 2, 1, []);
  const { prior, auto } = planVerification(dir, run, lane, 2, [], { tree: repoPath });
  assert.deepEqual(prior.map((p) => p.id), [major.id], 'only the major is a verifier item');
  assert.deepEqual(auto, [readme.id], 'the README nit is still open by construction');
  writeVerdicts(dir, lane, 2, 1, [{ id: major.id, verdict: 'fixed', quote: 'if (!cache.has(key)) return undefined;' }]);
  const r2 = registerRound(dir, run, lane, 2, { tree: repoPath });
  assert.deepEqual(r2.transitions.fixed, [major.id]);
  assert.deepEqual(r2.transitions.stillOpen, [readme.id]);
  const nit = lane.review.findings.find((f) => f.id === readme.id);
  assert.equal(nit.status, 'open');
  assert.equal(nit.stillOpenRounds, 1);
  assert.match(nit.history.at(-1).note, /auto: file byte-identical/);
  assert.equal(r2.verdict, 'converged');
  // two-sided: a nit in a file the fix DID touch is re-judged like any other
  git(['commit', '-q', '--allow-empty', '-m', 'noop'], repoPath);
  cleanup();
});

test('round 2: a confirmed major on a line the fix touched stays a major — the oscillation rule is about untouched lines only', () => {
  const { dir, run, lane, repoPath, cleanup } = fixture();
  open(dir, run, lane, repoPath);
  writeCandidates(dir, lane, 1, 1, [cand()]);
  planVerification(dir, run, lane, 1, readCandidates(dir, lane, 1).candidates);
  writeVerdicts(dir, lane, 1, 1, [{ id: 'c-1-1', verdict: 'CONFIRMED', severity: 'major', quote: 'return cache.get(key);' }]);
  const r1 = registerRound(dir, run, lane, 1, { tree: repoPath });
  const guard = r1.findings[0];
  writeFileSync(join(repoPath, 'widget.js'), WIDGET_V2.replace('export function get(key) {\n', 'export function get(key) {\n  if (cache.has(key) === false) return null;\n'));
  git(['commit', '-qam', 'fix'], repoPath);
  open(dir, run, lane, repoPath);
  writeCandidates(dir, lane, 2, 1, [cand({ line: 4, short_summary: 'guard returns null, callers expect undefined', summary: 'null vs undefined', failure_scenario: 'get(k) === undefined checks now fail for missing keys' })]);
  planVerification(dir, run, lane, 2, readCandidates(dir, lane, 2).candidates);
  writeVerdicts(dir, lane, 2, 1, [
    { id: guard.id, verdict: 'fixed', quote: 'if (cache.has(key) === false) return null;' },
    { id: 'c-1-1', verdict: 'PLAUSIBLE', severity: 'major', quote: 'if (cache.has(key) === false) return null;' },
  ]);
  const r2 = registerRound(dir, run, lane, 2, { tree: repoPath });
  const nu = lane.review.findings.find((f) => f.short_summary.startsWith('guard returns null'));
  assert.equal(nu.severity, 'major', 'PLAUSIBLE on a line the fix added is a major');
  assert.equal(nu.demoted, null);
  assert.equal(r2.verdict, 'open');
  cleanup();
});

test('registrar refusals: a citation past EOF, a moved branch, a finder that has not delivered, an already-registered round', () => {
  const { dir, run, lane, repoPath, cleanup } = fixture();
  open(dir, run, lane, repoPath);
  assert.throws(() => readCandidates(dir, lane, 1), /finder 1 of round 1 has not delivered/);
  writeCandidates(dir, lane, 1, 1, [cand({ line: 999 })]);
  planVerification(dir, run, lane, 1, readCandidates(dir, lane, 1).candidates);
  writeVerdicts(dir, lane, 1, 1, [{ id: 'c-1-1', verdict: 'CONFIRMED', severity: 'major', quote: 'x' }]);
  assert.throws(() => registerRound(dir, run, lane, 1, { tree: repoPath }), /widget\.js:999, which does not exist/);
  writeCandidates(dir, lane, 1, 1, [cand()]);
  planVerification(dir, run, lane, 1, readCandidates(dir, lane, 1).candidates);
  writeVerdicts(dir, lane, 1, 1, [{ id: 'c-1-1', verdict: 'CONFIRMED', severity: 'major', quote: 'x' }]);
  writeFileSync(join(repoPath, 'README.md'), '# moved\n');
  git(['commit', '-qam', 'moved under the review'], repoPath);
  assert.throws(() => registerRound(dir, run, lane, 1, { tree: repoPath }), /the branch moved/);
  cleanup();
});

test('the cap: a fifth round is refused as a hand-back, and converge refuses while a major is open', () => {
  const { dir, run, lane, repoPath, cleanup } = fixture();
  for (let round = 1; round <= MAX_REVIEW_ROUNDS; round += 1) {
    open(dir, run, lane, repoPath);
    if (round === 1) {
      writeCandidates(dir, lane, 1, 1, [cand()]);
      planVerification(dir, run, lane, 1, readCandidates(dir, lane, 1).candidates);
      writeVerdicts(dir, lane, 1, 1, [{ id: 'c-1-1', verdict: 'CONFIRMED', severity: 'major', quote: 'x' }]);
    } else {
      writeCandidates(dir, lane, round, 1, []);
      planVerification(dir, run, lane, round, readCandidates(dir, lane, round).candidates);
      writeVerdicts(dir, lane, round, 1, [{ id: openMajors(lane)[0].id, verdict: 'still-open', quote: 'still there' }]);
    }
    registerRound(dir, run, lane, round, { tree: repoPath });
  }
  assert.equal(reviewExhausted(lane), true);
  assert.throws(() => open(dir, run, lane, repoPath), HandBack);
  assert.throws(() => converge(dir, run, lane), /never ready a pull request over an open major/);
  assert.equal(lane.review.converged, false);
  cleanup();
});

test('the cap: a person rules on the open major — never before the cap, never without a note — and the lane converges', () => {
  const { dir, run, lane, repoPath, cleanup } = fixture();
  const spend = (upTo) => {
    for (let round = lane.review.rounds.length + 1; round <= upTo; round += 1) {
      open(dir, run, lane, repoPath);
      if (round === 1) {
        writeCandidates(dir, lane, 1, 1, [cand()]);
        planVerification(dir, run, lane, 1, readCandidates(dir, lane, 1).candidates);
        writeVerdicts(dir, lane, 1, 1, [{ id: 'c-1-1', verdict: 'CONFIRMED', severity: 'major', quote: 'x' }]);
      } else {
        writeCandidates(dir, lane, round, 1, []);
        planVerification(dir, run, lane, round, readCandidates(dir, lane, round).candidates);
        writeVerdicts(dir, lane, round, 1, [{ id: openMajors(lane)[0].id, verdict: 'still-open', quote: 'still there' }]);
      }
      registerRound(dir, run, lane, round, { tree: repoPath });
    }
  };
  spend(MAX_REVIEW_ROUNDS - 1);
  const major = openMajors(lane)[0];
  // Before the cap the verifiers rule, not a person — even a well-noted ruling is refused.
  assert.throws(() => ruleFinding(dir, run, lane, { id: major.id, ruling: 'fixed', note: 'I read it' }), /a person rules after it/);
  assert.equal(major.status, 'open');
  spend(MAX_REVIEW_ROUNDS);
  assert.equal(reviewExhausted(lane), true);
  // A bare ruling is refused, like a bare --another-round.
  assert.throws(() => ruleFinding(dir, run, lane, { id: major.id, ruling: 'fixed', note: '' }), /needs --note/);
  assert.throws(() => ruleFinding(dir, run, lane, { id: major.id, ruling: 'maybe', note: 'x' }), /--fixed or --withdrawn/);
  assert.throws(() => ruleFinding(dir, run, lane, { id: 'f-nope', ruling: 'fixed', note: 'x' }), /no finding f-nope/);
  assert.equal(major.status, 'open', 'a refused ruling changes nothing');
  // Two majors open: ruling the first leaves the round open, and the second ruling must still be allowed.
  lane.review.findings.push({ ...major, id: 'f-second00', status: 'open', threadId: null });
  assert.equal(openMajors(lane).length, 2);
  ruleFinding(dir, run, lane, { id: 'f-second00', ruling: 'withdrawn', note: 'the constant is 0, the branch is dead' });
  assert.equal(currentRound(lane).verdict, 'open', 'one major still open');
  const { finding, body } = ruleFinding(dir, run, lane, { id: major.id, ruling: 'fixed', note: 'the guard is on line 4 of the last commit', head: headOf(repoPath) });
  assert.equal(finding.status, 'fixed');
  assert.equal(finding.ruledBy, 'human');
  assert.match(body, /ruled by the author after round 4/);
  const last = currentRound(lane);
  assert.equal(last.verdict, 'converged', 'a ruling re-derives the round verdict');
  assert.equal(last.counts.majors, 0);
  assert.deepEqual(last.rulings.map((r) => r.id), ['f-second00', major.id], 'both rulings are on the round record');
  assert.equal(reviewExhausted(lane), false);
  assert.throws(() => ruleFinding(dir, run, lane, { id: major.id, ruling: 'withdrawn', note: 'again' }), /already fixed/);
  converge(dir, run, lane);
  assert.equal(lane.review.converged, true);
  cleanup();
});

test('the cap: --another-round with a reason opens round five and records the direction; a bare one is still the hand-back', () => {
  const { dir, run, lane, repoPath, cleanup } = fixture();
  for (let round = 1; round <= MAX_REVIEW_ROUNDS; round += 1) {
    open(dir, run, lane, repoPath);
    if (round === 1) {
      writeCandidates(dir, lane, 1, 1, [cand()]);
      planVerification(dir, run, lane, 1, readCandidates(dir, lane, 1).candidates);
      writeVerdicts(dir, lane, 1, 1, [{ id: 'c-1-1', verdict: 'CONFIRMED', severity: 'major', quote: 'x' }]);
    } else {
      writeCandidates(dir, lane, round, 1, []);
      planVerification(dir, run, lane, round, readCandidates(dir, lane, round).candidates);
      writeVerdicts(dir, lane, round, 1, [{ id: openMajors(lane)[0].id, verdict: 'still-open', quote: 'still there' }]);
    }
    registerRound(dir, run, lane, round, { tree: repoPath });
  }
  const head = headOf(repoPath);
  const diffText = laneDiff(repoPath, lane.base);
  assert.throws(() => openRound(dir, run, lane, { head, diffText }), HandBack);
  assert.throws(() => openRound(dir, run, lane, { head, diffText, anotherRound: '   ' }), HandBack, 'whitespace is a bare flag');
  const { round } = openRound(dir, run, lane, { head, diffText, anotherRound: 'the fix is in; verify it rather than trust it' });
  assert.equal(round, MAX_REVIEW_ROUNDS + 1);
  assert.deepEqual(lane.review.overrides.map((o) => [o.round, o.reason]), [[5, 'the fix is in; verify it rather than trust it']]);
  cleanup();
});

test('the fix report: a not-changed major is a dispute, and the same major disputed twice hands the run back', () => {
  const { dir, run, lane, repoPath, cleanup } = fixture();
  open(dir, run, lane, repoPath);
  writeCandidates(dir, lane, 1, 1, [cand()]);
  planVerification(dir, run, lane, 1, readCandidates(dir, lane, 1).candidates);
  writeVerdicts(dir, lane, 1, 1, [{ id: 'c-1-1', verdict: 'CONFIRMED', severity: 'major', quote: 'x' }]);
  const r1 = registerRound(dir, run, lane, 1, { tree: repoPath });
  const id = r1.findings[0].id;
  assert.throws(() => applyFixReport(dir, run, lane, 1), /no fix report/);
  writeFileSync(fixReportPath(dir, lane, 1), JSON.stringify({ [id]: { status: 'not-changed' } }));
  assert.throws(() => applyFixReport(dir, run, lane, 1), /no reason/);
  writeFileSync(fixReportPath(dir, lane, 1), JSON.stringify({ [id]: { status: 'not-changed', note: 'Map.get already returns undefined for a missing key' } }));
  currentRound(lane).fix = { briefed: true, model: 'sonnet', items: 1, redChecks: 0 };
  const replies = applyFixReport(dir, run, lane, 1);
  assert.equal(replies[0].body, 'Not changed — Map.get already returns undefined for a missing key');
  assert.equal(currentRound(lane).fix.briefed, true, 'recording the report must not forget the fixer was briefed — next would re-brief it');
  assert.equal(currentRound(lane).fix.reported, true);
  const f = lane.review.findings.find((x) => x.id === id);
  assert.equal(f.dispute, 'Map.get already returns undefined for a missing key');
  assert.equal(f.disputes, 0, 'the first dispute is recorded; the verifier rules on it next round');

  // Round 2: the verifier disagrees; the fixer disputes again → hand back.
  git(['commit', '-q', '--allow-empty', '-m', 'round 1 fix (nothing changed)'], repoPath);
  open(dir, run, lane, repoPath);
  writeCandidates(dir, lane, 2, 1, []);
  const { prior } = planVerification(dir, run, lane, 2, []);
  assert.equal(prior[0].dispute, 'Map.get already returns undefined for a missing key', 'the verifier sees the dispute');
  writeVerdicts(dir, lane, 2, 1, [{ id, verdict: 'still-open', quote: 'return cache.get(key);', note: 'the guard distinguished a stored undefined from a missing key' }]);
  registerRound(dir, run, lane, 2, { tree: repoPath });
  assert.equal(lane.review.findings.find((x) => x.id === id).disputes, 1);
  assert.match(lane.review.findings.find((x) => x.id === id).disputeRuling, /stored undefined/);
  writeFileSync(fixReportPath(dir, lane, 2), JSON.stringify({ [id]: { status: 'not-changed', note: 'still disagree' } }));
  assert.throws(() => applyFixReport(dir, run, lane, 2), HandBack);
  cleanup();
});

test('findingId is content-addressed and stable across a reworded round — the id is assigned once and echoed by id thereafter', () => {
  const lane = { slug: 'root' };
  const a = findingId(lane, cand());
  assert.equal(findingId(lane, cand({ short_summary: 'GET() lost its HAS() guard!' })), a, 'case and punctuation do not change the id');
  assert.notEqual(findingId(lane, cand({ file: 'other.js' })), a);
});

// ---------------------------------------------------------------------------
// Briefs.
// ---------------------------------------------------------------------------

test('the finder, verifier and fix briefs are rendered from the method file, and carry the loop\'s contracts', () => {
  const { dir, run, lane, repoPath, cleanup } = fixture();
  const { files } = open(dir, run, lane, repoPath);
  const entry = currentRound(lane);
  const finder = renderFinderBrief(dir, run, lane, entry, 1, { angles: entry.angles[0], issue: ISSUE, files, prior: [] });
  assert.match(finder, /You are a \*\*finder\*\*/);
  assert.match(finder, /### intent/);
  assert.match(finder, /Pass every candidate with a nameable failure scenario through/);
  assert.match(finder, /"notExamined"/);
  assert.match(finder, /diff\.patch/);
  assert.match(finder, /shared\/investigate\.md/, 'the finder is pointed at the approved plan');
  assert.match(finder, /addressed to `main`/);
  assert.match(finder, /Never rate severity/);
  assert.doesNotMatch(finder, /Already open/, 'no prior findings, no prior table');

  entry.verifiers = 1;
  const items = [{ ...cand(), id: 'c-1-1', prior: false }, { id: 'f-deadbeef', prior: true, file: 'widget.js', line: 9, side: 'RIGHT', severity: 'major', category: 'x', short_summary: 's', summary: 's', failure_scenario: 'f', dispute: 'the fixer says no', filedAtHead: 'abc' }];
  const verifier = renderVerifierBrief(dir, run, lane, entry, 1, { items, issue: ISSUE });
  assert.match(verifier, /You are a \*\*verifier\*\*/);
  assert.match(verifier, /REFUTED only when\nconstructible from the code/);
  assert.match(verifier, /A moved line is not a\s+fix/);
  assert.match(verifier, /the fixer says no/, 'a dispute crosses to the verifier');
  assert.match(verifier, /"verdicts"/);
  assert.match(verifier, /addressed to `main`/);

  const fix = renderFixBrief(dir, run, lane, entry, { items: [{ ...cand(), id: 'f-1', severity: 'major', stillOpenRounds: 1, quote: 'q' }], checks: [{ name: 'ci / widgets', bucket: 'fail', link: 'https://example.invalid/run' }], model: 'opus', issue: ISSUE });
  assert.match(fix, /You are the \*\*fixer\*\*/);
  assert.match(fix, /note the skip\s+rather than arguing with it/);
  assert.match(fix, /## Red checks/);
  assert.match(fix, /ci \/ widgets/);
  assert.match(fix, /survived 1 fix round/);
  assert.match(fix, /Never weaken, skip or delete a test/);
  assert.match(fix, /git push origin feature\/issue-5/);
  assert.match(fix, /"not-changed"/);
  assert.match(fix, /addressed to `main`/);
  assert.match(methodSection('fixer'), /ONE commit/);
  cleanup();
});

// ---------------------------------------------------------------------------
// Posting, against a stubbed gh: one pending review per round, one thread per
// inline finding, a refused anchor costing one thread and not the round.
// ---------------------------------------------------------------------------

function stubGh(bin, { refusePath = null } = {}) {
  const log = join(bin, 'gh-log.jsonl');
  const script = [
    '#!/usr/bin/env node',
    "const { readFileSync, appendFileSync } = require('node:fs');",
    'const args = process.argv.slice(2);',
    `const log = ${JSON.stringify(log)};`,
    "if (args[0] === 'api' && args[1] === 'graphql') {",
    "  const input = JSON.parse(readFileSync(args[args.indexOf('--input') + 1], 'utf8'));",
    "  appendFileSync(log, JSON.stringify(input) + '\\n');",
    '  const q = input.query;',
    "  if (q.includes('addPullRequestReview(')) return console.log(JSON.stringify({ data: { addPullRequestReview: { pullRequestReview: { id: 'PRR_1' } } } }));",
    "  if (q.includes('addPullRequestReviewThread(')) {",
    `    if (${JSON.stringify(refusePath)} && input.variables.path === ${JSON.stringify(refusePath)}) return console.log(JSON.stringify({ errors: [{ message: 'Pull request review thread line must be part of the diff' }] }));`,
    "    return console.log(JSON.stringify({ data: { addPullRequestReviewThread: { thread: { id: 'PRRT_' + input.variables.line } } } }));",
    '  }',
    "  if (q.includes('submitPullRequestReview(')) return console.log(JSON.stringify({ data: { submitPullRequestReview: { pullRequestReview: { id: 'PRR_1', url: 'https://example.invalid/pull/42#pullrequestreview-1' } } } }));",
    "  if (q.includes('addPullRequestReviewThreadReply(')) return console.log(JSON.stringify({ data: { addPullRequestReviewThreadReply: { comment: { id: 'C_1' } } } }));",
    "  if (q.includes('resolveReviewThread(')) return console.log(JSON.stringify({ data: { resolveReviewThread: { thread: { id: input.variables.thread, isResolved: true } } } }));",
    '}',
    'process.exit(1);',
  ].join('\n');
  writeFileSync(join(bin, 'gh'), script);
  chmodSync(join(bin, 'gh'), 0o755);
  return log;
}

function withGh(bin, fn) {
  const original = process.env.PATH;
  process.env.PATH = `${bin}:${original}`;
  try {
    return fn();
  } finally {
    process.env.PATH = original;
  }
}

test('postRound: one pending review, one thread per inline finding, submitted as COMMENT — and a refused anchor costs one thread, not the round', () => {
  const { dir, run, lane, repoPath, cleanup } = fixture();
  run.offline = false;
  open(dir, run, lane, repoPath);
  writeCandidates(dir, lane, 1, 1, [
    cand(),
    cand({ file: 'README.md', line: 1, category: 'conventions', short_summary: 'README never mentions eviction', summary: 'docs', failure_scenario: 'cost: the README lies' }),
  ]);
  planVerification(dir, run, lane, 1, readCandidates(dir, lane, 1).candidates);
  writeVerdicts(dir, lane, 1, 1, [
    { id: 'c-1-1', verdict: 'CONFIRMED', severity: 'major', quote: 'return cache.get(key);' },
    { id: 'c-1-2', verdict: 'CONFIRMED', severity: 'nit', quote: '# widgets' },
  ]);
  const r1 = registerRound(dir, run, lane, 1, { tree: repoPath });
  const readme = r1.findings.find((f) => f.file === 'README.md');
  assert.equal(readme.inline, false, 'README is not in the diff — body-only before anything is posted');

  const bin = mkdtempSync(join(tmpdir(), 'issueflow-gh-'));
  const log = stubGh(bin);
  const posted = withGh(bin, () => postRound(dir, run, lane, 1, { prNodeId: 'PR_node' }));
  const calls = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(calls.filter((c) => c.query.includes('addPullRequestReview(')).length, 1, 'exactly one pending review per round');
  assert.equal(calls.filter((c) => c.query.includes('addPullRequestReviewThread(')).length, 1, 'one thread for the one inline finding');
  const submit = calls.find((c) => c.query.includes('submitPullRequestReview('));
  assert.match(submit.query, /event: COMMENT/);
  assert.match(submit.variables.body, /Could not anchor/, 'the body-only finding is named in the review body');
  assert.equal(posted.threads, 1);
  assert.equal(lane.review.findings[0].threadId, 'PRRT_4', 'the stub keys thread ids by line; the guard finding is on line 4');
  assert.throws(() => postRound(dir, run, lane, 1, { prNodeId: 'PR_node' }), /already posted/);
  rmSync(bin, { recursive: true, force: true });

  // Round 2 against a stub that refuses one anchor: the round still posts, the
  // refused finding moves into the body, and the fixed prior thread is resolved.
  writeFileSync(join(repoPath, 'widget.js'), WIDGET_V2.replace('export function get(key) {\n', 'export function get(key) {\n  if (!cache.has(key)) return undefined;\n'));
  git(['commit', '-qam', 'fix'], repoPath);
  open(dir, run, lane, repoPath);
  // The new candidate sits on the eviction line — inside the hunk, so the
  // registrar classifies it inline; the stub then refuses the anchor.
  writeCandidates(dir, lane, 2, 1, [cand({ line: 10, category: 'line-by-line', short_summary: 'clear() on the 101st set drops live entries', summary: 'whole-cache eviction', failure_scenario: 'the 101st set() empties the cache mid-request' })]);
  planVerification(dir, run, lane, 2, readCandidates(dir, lane, 2).candidates);
  // README.md is untouched by the fix, so the README nit is still open by
  // construction and gets no verifier item — only the major and the new candidate do.
  writeVerdicts(dir, lane, 2, 1, [
    { id: lane.review.findings[0].id, verdict: 'fixed', quote: 'if (!cache.has(key)) return undefined;' },
    { id: 'c-1-1', verdict: 'CONFIRMED', severity: 'major', quote: 'if (cache.size > 100) cache.clear();' },
  ]);
  const r2 = registerRound(dir, run, lane, 2, { tree: repoPath });
  assert.equal(r2.findings.find((f) => f.short_summary.startsWith('clear() on the 101st')).inline, true, 'the registrar classified it inline — GitHub is what refuses it');
  const bin2 = mkdtempSync(join(tmpdir(), 'issueflow-gh-'));
  const log2 = stubGh(bin2, { refusePath: 'widget.js' });
  const posted2 = withGh(bin2, () => postRound(dir, run, lane, 2, { prNodeId: 'PR_node' }));
  const calls2 = readFileSync(log2, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(posted2.unanchored, 1, 'the refused anchor is counted');
  assert.equal(posted2.threads, 0);
  const submit2 = calls2.find((c) => c.query.includes('submitPullRequestReview('));
  assert.match(submit2.variables.body, /Could not anchor/);
  assert.match(submit2.variables.body, /clear\(\) on the 101st set drops live entries/);
  assert.ok(calls2.some((c) => c.query.includes('resolveReviewThread(') && c.variables.thread === 'PRRT_4'), 'the fixed finding\'s thread is resolved');
  assert.ok(calls2.some((c) => c.query.includes('addPullRequestReviewThreadReply(') && /Fixed in/.test(c.variables.body)));
  assert.deepEqual(posted2.replies.map((r) => r.state), ['resolved']);
  rmSync(bin2, { recursive: true, force: true });
  cleanup();
});

test('threadBody carries the marker, the severity, the scenario and a suggestion only when it is short', () => {
  const f = { id: 'f-1', severity: 'major', category: 'x', verdict: 'CONFIRMED', summary: 's', failure_scenario: 'fs', quote: 'q', suggestion: 'one line\n' };
  const body = threadBody(f);
  assert.match(body, /^<!-- issueflow:finding f-1 -->/);
  assert.match(body, /🔴 \*\*Major\*\*/);
  assert.match(body, /```suggestion\none line\n```/);
  assert.doesNotMatch(threadBody({ ...f, suggestion: 'a\nb\nc\nd\ne\nf\ng' }), /```suggestion/, 'a seven-line suggestion is not a suggestion block');
});

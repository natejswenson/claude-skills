import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { accept, createRun, deliveredSince, findStep, markBriefed, saveRun, artifactPath, evidencePath, progressPath, loadRun } from '../lib/run.mjs';
import { writeBrief, writeReviewBrief } from '../lib/brief.mjs';
import { activeRoot, approveArtifact, approvedArtifactPath, archivedPath, deliveryCurrent, gitStore, historyRoot, historyStore, prepareCheckout, prepareExecution, readDelivery } from '../lib/execution.mjs';
import { ensureWorktree } from '../lib/worktree.mjs';
import { markReviewBriefed, registerReview, reviewPath } from '../lib/reviews.mjs';
import { writeFinderBriefs, writeVerifierBriefs, writeFixBrief } from '../lib/reviewbrief.mjs';
import { applyFixReport, candidatesPath, currentRound, fixReportPath, laneDiff, openRound, planVerification, readCandidates, registerRound, verdictsPath } from '../lib/prreview.mjs';
import { checkpoint } from '../lib/checkpoint.mjs';
import { ship } from '../lib/ship.mjs';
import { finish } from '../lib/finish.mjs';
import { verify } from '../lib/verify.mjs';
import { STAGES } from '../lib/stages.mjs';
import { GOOD_EVIDENCE } from './helpers.mjs';
import { decide, renderAction, sh } from '../lib/next.mjs';

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const shLiteral = (value) => `'${value.replaceAll("'", `'"'"'`)}'`;
function codexChild(workspaceRoot, source, tree, paths) {
  const [artifact, evidence, progress] = paths;
  const script = join(workspaceRoot, 'codex-child.sh');
  writeFileSync(script, [
    'set -eu',
    `export TMPDIR=${shLiteral(workspaceRoot)}`,
    `printf 'child output\\n' > ${shLiteral(artifact)}`,
    `printf 'child output\\n' > ${shLiteral(evidence)}`,
    `printf 'child output\\n' > ${shLiteral(progress)}`,
    `printf 'child commit\\n' > ${shLiteral(join(tree, 'child.txt'))}`,
    `git -C ${shLiteral(tree)} add child.txt`,
    `git -C ${shLiteral(tree)} commit -m child`,
  ].join('\n'));
  chmodSync(script, 0o700);
  const prompt = `Run exactly this command, then finish:\n/bin/sh ${shLiteral(script)}`;
  const result = spawnSync('codex', ['exec', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'workspace-write',
    '-C', tree, '--add-dir', workspaceRoot, prompt], { encoding: 'utf8', timeout: 120000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  for (const path of paths) assert.equal(readFileSync(path, 'utf8'), 'child output\n');
  assert.equal(git(['show', 'HEAD:child.txt'], tree), 'child commit');
  assert.equal(git(['log', '-1', '--format=%s'], tree), 'child');
  assert.throws(() => git(['show', 'HEAD:child.txt'], source));
}
function fixture(number = 273) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "issueflow execution's workspace ")));
  const source = join(root, 'source');
  const dir = join(root, 'durable');
  const workspaceRoot = join(root, 'approved $HOME root');
  mkdirSync(source); mkdirSync(workspaceRoot);
  git(['init', '-b', 'dev'], source);
  git(['config', 'user.name', 'Fixture'], source);
  git(['config', 'user.email', 'fixture@example.test'], source);
  writeFileSync(join(source, 'file.txt'), 'base\n');
  git(['add', 'file.txt'], source);
  git(['commit', '-m', 'base'], source);
  const run = createRun({
    repo: { owner: 'acme', name: 'widgets', path: source },
    issue: { number, title: 'writable execution' },
    policy: { base: 'dev', featurePrefix: 'feature/' },
    runtime: 'codex', offline: true,
  });
  saveRun(dir, run);
  return { root, source, dir, workspaceRoot, run };
}

test('Codex writer paths refuse an unprepared execution layout', () => {
  const dir = mkdtempSync(join(tmpdir(), "issueflow execution's durable "));
  const run = createRun({
    repo: { owner: 'acme', name: 'widgets', path: '/tmp/widgets' },
    issue: { number: 273, title: 'writable execution' },
    policy: { base: 'dev', featurePrefix: 'feature/' },
    runtime: 'codex', offline: true,
  });
  saveRun(dir, run);
  assert.throws(() => writeBrief(dir, run, findStep(run, 'investigate'), run.issue), /workspace-root|execution.*prepar/i);
});

test('approved-root execution gives a constrained child writable outputs and Git administration paths', () => {
  const { source, dir, workspaceRoot, run } = fixture();
  writeFileSync(join(source, 'untracked.txt'), 'source work');
  const sourceStatus = git(['status', '--porcelain'], source);
  const sourceHead = git(['rev-parse', 'HEAD'], source);
  prepareExecution(dir, run, { workspaceRoot });
  const step = findStep(run, 'implement');
  const tree = prepareCheckout(dir, run, step.lane);
  writeBrief(dir, run, step, run.issue, tree);
  const paths = [artifactPath(dir, step), evidencePath(dir, step), progressPath(dir, step)];
  for (const path of paths) assert.ok(path.startsWith(workspaceRoot + '/'), path);
  const archives = join(dir, 'execution-archives', run.execution.generation);
  chmodSync(dir, 0o555); chmodSync(archives, 0o555); chmodSync(join(source, '.git'), 0o555);
  try { codexChild(workspaceRoot, source, tree, paths); }
  finally { chmodSync(dir, 0o755); chmodSync(archives, 0o755); chmodSync(join(source, '.git'), 0o755); }
  for (const args of [['--absolute-git-dir'], ['--path-format=absolute', '--git-common-dir'], ['--path-format=absolute', '--git-path', 'index'], ['--path-format=absolute', '--git-path', 'objects'], ['--path-format=absolute', '--git-path', 'refs']]) {
    assert.ok(git(['rev-parse', ...args], tree).startsWith(workspaceRoot + '/'), args.join(' '));
  }
  assert.equal(existsSync(join(gitStore(dir, run), 'objects/info/alternates')), false);
  assert.equal(git(['status', '--porcelain'], source), sourceStatus);
  assert.equal(git(['rev-parse', 'HEAD'], source), sourceHead);
  assert.throws(() => git(['rev-parse', '--verify', step.lane.branch], source));
});

test('durable snapshots preserve exact bytes and mtime and resume reuses its generation', () => {
  const { dir, workspaceRoot, run } = fixture();
  prepareExecution(dir, run, { workspaceRoot });
  const step = findStep(run, 'investigate');
  writeBrief(dir, run, step, run.issue);
  const path = artifactPath(dir, step);
  writeFileSync(path, 'approved plan with an unchanged /historical/path\n');
  utimesSync(path, 1700000000, 1700000000);
  saveRun(dir, run);
  const archived = archivedPath(dir, run, path);
  assert.equal(readFileSync(archived, 'utf8'), readFileSync(path, 'utf8'));
  assert.equal(statSync(archived).mtimeMs, statSync(path).mtimeMs);
  const resumed = loadRun(dir);
  prepareExecution(dir, resumed);
  assert.equal(resumed.execution.generation, run.execution.generation);
  assert.equal(artifactPath(dir, findStep(resumed, 'investigate')), path);
});

test('successor briefs inherit durable snapshots instead of writable active artifacts', () => {
  const { dir, workspaceRoot, run } = fixture();
  prepareExecution(dir, run, { workspaceRoot });
  const plan = findStep(run, 'investigate');
  writeBrief(dir, run, plan, run.issue);
  writeFileSync(artifactPath(dir, plan), 'approved plan');
  plan.stage.state = 'approved';
  saveRun(dir, run);
  approveArtifact(dir, run, artifactPath(dir, plan));
  const archived = archivedPath(dir, run, artifactPath(dir, plan));
  writeFileSync(artifactPath(dir, plan), 'rewritten active plan');
  saveRun(dir, run);
  const brief = writeBrief(dir, run, findStep(run, 'implement'), run.issue);
  assert.ok(readFileSync(brief.prompt, 'utf8').includes(approvedArtifactPath(dir, run, artifactPath(dir, plan))));
  assert.equal(approvedArtifactPath(dir, run, artifactPath(dir, plan)), archived);
  assert.equal(readFileSync(archived, 'utf8'), 'approved plan');
});

test('symlink outputs stop archival before state advances and retain the child results', () => {
  const { dir, workspaceRoot, run } = fixture();
  prepareExecution(dir, run, { workspaceRoot });
  const before = readFileSync(join(dir, 'run.json'), 'utf8');
  symlinkSync(join(dir, 'run.json'), join(activeRoot(dir), 'escape'));
  run.finished = { at: 'never persisted' };
  assert.throws(() => saveRun(dir, run), /unsafe execution|symlink/);
  assert.equal(readFileSync(join(dir, 'run.json'), 'utf8'), before);
  assert.ok(existsSync(join(activeRoot(dir), 'escape')));
});

test('a read-only durable root does not prevent child output or Git writes; failed parent import stops state', () => {
  assert.notEqual(process.getuid?.(), 0, 'permission proof must not run as root');
  const { source, dir, workspaceRoot, run } = fixture();
  prepareExecution(dir, run, { workspaceRoot });
  const step = findStep(run, 'implement');
  const tree = prepareCheckout(dir, run, step.lane);
  writeBrief(dir, run, step, run.issue, tree);
  saveRun(dir, run);
  const before = readFileSync(join(dir, 'run.json'), 'utf8');
  const archives = join(dir, 'execution-archives', run.execution.generation);
  chmodSync(dir, 0o555); chmodSync(archives, 0o555);
  try {
    codexChild(workspaceRoot, source, tree, [artifactPath(dir, step), evidencePath(dir, step), progressPath(dir, step)]);
    assert.throws(() => saveRun(dir, run), /could not persist.*|could not archive/);
    assert.equal(readFileSync(join(dir, 'run.json'), 'utf8'), before);
  } finally { chmodSync(dir, 0o755); chmodSync(archives, 0o755); }
  saveRun(dir, run);
  assert.equal(readFileSync(archivedPath(dir, run, artifactPath(dir, step)), 'utf8'), 'child output\n');
});

test('changing a delivered output after gate read refuses the canonical transition', () => {
  const { dir, workspaceRoot, run } = fixture();
  prepareExecution(dir, run, { workspaceRoot });
  const step = findStep(run, 'investigate');
  writeBrief(dir, run, step, run.issue); markBriefed(dir, run, step);
  const path = artifactPath(dir, step);
  writeFileSync(path, 'first complete result');
  readDelivery(dir, path, run);
  const before = readFileSync(join(dir, 'run.json'), 'utf8');
  writeFileSync(path, 'a partial replacement');
  assert.throws(() => saveRun(dir, run), /output changed after gate read/);
  assert.equal(readFileSync(join(dir, 'run.json'), 'utf8'), before);
});

test('rebrief excludes copied old output even when its timestamp is new', () => {
  const { dir, workspaceRoot, run } = fixture();
  prepareExecution(dir, run, { workspaceRoot });
  const step = findStep(run, 'investigate');
  writeBrief(dir, run, step, run.issue); markBriefed(dir, run, step);
  const path = artifactPath(dir, step);
  writeFileSync(path, 'the first result');
  assert.ok(deliveryCurrent(dir, path));
  writeBrief(dir, run, step, run.issue); markBriefed(dir, run, step);
  writeFileSync(path, 'the first result');
  assert.equal(deliveredSince(dir, step), null);
  assert.throws(() => readDelivery(dir, path, run), /stale/);
  writeFileSync(path, 'the revised result');
  assert.ok(deliveredSince(dir, step));
});

test('two runs share neither Git refs nor outputs and retain the source index', () => {
  const first = fixture(273);
  const second = createRun({ repo: first.run.repo, issue: { number: 274, title: 'second' }, policy: first.run.policy, runtime: 'codex', offline: true });
  const secondDir = join(first.root, 'second durable');
  saveRun(secondDir, second);
  writeFileSync(join(first.source, 'file.txt'), 'staged source change');
  git(['add', 'file.txt'], first.source);
  const index = readFileSync(join(first.source, '.git', 'index'));
  for (const [dir, run] of [[first.dir, first.run], [secondDir, second]]) {
    prepareExecution(dir, run, { workspaceRoot: first.workspaceRoot });
    const tree = prepareCheckout(dir, run, run.lanes[0]);
    writeFileSync(join(tree, 'child.txt'), String(run.issue.number));
    git(['add', 'child.txt'], tree); git(['commit', '-m', 'isolated child'], tree);
  }
  assert.notEqual(first.run.execution.path, second.execution.path);
  assert.throws(() => git(['rev-parse', '--verify', second.lanes[0].branch], gitStore(first.dir, first.run)));
  assert.deepEqual(readFileSync(join(first.source, '.git', 'index')), index);
});

test('clean legacy migration preserves unpushed lane commits and exact approved artifacts', () => {
  const { dir, source, workspaceRoot, run } = fixture();
  const lane = run.lanes[0];
  const tree = ensureWorktree(source, dir, lane, { offline: true }).path;
  writeFileSync(join(tree, 'legacy.txt'), 'unpushed'); git(['add', 'legacy.txt'], tree); git(['commit', '-m', 'legacy'], tree);
  lane.stages[0].state = 'approved';
  const path = artifactPath(dir, findStep(run, 'investigate'));
  writeFileSync(path, '## Approved\nold /absolute/path stays byte-identical');
  utimesSync(path, 1700000000, 1700000000); saveRun(dir, run);
  prepareExecution(dir, run, { workspaceRoot });
  assert.equal(git(['rev-parse', lane.branch], gitStore(dir, run)), git(['rev-parse', lane.branch], source));
  const migrated = artifactPath(dir, findStep(run, 'investigate'));
  assert.equal(readFileSync(migrated, 'utf8'), readFileSync(path, 'utf8'));
  assert.equal(statSync(migrated).mtimeMs, statSync(path).mtimeMs);
  assert.ok(existsSync(tree), 'legacy checkout remains available');
});

for (const state of ['dirty', 'in-flight']) test(`${state} legacy migration refuses without changing canonical state`, () => {
  const { dir, source, workspaceRoot, run } = fixture();
  const tree = ensureWorktree(source, dir, run.lanes[0], { offline: true }).path;
  if (state === 'dirty') writeFileSync(join(tree, 'untracked.txt'), 'preserve me');
  else run.lanes[0].stages[0].state = 'briefed';
  saveRun(dir, run);
  const before = readFileSync(join(dir, 'run.json'), 'utf8');
  assert.throws(() => prepareExecution(dir, run, { workspaceRoot }), /dirty legacy|in-flight/);
  assert.equal(readFileSync(join(dir, 'run.json'), 'utf8'), before);
  assert.ok(existsSync(tree));
});

test('missing staging restores an archived lane and reviewed head in a new generation', () => {
  const { dir, workspaceRoot, run } = fixture();
  prepareExecution(dir, run, { workspaceRoot });
  const lane = run.lanes[0];
  const tree = prepareCheckout(dir, run, lane);
  writeFileSync(join(tree, 'history.txt'), 'retain me'); git(['add', 'history.txt'], tree); git(['commit', '-m', 'reviewed'], tree);
  const head = git(['rev-parse', 'HEAD'], tree);
  const investigate = findStep(run, 'investigate');
  writeBrief(dir, run, investigate, run.issue);
  writeFileSync(artifactPath(dir, investigate), 'approved investigation');
  investigate.stage.state = 'approved';
  lane.stages[0].state = 'approved';
  lane.review.rounds.push({ round: 1, head, registered: 'yes' });
  saveRun(dir, run);
  approveArtifact(dir, run, artifactPath(dir, investigate));
  saveRun(dir, run);
  const old = run.execution.path;
  renameSync(old, old + '-crashed');
  prepareExecution(dir, run);
  assert.notEqual(run.execution.path, old);
  assert.equal(git(['rev-parse', lane.branch], gitStore(dir, run)), head);
  assert.equal(readFileSync(join(prepareCheckout(dir, run, lane), 'history.txt'), 'utf8'), 'retain me');
  assert.equal(git(['show', head + ':history.txt'], historyStore(dir, run)), 'retain me');
  const approved = approvedArtifactPath(dir, run, artifactPath(dir, investigate));
  assert.equal(readFileSync(approved, 'utf8'), 'approved investigation');
  assert.ok(readFileSync(writeBrief(dir, run, findStep(run, 'implement'), run.issue).prompt, 'utf8').includes(approved));
});

test('missing in-flight staging reports unexported work and never recreates approval', () => {
  const { dir, workspaceRoot, run } = fixture();
  prepareExecution(dir, run, { workspaceRoot });
  const step = findStep(run, 'investigate');
  writeBrief(dir, run, step, run.issue); markBriefed(dir, run, step);
  const before = readFileSync(join(dir, 'run.json'), 'utf8');
  renameSync(run.execution.path, run.execution.path + '-crashed');
  assert.throws(() => prepareExecution(dir, run), /in-flight.*recover the child outputs/);
  assert.equal(readFileSync(join(dir, 'run.json'), 'utf8'), before);
});

test('unapproved roots and changed ownership refuse before dispatch', () => {
  const { dir, source, workspaceRoot, run } = fixture();
  assert.throws(() => prepareExecution(dir, run, { workspaceRoot: join(source, '.git') }), /approved workspace root/);
  assert.throws(() => prepareExecution(dir, run, { workspaceRoot: source }), /approved workspace root/);
  prepareExecution(dir, run, { workspaceRoot });
  writeFileSync(join(run.execution.path, 'owner.json'), '{}');
  assert.throws(() => prepareExecution(dir, run), /mismatched execution owner/);
});

test('staged Git storage preserves optional origin transport settings', () => {
  const { root, source, dir, workspaceRoot, run } = fixture();
  const fetch = join(root, 'fetch.git'), push = join(root, 'push.git');
  git(['init', '--bare', fetch], root); git(['init', '--bare', push], root);
  git(['remote', 'add', 'origin', fetch], source);
  git(['config', 'remote.origin.pushurl', push], source);
  git(['config', '--unset-all', 'remote.origin.fetch'], source);
  prepareExecution(dir, run, { workspaceRoot });
  assert.equal(git(['remote', 'get-url', 'origin'], gitStore(dir, run)), fetch);
  assert.throws(() => git(['config', '--get-all', 'remote.origin.fetch'], gitStore(dir, run)));
  assert.equal(git(['config', '--get-all', 'remote.origin.pushurl'], gitStore(dir, run)), push);
});

test('all six worker roles deliver through execution storage and staged commits push and ship', () => {
  const { root, source, dir, workspaceRoot, run } = fixture();
  const remote = join(root, 'remote.git');
  git(['init', '--bare', remote], root); git(['remote', 'add', 'origin', remote], source);
  git(['push', '-u', 'origin', 'dev'], source);
  prepareExecution(dir, run, { workspaceRoot });
  const plan = findStep(run, 'investigate');
  writeBrief(dir, run, plan, run.issue); markBriefed(dir, run, plan);
  const good = (step) => STAGES.find((s) => s.id === step.stage.id).requires.map((h) => `## ${h}\n\nproof\n`).join('\n');
  writeFileSync(artifactPath(dir, plan), good(plan));
  writeReviewBrief(dir, run, plan, run.issue, 1); markReviewBriefed(dir, run, plan, 1);
  writeFileSync(reviewPath(dir, plan, 1), JSON.stringify({ findings: [], notExamined: ['external service'], verdict: 'pass' }));
  registerReview(dir, run, plan); accept(dir, run, plan);
  const step = findStep(run, 'implement');
  const lane = step.lane;
  const tree = prepareCheckout(dir, run, lane);
  writeBrief(dir, run, step, run.issue, tree); markBriefed(dir, run, step);
  writeFileSync(join(tree, 'file.txt'), 'implemented\n'); git(['add', 'file.txt'], tree); git(['commit', '-m', 'implementation'], tree);
  writeFileSync(artifactPath(dir, step), good(step)); writeFileSync(evidencePath(dir, step), GOOD_EVIDENCE);
  accept(dir, run, step);
  assert.ok(step.stage.evidence.startsWith(join(dir, 'execution-archives')));
  assert.match(JSON.stringify(verify(dir, run, step)), /commits over origin\/dev","1/);
  run.offline = false;
  const pushed = checkpoint(dir, run, { comment: false });
  assert.ok(pushed.some((r) => r.state === 'pushed'));
  assert.equal(git(['rev-parse', lane.branch], remote), git(['rev-parse', 'HEAD'], tree));
  let shipped;
  assert.doesNotThrow(() => { shipped = ship(dir, run, { dryRun: true }); });
  assert.equal(shipped[0].commits, 1);
  lane.pr = { number: 1, url: 'https://example.test/pull/1' };
  const head = git(['rev-parse', 'HEAD'], tree);
  const { files } = openRound(dir, run, lane, { head, remoteHead: head, prHead: head, diffText: laneDiff(tree, lane.base) });
  const entry = currentRound(lane);
  const briefs = writeFinderBriefs(dir, run, lane, entry, { issue: run.issue, files, prior: [] }); saveRun(dir, run);
  const candidate = { id: 'c-1-1', file: 'file.txt', line: 1, side: 'RIGHT', category: 'bug', short_summary: 'wrong value', summary: 'wrong value', failure_scenario: 'when read', proposed_severity: 'major' };
  for (const b of briefs) {
    assert.ok(b.prompt.startsWith(workspaceRoot + '/'));
    writeFileSync(b.writes, JSON.stringify({ candidates: b.n === 1 ? [candidate] : [], notExamined: ['runtime service'] }));
  }
  const { candidates } = readCandidates(dir, lane, 1);
  const { batches } = planVerification(dir, run, lane, 1, candidates);
  const verifiers = writeVerifierBriefs(dir, run, lane, entry, { batches, issue: run.issue }); saveRun(dir, run);
  writeFileSync(verifiers[0].writes, JSON.stringify({ verdicts: [{ id: candidate.id, verdict: 'CONFIRMED', severity: 'major', quote: 'implemented' }] }));
  registerRound(dir, run, lane, 1);
  const item = lane.review.findings[0];
  const fixer = writeFixBrief(dir, run, lane, entry, { items: [item], checks: [], model: 'gpt-6-astra', issue: run.issue }); saveRun(dir, run);
  writeFileSync(fixer.writes, JSON.stringify({ [item.id]: { status: 'fixed', note: 'updated' }, _summary: head }));
  writeFileSync(evidencePath(dir, step), GOOD_EVIDENCE + '\n# pass 1\n# fail 0\n');
  applyFixReport(dir, run, lane, 1);
  assert.ok(entry.fix);
  assert.ok(existsSync(join(historyRoot(dir, run), lane.slug, 'review/r1/fix-report.json')));
  assert.throws(() => git(['rev-parse', '--verify', lane.branch], source));
});

test('a failed atomic state rename leaves output recoverable and canonical state unchanged', (t) => {
  const { dir, workspaceRoot, run } = fixture();
  prepareExecution(dir, run, { workspaceRoot });
  const before = readFileSync(join(dir, 'run.json'), 'utf8');
  const step = findStep(run, 'investigate');
  writeBrief(dir, run, step, run.issue);
  writeFileSync(artifactPath(dir, step), 'recoverable');
  t.mock.method(fs, 'renameSync', () => { throw Object.assign(new Error('injected parent EACCES'), { code: 'EACCES' }); });
  syncBuiltinESMExports();
  try {
    assert.throws(() => saveRun(dir, run), /injected parent EACCES.*retain outputs/);
    assert.equal(readFileSync(join(dir, 'run.json'), 'utf8'), before);
    assert.equal(readFileSync(artifactPath(dir, step), 'utf8'), 'recoverable');
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  saveRun(dir, run);
});

test('finish archives history and removes only owned lanes including pre-split leftovers', () => {
  const { root, dir, source, workspaceRoot, run } = fixture();
  prepareExecution(dir, run, { workspaceRoot });
  const lane = run.lanes[0];
  const tree = prepareCheckout(dir, run, lane);
  const head = git(['rev-parse', 'HEAD'], tree);
  const leftover = ensureWorktree(gitStore(dir, run), dir, { slug: 'pre-split', branch: 'feature/old-root', base: 'dev' }, { offline: true }).path;
  const other = createRun({ repo: run.repo, issue: { number: 274, title: 'other' }, policy: run.policy, runtime: 'codex', offline: true });
  const otherDir = join(root, 'other');
  saveRun(otherDir, other); prepareExecution(otherDir, other, { workspaceRoot });
  const sibling = prepareCheckout(otherDir, other, other.lanes[0]);
  const bin = join(root, 'bin'); mkdirSync(bin);
  writeFileSync(join(bin, 'gh'), '#!/usr/bin/env node\nif (process.argv[2] !== "pr" || process.argv[3] !== "list") process.exit(9); console.log(JSON.stringify([{number: 1, state: "MERGED", url: "https://example.test/pull/1", mergedAt: "2026-01-01T00:00:00Z"}]));\n');
  chmodSync(join(bin, 'gh'), 0o755);
  const priorPath = process.env.PATH;
  process.env.PATH = bin + ':' + priorPath;
  run.offline = false;
  chmodSync(join(source, '.git'), 0o555);
  try { finish(dir, run); } finally { chmodSync(join(source, '.git'), 0o755); process.env.PATH = priorPath; }
  assert.equal(existsSync(tree), false);
  assert.equal(existsSync(leftover), false);
  assert.ok(existsSync(sibling));
  assert.equal(git(['rev-parse', 'HEAD'], source), head);
  assert.equal(git(['cat-file', '-t', head], historyStore(dir, run)), 'commit');
});

function startArgs(f) {
  const repoJson = join(f.root, 'repo.json'), issueJson = join(f.root, 'issue.json');
  writeFileSync(repoJson, JSON.stringify({ ...f.run.repo, defaultBranch: 'dev' }));
  writeFileSync(issueJson, JSON.stringify(f.run.issue));
  return [new URL('../issueflow.js', import.meta.url).pathname, 'start', '--take-over', '--offline', '--repo', f.source,
    '--repo-json', repoJson, '--issue-json', issueJson, '--issue', String(f.run.issue.number), '--run-dir', f.dir, '--runtime', 'codex', '--workspace-root', f.workspaceRoot];
}

test('the emitted push recovery command runs in the staged checkout with spaces and apostrophes', () => {
  const { root, source, dir, workspaceRoot, run } = fixture();
  const remote = join(root, 'remote.git');
  git(['init', '--bare', remote], root);
  git(['remote', 'add', 'origin', remote], source);
  git(['push', 'origin', 'dev'], source);
  prepareExecution(dir, run, { workspaceRoot });
  const lane = run.lanes[0];
  const tree = prepareCheckout(dir, run, lane);
  const head = git(['rev-parse', 'HEAD'], tree);
  writeBrief(dir, run, findStep(run, 'investigate'), run.issue);
  for (const stage of [...run.stages, ...lane.stages]) stage.state = 'approved';
  writeFileSync(artifactPath(dir, findStep(run, 'investigate')), '## Plan\nNo split.');
  lane.pr = { number: 1, url: 'https://example.test/pull/1' };
  lane.review.rounds.push({ round: 1, head, registered: true, posted: true, fix: { briefed: true, reported: true } });
  run.offline = false;
  git(['commit', '--allow-empty', '-m', 'fix'], tree);
  saveRun(dir, run);
  const action = decide(dir, run, { remoteHead: () => head, checks: () => [] });
  assert.equal(action.reason, 'unpushed');
  const rendered = renderAction(action, { skillCommand: `node ${sh(new URL('../issueflow.js', import.meta.url).pathname)}`, runDir: dir });
  const command = rendered.match(/^  command: (.+)$/m)[1];
  const result = spawnSync('sh', ['-c', command], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(git(['rev-parse', lane.branch], remote), git(['rev-parse', 'HEAD'], tree));
});

test('takeover retains archived outputs and history while creating a different generation', () => {
  const f = fixture();
  prepareExecution(f.dir, f.run, { workspaceRoot: f.workspaceRoot });
  const tree = prepareCheckout(f.dir, f.run, f.run.lanes[0]);
  const step = findStep(f.run, 'investigate');
  writeBrief(f.dir, f.run, step, f.run.issue);
  writeFileSync(artifactPath(f.dir, step), 'preserved plan');
  saveRun(f.dir, f.run);
  const generation = f.run.execution.generation;
  const result = spawnSync(process.execPath, startArgs(f), { encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: '' } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(tree), false);
  assert.notEqual(loadRun(f.dir).execution.generation, generation);
  const superseded = join(f.dir, 'superseded', fs.readdirSync(join(f.dir, 'superseded'))[0]);
  const archived = loadRun(superseded);
  assert.equal(readFileSync(join(historyRoot(superseded, archived), 'shared/investigate.md'), 'utf8'), 'preserved plan');
  assert.equal(git(['cat-file', '-t', git(['rev-parse', 'HEAD'], f.source)], historyStore(superseded, archived)), 'commit');
});

test('corrupt Codex state refuses takeover when execution ownership cannot be recovered', () => {
  const f = fixture();
  prepareExecution(f.dir, f.run, { workspaceRoot: f.workspaceRoot });
  const tree = prepareCheckout(f.dir, f.run, f.run.lanes[0]);
  writeFileSync(join(f.dir, 'run.json'), '{"truncated":');
  const result = spawnSync(process.execPath, startArgs(f), { encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: '' } });
  assert.equal(result.status, 3);
  assert.match(result.stderr, /restore run.json before cleanup/);
  assert.ok(existsSync(tree));
});

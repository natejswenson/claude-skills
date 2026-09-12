/**
 * Parallel sessions on one repo (#251).
 *
 * One Claude Code session per issue, all on one machine, all against one
 * checkout. A run's identity is `owner/name#N`, and until 0.8.0 nothing ever
 * asked whether that identity was taken: the second session to say "fix issue
 * 42" reset the first's state machine AND republished an empty board over the
 * sticky comment — the one artifact of a run that leaves this machine.
 *
 * Every `start` case here is driven ONLINE, against a recording `gh` stub on
 * `PATH`, because that is the only way the clobber is reachable: `checkpoint()`
 * returns before any `gh` call on an offline run, so an assertion about a
 * missing PATCH under `--issue-json` would pass byte-for-byte with the bug
 * fully present.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FINISHED_MARKER, claimedIn, finishedIn, markerFor } from '../lib/checkpoint.mjs';
import { HandBack, claimRunDir, createRun, saveRun } from '../lib/run.mjs';
import { prepareCheckout, releaseSourceLease } from '../lib/execution.mjs';
import { ensureWorktree } from '../lib/worktree.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = join(HERE, '..', '..');
const CLI = join(SKILL, 'scripts', 'issueflow.js');
const INPUTS = join(SKILL, 'evals', 'inputs');

const OWNER = 'acme';
const NAME = 'widgets';
const NUMBER = 42;

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const cli = (args, env = {}) => {
  try {
    const out = execFileSync(process.execPath, [CLI, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_TEST_CONTEXT: undefined, ...env },
    });
    return { code: 0, out, err: '' };
  } catch (e) {
    return { code: e.status ?? 1, out: String(e.stdout ?? ''), err: String(e.stderr ?? '') };
  }
};

/** A real git repository with one commit — `start` resolves its policy and pushes from it. */
function tempRepo() {
  const path = mkdtempSync(join(tmpdir(), 'issueflow-parallel-repo-'));
  git(['init', '-q', '-b', 'main'], path);
  git(['config', 'user.email', 'test@example.invalid'], path);
  git(['config', 'user.name', 'issueflow tests'], path);
  writeFileSync(join(path, 'README.md'), '# fixture\n');
  git(['add', 'README.md'], path);
  git(['commit', '-qm', 'initial'], path);
  return path;
}

/**
 * A recording `gh` that answers everything `start` asks, and logs every call.
 *
 * The log is the assertion: the clobber is a `-X PATCH` over somebody else's
 * comment, so what must be proved is that the refusal happens BEFORE it.
 */
function stubGh(bin, { comments = [] } = {}) {
  const log = join(bin, 'gh-log.txt');
  const issue = {
    number: NUMBER,
    title: 'Widgets drop their cache',
    body: 'The cache empties on the 101st set. Repro below.\n\n- [ ] find it\n- [ ] fix it\n',
    labels: [{ name: 'bug' }],
    comments,
    url: `https://example.invalid/${OWNER}/${NAME}/issues/${NUMBER}`,
    state: 'OPEN',
    author: { login: 'someone' },
  };
  const script = [
    '#!/usr/bin/env node',
    "const { appendFileSync, existsSync, readFileSync, writeFileSync } = require('node:fs');",
    'const args = process.argv.slice(2);',
    `appendFileSync(${JSON.stringify(log)}, args.join(' ') + '\\n');`,
    `const issue = ${JSON.stringify(issue)};`,
    `const store = ${JSON.stringify(join(bin, 'remote-comments.json'))};`,
    "const stored = existsSync(store) ? JSON.parse(readFileSync(store)) : issue.comments.map(c => ({ id: Number(/issuecomment-(\\d+)/.exec(c.url)?.[1]), body: c.body, html_url: c.url, user: { login: 'acme' } }));",
    `if (args[0] === 'repo' && args[1] === 'view') return console.log(JSON.stringify({ owner: { login: ${JSON.stringify(OWNER)} }, name: ${JSON.stringify(NAME)}, defaultBranchRef: { name: 'main' } }));`,
    "if (args[0] === 'issue' && args[1] === 'view') {",
    "  if (args[args.indexOf('--json') + 1] === 'comments') return console.log(JSON.stringify({ comments: issue.comments }));",
    '  return console.log(JSON.stringify(issue));',
    '}',
    "if (args[0] === 'issue' && args[1] === 'list') return console.log(JSON.stringify([issue]));",
    "if (args[0] === 'issue' && args[1] === 'comment') { const id = 999 + stored.filter(c=>c.created).length; const url = 'https://example.invalid/c#issuecomment-' + id; stored.push({ id, html_url:url, body:readFileSync(args[args.indexOf('--body-file')+1],'utf8'), user:{login:'acme'}, created:true }); writeFileSync(store,JSON.stringify(stored)); return console.log(url); }",
    "if (args[0] === 'api' && args[1] === 'user') return console.log('acme');",
    "if (args[0] === 'api' && args.includes('--paginate')) return console.log(JSON.stringify([stored]));",
    "if (args[0] === 'api' && args.includes('PATCH')) { const body=JSON.parse(readFileSync(args[args.indexOf('--input')+1])).body; const id=Number(args.find(s=>/\\/comments\\/\\d+$/.test(s)).split('/').pop()); const c=stored.find(c=>c.id===id); c.body=body; writeFileSync(store,JSON.stringify(stored)); return console.log(c.html_url); }",
    "if (args[0] === 'api') return console.log('https://example.invalid/c#issuecomment-999');",
    'process.exit(1);',
  ].join('\n');
  writeFileSync(join(bin, 'gh'), script);
  chmodSync(join(bin, 'gh'), 0o755);
  return log;
}

const calls = (log) => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : []);
const commentCalls = (log) =>
  calls(log).filter((l) => l.startsWith('issue comment ') || (l.startsWith('api ') && l.includes('-X PATCH')));

/** A fixture whose `gh` is on `PATH` for the CLI child processes only. */
function online({ comments = [] } = {}) {
  const repoPath = tempRepo();
  const bin = mkdtempSync(join(tmpdir(), 'issueflow-parallel-gh-'));
  const log = stubGh(bin, { comments });
  const runDir = join(mkdtempSync(join(tmpdir(), 'issueflow-parallel-run-')), 'run');
  const env = { PATH: `${bin}:${process.env.PATH}` };
  return {
    repoPath,
    log,
    runDir,
    start: (extra = []) => cli(['start', '--repo', repoPath, '--issue', String(NUMBER), '--run-dir', runDir, ...extra], env),
    cleanup: () => {
      for (const p of [repoPath, bin, dirname(runDir)]) rmSync(p, { recursive: true, force: true });
    },
  };
}

const claimComment = (owner = OWNER, name = NAME, number = NUMBER) => ({
  body: `${markerFor(owner, name, number)}\n### 🤖 issueflow — ${owner}/${name}#${number}\n\nsession A\n`,
  url: `https://example.invalid/${owner}/${name}/issues/${number}#issuecomment-999`,
});

// ---------------------------------------------------------------------------
// start — the refusals, and the override that is the one way past them.
// ---------------------------------------------------------------------------

test('start on an issue claimed from another machine refuses before it can republish over the claim', () => {
  const f = online({ comments: [claimComment()] });
  const r = f.start();

  assert.equal(r.code, 4, `expected a hand-back, got ${r.code}: ${r.err || r.out}`);
  assert.match(r.err, /already claimed by an issueflow run on another machine/);
  assert.match(r.err, /issuecomment-999/, 'the refusal must name the comment to read');
  assert.equal(existsSync(join(f.runDir, 'run.json')), false, 'a refused start must write no state');
  assert.deepEqual(commentCalls(f.log), [], 'the refusal must happen before the checkpoint touches the claim');
  f.cleanup();
});

test('start on an unclaimed issue still runs and still posts — the refusal is conditional, not blanket', () => {
  // The green half. Without it the refusal could be unconditional, or
  // `checkpoint` could have stopped calling `gh` at all, and the case above
  // would still pass.
  const f = online({ comments: [{ body: 'just a normal comment', url: 'https://example.invalid/c#issuecomment-1' }] });
  const r = f.start();

  assert.equal(r.code, 0, `expected a clean start, got ${r.code}: ${r.err}`);
  assert.equal(existsSync(join(f.runDir, 'run.json')), true);
  assert.equal(commentCalls(f.log).length, 1, 'an unclaimed issue gets this run\'s sticky comment');
  assert.match(commentCalls(f.log)[0], /^issue comment 42 /);
  f.cleanup();
});

test('--take-over is the one way past a claim on another machine, and it does republish', () => {
  const f = online({ comments: [claimComment()] });
  const r = f.start(['--take-over']);

  assert.equal(r.code, 0, `--take-over must proceed, got ${r.code}: ${r.err}`);
  assert.equal(existsSync(join(f.runDir, 'run.json')), true);
  // Deliberately: the human said take it over, so the stranger's comment is
  // adopted and rewritten. That is the whole cost of the flag.
  assert.ok(commentCalls(f.log).some((l) => l.includes('-X PATCH')), 'taking over adopts and rewrites the claim');
  f.cleanup();
});

test('start twice into one run directory leaves the first run byte-identical and posts nothing the second time', () => {
  const f = online();
  const first = f.start();
  assert.equal(first.code, 0, `the first start must succeed, got ${first.code}: ${first.err}`);
  const before = readFileSync(join(f.runDir, 'run.json'), 'utf8');
  const postedOnce = commentCalls(f.log).length;

  const second = f.start();
  assert.equal(second.code, 4, `the second start must hand back, got ${second.code}: ${second.err}`);
  assert.equal(readFileSync(join(f.runDir, 'run.json'), 'utf8'), before, 'the second session reset the first');
  assert.equal(commentCalls(f.log).length, postedOnce, 'the second start must not touch the checkpoint comment');
  assert.equal(postedOnce, 1);
  f.cleanup();
});

test('--take-over overwrites a local run too — the case it is most needed for', () => {
  const f = online();
  assert.equal(f.start().code, 0);
  // Move the run on, so the take-over has something to overwrite: two fresh
  // starts of one issue are byte-identical, and comparing them would prove
  // nothing either way.
  const state = JSON.parse(readFileSync(join(f.runDir, 'run.json'), 'utf8'));
  state.stages[0].state = 'approved';
  writeFileSync(join(f.runDir, 'run.json'), `${JSON.stringify(state, null, 2)}\n`);

  const second = f.start(['--take-over']);
  assert.equal(second.code, 0, `--take-over must proceed, got ${second.code}: ${second.err}`);
  assert.equal(
    JSON.parse(readFileSync(join(f.runDir, 'run.json'), 'utf8')).stages[0].state,
    'pending',
    'the override must not be inert on the exclusive create it exists to bypass',
  );
  f.cleanup();
});

test('a run `loadRun` refuses is refused with its own reason and `--take-over`, never a `next` that would fail too', () => {
  // `loadRun` already says a schema-mismatched run is not resumable, so
  // printing `next --run-dir` here would send the reader to a command that
  // fails for the same reason. Paired with the loadable case below, so a
  // refusal that collapsed to one message fails one of the two.
  const f = online();
  assert.equal(f.start().code, 0);
  const loadable = f.start();
  assert.match(loadable.err, /next --run-dir/, 'a resumable run gets the resume command');
  assert.doesNotMatch(loadable.err, /--take-over/, 'and is not first offered the destructive override');

  const state = JSON.parse(readFileSync(join(f.runDir, 'run.json'), 'utf8'));
  state.schema = 99;
  writeFileSync(join(f.runDir, 'run.json'), `${JSON.stringify(state, null, 2)}\n`);

  const broken = f.start();
  assert.equal(broken.code, 4, `expected a hand-back, got ${broken.code}: ${broken.err}`);
  assert.match(broken.err, /--take-over/, 'a run that cannot be resumed must be given a way out');
  assert.doesNotMatch(broken.err, /next --run-dir/, 'and must not be pointed at a command that fails identically');
  f.cleanup();
});

test('claimRunDir loses the race it cannot read its way out of', () => {
  // Two `start` invocations milliseconds apart both read "no run.json" and
  // both write one, so the read-then-write refusal above is advisory. The
  // exclusive create is what makes the loser lose.
  const dir = mkdtempSync(join(tmpdir(), 'issueflow-parallel-claim-'));
  const run = createRun({
    repo: { owner: OWNER, name: NAME, path: dir, defaultBranch: 'main' },
    issue: { number: NUMBER, title: 't', url: 'u', body: 'b' },
    policy: { base: 'main', featurePrefix: 'feature/', mergeMethod: 'squash', source: 'test', shipflow: false },
  });
  claimRunDir(dir, run);
  assert.throws(() => claimRunDir(dir, run), HandBack, 'the second claim must lose, not overwrite');
  claimRunDir(dir, run, { takeOver: true });
  rmSync(dir, { recursive: true, force: true });
});

test('an offline replay of a payload whose real comment carries a marker still starts', () => {
  // `evals/inputs/issue-132.json` is a real auto-mode run's payload and its
  // real sticky comment carries a real marker. An offline run makes no `gh`
  // call, so it can clobber nothing and makes no claim — this is what keeps
  // `evals/baseline/update.mjs` working.
  const repoPath = tempRepo();
  const dir = join(mkdtempSync(join(tmpdir(), 'issueflow-parallel-offline-')), 'run');
  const payload = JSON.parse(readFileSync(join(INPUTS, 'issue-132.json'), 'utf8'));
  assert.match(
    JSON.stringify(payload.comments),
    /issueflow:run natejswenson\/local-fitness#132/,
    'the fixture stopped carrying the marker this case is about',
  );

  const r = cli(['start', '--repo', repoPath, '--repo-json', join(INPUTS, 'repo.json'), '--run-dir', dir,
    '--issue', '132', '--issue-json', join(INPUTS, 'issue-132.json'), '--auto']);
  assert.equal(r.code, 0, `an offline replay must still start, got ${r.code}: ${r.err}`);
  rmSync(repoPath, { recursive: true, force: true });
  rmSync(dirname(dir), { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// claimedIn — defended inputs, the finished exemption, and a real commentId.
// ---------------------------------------------------------------------------

test('claimedIn reads "no comments" off a count, the shape board.mjs already defends against, instead of throwing', () => {
  // `board.mjs:80` already reads `comments` as either an array or a count —
  // feeding the same shape to `claimedIn` must not crash `board`/`start`.
  assert.equal(claimedIn(3, OWNER, NAME, NUMBER), null);
  assert.equal(claimedIn('some string', OWNER, NAME, NUMBER), null);
  assert.equal(claimedIn(undefined, OWNER, NAME, NUMBER), null);
  // The green half: an actual array with the marker still matches.
  assert.ok(claimedIn([claimComment()], OWNER, NAME, NUMBER));
});

test('claimedIn synthesizes commentId from the comment URL, the way gh.mjs already does for every other caller', () => {
  const claim = claimedIn([claimComment()], OWNER, NAME, NUMBER);
  assert.equal(claim.commentId, 999, `expected the id encoded in the fixture URL, got ${claim.commentId}`);
});

test('claimedIn skips a comment that also carries FINISHED_MARKER — a closed run\'s own note, not a live claim', () => {
  const dead = {
    body: `${markerFor(OWNER, NAME, NUMBER)}\n### issueflow\n\n${FINISHED_MARKER} **Finished** 2026-01-01T00:00:00.000Z — every lane landed.\n`,
    url: `https://example.invalid/${OWNER}/${NAME}/issues/${NUMBER}#issuecomment-1`,
  };
  assert.equal(claimedIn([dead], OWNER, NAME, NUMBER), null);
  // The green half: the same body without the finished marker still claims.
  assert.ok(claimedIn([claimComment()], OWNER, NAME, NUMBER));
});

test('finishedIn recognizes a pre-0.8.0 comment that never carried FINISHED_MARKER at all', () => {
  // Every issueflow release before 0.8.0 wrote the finished line with no
  // marker in front of it — the marker did not exist yet. A comment written
  // by that code (natejswenson/local-fitness#132 and #133, worked to
  // completion before this version) must still read as finished, or
  // `claimedIn` treats it as a live claim on an issue nobody holds, and
  // `--take-over` then adopts and PATCHes over it as if it were live
  // (f-9d600850).
  const legacyBody = `${markerFor(OWNER, NAME, NUMBER)}\n### issueflow\n\n**Finished** 2026-01-01T00:00:00.000Z — every lane landed.\n`;
  assert.equal(finishedIn(legacyBody), true, 'an unmarked pre-0.8.0 Finished line must still count as finished');
  assert.equal(claimedIn([{ body: legacyBody, url: `https://example.invalid/${OWNER}/${NAME}/issues/${NUMBER}#issuecomment-1` }], OWNER, NAME, NUMBER), null,
    'and claimedIn must skip it, exactly as it skips the marked line');
  // The green half: a comment with no Finished line of any kind still claims.
  assert.ok(claimedIn([claimComment()], OWNER, NAME, NUMBER));
});

test('start reads a pre-0.8.0 finished comment as done, not as a stranger\'s live claim, with no local run at all', () => {
  const legacyFinished = {
    body: `${markerFor(OWNER, NAME, NUMBER)}\n### issueflow\n\n**Finished** 2026-01-01T00:00:00.000Z — every lane landed.\n`,
    url: `https://example.invalid/${OWNER}/${NAME}/issues/${NUMBER}#issuecomment-778`,
  };
  const f = online({ comments: [legacyFinished] });
  const r = f.start();
  assert.equal(r.code, 0, `a pre-0.8.0 finished comment must not read as a live claim, got ${r.code}: ${r.err}`);
  assert.equal(existsSync(join(f.runDir, 'run.json')), true);
  f.cleanup();
});

test('a failed source reservation releases its fresh claim so start can retry after lease contention', (t) => {
  const f = online();
  t.after(f.cleanup);
  const holderDir = mkdtempSync(join(tmpdir(), 'issueflow-source-holder-'));
  t.after(() => rmSync(holderDir, { recursive: true, force: true }));
  const holder = createRun({
    repo: { owner: OWNER, name: NAME, path: f.repoPath, defaultBranch: 'main' },
    issue: { number: 7, title: 'holder', url: 'https://example.invalid/7' },
    policy: { base: 'main', featurePrefix: 'feature/', mergeMethod: 'squash', source: 'test', shipflow: false },
  });
  saveRun(holderDir, holder);
  prepareCheckout(holderDir, holder, holder.lanes[0], { noWorktree: true });

  const blocked = f.start(['--no-worktree']);
  assert.equal(blocked.code, 3, `lease contention must be infrastructure failure, got ${blocked.code}: ${blocked.err}`);
  assert.equal(existsSync(join(f.runDir, 'run.json')), false, 'a failed reservation must not leave an unresumable claim');
  assert.equal(existsSync(join(f.runDir, 'inputs', 'issue.json')), false, 'the absent claim has no misleading frozen input');

  releaseSourceLease(holderDir, holder);
  const retry = f.start(['--no-worktree']);
  assert.equal(retry.code, 0, `start must retry cleanly once the lease is available: ${retry.err}`);
  assert.equal(existsSync(join(f.runDir, 'inputs', 'issue.json')), true, 'the successful claim freezes its issue');
});

test('--take-over reclaims a source lease when the displaced run lost its checkout mode', (t) => {
  const f = online();
  t.after(f.cleanup);
  assert.equal(f.start(['--no-worktree']).code, 0);
  const state = JSON.parse(readFileSync(join(f.runDir, 'run.json'), 'utf8'));
  delete state.checkout;
  writeFileSync(join(f.runDir, 'run.json'), `${JSON.stringify(state, null, 2)}\n`);

  const replacement = f.start(['--take-over', '--no-worktree']);
  assert.equal(replacement.code, 0, `take-over must reclaim the surviving lease: ${replacement.err}`);
});

// ---------------------------------------------------------------------------
// start on a finished, or taken-over, run (#251 findings f-e3b86bc0,
// f-c17c24c8, f-b005fdf5, f-dfd22552).
// ---------------------------------------------------------------------------

test('a finished run\'s own dead marker comment does not block a later start once local state is gone', () => {
  // The issue was worked to completion, `finish` ran, and the local run
  // directory is gone (a wiped home, a different machine, a --run-dir under a
  // temp dir) — nothing but the sticky comment remains. Reopening the issue
  // (or working it a second time) must not read that comment as a stranger's
  // live claim.
  const finishedComment = {
    body: `${markerFor(OWNER, NAME, NUMBER)}\n### issueflow\n\n${FINISHED_MARKER} **Finished** 2026-01-01T00:00:00.000Z — every lane landed.\n`,
    url: `https://example.invalid/${OWNER}/${NAME}/issues/${NUMBER}#issuecomment-777`,
  };
  const f = online({ comments: [finishedComment] });
  const r = f.start();
  assert.equal(r.code, 0, `a finished run's own dead marker must not read as a live claim, got ${r.code}: ${r.err}`);
  assert.equal(existsSync(join(f.runDir, 'run.json')), true);
  f.cleanup();
});

test('start on a local run marked finished proceeds without --take-over, and resets its state', () => {
  const f = online();
  assert.equal(f.start().code, 0);
  const state = JSON.parse(readFileSync(join(f.runDir, 'run.json'), 'utf8'));
  state.stages[0].state = 'approved';
  state.finished = { at: '2026-01-01T00:00:00.000Z', issueClosed: false };
  writeFileSync(join(f.runDir, 'run.json'), `${JSON.stringify(state, null, 2)}\n`);

  const second = f.start();
  assert.equal(second.code, 0, `a finished run must not need --take-over, got ${second.code}: ${second.err}`);
  const fresh = JSON.parse(readFileSync(join(f.runDir, 'run.json'), 'utf8'));
  assert.equal(fresh.stages[0].state, 'pending', 'the reopened issue gets a fresh state machine');
  assert.equal(fresh.finished, null, 'a fresh run is not finished');
  f.cleanup();
});

test('the no-flag finished-run shortcut refuses a --run-dir that holds a DIFFERENT issue\'s finished run, and touches nothing in it', () => {
  // `refuseClaimed`\'s `--take-over` branch checks the run at `dir` belongs to
  // the issue being started before it ever returns; the finished-run
  // shortcut reached the identical destructive reset (`takeOver` at the
  // `cmdStart` call site folds `claim.finished` in unconditionally) with NO
  // such check — a `--run-dir` copied from an earlier session\'s notes, naming
  // a finished run for some other issue, was archived and wiped with no flag
  // at all (f-2aef04ce).
  const f = online();
  assert.equal(f.start().code, 0);
  const lane = JSON.parse(readFileSync(join(f.runDir, 'run.json'), 'utf8')).lanes[0];
  const wt = ensureWorktree(f.repoPath, f.runDir, lane).path;
  const state = JSON.parse(readFileSync(join(f.runDir, 'run.json'), 'utf8'));
  state.finished = { at: '2026-01-01T00:00:00.000Z', issueClosed: false };
  writeFileSync(join(f.runDir, 'run.json'), `${JSON.stringify(state, null, 2)}\n`);
  const before = readFileSync(join(f.runDir, 'run.json'), 'utf8');

  const otherIssuePath = join(dirname(f.runDir), 'other-issue-finished.json');
  writeFileSync(otherIssuePath, JSON.stringify({
    number: 999,
    title: 'A completely different issue',
    body: 'x',
    labels: [],
    comments: [],
    url: 'https://example.invalid/acme/widgets/issues/999',
    state: 'OPEN',
    author: { login: 'someone' },
  }));

  const r = cli(
    ['start', '--repo', f.repoPath, '--issue', '999', '--issue-json', otherIssuePath, '--run-dir', f.runDir],
    { PATH: `${dirname(f.log)}:${process.env.PATH}` },
  );
  assert.equal(r.code, 4, `expected a hand-back, got ${r.code}: ${r.err || r.out}`);
  assert.match(r.err, /#999/, 'the refusal must name the mismatched issue being started');
  assert.match(r.err, /42/, 'and the issue the finished run at --run-dir actually belongs to');
  assert.equal(existsSync(wt), true, 'the wrong issue\'s worktree must survive untouched');
  assert.equal(readFileSync(join(f.runDir, 'run.json'), 'utf8'), before, 'run.json must be untouched');
  rmSync(otherIssuePath, { force: true });
  f.cleanup();
});

test('start on a finished run does not leak its old artifacts into the fresh run\'s delivered state', () => {
  // The bug this closes: `--take-over` (explicit or implicit-via-finished)
  // used to rewrite only run.json, so a stage artifact still on disk from the
  // displaced run made the fresh, all-pending run instantly report that stage
  // as already delivered.
  const f = online();
  assert.equal(f.start().code, 0);
  writeFileSync(join(f.runDir, 'shared', 'investigate.md'), '## Root cause\n\nsomeone else\'s plan.\n');
  const state = JSON.parse(readFileSync(join(f.runDir, 'run.json'), 'utf8'));
  state.finished = { at: '2026-01-01T00:00:00.000Z', issueClosed: false };
  writeFileSync(join(f.runDir, 'run.json'), `${JSON.stringify(state, null, 2)}\n`);

  assert.equal(f.start().code, 0);
  assert.equal(
    existsSync(join(f.runDir, 'shared', 'investigate.md')), false,
    'the displaced session\'s artifact must not survive into the fresh run',
  );
  f.cleanup();
});

test('--take-over clears the previous run\'s artifacts, worktree and branch — not just run.json', () => {
  const f = online();
  assert.equal(f.start().code, 0);
  const run = JSON.parse(readFileSync(join(f.runDir, 'run.json'), 'utf8'));
  const lane = run.lanes[0];

  // Stand in for a session that reached implement: an artifact on disk and a
  // worktree with a real commit on the lane's branch.
  mkdirSync(join(f.runDir, 'shared'), { recursive: true });
  writeFileSync(join(f.runDir, 'shared', 'investigate.md'), '## Root cause\n\nsession A\'s plan.\n');
  const wt = ensureWorktree(f.repoPath, f.runDir, lane).path;
  writeFileSync(join(wt, 'work.txt'), 'session A\'s work\n');
  git(['add', 'work.txt'], wt);
  git(['-c', 'user.email=test@example.invalid', '-c', 'user.name=issueflow tests', 'commit', '-qm', 'session A commit'], wt);
  assert.equal(
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${lane.branch}`], { cwd: f.repoPath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().length > 0,
    true,
    'the fixture must actually have session A\'s branch',
  );

  const second = f.start(['--take-over']);
  assert.equal(second.code, 0, `--take-over must proceed, got ${second.code}: ${second.err}`);
  assert.equal(existsSync(join(f.runDir, 'shared', 'investigate.md')), false, 'the displaced artifact must be gone');
  assert.equal(existsSync(wt), false, 'the displaced worktree must be gone');
  let branchGone = false;
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${lane.branch}`], { cwd: f.repoPath, stdio: 'ignore' });
  } catch {
    branchGone = true;
  }
  assert.equal(branchGone, true, 'the displaced branch must be deleted, not silently reused by the fresh run');
  f.cleanup();
});

/** The single `superseded/<timestamp>/` a take-over just wrote, or null. */
function archiveOf(runDir) {
  const root = join(runDir, 'superseded');
  if (!existsSync(root)) return null;
  const stamps = readdirSync(root);
  assert.equal(stamps.length, 1, `expected exactly one archive under ${root}, got ${stamps.join(', ')}`);
  return join(root, stamps[0]);
}

test('a displaced run\'s artifacts move to superseded/, they are not deleted', () => {
  // The reset takes them out of the fresh run's way — `deliveredSince` and
  // `hasContent` read them straight off disk — but a run's plan, evidence and
  // review rounds are the only local account of how a change was designed and
  // proved, and the finished-run path reaches this with no flag at all. Out of
  // the way is not the same as gone.
  const f = online();
  assert.equal(f.start().code, 0);
  mkdirSync(join(f.runDir, 'shared'), { recursive: true });
  writeFileSync(join(f.runDir, 'shared', 'investigate.md'), '## Root cause\n\nsession A\'s plan.\n');
  const state = JSON.parse(readFileSync(join(f.runDir, 'run.json'), 'utf8'));
  state.finished = { at: '2026-01-01T00:00:00.000Z', issueClosed: false };
  writeFileSync(join(f.runDir, 'run.json'), `${JSON.stringify(state, null, 2)}\n`);

  const second = f.start();
  assert.equal(second.code, 0, `a finished run must not need --take-over, got ${second.code}: ${second.err}`);
  const archive = archiveOf(f.runDir);
  assert.ok(archive, 'the displaced run left no archive at all');
  assert.equal(
    readFileSync(join(archive, 'shared', 'investigate.md'), 'utf8'),
    '## Root cause\n\nsession A\'s plan.\n',
    'the displaced plan must survive, unchanged',
  );
  assert.ok(existsSync(join(archive, 'run.json')), 'the displaced state file goes with it');
  // And the fresh run must be able to say where, or the archive is a secret.
  assert.match(second.out, /superseded/, 'start must print where the previous run went');
  f.cleanup();
});

test('--take-over on a directory that holds no run deletes nothing in it', () => {
  // `dir` on this path is whatever `--run-dir` names. A mistyped or
  // tab-completed path used to reach an unguarded recursive delete of the whole
  // directory — the pre-0.8.0 code could only ever overwrite a `run.json`.
  const f = online();
  const notARun = mkdtempSync(join(tmpdir(), 'issueflow-parallel-notes-'));
  mkdirSync(join(notARun, 'chapters'), { recursive: true });
  writeFileSync(join(notARun, 'chapters', 'one.md'), 'a year of notes\n');

  const r = cli(['start', '--repo', f.repoPath, '--issue', String(NUMBER), '--run-dir', notARun, '--take-over'],
    { PATH: `${dirname(f.log)}:${process.env.PATH}` });
  assert.equal(r.code, 0, `expected a clean start, got ${r.code}: ${r.err}`);
  assert.equal(readFileSync(join(notARun, 'chapters', 'one.md'), 'utf8'), 'a year of notes\n', 'the directory was not a run — nothing in it may be touched');
  assert.equal(existsSync(join(notARun, 'superseded')), false, 'and there was nothing to archive either');
  rmSync(notARun, { recursive: true, force: true });
  f.cleanup();
});

test('a worktree git refused to remove is still unregistered, so the fresh run can create it again', () => {
  // `removeWorktree` swallows a failure — a corrupt `.git` file makes
  // `git worktree remove --force` refuse outright, leaving the worktree
  // present AND registered. Pruning at that moment prunes nothing; only a
  // prune AFTER the directory has moved out from under the registered path
  // clears it, and until it is cleared the fresh run's first
  // `git worktree add <same path>` fails with "already registered".
  const f = online();
  assert.equal(f.start().code, 0);
  const lane = JSON.parse(readFileSync(join(f.runDir, 'run.json'), 'utf8')).lanes[0];
  const wt = ensureWorktree(f.repoPath, f.runDir, lane).path;
  writeFileSync(join(wt, '.git'), 'not a gitfile\n');
  assert.match(git(['worktree', 'list'], f.repoPath), new RegExp(wt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'the fixture must actually leave a registered worktree');

  assert.equal(f.start(['--take-over']).code, 0);
  assert.doesNotMatch(
    git(['worktree', 'list'], f.repoPath),
    new RegExp(wt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    'a worktree whose directory has moved must not stay registered',
  );
  // `created` is true on BOTH arms of `ensureWorktree` — the branch-exists arm
  // (`git worktree add path branch`) returns it just like the branch-creating
  // one does — so on its own this proves only that a checkout exists again,
  // not that it is a FRESH one. The branch-deletion guarantee this whole test
  // is named for is only proved by checking the branch itself is gone
  // (f-2505ede1): without it, this passes whether `git branch -D` succeeded
  // or was silently swallowed while the branch was still checked out.
  let branchGone = false;
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${lane.branch}`], { cwd: f.repoPath, stdio: 'ignore' });
  } catch {
    branchGone = true;
  }
  assert.equal(branchGone, true, 'the displaced branch must be deleted, not silently reused by the fresh run');
  // The consequence, driven rather than argued: the fresh run provisions the
  // same path, which is what "already registered" would have refused.
  assert.equal(ensureWorktree(f.repoPath, f.runDir, lane).created, true);
  f.cleanup();
});

test('--take-over still clears the worktree and branch when run.json cannot be parsed at all', () => {
  // The state `timings.mjs` already tolerates elsewhere: a run.json truncated
  // by a crash or caught mid-write, one of the two documented reasons
  // `--take-over` exists (the other is a schema mismatch, which still
  // parses). A run this broken cannot report its own lanes, so the cleanup
  // has to find them another way — reading what git itself has registered
  // under this run's `worktrees/` — rather than silently skip them
  // (f-aa170334, f-719043d6).
  const f = online();
  assert.equal(f.start().code, 0);
  const run = JSON.parse(readFileSync(join(f.runDir, 'run.json'), 'utf8'));
  const lane = run.lanes[0];
  const wt = ensureWorktree(f.repoPath, f.runDir, lane).path;
  writeFileSync(join(wt, 'work.txt'), 'session A\'s work\n');
  git(['add', 'work.txt'], wt);
  git(['-c', 'user.email=test@example.invalid', '-c', 'user.name=issueflow tests', 'commit', '-qm', 'session A commit'], wt);

  // Genuinely unparseable — truncated mid-object, not merely an unknown
  // schema number (which still parses and takes a different code path).
  const raw = readFileSync(join(f.runDir, 'run.json'), 'utf8');
  writeFileSync(join(f.runDir, 'run.json'), raw.slice(0, Math.floor(raw.length / 2)));

  const second = f.start(['--take-over']);
  assert.equal(second.code, 0, `--take-over must proceed even over unparseable state, got ${second.code}: ${second.err}`);
  assert.equal(existsSync(wt), false, 'the displaced worktree must be gone');
  let branchGone = false;
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${lane.branch}`], { cwd: f.repoPath, stdio: 'ignore' });
  } catch {
    branchGone = true;
  }
  assert.equal(branchGone, true, 'the displaced branch must be deleted even when run.json could not be read at all');
  f.cleanup();
});

test('--take-over on a --run-dir that holds a DIFFERENT issue refuses, and touches nothing in it', () => {
  // `dir` on this path is whatever `--run-dir` names — a mistyped or
  // tab-completed path, or a stale path copied from an earlier session's
  // notes. `--take-over` must not force-clean and archive a live issue's run
  // just because it was passed for some OTHER issue (f-6d1c2ac7).
  const f = online();
  assert.equal(f.start().code, 0);
  const before = readFileSync(join(f.runDir, 'run.json'), 'utf8');
  const lane = JSON.parse(before).lanes[0];
  const wt = ensureWorktree(f.repoPath, f.runDir, lane).path;

  const otherIssuePath = join(dirname(f.runDir), 'other-issue.json');
  writeFileSync(otherIssuePath, JSON.stringify({
    number: 999,
    title: 'A completely different issue',
    body: 'x',
    labels: [],
    comments: [],
    url: 'https://example.invalid/acme/widgets/issues/999',
    state: 'OPEN',
    author: { login: 'someone' },
  }));

  const r = cli(
    ['start', '--repo', f.repoPath, '--issue', '999', '--issue-json', otherIssuePath, '--run-dir', f.runDir, '--take-over'],
    { PATH: `${dirname(f.log)}:${process.env.PATH}` },
  );
  assert.equal(r.code, 4, `expected a hand-back, got ${r.code}: ${r.err || r.out}`);
  assert.match(r.err, /#999/, 'the refusal must name the mismatched issue being started');
  assert.match(r.err, /42/, 'and the issue the run at --run-dir actually belongs to');
  assert.equal(existsSync(wt), true, 'the wrong issue\'s worktree must survive untouched');
  assert.equal(readFileSync(join(f.runDir, 'run.json'), 'utf8'), before, 'run.json must be untouched');
  rmSync(otherIssuePath, { force: true });
  f.cleanup();
});

test('--take-over on a --run-dir that holds a run for the SAME issue number in a DIFFERENT repository refuses, and touches nothing in it', () => {
  // The mismatch guard above only ever compared the issue number, never the
  // owner or the repository name — a `--run-dir` naming a live run for the
  // same number in an unrelated repository (mistyped, tab-completed, or
  // copied from another session's notes, the exact cases the guard's own
  // comment names) passed it and was force-cleaned under the wrong
  // repository's name (f-acd1d8b8).
  const f = online();
  assert.equal(f.start().code, 0);
  const before = readFileSync(join(f.runDir, 'run.json'), 'utf8');
  const lane = JSON.parse(before).lanes[0];
  const wt = ensureWorktree(f.repoPath, f.runDir, lane).path;

  const otherRepoPath = join(dirname(f.runDir), 'other-repo.json');
  writeFileSync(otherRepoPath, JSON.stringify({ owner: 'other-owner', name: 'other-repo', defaultBranch: 'main' }));

  const r = cli(
    ['start', '--repo', f.repoPath, '--repo-json', otherRepoPath, '--issue', String(NUMBER), '--run-dir', f.runDir, '--take-over'],
    { PATH: `${dirname(f.log)}:${process.env.PATH}` },
  );
  assert.equal(r.code, 4, `expected a hand-back, got ${r.code}: ${r.err || r.out}`);
  assert.match(r.err, new RegExp(`${OWNER}/${NAME}#${NUMBER}`), 'the refusal must name the repository the run at --run-dir actually belongs to');
  assert.equal(existsSync(wt), true, 'the other repository\'s worktree must survive untouched');
  assert.equal(readFileSync(join(f.runDir, 'run.json'), 'utf8'), before, 'run.json must be untouched');
  rmSync(otherRepoPath, { force: true });
  f.cleanup();
});

test('--take-over cleans a lane git still has registered from BEFORE a split even though run.lanes no longer names it', () => {
  // `split` replaces `run.lanes` wholesale, so a run briefed on the `root`
  // lane and then split keeps a real worktree and branch the new lane list
  // never mentions. Reading lanes only from `previous.lanes` (or only from
  // git's registration as a fallback) can never see both at once — the union
  // is what makes take-over find the pre-split lane too (f-26098252).
  const f = online();
  assert.equal(f.start().code, 0);
  const state = JSON.parse(readFileSync(join(f.runDir, 'run.json'), 'utf8'));
  const rootLane = state.lanes[0];
  const wt = ensureWorktree(f.repoPath, f.runDir, rootLane).path;
  writeFileSync(join(wt, 'work.txt'), 'pre-split work\n');
  git(['add', 'work.txt'], wt);
  git(['-c', 'user.email=test@example.invalid', '-c', 'user.name=issueflow tests', 'commit', '-qm', 'pre-split commit'], wt);

  // Simulate `split`: run.lanes is replaced by two lanes that never name
  // `rootLane`, exactly as run.mjs's own split does.
  state.split = true;
  state.lanes = [
    { ...rootLane, id: 'a', slug: 'a', branch: 'feature/issue-42-a' },
    { ...rootLane, id: 'b', slug: 'b', branch: 'feature/issue-42-b' },
  ];
  writeFileSync(join(f.runDir, 'run.json'), `${JSON.stringify(state, null, 2)}\n`);

  const second = f.start(['--take-over']);
  assert.equal(second.code, 0, `--take-over must proceed, got ${second.code}: ${second.err}`);
  assert.equal(existsSync(wt), false, 'the pre-split worktree must be gone, not left for the fresh run to collide with');
  let branchGone = false;
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${rootLane.branch}`], { cwd: f.repoPath, stdio: 'ignore' });
  } catch {
    branchGone = true;
  }
  assert.equal(branchGone, true, 'the pre-split branch must be deleted, not silently reused by a post-split lane');
  f.cleanup();
});

test('a claim on the issue outranks a local run `loadRun` cannot resume at all — the message names the claim, not just --take-over', () => {
  // The finished branch already makes a live claim outrank a finished local
  // run; the catch branch for a run that cannot be resumed at all (a schema
  // mismatch, or a run.json truncated mid-write) skipped that check
  // entirely and offered `--take-over` as the fix without ever saying a
  // claim exists (f-04525741).
  const f = online({ comments: [claimComment()] });
  assert.equal(f.start(['--take-over']).code, 0, 'the fixture needs a local run first');
  const state = JSON.parse(readFileSync(join(f.runDir, 'run.json'), 'utf8'));
  state.schema = 99;
  writeFileSync(join(f.runDir, 'run.json'), `${JSON.stringify(state, null, 2)}\n`);
  const before = readFileSync(join(f.runDir, 'run.json'), 'utf8');

  const broken = f.start();
  assert.equal(broken.code, 4, `a live claim outranks an unresumable local run, got ${broken.code}: ${broken.err}`);
  assert.match(broken.err, /already claimed by an issueflow run on another machine/);
  assert.match(broken.err, /issuecomment-999/, 'the refusal must name the comment to read, not just offer --take-over blind');
  assert.equal(readFileSync(join(f.runDir, 'run.json'), 'utf8'), before, 'a refused start must rewrite no state');
  f.cleanup();
});

test('--take-over falls back to the checkout it was actually pointed at when the recorded repo path no longer resolves', () => {
  // `previous.repo.path` can go stale — the checkout was renamed or
  // re-cloned, and runs live under ~/.claude and outlive checkouts. Before
  // this fix every cleanup below threw into an empty catch when that path
  // stopped resolving, `--take-over` still reported success, and the fresh
  // run then cut its lane from the displaced session's unpushed commits
  // (f-090ad77e).
  const f = online();
  assert.equal(f.start().code, 0);
  const run = JSON.parse(readFileSync(join(f.runDir, 'run.json'), 'utf8'));
  const lane = run.lanes[0];
  const wt = ensureWorktree(f.repoPath, f.runDir, lane).path;
  writeFileSync(join(wt, 'work.txt'), 'session A\'s unpushed work\n');
  git(['add', 'work.txt'], wt);
  git(['-c', 'user.email=test@example.invalid', '-c', 'user.name=issueflow tests', 'commit', '-qm', 'session A commit'], wt);

  // The recorded checkout goes stale — a moved or re-cloned working copy —
  // while `--repo` (this very invocation) still names the real one.
  const state = JSON.parse(readFileSync(join(f.runDir, 'run.json'), 'utf8'));
  state.repo.path = join(dirname(f.repoPath), 'a-checkout-that-was-moved-away');
  writeFileSync(join(f.runDir, 'run.json'), `${JSON.stringify(state, null, 2)}\n`);

  const second = f.start(['--take-over']);
  assert.equal(second.code, 0, `--take-over must proceed, got ${second.code}: ${second.err}`);
  assert.equal(existsSync(wt), false, 'the displaced worktree must be gone, not left behind by the stale path\'s empty catch');
  let branchGone = false;
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${lane.branch}`], { cwd: f.repoPath, stdio: 'ignore' });
  } catch {
    branchGone = true;
  }
  assert.equal(branchGone, true, 'the displaced branch must be deleted from the checkout the run is actually pointed at');
  // And the fresh run's own lane must provision cleanly, not collide with a
  // worktree registration the stale-path cleanup silently failed to clear.
  const fresh = JSON.parse(readFileSync(join(f.runDir, 'run.json'), 'utf8'));
  assert.equal(ensureWorktree(f.repoPath, f.runDir, fresh.lanes[0]).created, true);
  f.cleanup();
});

test('a plain start on a finished run does not force-delete a branch recreated afterward with commits this run never made', () => {
  // `finish` already deletes a landed lane's branch, so the only branch a
  // finished run's own cleanup should ever still find is one recreated by
  // hand after `finish` ran. SKILL.md scopes a force-delete of unverified
  // work to an EXPLICIT `--take-over`, not to the no-flag finished-run
  // shortcut a reopened issue reaches on its own (f-9eb3c38c).
  const f = online();
  assert.equal(f.start().code, 0);
  const run = JSON.parse(readFileSync(join(f.runDir, 'run.json'), 'utf8'));
  const lane = run.lanes[0];
  const wt = ensureWorktree(f.repoPath, f.runDir, lane).path;
  // Stand in for `finish`: the lane's own worktree and branch are gone, as
  // `finish` leaves them for a landed lane.
  git(['worktree', 'remove', '--force', wt], f.repoPath);
  execFileSync('git', ['branch', '-D', lane.branch], { cwd: f.repoPath, stdio: 'ignore' });

  const state = JSON.parse(readFileSync(join(f.runDir, 'run.json'), 'utf8'));
  state.finished = { at: '2026-01-01T00:00:00.000Z', issueClosed: false };
  writeFileSync(join(f.runDir, 'run.json'), `${JSON.stringify(state, null, 2)}\n`);

  // The maintainer recreates the SAME branch name by hand afterward and
  // commits follow-up work to it, unrelated to issueflow.
  git(['branch', lane.branch], f.repoPath);
  const manualWt = join(dirname(f.runDir), 'manual-checkout');
  git(['worktree', 'add', manualWt, lane.branch], f.repoPath);
  writeFileSync(join(manualWt, 'manual.txt'), 'hand-recreated follow-up work\n');
  git(['add', 'manual.txt'], manualWt);
  git(['-c', 'user.email=test@example.invalid', '-c', 'user.name=issueflow tests', 'commit', '-qm', 'manual follow-up'], manualWt);
  git(['worktree', 'remove', manualWt], f.repoPath);
  const manualTip = git(['rev-parse', lane.branch], f.repoPath);

  const second = f.start();
  assert.equal(second.code, 0, `a finished run must not need --take-over, got ${second.code}: ${second.err}`);
  const stillThere = git(['rev-parse', '--verify', '--quiet', `refs/heads/${lane.branch}`], f.repoPath);
  assert.equal(stillThere, manualTip, 'a plain start with no flag must never force-delete a branch carrying commits this run never made');
  f.cleanup();
});

test('a finished local run does not take over a claim somebody posted after it ended', () => {
  // Machine 1 finishes #42. The issue is reopened, machine 2 starts a fresh run
  // on it, and machine 2's checkpoint rewrites the sticky comment — which now
  // carries machine 2's live board and no finished marker. Machine 1 running a
  // plain `start` must refuse, or the finished-run exemption is a no-flag way
  // to republish an empty board over a live run.
  const f = online({ comments: [claimComment()] });
  assert.equal(f.start(['--take-over']).code, 0, 'the fixture needs a local run to mark finished');
  const state = JSON.parse(readFileSync(join(f.runDir, 'run.json'), 'utf8'));
  state.finished = { at: '2026-01-01T00:00:00.000Z', issueClosed: false };
  writeFileSync(join(f.runDir, 'run.json'), `${JSON.stringify(state, null, 2)}\n`);
  const before = readFileSync(join(f.runDir, 'run.json'), 'utf8');
  const postedSoFar = commentCalls(f.log).length;

  const r = f.start();
  assert.equal(r.code, 4, `a live claim outranks a finished local run, got ${r.code}: ${r.err || r.out}`);
  assert.match(r.err, /already claimed by an issueflow run on another machine/);
  assert.match(r.err, /issuecomment-999/, 'the refusal must name the comment to read');
  assert.equal(readFileSync(join(f.runDir, 'run.json'), 'utf8'), before, 'a refused start must rewrite no state');
  assert.equal(existsSync(join(f.runDir, 'superseded')), false, 'and must displace nothing');
  assert.equal(commentCalls(f.log).length, postedSoFar, 'and must not touch the claim it refused');
  f.cleanup();
});

test('a reopened issue gets its own comment — the finished run\'s record on the issue is never rewritten', () => {
  // `claimedIn` already knows a FINISHED_MARKER comment is a dead run.
  // `adoptComment` matched by marker alone, so the fresh run adopted the
  // finished run's sticky comment and PATCHed an all-pending board over it,
  // destroying that run's pull request links, merge times and artifacts — with
  // no flag and no warning.
  const finished = {
    body: `${markerFor(OWNER, NAME, NUMBER)}\n### issueflow\n\n${FINISHED_MARKER} **Finished** 2026-01-01T00:00:00.000Z — every lane landed, issue closed.\n`,
    url: `https://example.invalid/${OWNER}/${NAME}/issues/${NUMBER}#issuecomment-777`,
  };
  const f = online({ comments: [finished] });
  assert.equal(f.start().code, 0, 'a dead marker must not read as a live claim');
  const state = JSON.parse(readFileSync(join(f.runDir, 'run.json'), 'utf8'));
  state.finished = { at: '2026-01-01T00:00:00.000Z', issueClosed: true };
  writeFileSync(join(f.runDir, 'run.json'), `${JSON.stringify(state, null, 2)}\n`);

  const second = f.start();
  assert.equal(second.code, 0, `a finished run must not need --take-over, got ${second.code}: ${second.err}`);
  assert.deepEqual(
    commentCalls(f.log).filter((l) => l.includes('-X PATCH')), [],
    'the finished run\'s comment must never be adopted and rewritten',
  );
  assert.equal(commentCalls(f.log).length, 2, 'each run posts its own comment');
  f.cleanup();
});

// ---------------------------------------------------------------------------
// board — the Run column, and the rule that keeps the frozen board hermetic.
// ---------------------------------------------------------------------------

/** The `Run` cell of every issue row, keyed by issue number and resolved by column NAME. */
function runCells(out) {
  const lines = out.split('\n').filter((l) => l.startsWith('|'));
  const header = lines[0].split('|').map((c) => c.trim());
  const at = header.indexOf('Run');
  assert.notEqual(at, -1, `the board has no Run column:\n${out}`);
  const cells = new Map();
  for (const line of lines) {
    const cols = line.split('|').map((c) => c.trim());
    if (/^\d+$/.test(cols[1] ?? '')) cells.set(Number(cols[1]), cols[at]);
  }
  return cells;
}

/** The frozen issue list with one issue's comments replaced by another run's claim. */
function issuesClaiming(number) {
  const issues = JSON.parse(readFileSync(join(INPUTS, 'issues.json'), 'utf8'));
  issues.find((i) => i.number === number).comments = [claimComment('natejswenson', 'local-fitness', number)];
  const path = join(mkdtempSync(join(tmpdir(), 'issueflow-parallel-issues-')), 'issues.json');
  writeFileSync(path, `${JSON.stringify(issues, null, 2)}\n`);
  return path;
}

/** A run root holding one run for `number`, at the current schema unless asked otherwise. */
function runRootWith(number, { schema = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'issueflow-parallel-root-'));
  const dir = join(root, 'natejswenson__local-fitness', `issue-${number}`);
  mkdirSync(dir, { recursive: true });
  const run = createRun({
    repo: { owner: 'natejswenson', name: 'local-fitness', path: root, defaultBranch: 'main' },
    issue: { number, title: 't', url: 'u', body: 'b' },
    policy: { base: 'main', featurePrefix: 'feature/', mergeMethod: 'squash', source: 'test', shipflow: false },
  });
  saveRun(dir, run);
  if (schema !== null) {
    const state = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8'));
    state.schema = schema;
    writeFileSync(join(dir, 'run.json'), `${JSON.stringify(state, null, 2)}\n`);
  }
  return { root, dir };
}

const board = (extra) => cli(['board', '--repo', SKILL, '--repo-json', join(INPUTS, 'repo.json'), ...extra]);

test('board says which issue is claimed by a run on another machine, and which are free', () => {
  const issues = issuesClaiming(132);
  const empty = mkdtempSync(join(tmpdir(), 'issueflow-parallel-empty-'));
  const r = board(['--issues-json', issues, '--run-root', empty]);

  assert.equal(r.code, 0, r.err);
  const cells = runCells(r.out);
  assert.equal(cells.get(132), 'claimed');
  // Both halves in one assertion: a claim detector that matched everything
  // would pass the first line and fail these.
  assert.equal(cells.get(133), '—');
  assert.equal(cells.get(27), '—');
  assert.match(r.out, /`claimed` means a run\s+on another one/);
  rmSync(empty, { recursive: true, force: true });
  rmSync(dirname(issues), { recursive: true, force: true });
});

test('board reports a local run by its own state, which outranks a claim', () => {
  const issues = issuesClaiming(132);
  const { root } = runRootWith(133);
  const cells = runCells(board(['--issues-json', issues, '--run-root', root]).out);

  assert.equal(cells.get(133), 'in progress', 'a run on this machine reports its state');
  assert.equal(cells.get(132), 'claimed');
  assert.equal(cells.get(27), '—');
  rmSync(root, { recursive: true, force: true });
  rmSync(dirname(issues), { recursive: true, force: true });
});

test('a run board cannot read is `unreadable`, never `—` — a broken run must not read as a free issue', () => {
  const issues = issuesClaiming(132);
  const { root } = runRootWith(27, { schema: 1 });
  saveRun(join(root, 'natejswenson__local-fitness', 'issue-133'), createRun({
    repo: { owner: 'natejswenson', name: 'local-fitness', path: root, defaultBranch: 'main' },
    issue: { number: 133, title: 't', url: 'u', body: 'b' },
    policy: { base: 'main', featurePrefix: 'feature/', mergeMethod: 'squash', source: 'test', shipflow: false },
  }));
  const cells = runCells(board(['--issues-json', issues, '--run-root', root]).out);

  assert.equal(cells.get(27), 'unreadable');
  assert.equal(cells.get(133), 'in progress', 'a sibling run in the same root still reports its state');
  rmSync(root, { recursive: true, force: true });
  rmSync(dirname(issues), { recursive: true, force: true });
});

test('a frozen board scans no run root at all, so the golden cannot encode who regenerated it', () => {
  // Decisive where an empty HOME is not: the first invocation proves the run
  // directory is real and reachable, so the second can only print `—` by not
  // scanning. This machine really does hold a run for issue 132, and 132 is a
  // row in `evals/baseline/board.txt`.
  const issues = issuesClaiming(133);
  const home = mkdtempSync(join(tmpdir(), 'issueflow-parallel-home-'));
  const root = join(home, '.claude', 'issueflow');
  const dir = join(root, 'natejswenson__local-fitness', 'issue-132');
  mkdirSync(dir, { recursive: true });
  saveRun(dir, createRun({
    repo: { owner: 'natejswenson', name: 'local-fitness', path: home, defaultBranch: 'main' },
    issue: { number: 132, title: 't', url: 'u', body: 'b' },
    policy: { base: 'main', featurePrefix: 'feature/', mergeMethod: 'squash', source: 'test', shipflow: false },
  }));

  const scanned = cli(['board', '--repo', SKILL, '--repo-json', join(INPUTS, 'repo.json'), '--issues-json', issues,
    '--run-root', root], { HOME: home });
  assert.equal(runCells(scanned.out).get(132), 'in progress', 'the fixture must be real and reachable');

  const hermetic = cli(['board', '--repo', SKILL, '--repo-json', join(INPUTS, 'repo.json'), '--issues-json', issues],
    { HOME: home });
  assert.equal(runCells(hermetic.out).get(132), '—', 'a --issues-json board must read no run root');
  rmSync(home, { recursive: true, force: true });
  rmSync(dirname(issues), { recursive: true, force: true });
});

test('the hermetic rule is keyed on --issues-json, not on offlineness', () => {
  // `board` still calls `listIssues` over the network whenever `--issues-json`
  // is absent, so keying the scan on `isOffline` would blank the column on an
  // invocation that had just dialled out.
  const bin = mkdtempSync(join(tmpdir(), 'issueflow-parallel-gh-'));
  stubGh(bin);
  const home = mkdtempSync(join(tmpdir(), 'issueflow-parallel-home-'));
  const dir = join(home, '.claude', 'issueflow', `${OWNER}__${NAME}`, `issue-${NUMBER}`);
  mkdirSync(dir, { recursive: true });
  saveRun(dir, createRun({
    repo: { owner: OWNER, name: NAME, path: home, defaultBranch: 'main' },
    issue: { number: NUMBER, title: 't', url: 'u', body: 'b' },
    policy: { base: 'main', featurePrefix: 'feature/', mergeMethod: 'squash', source: 'test', shipflow: false },
  }));

  const r = cli(['board', '--repo', SKILL, '--offline'], { HOME: home, PATH: `${bin}:${process.env.PATH}` });
  assert.equal(r.code, 0, r.err);
  assert.equal(runCells(r.out).get(NUMBER), 'in progress', 'an --offline board with no frozen issues still scans');
  rmSync(home, { recursive: true, force: true });
  rmSync(bin, { recursive: true, force: true });
});

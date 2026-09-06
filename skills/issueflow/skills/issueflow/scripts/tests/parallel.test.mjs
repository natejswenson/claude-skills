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
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { markerFor } from '../lib/checkpoint.mjs';
import { HandBack, claimRunDir, createRun, saveRun } from '../lib/run.mjs';

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
    "const { appendFileSync } = require('node:fs');",
    'const args = process.argv.slice(2);',
    `appendFileSync(${JSON.stringify(log)}, args.join(' ') + '\\n');`,
    `const issue = ${JSON.stringify(issue)};`,
    `if (args[0] === 'repo' && args[1] === 'view') return console.log(JSON.stringify({ owner: { login: ${JSON.stringify(OWNER)} }, name: ${JSON.stringify(NAME)}, defaultBranchRef: { name: 'main' } }));`,
    "if (args[0] === 'issue' && args[1] === 'view') {",
    "  if (args[args.indexOf('--json') + 1] === 'comments') return console.log(JSON.stringify({ comments: issue.comments }));",
    '  return console.log(JSON.stringify(issue));',
    '}',
    "if (args[0] === 'issue' && args[1] === 'list') return console.log(JSON.stringify([issue]));",
    "if (args[0] === 'issue' && args[1] === 'comment') return console.log('https://example.invalid/c#issuecomment-999');",
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

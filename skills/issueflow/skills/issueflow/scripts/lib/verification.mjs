/** Controller-observed processes; digests detect mutation, they do not prove origin.
 * Repository executables still run with the controller's existing host permissions.
 * This is not an OS sandbox. Never grant additional permissions to run a check.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { RunError, laneTree, saveRun } from './run.mjs';
import { budgetStatus } from './budget.mjs';
import { checkScope, contractForLane, gitText, hash } from './contracts.mjs';
import { parseAllEvidence, twoSided } from './evidence.mjs';

const fail = (s) => { throw new RunError(`verification receipt: ${s}`); };
const envIdentity = () => hash({ node: process.version, platform: process.platform, arch: process.arch, path: process.env.PATH ?? '', nodeOptions: process.env.NODE_OPTIONS ?? '' });
const testIdentity = (root, files) => hash(files.map((file) => [file, hash(readFileSync(join(root, file)))]));
const attemptIdentity = (run, lane) => run.harness?.attempts?.[`${lane.slug}/implement.md`]?.id ?? lane.stages.find((s) => s.id === 'implement').at?.briefed;

const ignoredFiles = (tree) => gitText(tree, 'ls-files', '-z', '--others', '--ignored', '--exclude-standard').split('\0').filter(Boolean);
function internalLink(tree, file) {
  const path = join(tree, file);
  const target = readlinkSync(path);
  const resolved = relative(realpathSync(tree), realpathSync(path));
  if (isAbsolute(target) || resolved === '..' || resolved.startsWith('../') || isAbsolute(resolved) || resolved.split('/').includes('.git')) fail(`runtime symlink escapes the reproducible checkout: ${file}`);
  return target;
}

/** Ignored runtime inputs count too: a clean Git index is not an input identity. */
export function inputIdentity(tree) {
  const files = [...gitText(tree, 'ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0').filter(Boolean), ...ignoredFiles(tree)].sort();
  const entries = [...new Set(files)].map((file) => {
    const path = join(tree, file);
    if (!existsSync(path)) return [file, null];
    const st = lstatSync(path);
    if (st.isSymbolicLink()) return [file, 'symlink', internalLink(tree, file)];
    if (!st.isFile()) fail(`unsupported submodule/special input ${file}`);
    return [file, st.mode & 0o777, hash(readFileSync(path))];
  });
  return hash({ head: gitText(tree, 'rev-parse', 'HEAD'), status: gitText(tree, 'status', '--porcelain', '--untracked-files=all'), entries });
}

/** Reuse already-installed, fingerprinted local dependencies; never install or fetch. */
function copyRuntimeInputs(tree, target) {
  for (const file of ignoredFiles(tree)) {
    const source = join(tree, file); const path = join(target, file);
    const st = lstatSync(source);
    mkdirSync(dirname(path), { recursive: true });
    if (st.isSymbolicLink()) symlinkSync(internalLink(tree, file), path);
    else if (st.isFile()) writeFileSync(path, readFileSync(source), { flag: 'wx', mode: st.mode & 0o777 });
    else fail(`unsupported runtime input ${file}`);
  }
}

/** Materialize tracked bytes only, with no checkout hooks, network, or mutable Git linkage. */
function snapshot(tree, revision, target) {
  mkdirSync(target, { recursive: true });
  const entries = execFileSync('git', ['ls-tree', '-rz', '--full-tree', revision], { cwd: tree, encoding: 'utf8' }).split('\0').filter(Boolean);
  for (const entry of entries) {
    const tab = entry.indexOf('\t');
    const meta = entry.slice(0, tab); const file = entry.slice(tab + 1);
    const [mode, type, oid] = meta.split(' ');
    if (type !== 'blob' || mode === '120000') fail(`unsupported symlink/submodule in verification snapshot: ${file}`);
    const path = join(target, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, execFileSync('git', ['cat-file', 'blob', oid], { cwd: tree, maxBuffer: 32 * 1024 * 1024 }), { mode: mode === '100755' ? 0o755 : 0o644 });
  }
}

function execute(check, cwd, phase, dir, maxMs) {
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const result = spawnSync(check.argv[0], check.argv.slice(1), { cwd, encoding: 'utf8', shell: false,
    env: { ...process.env, NODE_TEST_CONTEXT: undefined },
    timeout: Math.max(1, Math.min(check.timeoutMs ?? 120000, maxMs)), killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024 });
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const outputPath = join(dir, `${phase}.txt`);
  writeFileSync(outputPath, output, { flag: 'wx' });
  const summaries = parseAllEvidence(output);
  const last = summaries.at(-1);
  // Actual process status always outranks printed output, including a spoofed exit line.
  const passed = !result.error && !result.signal && result.status === 0 && (check.type === 'command' || last?.green === true && last.passed > 0);
  return { phase, argv: check.argv, cwd, startedAt, endedAt: new Date().toISOString(), wallTimeMs: performance.now() - start,
    exitCode: result.status, signal: result.signal, error: result.error?.message ?? null,
    outputPath, outputHash: hash(output), summaries, passed };
}

export function verifyLane(dir, run, lane, { now = () => new Date().toISOString() } = {}) {
  if (run.harness?.version !== 1) fail('legacy runs require explicit migration before receipt verification');
  const contract = contractForLane(run.harness.contract, lane.slug);
  if (hash(run.harness.contract) !== run.harness.contractHash) fail('contract changed after approval');
  const tree = laneTree(dir, run, lane);
  if (gitText(tree, 'status', '--porcelain', '--untracked-files=all')) fail('commit all implementation and test inputs before verification');
  const head = gitText(tree, 'rev-parse', 'HEAD');
  const base = run.harness.bases[lane.slug];
  if (!base) fail(`no reviewed base for ${lane.slug}`);
  const risk = checkScope(tree, base, head, contract);
  run.harness.riskHistory ??= [];
  if (!run.harness.riskHistory.some((r) => r.head === head && r.lane === lane.slug)) run.harness.riskHistory.push({ ...risk, head, lane: lane.slug });
  if (risk.kind !== 'fast-docs') lane.review.maxRounds = Math.max(lane.review.maxRounds ?? 1, risk.kind === 'deep' ? 4 : 2);
  if (risk.kind === 'deep' || contract.risk === 'sensitive') run.reasoningPolicy = { ...run.reasoningPolicy, risk: 'sensitive' };
  const inputHash = inputIdentity(tree);
  const generation = run.execution?.generation ?? run.createdAt;
  const attempt = attemptIdentity(run, lane);
  if (!attempt) fail('implementation has not been dispatched');
  const receipts = [];
  const batchId = randomUUID();
  // Canonical storage, deliberately outside child-facing execution artifacts.
  const root = join(dir, 'verification', batchId);
  mkdirSync(root, { recursive: true });
  for (const check of contract.checks) {
    const remaining = budgetStatus(run, now());
    if (remaining?.expired) fail('time allowance expired before required command; resume within the persisted cap');
    const id = randomUUID();
    const store = join(root, id);
    mkdirSync(store);
    const common = { schema: 1, id, batchId, check: check.id, type: check.type, criteria: check.criteria, head, base,
      contractHash: run.harness.contractHash, inputHash, generation, attempt, environmentHash: envIdentity() };
    let red = null;
    let testHash = null;
    let redTestsUnchanged = true;
    if (check.type === 'regression') {
      const scratch = mkdtempSync(join(run.execution ? join(run.execution.path, 'tmp') : tmpdir(), 'issueflow-red-'));
      snapshot(tree, base, scratch);
      copyRuntimeInputs(tree, scratch);
      const tests = check.testFiles.map((file) => [file, readFileSync(join(tree, file))]);
      testHash = hash(tests.map(([file, bytes]) => [file, hash(bytes)]));
      for (const [file, bytes] of tests) { mkdirSync(dirname(join(scratch, file)), { recursive: true }); writeFileSync(join(scratch, file), bytes); }
      red = execute(check, scratch, 'red', store, (remaining?.remainingSeconds ?? 120) * 1000);
      redTestsUnchanged = testIdentity(scratch, check.testFiles) === testHash;
    }
    const nextBudget = budgetStatus(run, now());
    if (nextBudget?.expired) fail('time allowance expired after red execution; retained output is not a passing receipt');
    const green = execute(check, tree, 'green', store, (nextBudget?.remainingSeconds ?? 120) * 1000);
    const unchanged = inputHash === inputIdentity(tree) && redTestsUnchanged && (!testHash || testIdentity(tree, check.testFiles) === testHash);
    const redSummary = red?.summaries.at(-1);
    const assertionFailure = red && /ERR_ASSERTION|AssertionError|assert(?:ion)?\s+(?:failed|failure)|Expected:|expected .* (?:to|equal)|--- FAIL:/i.test(readFileSync(red.outputPath, 'utf8'));
    const redValid = !red || red.exitCode !== 0 && red.exitCode != null && !red.signal && !red.error && redSummary?.failed > 0 && !redSummary.loadError && assertionFailure;
    const paired = !red || twoSided([redSummary ?? {}, green.summaries.at(-1) ?? {}]).ok;
    const failure = !unchanged ? 'verification changed its inputs' : red && !redValid ? `red check did not produce an assertion failure (exit ${red.exitCode}); inspect ${red.outputPath}` : !green.passed ? `green check failed (exit ${green.exitCode}); inspect ${green.outputPath}` : !paired ? 'red/green summaries do not establish a regression' : null;
    const receipt = { ...common, testHash, red, green, unchanged, failure, passed: green.passed && redValid && paired && unchanged };
    const path = join(store, 'receipt.json');
    writeFileSync(path, JSON.stringify(receipt, null, 2), { flag: 'wx' });
    receipts.push({ path, hash: hash(readFileSync(path)), check: check.id, passed: receipt.passed });
    // Persist failures as well as successes. A later targeted pass cannot erase another check.
    lane.verification = { batchId, head, base, inputHash, contractHash: run.harness.contractHash, risk, receipts: [...receipts], complete: false };
    saveRun(dir, run);
  }
  lane.verification.complete = true;
  saveRun(dir, run);
  assertVerified(dir, run, lane);
  delete lane.review.localVerificationFailure;
  saveRun(dir, run);
  return lane.verification;
}

export function assertVerified(dir, run, lane) {
  const batch = lane.verification;
  if (!batch?.complete) fail('missing complete controller-observed verification; run verify-run');
  const tree = laneTree(dir, run, lane);
  const contract = contractForLane(run.harness.contract, lane.slug);
  if (hash(run.harness.contract) !== run.harness.contractHash || batch.contractHash !== run.harness.contractHash || batch.head !== gitText(tree, 'rev-parse', 'HEAD') || batch.inputHash !== inputIdentity(tree)) fail('stale code, inputs, or contract; rerun verify-run');
  for (const check of contract.checks) {
    const record = batch.receipts.find((r) => r.check === check.id);
    if (!record || !existsSync(record.path) || hash(readFileSync(record.path)) !== record.hash) fail(`missing or tampered receipt for ${check.id}`);
    const receipt = JSON.parse(readFileSync(record.path, 'utf8'));
    if (receipt.batchId !== batch.batchId || receipt.head !== batch.head || receipt.contractHash !== run.harness.contractHash || receipt.generation !== (run.execution?.generation ?? run.createdAt) || receipt.attempt !== attemptIdentity(run, lane) || !receipt.passed) fail(`failed or stale obligation ${check.id}${receipt.failure ? ': ' + receipt.failure : ''}`);
    if (receipt.environmentHash !== envIdentity()) fail(`changed runtime environment for ${check.id}; rerun verify-run`);
    for (const result of [receipt.red, receipt.green].filter(Boolean)) {
      if (!existsSync(result.outputPath) || hash(readFileSync(result.outputPath)) !== result.outputHash) fail(`tampered command output for ${check.id}`);
    }
  }
  return batch;
}

export function verificationCurrent(dir, run, lane) {
  try { assertVerified(dir, run, lane); return true; } catch { return false; }
}

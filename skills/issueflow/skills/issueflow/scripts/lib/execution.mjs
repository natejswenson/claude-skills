/** Execution storage, durable snapshots, and the source-mode lease. */
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, rmdirSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { saveRun, worktreePath } from './run.mjs';
import { ensureWorktree, registeredLanesUnder, validateWorktree, WorktreeError } from './worktree.mjs';

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const began = (lane) => lane.stages.some((s) => s.state !== 'pending' || s.at?.briefed);
const ownerOf = (dir, run) => ({ dir: realpathSync(dir), createdAt: run.createdAt, issue: run.issue.number });
const matches = (a, b) => a.dir === b.dir && a.createdAt === b.createdAt && a.issue === b.issue;

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const within = (root, path) => path === root || path.startsWith(root + '/');
export const rawRun = (dir) => {
  try { return JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')); }
  catch (err) {
    if (existsSync(join(dir, 'execution-owner.json'))) fail(`cannot read execution ownership at ${dir}; restore run.json before cleanup or dispatch`);
    if (err.code !== 'ENOENT' && !(err instanceof SyntaxError)) throw err;
    return null;
  }
};
const fail = (message) => { throw new WorktreeError(message); };

function record(dir, run) {
  const e = run.execution;
  if (!e) return null;
  const owner = ownerOf(dir, run);
  if (e.version !== 1 || !matches(e.owner ?? {}, owner) || !isAbsolute(e.root ?? '') ||
      !/^[a-f0-9-]{36}$/.test(e.generation ?? '') || e.key !== digest(JSON.stringify(owner)) ||
      e.path !== join(e.root, 'issueflow', e.key, e.generation) || e.source !== realpathSync(run.repo.path) ||
      e.common !== sourceInfo(run).common) {
    fail(`invalid execution ownership at ${dir}; restore the recorded run`);
  }
  if (realpathSync(e.root) !== e.root || within(realpathSync(dir), e.root) ||
      within(join(homedir(), '.claude'), e.root) || within(e.common, e.root) ||
      within(e.root, e.source) || within(e.source, e.root)) {
    fail(`execution root is not an approved workspace location: ${e.root}`);
  }
  return e;
}

/** Validate each existing ancestor, including paths below an otherwise owned root. */
function guarded(root, path) {
  if (!within(root, path)) fail(`execution path escapes ${root}: ${path}`);
  let cursor = path;
  while (within(root, cursor)) {
    const st = lstatSync(cursor, { throwIfNoEntry: false });
    if (st && (st.isSymbolicLink() || realpathSync(cursor) !== cursor)) fail(`unsafe execution path: ${cursor}`);
    if (cursor === root) break;
    cursor = dirname(cursor);
  }
  return path;
}

export function validateExecution(dir, run) {
  const e = record(dir, run);
  if (!e) fail(`Codex execution is not prepared; supply --workspace-root <approved-root> for ${dir}`);
  guarded(e.root, e.path);
  const marker = guarded(e.root, join(e.path, 'owner.json'));
  if (!existsSync(marker) || readFileSync(marker, 'utf8') !== JSON.stringify({ ...e.owner, generation: e.generation, source: e.source, common: e.common })) {
    fail(`missing or mismatched execution owner at ${e.path}; run prepare --workspace-root ${e.root} to recover`);
  }
  return e;
}

/** Canonical directory arguments remain stable; only child-facing paths are routed. */
export function activeRoot(dir, run = rawRun(dir)) {
  if (!run?.execution || (run.runtime === 'codex' && run.offline && !run.execution)) return dir;
  const e = validateExecution(dir, run);
  return guarded(e.root, join(e.path, 'artifacts'));
}

export function activePath(dir, ...parts) {
  const root = activeRoot(dir);
  const path = join(root, ...parts);
  return root === dir ? path : guarded(root, path);
}

export function gitStore(dir, run = rawRun(dir)) {
  if (!run?.execution || run.checkout?.mode === 'source') return run.repo.path;
  const e = validateExecution(dir, run);
  const store = guarded(e.root, join(e.path, 'git-store'));
  for (const part of ['objects', 'refs', 'worktrees']) guarded(e.root, join(store, part));
  if (realpathSync(git(['rev-parse', '--path-format=absolute', '--git-common-dir'], store)) !== store ||
      existsSync(join(store, 'objects', 'info', 'alternates'))) fail(`execution Git storage escapes ${store}`);
  return store;
}

/** Read-only inspection can see legacy state; dispatch must pass this boundary. */
export function prepareOutputs(dir, run, paths) {
  // An explicitly autonomous offline run may renew its budget before the
  // host has supplied a workspace; let that simulation render its next brief.
  // Every real Codex writer, and every prepared execution, remains strict.
  if (run.runtime === 'codex' && !(run.autonomous && run.offline && !run.execution)) validateExecution(dir, run);
  if (run.execution) mkdirSync(guarded(run.execution.root, join(run.execution.path, 'tmp')), { recursive: true });
  for (const path of paths) {
    if (run.execution) guarded(activeRoot(dir, run), path);
    mkdirSync(dirname(path), { recursive: true });
  }
}

export const executionInstructions = (run) => run.execution ? [
  `Set the TMPDIR environment variable for every subprocess to \`${join(run.execution.path, 'tmp')}\`.`,
  'This prepared directory keeps Git temporary files inside the approved workspace.',
  'Write only the declared execution outputs; the parent archives them and persists run.json.',
  '',
] : [];

/** A rebrief binds its output to this generation and excludes the prior delivery. */
export function recordDispatch(dir, run, brief, outputs) {
  if (!run.execution) return;
  const e = validateExecution(dir, run);
  const root = activeRoot(dir, run);
  e.dispatches ??= {};
  const id = randomUUID();
  for (const output of outputs) {
    guarded(root, output);
    const key = relative(root, output);
    const prior = e.dispatches[key]?.excluded ?? [];
    const hash = existsSync(output) ? stableFile(output).hash : null;
    e.dispatches[key] = { id, generation: e.generation, brief: relative(root, brief),
      at: lstatSync(brief).mtimeMs, excluded: [...new Set([...prior, ...(hash ? [hash] : [])])] };
  }
}

export function deliveryCurrent(dir, path, run = rawRun(dir)) {
  if (!run?.execution) return true;
  const root = activeRoot(dir, run);
  guarded(root, path);
  const dispatch = run.execution.dispatches?.[relative(root, path)];
  if (!dispatch || dispatch.generation !== run.execution.generation || !existsSync(path)) return false;
  const file = stableFile(path);
  return file.mtimeMs >= dispatch.at && !dispatch.excluded.includes(file.hash);
}

const deliveries = new Map();
/** Pin the exact bytes read by a gate until its canonical save has succeeded. */
export function readDelivery(dir, path, run = rawRun(dir), { dispatched = true } = {}) {
  if (!run?.execution) return readFileSync(path, 'utf8');
  if (dispatched && !deliveryCurrent(dir, path, run)) fail(`stale or undispatched output ${path}; rebrief and deliver this generation's result`);
  const root = activeRoot(dir, run);
  guarded(root, path);
  const file = stableFile(path);
  const pinned = deliveries.get(realpathSync(dir)) ?? new Map();
  pinned.set(relative(root, path), file.hash);
  deliveries.set(realpathSync(dir), pinned);
  return file.bytes.toString('utf8');
}

export function persistedExecution(dir) { deliveries.delete(realpathSync(dir)); }

function stableFile(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd);
    if (!before.isFile()) fail(`not an execution output file: ${path}`);
    const bytes = readFileSync(fd);
    const after = fstatSync(fd);
    const current = lstatSync(path);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs ||
        current.ino !== after.ino || current.mtimeMs !== after.mtimeMs || current.ctimeMs !== after.ctimeMs) {
      fail(`output changed during archival: ${path}; wait for the child and retry`);
    }
    return { bytes, mtimeMs: after.mtimeMs, hash: digest(bytes) };
  } finally { closeSync(fd); }
}

function filesUnder(root, path = root) {
  if (!existsSync(path)) return [];
  guarded(root, path);
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const file = guarded(root, join(path, entry.name));
    if (entry.isSymbolicLink()) fail(`refusing symlink output ${file}`);
    return entry.isDirectory() ? filesUnder(root, file) : [file];
  });
}

function copyStable(from, to) {
  const snapshot = stableFile(from);
  mkdirSync(dirname(to), { recursive: true });
  writeFileSync(to, snapshot.bytes, { flag: 'wx' });
  utimesSync(to, snapshot.mtimeMs / 1000, snapshot.mtimeMs / 1000);
  return { hash: snapshot.hash, mtimeMs: snapshot.mtimeMs };
}

/** Import before canonical state advances. A failed import leaves active results intact. */
export function archiveExecution(dir, run) {
  if (!run.execution) return;
  const e = validateExecution(dir, run);
  const root = activeRoot(dir, run);
  const archive = join(realpathSync(dir), 'execution-archives', e.generation, randomUUID());
  guarded(realpathSync(dir), archive);
  const files = {};
  try {
    mkdirSync(join(archive, 'artifacts'), { recursive: true });
    for (const path of filesUnder(root)) files[relative(root, path)] = copyStable(path, join(archive, 'artifacts', relative(root, path)));
    for (const [key, hash] of deliveries.get(realpathSync(dir)) ?? []) {
      if (files[key]?.hash !== hash) fail(`output changed after gate read: ${join(root, key)}`);
    }
    const store = gitStore(dir, run);
    const heads = new Set(run.lanes.flatMap((lane) => (lane.review?.rounds ?? []).flatMap((round) => [round.head, round.prevHead])).filter((head) => /^[a-f0-9]{40}$/.test(head ?? '')));
    for (const lane of run.lanes) {
      try { heads.add(git(['rev-parse', '--verify', `refs/heads/${lane.branch}`], store)); } catch { /* Lane not created yet. */ }
    }
    for (const head of heads) git(['update-ref', `refs/issueflow/history/${head}`, head], store);
    const refs = git(['for-each-ref', '--format=%(refname) %(objectname)'], store).split('\n').filter(Boolean);
    if (refs.length || heads.size) git(['bundle', 'create', join(archive, 'history.bundle'), '--all'], store);
    // Recheck the whole copy: an earlier file changing during a later copy is partial delivery.
    for (const [key, file] of Object.entries(files)) {
      const current = stableFile(join(root, key));
      if (current.hash !== file.hash || current.mtimeMs !== file.mtimeMs) fail(`output changed during archival: ${join(root, key)}`);
    }
    const snapshot = { generation: e.generation, path: archive, files, refs, dispatches: e.dispatches ?? {} };
    writeFileSync(join(archive, 'snapshot.json'), JSON.stringify(snapshot), { flag: 'wx' });
    e.archive = snapshot;
  } catch (err) {
    throw new WorktreeError(`could not archive execution outputs from ${root} to ${archive}: ${err.message}; results retained, retry before advancing`);
  }
}

function snapshotOf(dir, run) {
  const e = run.execution;
  const snapshot = e.archive;
  const current = realpathSync(dir);
  const base = join(e.owner.dir, 'execution-archives', e.generation);
  const superseded = dirname(current) === join(e.owner.dir, 'superseded');
  if (e.version !== 1 || e.key !== digest(JSON.stringify(e.owner)) ||
      current !== e.owner.dir && !superseded || !snapshot ||
      snapshot.generation !== e.generation || dirname(snapshot.path) !== base) fail(`missing durable execution snapshot for ${e.path}`);
  const path = guarded(current, join(current, relative(e.owner.dir, snapshot.path)));
  if (readFileSync(join(path, 'snapshot.json'), 'utf8') !== JSON.stringify(snapshot)) fail(`invalid durable snapshot at ${path}`);
  for (const [key, file] of Object.entries(snapshot.files)) {
    const output = guarded(path, join(path, 'artifacts', key));
    if (stableFile(output).hash !== file.hash) fail(`damaged durable output at ${output}`);
  }
  return { ...snapshot, path };
}

/** Historical readers explicitly consume the archive when execution storage is gone. */
export function historyRoot(dir, run) {
  if (!run.execution) return dir;
  return join(snapshotOf(dir, run).path, 'artifacts');
}

export function historyStore(dir, run) {
  if (!run.execution) return run.repo.path;
  const snapshot = snapshotOf(dir, run);
  const store = mkdtempSync(join(tmpdir(), 'issueflow-history-'));
  git(['init', '--bare', store], store);
  git(['fetch', join(snapshot.path, 'history.bundle'), '+refs/*:refs/*'], store);
  return store;
}

export function archivedPath(dir, run, path) {
  if (!run.execution) return path;
  const root = activeRoot(dir, run);
  const key = relative(root, path);
  if (!run.execution.archive?.files[key]) fail(`output has no durable snapshot: ${path}`);
  return join(run.execution.archive.path, 'artifacts', key);
}

/** An approved predecessor keeps its first archived bytes, not a later staging copy. */
export function approveArtifact(dir, run, path) {
  if (!run.execution) return;
  const e = validateExecution(dir, run);
  const root = activeRoot(dir, run);
  const key = relative(root, path);
  const file = e.archive?.files[key];
  if (!file) fail(`approved output has no durable snapshot: ${path}`);
  e.approved ??= {};
  e.approved[key] ??= { path: e.archive.path, hash: file.hash };
}

/** Successors consume the first immutable snapshot and verify it before reading. */
export function approvedArtifactPath(dir, run, path) {
  if (!run.execution) return path;
  const e = validateExecution(dir, run);
  const root = activeRoot(dir, run);
  const key = relative(root, path);
  const approved = e.approved?.[key];
  if (!approved) fail(`approved output has no immutable snapshot: ${path}`);
  const archive = guarded(realpathSync(dir), join(realpathSync(dir), relative(e.owner.dir, approved.path)));
  const snapshot = JSON.parse(readFileSync(join(archive, 'snapshot.json'), 'utf8'));
  const output = guarded(archive, join(archive, 'artifacts', key));
  if (snapshot.path !== approved.path || snapshot.files?.[key]?.hash !== approved.hash || stableFile(output).hash !== approved.hash) {
    fail(`damaged approved output at ${output}`);
  }
  return output;
}

/** Recovery retains only approved references whose durable snapshots still verify. */
function preservedApprovals(dir, e) {
  const durable = realpathSync(dir);
  return Object.fromEntries(Object.entries(e.approved ?? {}).map(([key, approved]) => {
    if (typeof approved?.path !== 'string' || !/^[a-f0-9]{64}$/.test(approved.hash ?? '')) {
      fail(`invalid approved output snapshot for ${key}`);
    }
    const archive = guarded(durable, join(durable, relative(e.owner.dir, approved.path)));
    const snapshot = JSON.parse(readFileSync(join(archive, 'snapshot.json'), 'utf8'));
    const output = guarded(archive, join(archive, 'artifacts', key));
    if (snapshot.path !== approved.path || snapshot.files?.[key]?.hash !== approved.hash || stableFile(output).hash !== approved.hash) {
      fail(`damaged approved output at ${output}`);
    }
    return [key, { path: approved.path, hash: approved.hash }];
  }));
}

function quiescent(run) {
  return [...run.stages, ...run.lanes.flatMap((lane) => lane.stages)].every((s) =>
    ['pending', 'approved', 'skipped'].includes(s.state) && !(s.state === 'pending' && s.at?.briefed)) &&
    run.lanes.every((lane) => (lane.review?.rounds ?? []).every((round) => round.registered && (!round.fix?.briefed || round.fix.reported))) &&
    Object.entries(run.execution?.dispatches ?? {}).every(([key, dispatch]) => {
      if (!key.endsWith('fix-report.json')) return true;
      return run.execution.archive?.files[key]?.mtimeMs >= dispatch.at;
    });
}

/** The host supplies an actual approved root. Naming a path never grants child authority. */
export function prepareExecution(dir, run, { workspaceRoot } = {}) {
  try { return prepare(dir, run, { workspaceRoot }); }
  catch (err) {
    if (err instanceof WorktreeError) throw err;
    throw new WorktreeError(`prepare execution for ${dir}: ${err.message}; retain existing work and retry with an approved workspace root`);
  }
}

function prepare(dir, run, { workspaceRoot }) {
  if (run.runtime !== 'codex') {
    if (workspaceRoot) fail('--workspace-root is only for Codex runs');
    return run;
  }
  if (run.execution && existsSync(run.execution.path)) {
    const e = validateExecution(dir, run);
    if (workspaceRoot && realpathSync(resolve(workspaceRoot)) !== e.root) fail(`resume must reuse recorded workspace root ${e.root}`);
    gitStore(dir, run);
    if (seedApprovals(run)) saveRun(dir, run);
    return run;
  }
  if (!run.execution && run.lanes.some((lane) => existsSync(join(dir, 'briefs', `${lane.slug}-fix-r${lane.review?.rounds?.at(-1)?.round}.md`)) &&
      !lane.review?.rounds?.at(-1)?.fix)) fail(`cannot migrate in-flight fixer at ${dir}; collect its fix report first`);
  const previous = run.execution ? record(dir, run) : null;
  if (!workspaceRoot && !previous) fail(`Codex execution is not prepared at ${dir}; supply --workspace-root <approved-root>`);
  if (!quiescent(run)) fail(`cannot migrate or restore in-flight execution at ${previous?.path ?? dir}; recover the child outputs and commit or preserve dirty lane work before preparing`);
  const info = sourceInfo(run);
  const root = realpathSync(resolve(workspaceRoot ?? previous.root));
  if (within(realpathSync(dir), root) || within(join(homedir(), '.claude'), root) || within(info.common, root) ||
      within(root, info.path) || within(info.path, root)) fail(`not an approved workspace root: ${root}`);
  const owner = ownerOf(dir, run);
  const generation = randomUUID();
  const key = digest(JSON.stringify(owner));
  const path = guarded(root, join(root, 'issueflow', key, generation));
  const approved = previous ? preservedApprovals(dir, previous) : null;
  const e = { version: 1, owner, root, key, generation, path, source: info.path, common: info.common,
    ...(approved && Object.keys(approved).length ? { approved } : {}) };
  const snapshot = previous ? snapshotOf(dir, run) : null;
  const oldRoot = previous ? join(snapshot.path, 'artifacts') : realpathSync(dir);
  if (previous && !existsSync(join(snapshot.path, 'history.bundle'))) fail(`missing execution history at ${previous.path}; unexported commits cannot be recovered`);
  const legacy = previous ? [] : registeredLanesUnder(run.repo.path, dir);
  for (const lane of legacy) {
    const tree = validateWorktree(run.repo.path, dir, lane);
    if (git(['status', '--porcelain', '--untracked-files=all'], tree)) fail(`dirty legacy checkout ${tree}; commit or preserve its work before migration`);
  }
  let lfs = false;
  try { lfs = Boolean(git(['grep', '-I', '-l', 'filter=lfs', 'HEAD', '--', '*gitattributes'], info.path)); }
  catch (err) { if (err.status !== 1) throw err; }
  let worktreeConfig = false;
  try { worktreeConfig = git(['config', '--bool', 'extensions.worktreeConfig'], info.path) === 'true'; } catch (err) { if (err.status !== 1) throw err; }
  if (existsSync(join(info.path, '.gitmodules')) || lfs || worktreeConfig) {
    fail(`submodule, LFS or worktree-specific configuration requires explicit migration at ${info.path}`);
  }
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'owner.json'), JSON.stringify({ ...owner, generation, source: info.path, common: info.common }), { flag: 'wx' });
  const store = join(path, 'git-store');
  git(['init', '--bare', store], root);
  git(['fetch', '--no-tags', previous ? join(snapshot.path, 'history.bundle') : info.path,
    ...(previous ? ['+refs/*:refs/*'] : ['+refs/heads/*:refs/heads/*', '+refs/tags/*:refs/tags/*'])], store);
  if (git(['for-each-ref', '--format=%(refname)', 'refs/remotes/origin'], info.path)) git(['fetch', info.path, '+refs/remotes/origin/*:refs/remotes/origin/*'], store);
  if (git(['remote'], info.path).split('\n').includes('origin')) {
    git(['remote', 'add', 'origin', git(['remote', 'get-url', 'origin'], info.path)], store);
    try { git(['config', '--unset-all', 'remote.origin.fetch'], store); } catch (err) { if (err.status !== 5) throw err; }
    let fetch = [], push = [];
    try { fetch = git(['config', '--get-all', 'remote.origin.fetch'], info.path).split('\n').filter(Boolean); } catch (err) { if (err.status !== 1) throw err; }
    try { push = git(['config', '--get-all', 'remote.origin.pushurl'], info.path).split('\n').filter(Boolean); } catch (err) { if (err.status !== 1) throw err; }
    for (const spec of fetch) git(['config', '--add', 'remote.origin.fetch', spec], store);
    for (const url of push) git(['config', '--add', 'remote.origin.pushurl', url], store);
  }
  for (const config of ['user.name', 'user.email']) {
    try { git(['config', config, git(['config', '--get', config], info.path)], store); } catch (err) { if (err.status !== 1) throw err; }
  }
  for (const lane of legacy) {
    if (git(['rev-parse', lane.branch], info.path) !== git(['rev-parse', lane.branch], store)) fail(`legacy tip mismatch for ${lane.branch}; preserved ${dir}`);
  }
  const artifacts = join(path, 'artifacts');
  mkdirSync(artifacts);
  const names = previous ? readdirSync(oldRoot) : ['shared', 'briefs', 'progress', 'reviews', ...run.lanes.map((lane) => lane.slug)];
  for (const name of new Set(names)) {
    for (const from of filesUnder(realpathSync(oldRoot), join(oldRoot, name))) copyStable(from, join(artifacts, relative(oldRoot, from)));
  }
  e.priorRoots = [...(previous?.priorRoots ?? []), previous?.path ?? realpathSync(dir)];
  const restored = previous ? run.lanes.filter((lane) => !lane.landed && run.checkout?.mode !== 'source' && began(lane)) : legacy;
  const staged = { ...run, execution: e };
  for (const lane of restored) ensureWorktree(store, dir, lane, { offline: true, lanes: run.lanes, executionRun: staged });
  saveRun(dir, staged);
  // A legacy run arrives with stages the old layout already approved. Their
  // migration copy is the first immutable snapshot successors may read, so it
  // is registered as approved here — accept never runs for them again.
  if (seedApprovals(staged)) saveRun(dir, staged);
  Object.assign(run, staged);
  return run;
}

/**
 * Register an archived artifact as the approved snapshot for every approved
 * stage that has none. Only migration produces that state: accept records the
 * approval itself, so on a run that was never legacy this changes nothing.
 */
function seedApprovals(run) {
  const e = run.execution;
  if (!e?.archive) return false;
  const steps = [
    ...run.stages.map((stage) => ({ key: `shared/${stage.artifact}`, stage })),
    ...run.lanes.flatMap((lane) => lane.stages.map((stage) => ({ key: `${lane.slug}/${stage.artifact}`, stage }))),
  ];
  let seeded = false;
  for (const { key, stage } of steps) {
    if (stage.state !== 'approved' || e.approved?.[key]) continue;
    const file = e.archive.files[key];
    // No archived copy means nothing to register; the successor's read reports it.
    if (!file) continue;
    e.approved ??= {};
    e.approved[key] = { path: e.archive.path, hash: file.hash };
    seeded = true;
  }
  return seeded;
}

function sourceInfo(run) {
  const path = realpathSync(run.repo.path);
  if (realpathSync(git(['rev-parse', '--show-toplevel'], path)) !== path) {
    throw new WorktreeError(`source checkout ${path} is not a repository root`);
  }
  const common = realpathSync(git(['rev-parse', '--path-format=absolute', '--git-common-dir'], path));
  return { path, common, lease: join(common, 'issueflow-source-lease.json') };
}

function sourceLease(dir, run, lane, acquire, reserve = false) {
  let lock = null;
  try {
    const info = sourceInfo(run);
    if (run.checkout?.path && (run.checkout.path !== info.path || run.checkout.common !== info.common)) {
      throw new WorktreeError('source checkout identity changed; restore the recorded checkout');
    }
    if (acquire) {
      mkdirSync(info.lease + '.lock');
      lock = info.lease + '.lock';
    }
    const owner = { ...ownerOf(dir, run), lane: reserve ? null : lane.slug, path: info.path };
    if (lstatSync(info.lease, { throwIfNoEntry: false })?.isSymbolicLink()) {
      throw new WorktreeError(`source checkout lease is a symlink: ${info.lease}`);
    }
    if (acquire && !existsSync(info.lease)) {
      try {
        writeFileSync(info.lease, JSON.stringify(owner), { flag: 'wx' });
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
      }
    }
    if (!existsSync(info.lease)) throw new WorktreeError(`missing source checkout lease at ${info.lease} — rebrief explicitly with --no-worktree`);
    const held = JSON.parse(readFileSync(info.lease, 'utf8'));
    if (!matches(held, owner) || held.path !== owner.path) {
      throw new WorktreeError(`source checkout is leased by ${held.dir} (${info.lease}); finish that run or explicitly take it over`);
    }
    if (held.lane !== owner.lane) {
      const previous = run.lanes.find((candidate) => candidate.slug === held.lane);
      const finishedImplementing = previous?.stages.some((stage) => stage.id === 'implement' && stage.state === 'approved');
      if (!acquire || (!run.checkout?.mode && held.lane !== null) || (previous && !finishedImplementing)) {
        throw new WorktreeError(`source checkout is leased by active lane ${held.lane}; overlapping writable lanes require worktrees`);
      }
      writeFileSync(info.lease, JSON.stringify(owner));
    }
    return info;
  } catch (err) {
    if (err instanceof WorktreeError) throw err;
    throw new WorktreeError(`source checkout lease for ${run.repo.path}: ${err.message}`);
  } finally {
    if (lock) rmdirSync(lock);
  }
}

export function sourceTree(dir, run, lane) {
  sourceLease(dir, run, lane, false);
  return run.repo.path;
}

/** A persisted mode is sticky. Missing legacy mode never grants source access. */
export function prepareCheckout(dir, run, lane, { noWorktree = false, reserve = false } = {}) {
  if (run.checkout && !['source', 'worktree'].includes(run.checkout.mode)) {
    throw new WorktreeError('unknown checkout mode; restore the run record');
  }
  if (noWorktree && run.checkout?.mode === 'worktree' && run.lanes.some(began)) {
    throw new WorktreeError('cannot change checkout mode after implementation has begun');
  }
  const legacyWorktree = !run.checkout && run.lanes.find((candidate) => began(candidate) && existsSync(worktreePath(dir, candidate)));
  if (noWorktree && legacyWorktree) {
    validateWorktree(gitStore(dir, run), dir, legacyWorktree);
    throw new WorktreeError('legacy implementation already owns a worktree; restore that checkout instead of changing mode');
  }
  if (noWorktree || run.checkout?.mode === 'source') {
    const info = sourceLease(dir, run, lane, true, reserve);
    run.checkout = { mode: 'source', path: info.path, common: info.common };
    saveRun(dir, run);
    return run.repo.path;
  }
  // A disappeared dispatched checkout may contain unpushed work; recreating
  // one from a branch would conceal the loss.
  if (run.runtime === 'codex' && !(run.autonomous && run.offline && !run.execution)) validateExecution(dir, run);
  if (began(lane)) validateWorktree(gitStore(dir, run), dir, lane);
  const tree = ensureWorktree(gitStore(dir, run), dir, lane, { offline: run.offline, lanes: run.lanes }).path;
  run.checkout = { mode: 'worktree' };
  saveRun(dir, run);
  return tree;
}

/** Release only this durable run's owner; an unrelated lease is never removed. */
export function releaseSourceLease(dir, run) {
  let lock = null;
  try {
    const info = sourceInfo(run);
    mkdirSync(info.lease + '.lock');
    lock = info.lease + '.lock';
    if (!existsSync(info.lease)) return;
    const held = JSON.parse(readFileSync(info.lease, 'utf8'));
    if (!matches(held, ownerOf(dir, run))) throw new WorktreeError(`refusing to release another run's source lease at ${info.lease}`);
    unlinkSync(info.lease);
  } catch (err) {
    if (err instanceof WorktreeError) throw err;
    throw new WorktreeError(`release source checkout lease: ${err.message}`);
  } finally {
    if (lock) rmdirSync(lock);
  }
}

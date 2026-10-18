import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { open, readFile, mkdir, chmod, lstat, unlink, rename } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectAgent } from './agent.mjs';

const command = promisify(execFile);
const appRootDefault = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const derivation = `const {createHmac}=require('node:crypto');const token=process.env.PREVIEW_API_TOKEN;if(typeof token!=='string'||token.length<32)process.exit(1);const key=role=>createHmac('sha256',token).update('skills-studio-'+role).digest('hex');process.stdout.write(JSON.stringify({agent:key('agent'),browser:key('browser')}));`;
const sleep = milliseconds => new Promise(done => setTimeout(done, milliseconds));

async function privateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Preview data directory must be a real local directory.');
  await chmod(path, 0o700);
}
async function readOwner(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > 4096) throw new Error('Invalid owner lock.');
    const owner = JSON.parse(await handle.readFile('utf8'));
    if (!Number.isSafeInteger(owner.pid) || owner.pid < 1 || typeof owner.owner !== 'string' || !owner.owner) throw new Error('Invalid owner lock.');
    return owner;
  } finally { await handle.close(); }
}
function demonstrablyDead(pid) {
  try { process.kill(pid, 0); return false; }
  catch (error) { return error.code === 'ESRCH'; }
}

/** A live or unrecognizable owner is never replaced. The recovery lock serializes stale-lock reclamation. */
export async function acquireOwnerLock(directory) {
  const path = join(directory, 'owner.lock');
  const owner = { pid: process.pid, owner: randomUUID() };
  async function claim() {
    const handle = await open(path, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(owner)); }
    finally { await handle.close(); }
  }
  try { await claim(); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const recoveryPath = join(directory, 'owner-recovery.lock');
    let recovery;
    try {
      recovery = await open(recoveryPath, 'wx', 0o600);
      const previous = await readOwner(path);
      if (!demonstrablyDead(previous.pid)) throw new Error('A preview backend owner is already running or cannot be verified.');
      await unlink(path);
      await claim();
    } catch {
      throw new Error('Preview owner lock is occupied or cannot be safely recovered.');
    } finally {
      if (recovery) { await recovery.close(); await unlink(recoveryPath); }
    }
  }
  return {
    async release() {
      try {
        const current = await readOwner(path);
        if (current.pid === owner.pid && current.owner === owner.owner) await unlink(path);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    },
  };
}

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolvePort(port));
    });
  });
}
async function bootstrap(port) {
  const response = await fetch(`http://127.0.0.1:${port}/api/bootstrap`, { signal: AbortSignal.timeout(2000), redirect: 'error' });
  if (!response.ok) throw new Error('Backend is not ready.');
  return response.json();
}
function parseJSON(value, message) {
  try { return JSON.parse(value); } catch { throw new Error(message); }
}
async function certificate(env, run) {
  let path = env.PREVIEW_CA_FILE;
  if (!path) {
    let result;
    try { result = await run('mkcert', ['-CAROOT'], { env, timeout: 10000, maxBuffer: 1024 * 1024 }); }
    catch { throw new Error('Could not find the local mkcert public CA. Set PREVIEW_CA_FILE if needed.'); }
    path = join(result.stdout.trim(), 'rootCA.pem');
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > 1024 * 1024 || !info.size) throw new Error('Invalid public preview CA file.');
    return await handle.readFile();
  } finally { await handle.close(); }
}
async function saveAccess(directory, value) {
  const path = join(directory, 'browser-access.json');
  const temporary = join(directory, `.browser-access-${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); }
  finally { await handle.close(); }
  try { await rename(temporary, path); }
  catch (error) { await unlink(temporary).catch(() => {}); throw error; }
  return path;
}

/** The only backend controlled by this supervisor is the child it spawns itself. */
export async function startPreview({ previewId, appRoot = appRootDefault, env = process.env, readyTimeoutMs = 30000, signal, log = console.log }, dependencies = {}) {
  if (!/^p-[a-f0-9]{12}$/.test(previewId || '')) throw new Error('Use --preview with a valid tk preview ID.');
  if (!Number.isFinite(readyTimeoutMs) || readyTimeoutMs < 1 || readyTimeoutMs > 60000) throw new Error('Preview ready timeout must be between 1 and 60000 ms.');
  const deps = { command, spawn, choosePort: freePort, bootstrap, connect: connectAgent, ...dependencies };
  const url = `https://skills-studio-${previewId}.dev.internal`;
  const tk = env.TK_BIN || 'tk';
  let owner, child, agent, exited = false, started = false, closing;
  let keys, timeout, rejectBackend, resolveExit, resolveClosed, rejectAbort;
  const childExit = new Promise(done => { resolveExit = done; });
  const backendFailure = new Promise((_, reject) => { rejectBackend = reject; });
  backendFailure.catch(() => {});
  const aborted = new Promise((_, reject) => { rejectAbort = reject; });
  aborted.catch(() => {});
  const closed = new Promise(done => { resolveClosed = done; });
  let deadline;
  const wait = task => Promise.race([task, backendFailure, aborted, ...(deadline ? [deadline] : [])]);
  async function close(reason = 'closed') {
    if (closing) return closing;
    closing = (async () => {
      signal?.removeEventListener('abort', onAbort);
      clearTimeout(timeout);
      try { agent?.close(); }
      finally {
        if (child && !exited) {
          child.kill('SIGTERM');
          let stopTimer;
          try {
            await Promise.race([childExit, new Promise((_, reject) => { stopTimer = setTimeout(() => reject(new Error('Owned backend did not stop; owner lock retained.')), 5000); })]);
          } finally { clearTimeout(stopTimer); }
        }
        await owner?.release();
        resolveClosed({ reason });
      }
    })();
    return closing;
  }
  function onAbort() {
    rejectAbort(new Error('Preview connection cancelled.'));
    if (started) void close('signal').catch(() => { process.exitCode = 1; });
  }
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();
  try {
    let status;
    try { status = await wait(deps.command(tk, ['dev', 'status', '--preview', previewId, '--json'], { env, timeout: 15000, maxBuffer: 1024 * 1024 })); }
    catch { throw new Error('Could not inspect the selected tk preview.'); }
    const result = parseJSON(status.stdout, 'Invalid tk preview status.');
    const preview = result.preview;
    if (result.ok !== true || result.schema_version !== 1 || preview?.id !== previewId || preview.app !== 'skills-studio' || preview.binding?.root !== appRoot || preview.state !== 'ready' || preview.url !== url) {
      throw new Error('Preview must be ready and bound to this exact Skills Studio worktree and URL.');
    }
    const dataRoot = join(appRoot, '.studio-data');
    const kubernetes = join(dataRoot, 'kubernetes');
    const directory = join(kubernetes, previewId);
    for (const path of [dataRoot, kubernetes, directory]) await privateDirectory(path);
    owner = await acquireOwnerLock(directory);
    const backend = join(directory, 'backend'), workspace = join(directory, 'workspace');
    for (const path of [backend, workspace]) await privateDirectory(path);
    const ca = await wait(certificate(env, deps.command));
    let pod;
    try { pod = await wait(deps.command(tk, ['dev', 'kubectl', '--preview', previewId, '--json', '--', 'exec', 'deployment/app', '--', 'node', '-e', derivation], { env, timeout: 15000, maxBuffer: 1024 * 1024 })); }
    catch { throw new Error('Could not derive scoped preview credentials inside the selected pod.'); }
    const podResult = parseJSON(pod.stdout, 'Invalid scoped preview credential response.');
    if (podResult.ok !== true || podResult.preview_id !== previewId || podResult.exit_code !== 0) throw new Error('Scoped preview credential derivation failed.');
    keys = parseJSON(podResult.stdout, 'Invalid derived preview keys.');
    if (!keys || Object.keys(keys).sort().join(',') !== 'agent,browser' || !/^[a-f0-9]{64}$/.test(keys.agent) || !/^[a-f0-9]{64}$/.test(keys.browser) || keys.agent === keys.browser) throw new Error('Invalid derived preview keys.');
    const backendPort = await wait(deps.choosePort());
    if (!Number.isInteger(backendPort) || backendPort < 1 || backendPort > 65535 || backendPort === 4317) throw new Error('Could not reserve a separate local backend port.');
    deadline = new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Preview backend and subscription did not become ready before timeout.')), readyTimeoutMs); });
    deadline.catch(() => {});
    child = deps.spawn(process.execPath, [join(appRoot, 'server/index.mjs')], { cwd: appRoot, env: { ...env, PORT: String(backendPort), STUDIO_DATA_DIR: backend, STUDIO_WORKSPACE: workspace }, stdio: ['ignore', 'pipe', 'pipe'] });
    const stopped = () => {
      exited = true; resolveExit();
      rejectBackend(new Error('Owned preview backend exited before it was ready.'));
      if (started && !closing) void close('backend-exit').catch(() => { process.exitCode = 1; });
    };
    child.once('exit', stopped);
    child.once('error', stopped);
    let resolveListening;
    const listening = new Promise(done => { resolveListening = done; });
    const sanitize = line => line.replaceAll(keys.agent, '[redacted]').replaceAll(keys.browser, '[redacted]')
      .replace(/\bBearer\s+\S+|\bsk-[\w-]+|\beyJ[\w.-]+|\b[a-f\d]{64}\b/gi, '[redacted]')
      .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').slice(0, 2000);
    for (const stream of [child.stdout, child.stderr]) {
      let pending = '';
      stream.on('data', chunk => {
        pending += chunk.toString();
        let newline;
        while ((newline = pending.indexOf('\n')) !== -1) {
          const line = pending.slice(0, newline).trim(); pending = pending.slice(newline + 1);
          if (stream === child.stdout && line === `Skills Studio: http://127.0.0.1:${backendPort}`) resolveListening();
          if (line.includes('EADDRINUSE')) rejectBackend(new Error('Owned preview backend could not bind its port.'));
          if (line) log(`Backend: ${sanitize(line)}`);
        }
        if (pending.length > 8192) { log('Backend: diagnostic line omitted.'); pending = ''; }
      });
    }
    await wait(listening);
    while (true) {
      const state = await wait(deps.bootstrap(backendPort).catch(() => null));
      if (state?.account?.type === 'chatgpt' && state.connection?.status === 'connected') break;
      await wait(sleep(100));
    }
    agent = deps.connect({ bridgeUrl: url.replace('https:', 'wss:') + '/_bridge', expectedHost: new URL(url).host, backendPort, agentToken: keys.agent, ca, onState: state => { if (started && state === 'disconnected') log('Preview worker disconnected; reconnecting.'); } });
    await wait(agent.ready);
    const accessFile = await wait(saveAccess(directory, { url, code: keys.browser }));
    clearTimeout(timeout); deadline = undefined;
    started = true;
    log(`Browser access file: ${accessFile}`);
    log(`Ready: ${url}`);
    return { url, backendPort, accessFile, close, closed };
  } catch (error) {
    await close('failed');
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const abort = new AbortController();
  const stop = () => abort.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    const args = process.argv.slice(2);
    if (args.length !== 2 || args[0] !== '--preview') throw new Error('Usage: node preview/connect.mjs --preview p-<12 hex characters>');
    const worker = await startPreview({ previewId: args[1], signal: abort.signal, readyTimeoutMs: 60000 });
    const { reason } = await worker.closed;
    if (reason === 'backend-exit') process.exitCode = 1;
  } catch (error) {
    if (!abort.signal.aborted) { console.error(error.message); process.exitCode = 1; }
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}

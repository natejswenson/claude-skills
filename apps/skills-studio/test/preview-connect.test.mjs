import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, mkdir, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startPreview, acquireOwnerLock } from '../preview/connect.mjs';

const previewId = 'p-012345abcdef';
const url = `https://skills-studio-${previewId}.dev.internal`;
const keys = { agent: 'a'.repeat(64), browser: 'b'.repeat(64) };
async function fixture(t, overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), 'studio-supervisor-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'rootCA.pem'), 'public-test-ca');
  const events = [], logs = [], commands = [], bootstrapCalls = [];
  let child, connection;
  const deps = {
    async command(command, args) {
      commands.push({ command, args });
      if (command === 'mkcert') return { stdout: root };
      if (args.includes('status')) return { stdout: JSON.stringify({ schema_version: 1, ok: true, preview: { id: previewId, app: 'skills-studio', state: 'ready', url, binding: { root }, ...overrides.status } }) };
      return { stdout: JSON.stringify({ ok: true, preview_id: previewId, exit_code: 0, stdout: JSON.stringify(overrides.keys || keys) }) };
    },
    async choosePort() { return 43219; },
    spawn(command, args, options) {
      events.push('spawn');
      child = new EventEmitter();
      child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.pid = 12345;
      child.command = command; child.args = args; child.options = options;
      child.kill = signal => { events.push(signal); setImmediate(() => child.emit('exit', 0, signal)); return true; };
      setImmediate(() => {
        if (overrides.bindFailure) { child.stderr.write('EADDRINUSE'); child.emit('exit', 1, null); }
        else { events.push('listening'); child.stdout.write(`Skills Studio: http://127.0.0.1:${options.env.PORT}\n`); child.stderr.write(`diagnostic ${keys.agent} ${keys.browser}\n`); }
      });
      return child;
    },
    async bootstrap(port) { events.push('bootstrap'); bootstrapCalls.push(port); return overrides.bootstrap || { account: { type: 'chatgpt' }, connection: { status: 'connected' } }; },
    connect(options) { events.push('connect'); connection = options; return { ready: Promise.resolve(), close() { events.push('agent-close'); } }; },
  };
  const start = () => startPreview({ previewId, appRoot: root, readyTimeoutMs: 100, log: value => logs.push(value), env: {} }, deps);
  return { root, start, events, commands, logs, bootstrapCalls, get child() { return child; }, get connection() { return connection; } };
}

test('wrong worktree or preview identity is rejected before any pod command or backend starts', async t => {
  for (const status of [{ binding: { root: '/some/other/worktree' } }, { id: 'p-fedcba543210' }, { app: 'other' }, { state: 'starting' }, { url: `${url}/unexpected` }]) {
    const f = await fixture(t, { status });
    await assert.rejects(f.start());
    assert.equal(f.commands.length, 1);
    assert.deepEqual(f.events, []);
  }
});

test('supervisor owns a separate private backend, gates bridge connection on listening and subscription readiness, and stores only private browser access', async t => {
  const f = await fixture(t);
  const worker = await f.start();
  try {
    assert.deepEqual(f.events.slice(0, 4), ['spawn', 'listening', 'bootstrap', 'connect']);
    assert.equal(f.child.options.env.PORT, '43219');
    assert.equal(f.child.options.env.STUDIO_DATA_DIR, join(f.root, '.studio-data/kubernetes', previewId, 'backend'));
    assert.equal(f.child.options.env.STUDIO_WORKSPACE, join(f.root, '.studio-data/kubernetes', previewId, 'workspace'));
    assert.equal(f.connection.bridgeUrl, url.replace('https:', 'wss:') + '/_bridge');
    assert.equal(f.connection.expectedHost, new URL(url).host);
    assert.equal(f.connection.agentToken, keys.agent);
    assert.equal(f.connection.ca.toString(), 'public-test-ca');
    const podCommand = f.commands.find(entry => entry.args.includes('kubectl'));
    assert.deepEqual(podCommand.args.slice(0, 10), ['dev', 'kubectl', '--preview', previewId, '--json', '--', 'exec', 'deployment/app', '--', 'node']);
    assert.match(podCommand.args.at(-1), /createHmac/);
    assert.doesNotMatch(podCommand.args.at(-1), new RegExp(keys.agent));
    assert.deepEqual(JSON.parse(await readFile(worker.accessFile, 'utf8')), { url, code: keys.browser });
    assert.equal((await stat(worker.accessFile)).mode & 0o777, 0o600);
    assert.equal((await stat(join(f.root, '.studio-data/kubernetes', previewId))).mode & 0o777, 0o700);
    assert.equal(f.logs.join('\n').includes(keys.agent), false);
    assert.equal(f.logs.join('\n').includes(keys.browser), false);
  } finally { await worker.close(); }
  assert.deepEqual(f.events.slice(-2), ['agent-close', 'SIGTERM']);
  await assert.rejects(stat(join(f.root, '.studio-data/kubernetes', previewId, 'owner.lock')), { code: 'ENOENT' });
});

test('a failed owned bind never probes an existing local backend or connects the bridge', async t => {
  const f = await fixture(t, { bindFailure: true });
  await assert.rejects(f.start(), /backend/i);
  assert.equal(f.bootstrapCalls.length, 0);
  assert.equal(f.events.includes('connect'), false);
});

test('unready subscription times out and stops only its owned backend', async t => {
  const f = await fixture(t, { bootstrap: { account: { type: 'apikey' }, connection: { status: 'connected' } } });
  await assert.rejects(f.start(), /subscription|ready|timed out/i);
  assert.equal(f.events.includes('connect'), false);
  assert.equal(f.events.at(-1), 'SIGTERM');
  const lock = await acquireOwnerLock(join(f.root, '.studio-data/kubernetes', previewId));
  await lock.release();
});

test('invalid derived keys are refused without spawning or printing them', async t => {
  const f = await fixture(t, { keys: { agent: 'not-a-key', browser: keys.browser } });
  await assert.rejects(f.start(), /key|credential|token/i);
  assert.deepEqual(f.events, []);
  assert.equal(f.logs.join('\n').includes(keys.browser), false);
});

test('owner lock excludes concurrent workers and never removes a replacement owner', async t => {
  const root = await mkdtemp(join(tmpdir(), 'studio-lock-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const owner = await acquireOwnerLock(root);
  await assert.rejects(acquireOwnerLock(root), /owner|already|running/i);
  await rm(join(root, 'owner.lock'));
  await writeFile(join(root, 'owner.lock'), JSON.stringify({ pid: process.pid, owner: 'replacement' }), { mode: 0o600 });
  await owner.release();
  assert.equal(JSON.parse(await readFile(join(root, 'owner.lock'), 'utf8')).owner, 'replacement');
});

test('owner lock recovers only a demonstrably dead pid and refuses malformed ownership', async t => {
  const root = await mkdtemp(join(tmpdir(), 'studio-lock-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'owner.lock'), JSON.stringify({ pid: 1073741823, owner: 'dead' }), { mode: 0o600 });
  const owner = await acquireOwnerLock(root);
  assert.equal(JSON.parse(await readFile(join(root, 'owner.lock'), 'utf8')).pid, process.pid);
  await owner.release();
  await writeFile(join(root, 'owner.lock'), 'not json', { mode: 0o600 });
  await assert.rejects(acquireOwnerLock(root), /owner|lock/i);
});
